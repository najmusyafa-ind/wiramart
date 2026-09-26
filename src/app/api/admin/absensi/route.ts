// =============================================================
// GET   /api/admin/absensi  — Rekap kehadiran per tanggal/mahasiswa
// POST  /api/admin/absensi  — Dosen input manual IJIN / TIDAK_HADIR
// PATCH /api/admin/absensi/[id] — Koreksi record yang sudah ada
// Auth: sk_admin
// =============================================================
// FILOSOFI:
//   HADIR/TELAT → auto-created saat kasir login (via kasir auth route)
//   IJIN/TIDAK_HADIR → dosen input manual di sini
//   PENGGANTI → auto-created saat admin approve swap
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances, shiftSchedules, employees } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ── GET: Rekap absensi ─────────────────────────────────────────
// Query params:
//   date      YYYY-MM-DD  (default: hari ini)
//   employeeId UUID        (opsional: filter per mahasiswa)
//   startDate / endDate   (opsional: range tanggal, max 31 hari)

export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin.', 403);
  }

  const { searchParams } = new URL(req.url);
  const dateParam       = searchParams.get('date');
  const employeeIdParam = searchParams.get('employeeId');
  const startDateParam  = searchParams.get('startDate');
  const endDateParam    = searchParams.get('endDate');

  // Build where conditions
  const conditions = [];

  if (startDateParam && endDateParam) {
    // Range mode
    const start = new Date(startDateParam);
    const end   = new Date(endDateParam);
    const diffDays = (end.getTime() - start.getTime()) / 86400000;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return apiError('Format tanggal tidak valid (gunakan YYYY-MM-DD).', 422);
    }
    if (diffDays > 31) {
      return apiError('Range tanggal maksimal 31 hari untuk performa query.', 422);
    }
    if (diffDays < 0) {
      return apiError('startDate harus sebelum endDate.', 422);
    }
    conditions.push(gte(attendances.attendanceDate, startDateParam));
    conditions.push(lte(attendances.attendanceDate, endDateParam));
  } else {
    // Single date mode (default: hari ini WIB)
    const targetDate = dateParam ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    conditions.push(eq(attendances.attendanceDate, targetDate));
  }

  if (employeeIdParam) {
    conditions.push(eq(attendances.employeeId, employeeIdParam));
  }

  const records = await db.query.attendances.findMany({
    where: and(...conditions),
    with: {
      employee: {
        columns: { id: true, fullName: true, nim: true, programStudi: true, jabatan: true },
      },
      schedule: {
        columns: { dayOfWeek: true, slotStart: true, slotEnd: true, coordinatorName: true },
      },
    },
    orderBy: [desc(attendances.attendanceDate), attendances.scheduleId],
    limit: 500,
  });

  return apiOk(records);
}

// ── POST: Input manual IJIN / TIDAK_HADIR ─────────────────────
const manualAttendanceSchema = z.object({
  employeeId:     z.string().uuid('Employee ID tidak valid'),
  scheduleId:     z.string().uuid('Schedule ID tidak valid'),
  attendanceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  status: z.enum(['IJIN', 'TIDAK_HADIR'], {
    message: 'Status hanya boleh IJIN atau TIDAK_HADIR untuk input manual',
  }),
  notes: z.string().max(500).trim().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin.', 403);
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Format request tidak valid.', 400); }

  const parsed = manualAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.format(), 422);
  }

  const { employeeId, scheduleId, attendanceDate, status, notes } = parsed.data;

  // Validasi: karyawan dan jadwal harus ada
  const [emp, sched] = await Promise.all([
    db.query.employees.findFirst({ where: eq(employees.id, employeeId), columns: { id: true, fullName: true } }),
    db.query.shiftSchedules.findFirst({ where: eq(shiftSchedules.id, scheduleId), columns: { id: true, dayOfWeek: true, slotStart: true } }),
  ]);

  if (!emp)   return apiError('Karyawan tidak ditemukan.', 404);
  if (!sched) return apiError('Jadwal tidak ditemukan.', 404);

  // Upsert: jika sudah ada record (misal HADIR) → overwrite dengan input admin
  const [result] = await db
    .insert(attendances)
    .values({
      employeeId,
      scheduleId,
      attendanceDate,
      status,
      notes:             notes ?? null,
      recordedByAdminId: session.sub,
    })
    .onConflictDoUpdate({
      // Unique: employee × schedule × date
      target: [attendances.employeeId, attendances.scheduleId, attendances.attendanceDate],
      set: {
        status,
        notes:             notes ?? null,
        recordedByAdminId: session.sub,
        updatedAt:         new Date(),
      },
    })
    .returning({ id: attendances.id });

  return apiOk(
    {
      id:      result?.id,
      message: `Absensi ${emp.fullName} tanggal ${attendanceDate} berhasil dicatat sebagai ${status}.`,
    },
    201,
  );
}
