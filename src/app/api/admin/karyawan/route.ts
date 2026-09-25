// =============================================================
// GET  /api/admin/karyawan — Daftar semua karyawan aktif
// POST /api/admin/karyawan — Tambah karyawan baru
// Auth: Admin JWT cookie required
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, admins } from '@/lib/db/schema';
import { eq, and, isNull, or, ilike } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

// ── GET: list semua karyawan ──────────────────────────────────
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized', 401);
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';

  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      nim: employees.nim,
      programStudi: employees.programStudi,
      jabatan: employees.jabatan,
      isActive: employees.isActive,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        q
          ? or(
              ilike(employees.fullName, `%${q}%`),
              ilike(employees.nim, `%${q}%`),
              ilike(employees.programStudi, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(employees.fullName);

  return apiOk(rows);
}

// ── POST: tambah karyawan baru ────────────────────────────────
const CreateSchema = z.object({
  fullName: z.string().min(2).max(200),
  nim: z.string().min(5).max(20),
  programStudi: z.string().min(2).max(100),
  jabatan: z.string().max(100).default('Kasir'),
});

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized', 401);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { fullName, nim, programStudi, jabatan } = parsed.data;

  // Cek duplikat NIM + Prodi
  const existing = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.nim, nim.toUpperCase()),
        eq(employees.programStudi, programStudi),
        isNull(employees.deletedAt),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return apiError('NIM + Program Studi sudah terdaftar', 409);
  }

  const [created] = await db
    .insert(employees)
    .values({
      fullName: fullName.trim(),
      nim: nim.toUpperCase().trim(),
      programStudi: programStudi.trim(),
      jabatan: jabatan.trim(),
      createdByAdminId: payload.sub as string,
    })
    .returning();

  return apiOk(created, 201);
}
