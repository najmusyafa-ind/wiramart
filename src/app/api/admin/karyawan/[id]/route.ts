// =============================================================
// PATCH /api/admin/karyawan/[id] — Update karyawan (toggle aktif / edit jabatan / set Ketua Shift & PIN)
// DELETE /api/admin/karyawan/[id] — Soft delete karyawan
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftSchedules } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import bcrypt from 'bcryptjs';

type Context = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  jabatan: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
  isKetuaShift: z.boolean().optional(),
  pin: z.string().length(6, 'PIN harus 6 digit angka').optional(),
});

// ── PATCH: update karyawan ────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.flatten().fieldErrors, 422);

  // Pastikan karyawan exist & belum dihapus
  const [existing] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    .limit(1);

  if (!existing) return apiError('Karyawan tidak ditemukan', 404);

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (parsed.data.fullName !== undefined) updateData.fullName = parsed.data.fullName;
  if (parsed.data.jabatan !== undefined) updateData.jabatan = parsed.data.jabatan;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (parsed.data.isKetuaShift !== undefined) {
    updateData.isKetuaShift = parsed.data.isKetuaShift;
    if (parsed.data.isKetuaShift === false) {
      updateData.pinHash = null;
      updateData.pinFailedAttempts = 0;
      updateData.pinLockedUntil = null;
    }
  }

  // Jika admin menyetel/mereset PIN 6 digit
  if (parsed.data.pin) {
    const hashedPin = await bcrypt.hash(parsed.data.pin, 10);
    updateData.pinHash = hashedPin;
    updateData.isKetuaShift = true; // Otomatis aktifkan flag ketua shift
    updateData.pinFailedAttempts = 0;
    updateData.pinLockedUntil = null;
  }

  const [updated] = await db
    .update(employees)
    .set(updateData)
    .where(eq(employees.id, id))
    .returning({
      id: employees.id,
      fullName: employees.fullName,
      nim: employees.nim,
      programStudi: employees.programStudi,
      jabatan: employees.jabatan,
      isKetuaShift: employees.isKetuaShift,
      isActive: employees.isActive,
    });

  return apiOk(updated);
}

// ── DELETE: soft delete karyawan ─────────────────────────────
export async function DELETE(req: NextRequest, ctx: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const { id } = await ctx.params;

  const [existing] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    .limit(1);

  if (!existing) return apiError('Karyawan tidak ditemukan', 404);

  // 1. Soft-delete employee
  await db
    .update(employees)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(employees.id, id));

  // 2. Force-close semua sesi shift yang masih aktif
  await db
    .update(shifts)
    .set({ clockOut: new Date(), status: 'CLOSED' })
    .where(and(eq(shifts.employeeId, id), eq(shifts.status, 'ACTIVE')));

  // 3. Lepaskan slot jadwal mingguan agar kembali kosong untuk pendaftar lain
  await db
    .update(shiftSchedules)
    .set({ employeeId: null })
    .where(eq(shiftSchedules.employeeId, id));

  return apiOk({ message: 'Karyawan berhasil dihapus dan slot jadwal telah dikosongkan' });
}
