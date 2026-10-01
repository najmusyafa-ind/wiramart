// =============================================================
// DELETE /api/admin/jadwal/slot-group
//   Hapus seluruh slot group berdasarkan dayOfWeek + slotStart + slotEnd.
//   Safety: Ditolak jika ada slot yang masih ditempati karyawan.
// AUTH: Admin only
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const DAY_VALUES = ['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'] as const;

const DeleteGroupSchema = z.object({
  dayOfWeek: z.enum(DAY_VALUES),
  slotStart: z.string().min(1),
  slotEnd:   z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  try { await requireAdmin(); }
  catch { return apiError('Akses ditolak.', 'UNAUTHORIZED', 401); }

  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Format tidak valid', 'INVALID_JSON', 400); }

  const parsed = DeleteGroupSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Parameter tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { dayOfWeek, slotStart, slotEnd } = parsed.data;

  // Ambil semua slot dalam group ini
  const groupSlots = await db
    .select({
      id:         shiftSchedules.id,
      employeeId: shiftSchedules.employeeId,
    })
    .from(shiftSchedules)
    .where(
      and(
        sql`${shiftSchedules.dayOfWeek} = ${dayOfWeek}`,
        sql`${shiftSchedules.slotStart} = ${slotStart}`,
        sql`${shiftSchedules.slotEnd}   = ${slotEnd}`,
        sql`${shiftSchedules.isActive}  = true`,
      ),
    );

  if (groupSlots.length === 0) {
    return apiError(
      `Shift ${dayOfWeek} ${slotStart}–${slotEnd} tidak ditemukan.`,
      'NOT_FOUND',
      404,
    );
  }

  // Safety: Tolak hapus jika ada yang masih ditempati
  const occupied = groupSlots.filter(s => s.employeeId !== null);
  if (occupied.length > 0) {
    return apiError(
      `Tidak bisa hapus — ${occupied.length} slot masih ditempati karyawan. Bebaskan slot terlebih dahulu.`,
      'SLOTS_OCCUPIED',
      409,
    );
  }

  // Soft delete: set isActive = false
  await db
    .update(shiftSchedules)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        sql`${shiftSchedules.dayOfWeek} = ${dayOfWeek}`,
        sql`${shiftSchedules.slotStart} = ${slotStart}`,
        sql`${shiftSchedules.slotEnd}   = ${slotEnd}`,
        sql`${shiftSchedules.isActive}  = true`,
      ),
    );

  return apiOk({
    message: `Shift ${dayOfWeek} ${slotStart}–${slotEnd} (${groupSlots.length} slot) berhasil dihapus.`,
    deletedCount: groupSlots.length,
  });
}
