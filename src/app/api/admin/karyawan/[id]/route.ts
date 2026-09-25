// =============================================================
// PATCH /api/admin/karyawan/[id] — Update karyawan (toggle aktif / edit jabatan)
// DELETE /api/admin/karyawan/[id] — Soft delete karyawan
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

type Context = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  jabatan: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
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

  const [updated] = await db
    .update(employees)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, id))
    .returning();

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

  await db
    .update(employees)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(employees.id, id));

  return apiOk({ message: 'Karyawan berhasil dihapus' });
}
