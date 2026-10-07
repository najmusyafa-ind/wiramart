// =============================================================
// PATCH /api/kasir/shift/buka — Set modal awal untuk shift aktif
// Auth: Employee JWT required
// Body: { modalAwal: number }
// Business Rule: modalAwal WAJIB diisi sebelum POS bisa dipakai
// Idempotent: jika sudah di-set, tolak update (tidak bisa diganti)
// =============================================================

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const bukaShiftSchema = z.object({
  // Modal awal minimal 0 (mesin baru, belum ada uang di laci)
  // Maksimal 10 juta agar tidak ada typo ekstrem
  modalAwal: z.number().min(0, 'Modal awal tidak boleh negatif').max(10_000_000, 'Nilai terlalu besar'),
  // Breakdown pecahan lembar dan koin (opsional dari kalkulator fisik)
  breakdown: z.record(z.string(), z.number()).optional(),
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

  // 4. Idempotency guard: jika sudah di-set, tolak
  // (kasir tidak boleh ubah modal awal setelah shift dibuka)
  if (activeShift.modalAwal !== null) {
    return apiError(
      'Modal awal sudah tercatat. Tidak dapat diubah dalam satu shift.',
      'MODAL_ALREADY_SET',
      409,
    );
  }

  // 5. Update modal awal & breakdown pecahan fisik
  await db
    .update(shifts)
    .set({
      modalAwal: modalAwal.toString(),
      cashBreakdownOpen: breakdown ?? null,
    })
    .where(eq(shifts.id, activeShift.id));

  return apiOk({
    message: `Shift dibuka. Modal awal Rp ${modalAwal.toLocaleString('id-ID')} tercatat.`,
    shiftId: activeShift.id,
    modalAwal,
  });
}
