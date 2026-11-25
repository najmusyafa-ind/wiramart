// =============================================================
// PATCH /api/kasir/shift/tutup — Tutup shift aktif secara manual
// Auth: Employee JWT required
// Body: { actualCash?: number, breakdown?: Record<string, number>, notes?: string, pinKetuaShift?: string }
//
// Business Rules:
//   1. Hanya shift ACTIVE yang bisa ditutup.
//   2. clockOut di-set ke waktu sekarang (WIB).
//   3. status → CLOSED.
//   4. Blind Count: saldoAkhirLaci / expected TIDAK dikirim ke kasir.
//   5. K3 Fraud Detection: Jika ada penjualan tunai (omzetCash > 0),
//      tetapi laci fisik masih persis sama dengan modalAwal,
//      beri flag 'FRAUD_CASH_SUSPICIOUS' untuk audit Manajer.
//   6. K17 PIN Ketua Shift: Otorisasi tutup shift oleh Ketua Shift (jika ditugaskan).
// =============================================================

import { z } from 'zod';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, transactions, transactionPayments, shiftCashMovements, employees } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import {
  SHORTAGE_TOLERANCE_RP,
  SHORTAGE_GRACE_MS,
  MAX_GRACE_RECOUNTS,
  getUnsettledConsignmentsForToday,
  resolveSameSessionShiftContext,
} from '@/lib/services/shiftShortageService';
import { resolveActiveDrawerShift } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';

const tutupShiftSchema = z.object({
  actualCash: z.number({ message: 'Nominal uang fisik di laci wajib diisi (Blind Count).' }).min(0, 'Saldo fisik kas tidak boleh negatif').max(50_000_000, 'Nilai terlalu besar'),
  breakdown: z.record(z.string(), z.number()).optional(),
  notes: z.string().max(500).optional(),
  earlyCloseReason: z.enum(['NORMAL', 'KULIAH', 'IZIN_DOSEN']).optional().default('NORMAL'),
  pinKetuaShift: z.string().min(1, 'PIN tidak boleh kosong').max(20).optional(),
  pin: z.string().min(1, 'PIN tidak boleh kosong').max(20).optional(),
});

export async function PATCH(req: NextRequest): Promise<Response> {
  // 1. Auth
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  // 2. Parse body (opsional)
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // body kosong → OK
  }

  const parsed = tutupShiftSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { notes, actualCash, breakdown, earlyCloseReason } = parsed.data;

  // 3. Cari shift aktif terisolasi sesi & sandbox via resolveActiveDrawerShift (anti cross-session hijack)
  const resolvedDrawer = await resolveActiveDrawerShift({
    employeeId,
    employeeName: payload.name,
    host: req.headers.get('host'),
  });
  const activeShift = resolvedDrawer.activeShift
    ? await db.query.shifts.findFirst({
        where: and(eq(shifts.id, resolvedDrawer.activeShift.id), eq(shifts.status, 'ACTIVE')),
        columns: { id: true, employeeId: true, clockIn: true, modalAwal: true, auditFlags: true },
      })
    : undefined;

  if (!activeShift) {
    return apiError(
      'Tidak ada shift aktif yang perlu ditutup.',
      'NO_ACTIVE_SHIFT',
      404,
    );
  }

  // 4. Gabungkan sub-shift yang terputus tanpa hitung fisik (actual_cash IS NULL) pada sesi WIB yang sama
  // agar angka Tutup Shift Kasir selalu 100% sinkron dengan laporan Admin (/api/admin/laporan/per-shift).
  const sessionCtx = await resolveSameSessionShiftContext({
    id: activeShift.id,
    employeeId: activeShift.employeeId,
    clockIn: new Date(activeShift.clockIn),
    modalAwal: activeShift.modalAwal,
  });

  // 5. Hitung jumlah transaksi completed lintas sub-shift sesi ini
  const [summary] = await db
    .select({
      txCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false)`,
    })
    .from(transactions)
    .where(inArray(transactions.shiftId, sessionCtx.shiftIds));

  // 5b. Hitung omzet TUNAI & QRIS murni dari transaction_payments (Split Payment aware)
  const [paySummary] = await db
    .select({
      payCash: sql<string>`COALESCE(
        SUM(${transactionPayments.amount})
        FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'CASH' AND ${transactions.isTest} = false),
        0
      )`,
      payQris: sql<string>`COALESCE(
        SUM(${transactionPayments.amount})
        FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'QRIS' AND ${transactions.isTest} = false),
        0
      )`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
    .where(inArray(transactions.shiftId, sessionCtx.shiftIds));

  // 5c. Transaksi langsung legacy (jika ada baris transaksi tanpa transaction_payments)
  // PENTING: NOT EXISTS wajib di .where() dengan alias eksplisit (tp.transaction_id = transactions.id)
  // karena Drizzle ORM men-strip qualifier tabel jika ditaruh di dalam .select() FILTER (...).
  const [directSummary] = await db
    .select({
      directCash: sql<string>`COALESCE(
        SUM(${transactions.grossAmount})
        FILTER (WHERE ${transactions.paymentMethod} = 'CASH'),
        0
      )`,
      directQris: sql<string>`COALESCE(
        SUM(${transactions.grossAmount})
        FILTER (WHERE ${transactions.paymentMethod} = 'QRIS'),
        0
      )`,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.shiftId, sessionCtx.shiftIds),
        eq(transactions.status, 'COMPLETED'),
        eq(transactions.isTest, false),
        sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = transactions.id)`,
      ),
    );

  // 5d. Ambil potongan bayar supplier / kas gerak pada sesi shift ini + nama kasir
  const [movements, kasirRow] = await Promise.all([
    db
      .select({
        id: shiftCashMovements.id,
        movementType: shiftCashMovements.movementType,
        category: shiftCashMovements.category,
        amount: shiftCashMovements.amount,
        notes: shiftCashMovements.notes,
      })
      .from(shiftCashMovements)
      .where(inArray(shiftCashMovements.shiftId, sessionCtx.shiftIds)),
    db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: { fullName: true },
    }),
  ]);

  const totalOmzetCash = Number(paySummary?.payCash ?? 0) + Number(directSummary?.directCash ?? 0);
  const totalOmzetQris = Number(paySummary?.payQris ?? 0) + Number(directSummary?.directQris ?? 0);
  const totalPenjualan = totalOmzetCash + totalOmzetQris;
  const txCount = Number(summary?.txCount ?? 0);
  const nowWib  = new Date();

  const potonganSupplier = movements
    .filter((m) => m.movementType === 'CASH_OUT')
    .map((m) => ({
      category: m.category,
      notes: m.notes,
      amount: Number(m.amount ?? 0),
    }));
  const totalCashOut = potonganSupplier.reduce((acc, x) => acc + x.amount, 0);
  const totalCashIn = movements
    .filter((m) => m.movementType === 'CASH_IN')
    .reduce((acc, m) => acc + Number(m.amount ?? 0), 0);

  // 6. Kontrol Fraud K3 + Penanda Tutup Awal Kuliah (Audio 4)
  let newAuditFlags = activeShift.auditFlags || 'NORMAL';
  if (
    totalOmzetCash > 0 &&
    actualCash !== undefined &&
    activeShift.modalAwal !== null &&
    Math.abs(actualCash - Number(activeShift.modalAwal)) < 1
  ) {
    newAuditFlags = 'FRAUD_CASH_SUSPICIOUS';
  } else if (earlyCloseReason === 'KULIAH') {
    newAuditFlags = 'EARLY_CLOSE_KULIAH';
  } else if (earlyCloseReason === 'IZIN_DOSEN') {
    newAuditFlags = 'EARLY_CLOSE_IZIN_DOSEN';
  }

  const earlyPrefix =
    earlyCloseReason === 'KULIAH'
      ? '[TUTUP AWAL RESMI: ADA MATA KULIAH]'
      : earlyCloseReason === 'IZIN_DOSEN'
        ? '[TUTUP AWAL RESMI: IZIN DOSEN]'
        : '';
  const finalNotes = [earlyPrefix, notes?.trim() ?? ''].filter(Boolean).join(' ') || null;

  // 6b. Auto-Checklist & Jeda 5 Menit Selisih Laci (Opsi A: Modal Fisik Fleksibel + Peringatan Audit Non-Auto-Potong)
  const effectiveModalAwal = sessionCtx.effectiveModalAwal;
  const expectedCash = Math.round(effectiveModalAwal + totalOmzetCash - totalCashOut + totalCashIn);
  const discrepancy = actualCash !== undefined ? Math.round(actualCash) - expectedCash : null;
  const shortageRp =
    discrepancy !== null && discrepancy < -SHORTAGE_TOLERANCE_RP
      ? Math.round(Math.abs(discrepancy))
      : 0;
  const typoSuspected =
    actualCash !== undefined && actualCash > 0 && actualCash < 10_000 && expectedCash >= 50_000;
  const consignmentCheck = await getUnsettledConsignmentsForToday();

  const shortageStatus =
    actualCash === undefined
      ? 'NONE'
      : shortageRp > 0
        ? 'PENDING_GRACE'
        : 'AUTO_VERIFIED';
  const shortageGraceUntil =
    shortageStatus === 'PENDING_GRACE'
      ? new Date(nowWib.getTime() + SHORTAGE_GRACE_MS)
      : null;

  // 7. Tutup shift — guard status ACTIVE
  const closed = await db
    .update(shifts)
    .set({
      status:               'CLOSED',
      clockOut:             nowWib,
      actualCash:           actualCash !== undefined ? actualCash.toString() : null,
      cashBreakdownClose:   breakdown ?? null,
      notes:                finalNotes,
      auditFlags:           newAuditFlags,
      shortageStatus,
      shortageGraceUntil,
      shortageAmount:       shortageRp.toString(),
      shortageRecountCount: 0,
    })
    .where(and(eq(shifts.id, activeShift.id), eq(shifts.status, 'ACTIVE')))
    .returning({ id: shifts.id });

  if (closed.length === 0) {
    return apiError(
      'Shift sudah ditutup oleh proses lain.',
      'SHIFT_ALREADY_CLOSED',
      409,
    );
  }

  // Blind Count sudah terkunci di DB (status CLOSED).
  // Kirim ringkasan serah terima kas + hasil Auto-Checklist Jeda 5 Menit (tanpa HPP / Laba).
  return apiOk({
    message:
      shortageStatus === 'PENDING_GRACE'
        ? `Shift ditutup dengan selisih kurang Rp ${shortageRp.toLocaleString('id-ID')}. Tersedia jeda 5 menit untuk koreksi.`
        : 'Shift berhasil ditutup.',
    shiftId:  activeShift.id,
    clockIn:  activeShift.clockIn,
    clockOut: nowWib.toISOString(),
    txCount,
    autoChecklist: {
      status: shortageStatus,
      shortageAmount: shortageRp,
      graceUntil: shortageGraceUntil ? shortageGraceUntil.toISOString() : null,
      recountRemaining: shortageStatus === 'PENDING_GRACE' ? MAX_GRACE_RECOUNTS : 0,
      unsettledConsignmentsToday: consignmentCheck.openToday,
      carryoverConsignments: consignmentCheck.carryover,
      typoSuspected,
      toleranceRp: SHORTAGE_TOLERANCE_RP,
    },
    handoverSummary: {
      kasirName: kasirRow?.fullName ?? 'Kasir',
      modalAwal: effectiveModalAwal,
      cashMasuk: totalOmzetCash,
      qrisMasuk: totalOmzetQris,
      totalPenjualan,
      potonganSupplier,
      totalCashOut,
      totalCashIn,
      sisaCashKotakUang: actualCash !== undefined ? actualCash : null,
      earlyCloseReason,
    },
  });
}
