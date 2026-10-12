import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { employees, admins, shiftSchedules, shifts } from '@/lib/db/schema';
import { eq, and, isNull, or, ilike, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError, requireManager } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';

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

  // Kelompokkan shift per karyawan agar tidak ada baris duplikat di tabel admin
  type ShiftSlotInfo = { day: string; start: string; end: string; slotId: string };
  type EmployeeResponse = (typeof rows)[number] & { allShifts: ShiftSlotInfo[] };

  const employeeMap = new Map<string, EmployeeResponse>();

  for (const r of rows) {
    const existing = employeeMap.get(r.id);
    const shiftInfo: ShiftSlotInfo | null =
      r.shiftDay && r.shiftStart && r.shiftEnd && r.shiftSlotId
        ? {
            day: r.shiftDay,
            start: r.shiftStart,
            end: r.shiftEnd,
            slotId: r.shiftSlotId,
          }
        : null;

    if (!existing) {
      employeeMap.set(r.id, {
        ...r,
        allShifts: shiftInfo ? [shiftInfo] : [],
      });
    } else {
      if (shiftInfo && !existing.allShifts.some((s) => s.slotId === shiftInfo.slotId)) {
        existing.allShifts.push(shiftInfo);
      }
      if (r.activeShiftId && !existing.activeShiftId) {
        existing.activeShiftId = r.activeShiftId;
        existing.activeShiftClockIn = r.activeShiftClockIn;
      }
    }
  }

  return apiOk(Array.from(employeeMap.values()));
}

// ── POST: tambah karyawan baru (Manager Dosen Only — Cacat 6 Opsi A) ───────────────
import bcrypt from 'bcryptjs';

const CreateSchema = z.object({
  fullName: z.string().min(2).max(200),
  nim: z.string().min(5).max(20),
  programStudi: z.string().min(2).max(100),
  jabatan: z.string().max(100).default('Kasir'),
  isKetuaShift: z.boolean().optional(),
  pin: z.string().regex(/^\d{6,8}$/, 'PIN harus 6 hingga 8 digit angka').optional(),
});

export async function POST(req: NextRequest) {
  try {
    const manager = await requireManager();

    let body: unknown;
    try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { fullName, nim, programStudi, jabatan, isKetuaShift, pin } = parsed.data;

  // Cek duplikat NIM
  const [existing] = await db
    .select({ id: employees.id, deletedAt: employees.deletedAt })
    .from(employees)
    .where(eq(employees.nim, nim.toUpperCase()))
    .limit(1);

  if (existing && !existing.deletedAt) {
    return apiError('NIM sudah terdaftar dan masih aktif', 409);
  }

  let pinHash: string | null = null;
  if (isKetuaShift && pin) {
    pinHash = await bcrypt.hash(pin, 10);
  }

  let created;
  if (existing && existing.deletedAt) {
    // Re-aktifkan karyawan yang sebelumnya dihapus
    const [revived] = await db
      .update(employees)
      .set({
        fullName: fullName.trim(),
        programStudi: programStudi.trim(),
        jabatan: jabatan.trim(),
        isActive: true,
        deletedAt: null,
        isKetuaShift: isKetuaShift ?? false,
        pinHash,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        updatedAt: new Date(),
        createdByAdminId: manager.sub,
      })
      .where(eq(employees.id, existing.id))
      .returning();
    created = revived;
  } else {
    const [inserted] = await db
      .insert(employees)
      .values({
        fullName: fullName.trim(),
        nim: nim.toUpperCase().trim(),
        programStudi: programStudi.trim(),
        jabatan: jabatan.trim(),
        isKetuaShift: isKetuaShift ?? false,
        pinHash,
        createdByAdminId: manager.sub,
      })
      .returning();
    created = inserted;
  }

  return apiOk(created, 201);
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.statusCode);
    }
    return apiError('Gagal menambahkan karyawan', 500);
  }
}
