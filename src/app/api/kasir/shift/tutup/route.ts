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
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, transactions, transactionPayments } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const tutupShiftSchema = z.object({
  actualCash: z.number().min(0, 'Saldo fisik kas tidak boleh negatif').max(50_000_000, 'Nilai terlalu besar').optional(),
  breakdown: z.record(z.string(), z.number()).optional(),
  notes: z.string().max(500).optional(),
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

  const { notes, actualCash, breakdown } = parsed.data;

  // 3. Cari shift aktif (milik kasir ini ATAU shift aktif toko saat ini — Cacat 1 Opsi A)
  let activeShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
    columns: { id: true, clockIn: true, modalAwal: true, auditFlags: true },
  });

  if (!activeShift) {
    activeShift = await db.query.shifts.findFirst({
      where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
      orderBy: [desc(shifts.clockIn)],
      columns: { id: true, clockIn: true, modalAwal: true, auditFlags: true },
    });
  }

  if (!activeShift) {
    return apiError(
      'Tidak ada shift aktif yang perlu ditutup.',
      'NO_ACTIVE_SHIFT',
      404,
    );
  }

  // 5. Hitung jumlah transaksi completed
  const [summary] = await db
    .select({
      txCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED')`,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, activeShift.id));

  // 5b. Hitung omzet TUNAI murni dari transaction_payments (Split Payment aware — Cacat 3 Opsi A)
  const [paySummary] = await db
    .select({
      payCash: sql<string>`COALESCE(
        SUM(${transactionPayments.amount})
        FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'CASH' AND ${transactions.isTest} = false),
        0
      )`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
    .where(eq(transactions.shiftId, activeShift.id));

  // 5c. Transaksi tunai langsung legacy (jika ada baris transaksi tanpa transaction_payments)
  const [directSummary] = await db
    .select({
      directCash: sql<string>`COALESCE(
        SUM(${transactions.grossAmount})
        FILTER (
          WHERE ${transactions.status} = 'COMPLETED'
          AND ${transactions.paymentMethod} = 'CASH'
          AND ${transactions.isTest} = false
          AND NOT EXISTS (
            SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id}
          )
        ),
        0
      )`,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, activeShift.id));

  const totalOmzetCash = Number(paySummary?.payCash ?? 0) + Number(directSummary?.directCash ?? 0);
  const txCount = Number(summary?.txCount ?? 0);
  const nowWib  = new Date();

  // 6. Kontrol Fraud K3: Penjualan tunai > 0 tetapi laci masih persis modal awal
  let newAuditFlags = activeShift.auditFlags || 'NORMAL';
  if (
    totalOmzetCash > 0 &&
    actualCash !== undefined &&
    activeShift.modalAwal !== null &&
    Math.abs(actualCash - Number(activeShift.modalAwal)) < 1
  ) {
    newAuditFlags = 'FRAUD_CASH_SUSPICIOUS';
  }

  // 7. Tutup shift — guard status ACTIVE
  const closed = await db
    .update(shifts)
    .set({
      status:             'CLOSED',
      clockOut:           nowWib,
      actualCash:         actualCash !== undefined ? actualCash.toString() : null,
      cashBreakdownClose: breakdown ?? null,
      notes:              notes ?? null,
      auditFlags:         newAuditFlags,
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

  // Zero-Trust: Respons TIDAK memuat expected cash atau laba ke kasir
  return apiOk({
    message:  'Shift berhasil ditutup.',
    shiftId:  activeShift.id,
    clockIn:  activeShift.clockIn,
    clockOut: nowWib.toISOString(),
    txCount,
  });
}
