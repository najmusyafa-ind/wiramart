// =============================================================
// PATCH /api/kasir/shift/buka — Set modal awal untuk shift aktif
// Auth: Employee JWT required
// Body: { modalAwal: number, breakdown?: Record<string, number>, pinKetuaShift?: string }
//
// Business Rules (K1, K3, K10):
//   1. modalAwal WAJIB diisi sebelum POS bisa dipakai.
//   2. Idempotent: jika sudah di-set, tolak update.
//   3. K3 Serah-Terima Laci: Sistem mencari shift toko terakhir yang CLOSED.
//      Jika ada actual_cash dari shift sebelumnya, hitung selisih:
//        serahTerimaDiff = modalAwal - prevActualCash
//      Jika |serahTerimaDiff| > Rp 2.000, flag otomatis: 'SERAH_TERIMA_SELISIH'
//      untuk diaudit Dosen/Manajer di Dashboard.
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const bukaShiftSchema = z.object({
  modalAwal: z.number().min(0, 'Modal awal tidak boleh negatif').max(10_000_000, 'Nilai terlalu besar'),
  breakdown: z.record(z.string(), z.number()).optional(),
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

  // 2. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = bukaShiftSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { modalAwal, breakdown } = parsed.data;

  // 3. Cari shift aktif milik karyawan ini
  const activeShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
    columns: { id: true, modalAwal: true },
  });

  if (!activeShift) {
    return apiError(
      'Tidak ada shift aktif. Silakan login ulang.',
      'NO_ACTIVE_SHIFT',
      404,
    );
  }

  // 5. Idempotency guard: jika sudah di-set, tolak
  if (activeShift.modalAwal !== null) {
    return apiError(
      'Modal awal sudah tercatat. Tidak dapat diubah dalam satu shift.',
      'MODAL_ALREADY_SET',
      409,
    );
  }

  // 6. Kontrol K3: Cek fisik tutup shift sebelumnya untuk mendeteksi selisih serah-terima
  const lastClosedShift = await db.query.shifts.findFirst({
    where: eq(shifts.status, 'CLOSED'),
    orderBy: [desc(shifts.clockOut)],
    columns: { id: true, actualCash: true, clockOut: true },
  });

  let serahTerimaDiff: number | null = null;
  let auditFlags = 'NORMAL';

  if (lastClosedShift && lastClosedShift.actualCash !== null) {
    const prevActual = Number(lastClosedShift.actualCash);
    serahTerimaDiff = modalAwal - prevActual;
    const TOLERANSI_SERAH_TERIMA = 2000; // Ambang Rp 2.000
    if (Math.abs(serahTerimaDiff) > TOLERANSI_SERAH_TERIMA) {
      auditFlags = 'SERAH_TERIMA_SELISIH';
    }
  }

  // 7. Update modal awal, breakdown pecahan fisik, selisih serah-terima, dan flag audit
  await db
    .update(shifts)
    .set({
      modalAwal: modalAwal.toString(),
      cashBreakdownOpen: breakdown ?? null,
      serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
      auditFlags,
    })
    .where(eq(shifts.id, activeShift.id));

  return apiOk({
    message: `Shift dibuka. Modal awal Rp ${modalAwal.toLocaleString('id-ID')} tercatat.`,
    shiftId: activeShift.id,
    modalAwal,
    serahTerimaDiff,
    auditFlags,
  });
}
