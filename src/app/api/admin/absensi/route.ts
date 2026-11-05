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
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances, shiftSchedules, employees } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getLateDisciplineFactor } from '@/lib/finance/report';

export const runtime = 'nodejs';

/** Akun testing/dosen/admin yang tidak dimasukkan dalam rekap performa mahasiswa */
function isExcludedAccount(name?: string | null, nim?: string | null): boolean {
  const lname = (name || '').toLowerCase();
  const lnim = (nim || '').trim();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lnim === '02405013' ||
    lnim === '02405021' ||
    lnim === '02405015' ||
    lnim === '02405016' ||
    lnim === '02405050' ||
    lnim === '00000000'
  );
}

// ── GET: Rekap absensi ─────────────────────────────────────────
// Query params:
//   period    'daily' | 'month' | 'last_month' | 'range' | 'all_time'
//   date      YYYY-MM-DD  (default: hari ini)
//   month     YYYY-MM     (expand ke 1 bulan penuh)
//   startDate YYYY-MM-DD
//   endDate   YYYY-MM-DD
//   employeeId UUID       (opsional: filter per mahasiswa)

export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin.', 403);
  }

  const { searchParams } = new URL(req.url);
  const periodParam     = searchParams.get('period');
  const dateParam       = searchParams.get('date');
  const employeeIdParam = searchParams.get('employeeId');
  const startDateParam  = searchParams.get('startDate');
  const endDateParam    = searchParams.get('endDate');
  const monthParam      = searchParams.get('month'); // 'YYYY-MM'

  const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  // Ambil daftar bulan yang tersedia dari database untuk tombol navigasi UI
  const availableMonthsRaw = await db
    .select({
      month: sql<string>`SUBSTRING(${attendances.attendanceDate}, 1, 7)`,
    })
    .from(attendances)
    .groupBy(sql`SUBSTRING(${attendances.attendanceDate}, 1, 7)`)
    .orderBy(sql`SUBSTRING(${attendances.attendanceDate}, 1, 7) DESC`);
  const availableMonths = availableMonthsRaw.map((m) => m.month).filter(Boolean);

  // Tentukan rentang tanggal
  const conditions = [];
  let effectiveStart: string | null = null;
  let effectiveEnd: string | null = null;
  let rangeLabel = '';
  let activePeriod = periodParam ?? 'daily';

  if (periodParam === 'all_time') {
    activePeriod = 'all_time';
    rangeLabel = 'Semua Waktu (Seluruh Riwayat Presensi)';
    // Tanpa batasan tanggal atau dari awal operasional
    effectiveStart = '2026-08-01';
    effectiveEnd = todayWib;
    conditions.push(gte(attendances.attendanceDate, '2026-08-01'));
  } else if (periodParam === 'last_month') {
    activePeriod = 'last_month';
    const [currY, currM] = todayWib.split('-').map(Number);
    const lastMonthDate = new Date(Date.UTC(currY ?? 2026, (currM ?? 11) - 2, 1));
    const ly = lastMonthDate.getUTCFullYear();
    const lm = String(lastMonthDate.getUTCMonth() + 1).padStart(2, '0');
    const lastDay = new Date(Date.UTC(ly, lastMonthDate.getUTCMonth() + 1, 0)).getUTCDate();
    effectiveStart = `${ly}-${lm}-01`;
    effectiveEnd = `${ly}-${lm}-${String(lastDay).padStart(2, '0')}`;
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(lastMonthDate);
    rangeLabel = `Bulan Lalu (${monthName})`;
    conditions.push(gte(attendances.attendanceDate, effectiveStart));
    conditions.push(lte(attendances.attendanceDate, effectiveEnd));
  } else if (monthParam || activePeriod === 'month') {
    activePeriod = 'month';
    const targetMonth = monthParam || todayWib.slice(0, 7);
    const [y, m] = targetMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
    effectiveStart = `${targetMonth}-01`;
    effectiveEnd = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
    const monthObj = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1));
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(monthObj);
    rangeLabel = `Bulan ${monthName}`;
    conditions.push(gte(attendances.attendanceDate, effectiveStart));
    conditions.push(lte(attendances.attendanceDate, effectiveEnd));
  } else if (startDateParam && endDateParam) {
    activePeriod = 'range';
    effectiveStart = startDateParam;
    effectiveEnd = endDateParam;
    rangeLabel = `${startDateParam} s/d ${endDateParam}`;
    conditions.push(gte(attendances.attendanceDate, effectiveStart));
    conditions.push(lte(attendances.attendanceDate, effectiveEnd));
  } else {
    // Single date mode (default: hari ini WIB atau date param)
    activePeriod = 'daily';
    const targetDate = dateParam ?? todayWib;
    effectiveStart = targetDate;
    effectiveEnd = targetDate;
    const dateObj = new Date(`${targetDate}T00:00:00+07:00`);
    rangeLabel = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(dateObj);
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
    orderBy: [desc(attendances.attendanceDate), desc(attendances.clockInActual)],
    limit: 5000,
  });

  // ── Agregasi Performa & Disiplin per Mahasiswa ────────────────
  type EmpSummary = {
    employeeId: string;
    fullName: string;
    nim: string;
    programStudi: string;
    jabatan: string;
    totalShift: number;
    hadir: number;
    telat: number;
    totalLateMinutes: number;
    ijin: number;
    tidakHadir: number;
    pengganti: number;
    persenKehadiran: number;
    skorDisiplin: number;
    statusDisiplin: 'SANGAT_DISIPLIN' | 'DISIPLIN' | 'CUKUP' | 'PERLU_PERHATIAN';
  };

  const empMap = new Map<string, EmpSummary & { disciplineScoreSum: number }>();

  let totalHadir = 0;
  let totalTelat = 0;
  let totalLateMinutes = 0;
  let totalIjin = 0;
  let totalTidakHadir = 0;
  let totalPengganti = 0;

  for (const r of records) {
    if (r.status === 'HADIR') totalHadir += 1;
    else if (r.status === 'TELAT') {
      totalTelat += 1;
      totalLateMinutes += (r.lateMinutes && r.lateMinutes > 0 ? r.lateMinutes : 0);
    } else if (r.status === 'IJIN') totalIjin += 1;
    else if (r.status === 'TIDAK_HADIR') totalTidakHadir += 1;
    else if (r.status === 'PENGGANTI') totalPengganti += 1;

    const emp = r.employee;
    if (!emp || isExcludedAccount(emp.fullName, emp.nim)) continue;

    if (!empMap.has(emp.id)) {
      empMap.set(emp.id, {
        employeeId: emp.id,
        fullName: emp.fullName,
        nim: emp.nim,
        programStudi: emp.programStudi,
        jabatan: emp.jabatan || 'Kasir',
        totalShift: 0,
        hadir: 0,
        telat: 0,
        totalLateMinutes: 0,
        ijin: 0,
        tidakHadir: 0,
        pengganti: 0,
        persenKehadiran: 100,
        skorDisiplin: 100,
        statusDisiplin: 'SANGAT_DISIPLIN',
        disciplineScoreSum: 0,
      });
    }

    const item = empMap.get(emp.id)!;
    item.totalShift += 1;

    if (r.status === 'HADIR') {
      item.hadir += 1;
      item.disciplineScoreSum += 100;
    } else if (r.status === 'PENGGANTI') {
      item.pengganti += 1;
      item.disciplineScoreSum += 100;
    } else if (r.status === 'TELAT') {
      item.telat += 1;
      const mins = r.lateMinutes && r.lateMinutes > 0 ? r.lateMinutes : 0;
      item.totalLateMinutes += mins;
      const factorInfo = getLateDisciplineFactor(r.attendanceDate, mins);
      item.disciplineScoreSum += Math.round(factorInfo.factor * 100);
    } else if (r.status === 'IJIN') {
      item.ijin += 1;
    } else if (r.status === 'TIDAK_HADIR') {
      item.tidakHadir += 1;
    }
  }

  const summaryByEmployee: EmpSummary[] = Array.from(empMap.values()).map((e) => {
    const validCount = e.hadir + e.telat + e.pengganti;
    const persenKehadiran = e.totalShift > 0
      ? Math.round((validCount / e.totalShift) * 100)
      : 0;
    const skorDisiplin = validCount > 0
      ? Math.round(e.disciplineScoreSum / validCount)
      : 100;

    let statusDisiplin: EmpSummary['statusDisiplin'] = 'SANGAT_DISIPLIN';
    if (skorDisiplin >= 95) statusDisiplin = 'SANGAT_DISIPLIN';
    else if (skorDisiplin >= 80) statusDisiplin = 'DISIPLIN';
    else if (skorDisiplin >= 65) statusDisiplin = 'CUKUP';
    else statusDisiplin = 'PERLU_PERHATIAN';

    return {
      employeeId: e.employeeId,
      fullName: e.fullName,
      nim: e.nim,
      programStudi: e.programStudi,
      jabatan: e.jabatan,
      totalShift: e.totalShift,
      hadir: e.hadir,
      telat: e.telat,
      totalLateMinutes: e.totalLateMinutes,
      ijin: e.ijin,
      tidakHadir: e.tidakHadir,
      pengganti: e.pengganti,
      persenKehadiran,
      skorDisiplin,
      statusDisiplin,
    };
  }).sort((a, b) => b.skorDisiplin - a.skorDisiplin || b.totalShift - a.totalShift || a.fullName.localeCompare(b.fullName));

  const totalEmployees = summaryByEmployee.length;
  const avgKehadiran = totalEmployees > 0
    ? Math.round(summaryByEmployee.reduce((s, e) => s + e.persenKehadiran, 0) / totalEmployees)
    : 100;
  const avgDisiplin = totalEmployees > 0
    ? Math.round(summaryByEmployee.reduce((s, e) => s + e.skorDisiplin, 0) / totalEmployees)
    : 100;

  return apiOk({
    records,
    summaryByEmployee,
    summary: {
      totalRecords: records.length,
      hadir: totalHadir,
      telat: totalTelat,
      totalLateMinutes,
      ijin: totalIjin,
      tidakHadir: totalTidakHadir,
      pengganti: totalPengganti,
      avgKehadiran,
      avgDisiplin,
    },
    range: {
      startDate: effectiveStart ?? todayWib,
      endDate: effectiveEnd ?? todayWib,
      label: rangeLabel,
      period: activePeriod,
    },
    availableMonths,
  });
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
