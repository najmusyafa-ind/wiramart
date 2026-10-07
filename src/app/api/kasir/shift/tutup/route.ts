// =============================================================
// PATCH /api/kasir/shift/tutup — Tutup shift aktif secara manual
// Auth: Employee JWT required
// Body: { notes?: string } (opsional catatan handover)
// Business Rules:
//   - Hanya shift ACTIVE yang bisa ditutup
//   - clockOut di-set ke waktu sekarang (WIB)
//   - status → CLOSED
//   - Auto-close juga dipanggil oleh cron 15 menit pasca jam akhir shift
//
// v1.1 — Fix D2 (Fase 0.6):
//   saldoAkhirLaci TIDAK lagi dikirim ke kasir. Kasir harus melakukan
//   BLIND COUNT — tidak tahu angka yang diharapkan.
// v1.2 — Tutup celah D2:
//   Respons juga TIDAK memuat modalAwal / totalCash / totalQris / totalOmzet /
//   totalHpp, karena kombinasi angka itu cukup untuk menurunkan saldo expected
//   (modalAwal + totalCash, atau labaKotor + HPP − QRIS). Angka lengkap hanya
//   untuk manajer/admin lewat laporan shift.
//   UPDATE diberi guard status = 'ACTIVE' agar penutupan ganda bersamaan ditolak.
// =============================================================

import { z } from 'zod';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, transactions, transactionItems, attendances, shiftSchedules, employees } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const tutupShiftSchema = z.object({
  notes: z.string().max(500).optional(),
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

  const { notes } = parsed.data;

  // 3. Cari shift aktif milik karyawan ini
  const activeShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
    columns: { id: true, clockIn: true, modalAwal: true },
  });

  if (!activeShift) {
    return apiError(
      'Tidak ada shift aktif yang perlu ditutup.',
      'NO_ACTIVE_SHIFT',
      404,
    );
  }

  // 4. Hitung ringkasan shift (total cash & QRIS dalam shift ini)
  const [summary] = await db
    .select({
      totalCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (
        WHERE ${transactions.paymentMethod} = 'CASH'
        AND ${transactions.status} = 'COMPLETED'
      ), 0)`,
      totalQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (
        WHERE ${transactions.paymentMethod} = 'QRIS'
        AND ${transactions.status} = 'COMPLETED'
      ), 0)`,
      txCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED')`,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, activeShift.id));

  // 4b. Hitung HPP dan laba kotor shift ini
  const [hppRow] = await db
    .select({
      totalHpp: sql<string>`COALESCE(SUM(${transactionItems.subtotalCost}), 0)`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(and(
      eq(transactions.shiftId, activeShift.id),
      eq(transactions.status, 'COMPLETED'),
    ));

  const totalCash      = parseFloat(summary?.totalCash  ?? '0');
  const totalQris      = parseFloat(summary?.totalQris  ?? '0');
  const txCount        = Number(summary?.txCount ?? 0);
  const totalHpp       = parseFloat(hppRow?.totalHpp ?? '0');
  const totalOmzet     = totalCash + totalQris;
  const labaKotorShift = Math.max(0, totalOmzet - totalHpp);
  // Sistem Paten Wiramart: 50% Laba Kotor untuk Hak Karyawan Shift
  const alokasiGajiShift = Math.round(labaKotorShift * 0.5);

  const nowWib = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(nowWib);

  // Ambil data slot jadwal shift aktif ini (jika ada)
  let attendeeNames: string[] = [];

  const [currentAtt] = await db
    .select({
      slotStart: shiftSchedules.slotStart,
      slotEnd:   shiftSchedules.slotEnd,
    })
    .from(attendances)
    .innerJoin(shiftSchedules, eq(attendances.scheduleId, shiftSchedules.id))
    .where(eq(attendances.shiftId, activeShift.id))
    .limit(1);

  if (currentAtt) {
    // Ambil personil yang hadir pada slot shift yang sama hari ini
    const slotAttRows = await db
      .select({
        employeeName: employees.fullName,
      })
      .from(attendances)
      .innerJoin(shiftSchedules, eq(attendances.scheduleId, shiftSchedules.id))
      .innerJoin(employees, eq(attendances.employeeId, employees.id))
      .where(and(
        eq(attendances.attendanceDate, todayStr),
        eq(shiftSchedules.slotStart, currentAtt.slotStart),
        eq(shiftSchedules.slotEnd, currentAtt.slotEnd),
        inArray(attendances.status, ['HADIR', 'TELAT', 'PENGGANTI']),
      ));

    attendeeNames = slotAttRows.map((r) => r.employeeName);
  }

  // Fallback jika shift tidak terikat slot spesifik
  if (attendeeNames.length === 0) {
    const fallbackAttRows = await db
      .select({
        employeeName: employees.fullName,
      })
      .from(attendances)
      .innerJoin(employees, eq(attendances.employeeId, employees.id))
      .where(and(
        eq(attendances.attendanceDate, todayStr),
        inArray(attendances.status, ['HADIR', 'TELAT', 'PENGGANTI']),
      ));
    attendeeNames = fallbackAttRows.map((r) => r.employeeName);
  }

  const personCount = Math.max(1, attendeeNames.length);
  const perPersonShare = Math.round(alokasiGajiShift / personCount);

  // Catatan D2: saldo expected (modalAwal + totalCash) sengaja TIDAK dihitung
  // di sini maupun dikirim ke kasir. Laporan manajer menghitungnya sendiri.

  // 5. Tutup shift — guard status mencegah dua request bersamaan sama-sama "berhasil"
  const closed = await db
    .update(shifts)
    .set({
      status:   'CLOSED',
      clockOut: nowWib,
      notes:    notes ?? null,
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

  // PENTING (D2): respons TIDAK memuat angka apa pun yang bisa dipakai
  // menurunkan kas laci. Kasir hanya melihat jumlah transaksi & bagi hasil.
  return apiOk({
    message: 'Shift berhasil ditutup.',
    shiftId:        activeShift.id,
    clockIn:        activeShift.clockIn,
    clockOut:       nowWib.toISOString(),
    labaKotorShift,
    alokasiGajiShift,
    personCount,
    attendeeNames,
    perPersonShare,
    txCount,
  });
}
