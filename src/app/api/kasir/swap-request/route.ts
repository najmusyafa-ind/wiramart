// =============================================================
// POST /api/kasir/swap-request — Ajukan Pindah Shift
// Auth: sk_kasir (employee role)
// Rate limit: 3x per 7 hari per NIM (via swapRequestLimiter)
// =============================================================
// ALUR:
//   1. Kasir pilih from_schedule (slot miliknya) → to_schedule (slot lain)
//   2. Server validasi: from_schedule HARUS milik kasir yg login
//   3. Tidak boleh ada PENDING request yang masih aktif untuk slot yg sama
//   4. Insert ke shift_swap_requests dengan status PENDING
//   5. Admin notified → review via /admin/swap-request
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSwapRequests, shiftSchedules } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { swapRequestLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const swapRequestSchema = z.object({
  fromScheduleId: z.string().uuid('ID jadwal asal tidak valid'),
  toScheduleId:   z.string().uuid('ID jadwal tujuan tidak valid'),
  reason:         z.string()
    .min(10, 'Alasan minimal 10 karakter')
    .max(500, 'Alasan maksimal 500 karakter')
    .trim(),
});

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Auth — hanya kasir yang bisa ajukan swap
  const session = await verifyJwt(req);
  if (!session || session.role !== 'employee') {
    return apiError('Akses ditolak. Login sebagai kasir terlebih dahulu.', 401);
  }

  const employeeId = session.sub;
  const nim = employeeId; // rate limit key pakai employeeId (sudah unik per NIM)

  // 2. Rate limit: 3x per 7 hari
  const rateKey = `swap:${nim}`;
  const rl = swapRequestLimiter.check(rateKey, false);
  if (!rl.allowed) {
    const hariLagi = Math.ceil(rl.retryAfterSeconds / 86400);
    return apiError(
      `Kamu sudah mencapai batas 3 pengajuan per minggu. Coba lagi dalam ${hariLagi} hari, atau minta Admin untuk membantu.`,
      429,
    );
  }

  // 3. Parse body
  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Format request tidak valid.', 400); }

  const parsed = swapRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.format(), 422);
  }

  const { fromScheduleId, toScheduleId, reason } = parsed.data;

  // 4. Validasi: fromSchedule dan toSchedule tidak boleh sama
  if (fromScheduleId === toScheduleId) {
    return apiError('Jadwal asal dan tujuan tidak boleh sama.', 422);
  }

  // 5. Validasi: fromSchedule HARUS milik kasir yang login
  const fromSchedule = await db.query.shiftSchedules.findFirst({
    where: and(
      eq(shiftSchedules.id, fromScheduleId),
      eq(shiftSchedules.employeeId, employeeId),
      eq(shiftSchedules.isActive, true),
    ),
  });

  if (!fromSchedule) {
    return apiError(
      'Jadwal asal tidak ditemukan atau bukan milikmu. Pastikan kamu memilih jadwal yang benar.',
      404,
    );
  }

  // 6. Validasi: toSchedule harus ada dan aktif
  const toSchedule = await db.query.shiftSchedules.findFirst({
    where: and(
      eq(shiftSchedules.id, toScheduleId),
      eq(shiftSchedules.isActive, true),
    ),
  });

  if (!toSchedule) {
    return apiError('Jadwal tujuan tidak ditemukan atau tidak aktif.', 404);
  }

  // 7. Cek tidak ada PENDING request untuk slot yang sama
  const existingPending = await db.query.shiftSwapRequests.findFirst({
    where: and(
      eq(shiftSwapRequests.requesterId, employeeId),
      eq(shiftSwapRequests.fromScheduleId, fromScheduleId),
      eq(shiftSwapRequests.status, 'PENDING'),
    ),
  });

  if (existingPending) {
    return apiError(
      'Kamu sudah punya pengajuan swap yang masih menunggu untuk jadwal ini. Tunggu keputusan Admin terlebih dahulu.',
      409,
    );
  }

  // 8. Consume rate limit slot (baru dikonsumsi setelah semua validasi lewat)
  swapRequestLimiter.check(rateKey, true);

  // 9. Insert swap request
  const [newRequest] = await db
    .insert(shiftSwapRequests)
    .values({
      requesterId:    employeeId,
      fromScheduleId,
      toScheduleId,
      reason,
      status:         'PENDING',
    })
    .returning({ id: shiftSwapRequests.id });

  if (!newRequest) {
    return apiError('Gagal membuat pengajuan. Coba lagi.', 500);
  }

  return apiOk(
    {
      id:      newRequest.id,
      message: 'Pengajuan pindah shift berhasil dikirim. Tunggu persetujuan Admin.',
      from:    `${fromSchedule.dayOfWeek} ${fromSchedule.slotStart}–${fromSchedule.slotEnd}`,
      to:      `${toSchedule.dayOfWeek} ${toSchedule.slotStart}–${toSchedule.slotEnd}`,
    },
    201,
  );
}

// GET — kasir lihat history swap request miliknya
export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'employee') {
    return apiError('Akses ditolak.', 401);
  }

  const requests = await db.query.shiftSwapRequests.findMany({
    where: eq(shiftSwapRequests.requesterId, session.sub),
    with: {
      fromSchedule:  { columns: { dayOfWeek: true, slotStart: true, slotEnd: true } },
      toSchedule:    { columns: { dayOfWeek: true, slotStart: true, slotEnd: true } },
    },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 20,
  });

  return apiOk(requests);
}
