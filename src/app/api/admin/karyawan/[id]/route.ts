// =============================================================
// PATCH /api/admin/karyawan/[id] — Update karyawan (toggle aktif / edit jabatan / set Ketua Shift & PIN)
// DELETE /api/admin/karyawan/[id] — Soft delete karyawan
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftSchedules, admins, auditLogs } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyJwt, requireManager, apiOk, apiError } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
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

// ── DELETE: soft delete karyawan & eliminasi akun admin terkait ──────────
export async function DELETE(req: NextRequest, ctx: Context) {
  try {
    const admin = await requireManager();
    const { id } = await ctx.params;

    const [existing] = await db
      .select({ id: employees.id, nim: employees.nim, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
      .limit(1);

    if (!existing) return apiError('Karyawan tidak ditemukan', 404);

    const now = new Date();

    await db.transaction(async (tx) => {
      // 1. Soft-delete employee
      await tx
        .update(employees)
        .set({ deletedAt: now, isActive: false, updatedAt: now })
        .where(eq(employees.id, id));

      // 2. Force-close semua sesi shift yang masih aktif
      await tx
        .update(shifts)
        .set({ clockOut: now, status: 'CLOSED' })
        .where(and(eq(shifts.employeeId, id), eq(shifts.status, 'ACTIVE')));

      // 3. Lepaskan slot jadwal mingguan agar kembali kosong untuk pendaftar lain
      await tx
        .update(shiftSchedules)
        .set({ employeeId: null })
        .where(eq(shiftSchedules.employeeId, id));

      // 4. CISO Guard: Soft-delete akun admin terkait (Zombie Admin Account Elimination)
      // Nonaktifkan akun di tabel admins yang terhubung dengan NIM karyawan ini
      await tx
        .update(admins)
        .set({
          isActive: false,
          deletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(admins.nidn, existing.nim),
            eq(admins.role, 'ADMIN_SHIFT'),
            isNull(admins.deletedAt),
          ),
        );

      // 5. Catat audit logs
      await tx.insert(auditLogs).values({
        tableName: 'employees',
        recordId: id,
        action: 'SOFT_DELETE',
        oldValues: JSON.stringify({ fullName: existing.fullName, nim: existing.nim }),
        newValues: JSON.stringify({ isActive: false, deletedAt: now.toISOString() }),
        actorType: 'ADMIN',
        actorId: admin.sub,
      });
    });

    return apiOk({ message: 'Karyawan dan hak akses admin berhasil dinonaktifkan, serta slot jadwal telah dikosongkan' });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.statusCode);
    }
    return apiError('Gagal menghapus karyawan. Silakan coba lagi.', 500);
  }
}
