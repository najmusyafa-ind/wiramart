// =============================================================
// PATCH /api/kasir/shift/tutup — Tutup shift aktif secara manual
// Auth: Employee JWT required
// Body: { notes?: string } (opsional catatan handover)
// Business Rules:
//   - Hanya shift ACTIVE yang bisa ditutup
//   - clockOut di-set ke waktu sekarang (WIB)
//   - status → CLOSED
//   - Auto-close juga dipanggil oleh cron 15 menit pasca jam akhir shift
// =============================================================

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, transactions } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { sql } from 'drizzle-orm';

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

  const totalCash  = parseFloat(summary?.totalCash  ?? '0');
  const totalQris  = parseFloat(summary?.totalQris  ?? '0');
  const txCount    = Number(summary?.txCount ?? 0);
  const modalAwal  = parseFloat(activeShift.modalAwal ?? '0');
  // Saldo expected di laci = modal awal + semua cash yang masuk
  const saldoAkhir = modalAwal + totalCash;

  const nowWib = new Date();

  // 5. Tutup shift
  await db
    .update(shifts)
    .set({
      status:   'CLOSED',
      clockOut: nowWib,
      notes:    notes ?? null,
    })
    .where(eq(shifts.id, activeShift.id));

  return apiOk({
    message: 'Shift berhasil ditutup.',
    shiftId:   activeShift.id,
    clockIn:   activeShift.clockIn,
    clockOut:  nowWib.toISOString(),
    modalAwal,
    totalCash,
    totalQris,
    txCount,
    // Saldo expected di laci (hanya uang tunai — QRIS langsung ke rekening)
    saldoAkhirLaci: saldoAkhir,
  });
}
