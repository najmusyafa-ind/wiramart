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
import { eq, and, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, transactions } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const tutupShiftSchema = z.object({
  actualCash: z.number().min(0, 'Saldo fisik kas tidak boleh negatif').max(50_000_000, 'Nilai terlalu besar').optional(),
  breakdown: z.record(z.string(), z.number()).optional(),
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

  const { notes, actualCash, breakdown } = parsed.data;

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

  // 4. Hitung jumlah transaksi yang terselesaikan dalam shift ini (hanya volume transaksi)
  const [summary] = await db
    .select({
      txCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED')`,
    })
    .from(transactions)
    .where(eq(transactions.shiftId, activeShift.id));

  const txCount = Number(summary?.txCount ?? 0);
  const nowWib  = new Date();

  // 5. Tutup shift — guard status ACTIVE mencegah dua request bersamaan sama-sama "berhasil"
  const closed = await db
    .update(shifts)
    .set({
      status:             'CLOSED',
      clockOut:           nowWib,
      actualCash:         actualCash !== undefined ? actualCash.toString() : null,
      cashBreakdownClose: breakdown ?? null,
      notes:              notes ?? null,
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

  // PENTING (K2 & K5 Zero-Trust):
  // Respons TIDAK memuat angka laba, margin, bagi hasil, atau nominal kas laci.
  // Seluruh kalkulasi finansial dan bagi hasil dikelola oleh Manajer/Dosen.
  return apiOk({
    message:  'Shift berhasil ditutup.',
    shiftId:  activeShift.id,
    clockIn:  activeShift.clockIn,
    clockOut: nowWib.toISOString(),
    txCount,
  });
}

