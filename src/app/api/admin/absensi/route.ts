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
import { eq, and, gte, lte, desc, sql, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances, shiftSchedules, employees, auditLogs } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  getLateDisciplineFactor,
  computeAttendanceDisciplineScore,
} from '@/lib/finance/report';

export const runtime = 'nodejs';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidYmd(val: string): boolean {
  if (!YMD_RE.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10) === val;
}

class AttendanceBatchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AttendanceBatchError';
  }
}

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
  const periodParam     = searchParams.get('period')?.trim() || null;
  const dateParam       = searchParams.get('date')?.trim() || null;
  const employeeIdParam = searchParams.get('employeeId')?.trim() || null;
  const startDateParam  = searchParams.get('startDate')?.trim() || null;
  const endDateParam    = searchParams.get('endDate')?.trim() || null;
  const monthParam      = searchParams.get('month')?.trim() || null; // 'YYYY-MM'

  if (employeeIdParam && !UUID_RE.test(employeeIdParam)) {
    return apiError('Parameter employeeId tidak valid.', 400);
  }
  if (monthParam && !YM_RE.test(monthParam)) {
    return apiError('Format bulan tidak valid (harus YYYY-MM).', 400);
  }
  if (dateParam && !isValidYmd(dateParam)) {
    return apiError('Format tanggal tidak valid (harus YYYY-MM-DD).', 400);
  }
  if (startDateParam && !isValidYmd(startDateParam)) {
    return apiError('Format tanggal awal tidak valid (harus YYYY-MM-DD).', 400);
  }
  if (endDateParam && !isValidYmd(endDateParam)) {
    return apiError('Format tanggal akhir tidak valid (harus YYYY-MM-DD).', 400);
  }
  if (startDateParam && endDateParam && startDateParam > endDateParam) {
    return apiError('Tanggal awal tidak boleh melebihi tanggal akhir.', 400);
  }

  const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  // Ambil daftar bulan yang tersedia dari database untuk tombol navigasi UI
  // CATATAN: attendances.attendanceDate bertipe PostgreSQL DATE, bukan TEXT,
  // sehingga wajib TO_CHAR(..., 'YYYY-MM') agar tidak gagal SUBSTRING(date, ...).
  const monthExpr = sql<string>`TO_CHAR(${attendances.attendanceDate}, 'YYYY-MM')`;
  const availableMonthsRaw = await db
    .select({
      month: monthExpr,
    })
    .from(attendances)
    .groupBy(monthExpr)
    .orderBy(desc(monthExpr));
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
    const lastMonthDate = new Date(Date.UTC(currY ?? 2026, (currM ?? 11) - 2, 1, 12, 0, 0));
    const ly = lastMonthDate.getUTCFullYear();
    const lm = String(lastMonthDate.getUTCMonth() + 1).padStart(2, '0');
    const lastDay = new Date(Date.UTC(ly, lastMonthDate.getUTCMonth() + 1, 0)).getUTCDate();
    effectiveStart = `${ly}-${lm}-01`;
    effectiveEnd = `${ly}-${lm}-${String(lastDay).padStart(2, '0')}`;
    const monthName = new Intl.DateTimeFormat('id-ID', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(lastMonthDate);
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
    const monthObj = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1, 12, 0, 0));
    const monthName = new Intl.DateTimeFormat('id-ID', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    }).format(monthObj);
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
    const dateObj = new Date(`${targetDate}T12:00:00+07:00`);
    rangeLabel = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
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
        columns: {
          id: true,
          fullName: true,
          nim: true,
          programStudi: true,
          jabatan: true,
          isActive: true,
          deletedAt: true,
        },
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

  const empMap = new Map<
    string,
    EmpSummary & { disciplineScoreSum: number; isActive: boolean }
  >();

  let totalHadir = 0;
  let totalTelat = 0;
  let totalLateMinutes = 0;
  let totalIjin = 0;
  let totalTidakHadir = 0;
  let totalPengganti = 0;

  const visibleRecords: typeof records = [];

  for (const r of records) {
    const emp = r.employee;
    if (!emp || emp.deletedAt || isExcludedAccount(emp.fullName, emp.nim)) continue;

    visibleRecords.push(r);

    if (r.status === 'HADIR') totalHadir += 1;
    else if (r.status === 'TELAT') {
      totalTelat += 1;
      totalLateMinutes += (r.lateMinutes && r.lateMinutes > 0 ? r.lateMinutes : 0);
    } else if (r.status === 'IJIN') totalIjin += 1;
    else if (r.status === 'TIDAK_HADIR') totalTidakHadir += 1;
    else if (r.status === 'PENGGANTI') totalPengganti += 1;

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
        isActive: emp.isActive,
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

  const summaryByEmployee: EmpSummary[] = Array.from(empMap.values())
    .filter((e) => e.isActive || e.hadir + e.telat + e.pengganti > 0)
    .map((e) => {
      const computed = computeAttendanceDisciplineScore({
        hadir: e.hadir,
        telat: e.telat,
        pengganti: e.pengganti,
        ijin: e.ijin,
        tidakHadir: e.tidakHadir,
        disciplineScoreSum: e.disciplineScoreSum,
      });

      return {
        employeeId: e.employeeId,
        fullName: e.fullName,
        nim: e.nim,
        programStudi: e.programStudi,
        jabatan: e.jabatan,
        totalShift: computed.totalShift,
        hadir: e.hadir,
        telat: e.telat,
        totalLateMinutes: e.totalLateMinutes,
        ijin: e.ijin,
        tidakHadir: e.tidakHadir,
        pengganti: e.pengganti,
        persenKehadiran: computed.persenKehadiran,
        skorDisiplin: computed.skorDisiplin,
        statusDisiplin: computed.statusDisiplin,
      };
    })
    .sort((a, b) => b.skorDisiplin - a.skorDisiplin || b.totalShift - a.totalShift || a.fullName.localeCompare(b.fullName));

  const totalEmployees = summaryByEmployee.length;
  const avgKehadiran = totalEmployees > 0
    ? Math.round(summaryByEmployee.reduce((s, e) => s + e.persenKehadiran, 0) / totalEmployees)
    : 100;
  const avgDisiplin = totalEmployees > 0
    ? Math.round(summaryByEmployee.reduce((s, e) => s + e.skorDisiplin, 0) / totalEmployees)
    : 100;

  return apiOk({
    records: visibleRecords,
    summaryByEmployee,
    summary: {
      totalRecords: visibleRecords.length,
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

// ── POST: Input manual / Crosscheck Buku (Single atau Massal per Tanggal) ──
const singleManualAttendanceSchema = z.object({
  employeeId:     z.string().uuid('Employee ID tidak valid'),
  scheduleId:     z.string().uuid('Schedule ID tidak valid'),
  attendanceDate: z
    .string()
    .refine(isValidYmd, 'Tanggal absensi tidak valid (harus tanggal kalender YYYY-MM-DD)'),
  status: z.enum(['HADIR', 'TELAT', 'PENGGANTI', 'IJIN', 'TIDAK_HADIR'], {
    message: 'Status kehadiran tidak valid',
  }),
  lateMinutes: z.number().int().min(0).max(480).optional().default(0),
  roleTask:    z.string().trim().max(50).optional(),
  clockInTime: z.string().regex(HM_RE, 'Format jam masuk tidak valid (HH:MM)').optional(),
  notes:       z.string().max(500).trim().optional(),
});

const bulkManualAttendanceSchema = z.object({
  entries: z.array(singleManualAttendanceSchema).min(1).max(40),
});

export async function POST(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin Shift atau Manager.', 403);
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Format request tidak valid.', 400); }

  const isBulk = Boolean(body && typeof body === 'object' && 'entries' in body);
  let entriesToSave: z.infer<typeof singleManualAttendanceSchema>[];

  if (isBulk) {
    const parsed = bulkManualAttendanceSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Data absensi massal tidak valid.', 422);
    }
    entriesToSave = parsed.data.entries;
  } else {
    const parsed = singleManualAttendanceSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Data absensi tidak valid.', 422);
    }
    entriesToSave = [parsed.data];
  }

  let savedIds: string[];
  try {
    savedIds = await db.transaction(async (tx) => {
      const ids: string[] = [];

      for (const item of entriesToSave) {
        const [emp, sched] = await Promise.all([
          tx.query.employees.findFirst({
            where: and(eq(employees.id, item.employeeId), isNull(employees.deletedAt)),
            columns: { id: true, fullName: true, isActive: true },
          }),
          tx.query.shiftSchedules.findFirst({
            where: eq(shiftSchedules.id, item.scheduleId),
            columns: { id: true, dayOfWeek: true, slotStart: true },
          }),
        ]);

        if (!emp) {
          throw new AttendanceBatchError(404, `Karyawan ${item.employeeId} tidak ditemukan.`);
        }
        if (!sched) {
          throw new AttendanceBatchError(404, `Jadwal ${item.scheduleId} tidak ditemukan.`);
        }

        const isPresent =
          item.status === 'HADIR' || item.status === 'TELAT' || item.status === 'PENGGANTI';
        if (isPresent && !emp.isActive) {
          throw new AttendanceBatchError(
            422,
            `Karyawan ${emp.fullName} sudah nonaktif dan tidak dapat dicatat hadir.`,
          );
        }

        const effLate = item.status === 'TELAT' ? item.lateMinutes : 0;
        const roleLabel = isPresent ? (item.roleTask?.trim() || 'Kasir') : null;
        const noteText = item.notes?.trim()
          ? (isPresent
              ? `Peran: ${roleLabel} | ${item.notes.trim()}`
              : item.notes.trim())
          : (isPresent
              ? `Peran: ${roleLabel} | Crosscheck buku`
              : null);

        const clockInActual = isPresent
          ? new Date(`${item.attendanceDate}T${item.clockInTime ?? sched.slotStart}:00+07:00`)
          : null;

        const [result] = await tx
          .insert(attendances)
          .values({
            employeeId:         item.employeeId,
            scheduleId:         item.scheduleId,
            attendanceDate:     item.attendanceDate,
            status:             item.status,
            clockInActual,
            clockOutActual:     null,
            lateMinutes:        effLate,
            roleTask:           roleLabel,
            verificationSource: 'MANUAL_CROSSCHECK',
            isSubstitute:       item.status === 'PENGGANTI',
            notes:              noteText,
            recordedByAdminId:  session.sub,
          })
          .onConflictDoUpdate({
            target: [attendances.employeeId, attendances.scheduleId, attendances.attendanceDate],
            set: {
              status:             item.status,
              clockInActual,
              ...(isPresent ? {} : { clockOutActual: null }),
              lateMinutes:        effLate,
              roleTask:           roleLabel,
              verificationSource: 'MANUAL_CROSSCHECK',
              isSubstitute:       item.status === 'PENGGANTI',
              notes:              noteText,
              recordedByAdminId:  session.sub,
              updatedAt:          new Date(),
            },
          })
          .returning({ id: attendances.id });

        if (result?.id) {
          ids.push(result.id);
          await tx.insert(auditLogs).values({
            tableName: 'attendances',
            recordId: result.id,
            action: 'UPDATE',
            newValues: JSON.stringify({
              source: 'MANUAL_CROSSCHECK',
              employeeName: emp.fullName,
              attendanceDate: item.attendanceDate,
              status: item.status,
              lateMinutes: effLate,
              roleTask: roleLabel,
              notes: noteText,
            }),
            actorType: 'ADMIN',
            actorId: session.sub,
          });
        }
      }

      return ids;
    });
  } catch (err) {
    if (err instanceof AttendanceBatchError) {
      return apiError(err.message, err.status);
    }
    console.error('Error saving manual attendance:', err);
    return apiError('Gagal menyimpan data absensi manual.', 500);
  }

  return apiOk(
    {
      id:      savedIds[0],
      ids:     savedIds,
      count:   savedIds.length,
      message: savedIds.length > 1
        ? `${savedIds.length} data absensi crosscheck berhasil disimpan.`
        : `Absensi berhasil dicatat.`,
    },
    201,
  );
}
