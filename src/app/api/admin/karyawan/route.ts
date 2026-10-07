import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, admins, shiftSchedules, shifts } from '@/lib/db/schema';
import { eq, and, isNull, or, ilike, sql } from 'drizzle-orm';
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
      isKetuaShift: employees.isKetuaShift,
      hasPin: sql<boolean>`CASE WHEN ${employees.pinHash} IS NOT NULL THEN true ELSE false END`,
      createdAt: employees.createdAt,
      // Shift yang diassign ke karyawan ini (nullable jika belum ada slot)
      shiftDay:   shiftSchedules.dayOfWeek,
      shiftStart: shiftSchedules.slotStart,
      shiftEnd:   shiftSchedules.slotEnd,
      shiftSlotId: shiftSchedules.id,
      // Sesi aktif (kasir sedang login) — untuk fitur Force Logout
      activeShiftId:      shifts.id,
      activeShiftClockIn: shifts.clockIn,
    })
    .from(employees)
    .leftJoin(
      shiftSchedules,
      and(
        eq(shiftSchedules.employeeId, employees.id),
        eq(shiftSchedules.isActive, true),
      ),
    )
    .leftJoin(
      shifts,
      and(
        eq(shifts.employeeId, employees.id),
        eq(shifts.status, 'ACTIVE'),
      ),
    )
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
import bcrypt from 'bcryptjs';

const CreateSchema = z.object({
  fullName: z.string().min(2).max(200),
  nim: z.string().min(5).max(20),
  programStudi: z.string().min(2).max(100),
  jabatan: z.string().max(100).default('Kasir'),
  isKetuaShift: z.boolean().optional(),
  pin: z.string().length(6, 'PIN harus 6 digit angka').optional(),
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

  const { fullName, nim, programStudi, jabatan, isKetuaShift, pin } = parsed.data;

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

  let pinHash: string | null = null;
  if (isKetuaShift && pin) {
    pinHash = await bcrypt.hash(pin, 10);
  }

  const [created] = await db
    .insert(employees)
    .values({
      fullName: fullName.trim(),
      nim: nim.toUpperCase().trim(),
      programStudi: programStudi.trim(),
      jabatan: jabatan.trim(),
      isKetuaShift: isKetuaShift ?? false,
      pinHash,
      createdByAdminId: payload.sub as string,
    })
    .returning();

  return apiOk(created, 201);
}
