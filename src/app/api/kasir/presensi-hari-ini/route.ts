// =============================================================
// GET /api/kasir/presensi-hari-ini
// Mengambil jadwal shift hari ini (WIB) beserta status kehadiran karyawan
// Digunakan oleh Kiosk Presensi Bersama di komputer toko
// =============================================================

import { eq, and, sql, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees, attendances, qrisSettings } from '@/lib/db/schema';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HARI_MAP: Record<string, 'MINGGU' | 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU'> = {
  Minggu: 'MINGGU',
  Senin:  'SENIN',
  Selasa: 'SELASA',
  Rabu:   'RABU',
  Kamis:  'KAMIS',
  Jumat:  'JUMAT',
  Sabtu:  'SABTU',
};

export async function GET(): Promise<Response> {
  try {
    const nowWib = new Date();
    const hariRaw = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
    }).format(nowWib);
    const dayOfWeek = HARI_MAP[hariRaw] ?? (hariRaw.toUpperCase() as 'MINGGU' | 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU');
    const queryDayOfWeek = dayOfWeek;
    const tanggalHari = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const jamMenitSekarang = nowWib.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    }); // 'HH:MM'

    // Ambil toleransi keterlambatan dari pengaturan (singleton)
    const settingsRow = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
      columns: { attendanceTolerance: true },
    });
    const toleransiMenit = settingsRow?.attendanceTolerance ?? 30;

    // Ambil semua jadwal slot aktif hari ini beserta info karyawan
    const slots = await db
      .select({
        scheduleId:      shiftSchedules.id,
        dayOfWeek:       shiftSchedules.dayOfWeek,
        slotStart:       shiftSchedules.slotStart,
        slotEnd:         shiftSchedules.slotEnd,
        orderInSlot:     shiftSchedules.orderInSlot,
        coordinatorName: shiftSchedules.coordinatorName,
        employeeId:      shiftSchedules.employeeId,
        employeeName:    employees.fullName,
        employeeNim:     employees.nim,
        employeeProdi:   employees.programStudi,
        employeeJabatan: employees.jabatan,
        hasPin:          sql<boolean>`CASE WHEN ${employees.pinHash} IS NOT NULL THEN true ELSE false END`,
      })
      .from(shiftSchedules)
      .leftJoin(
        employees,
        and(
          eq(shiftSchedules.employeeId, employees.id),
          eq(employees.isActive, true),
          isNull(employees.deletedAt),
        ),
      )
      .where(and(
        eq(shiftSchedules.dayOfWeek, queryDayOfWeek),
        eq(shiftSchedules.isActive, true),
      ))
      .orderBy(shiftSchedules.slotStart, shiftSchedules.orderInSlot);

    // Ambil absensi yang sudah tercatat hari ini (beserta info karyawan & jadwal untuk dukungan Pengganti/Badal)
    const attendancesToday = await db
      .select({
        id:             attendances.id,
        employeeId:     attendances.employeeId,
        scheduleId:     attendances.scheduleId,
        status:         attendances.status,
        clockInActual:  attendances.clockInActual,
        clockOutActual: attendances.clockOutActual,
        lateMinutes:    attendances.lateMinutes,
        roleTask:       attendances.roleTask,
        isSubstitute:   attendances.isSubstitute,
        notes:          attendances.notes,
        empName:        employees.fullName,
        empNim:         employees.nim,
        empProdi:       employees.programStudi,
        empJabatan:     employees.jabatan,
        empHasPin:      sql<boolean>`CASE WHEN ${employees.pinHash} IS NOT NULL THEN true ELSE false END`,
        schedSlotStart: shiftSchedules.slotStart,
        schedSlotEnd:   shiftSchedules.slotEnd,
      })
      .from(attendances)
      .innerJoin(employees, eq(attendances.employeeId, employees.id))
      .leftJoin(shiftSchedules, eq(attendances.scheduleId, shiftSchedules.id))
      .where(eq(attendances.attendanceDate, tanggalHari));

    const attendanceMap = new Map<string, typeof attendancesToday[0]>();
    for (const att of attendancesToday) {
      attendanceMap.set(`${att.employeeId}_${att.scheduleId}`, att);
    }

    // Kelompokkan slot berdasarkan rentang waktu (mis. '07:30 - 11:30', '11:30 - 15:00')
    const grouped = new Map<string, {
      slotStart: string;
      slotEnd: string;
      label: string;
      defaultScheduleId: string;
      isCurrent: boolean;
      coordinator: string | null;
      personnel: Array<{
        scheduleId: string;
        orderInSlot: number;
        employeeId: string | null;
        fullName: string | null;
        nim: string | null;
        programStudi: string | null;
        defaultJabatan: string | null;
        hasPin: boolean;
        isSubstitute?: boolean;
        attendance: {
          isAttended: boolean;
          isClockedOut: boolean;
          status?: string;
          clockInTime?: string | null;
          clockOutTime?: string | null;
          lateMinutes?: number;
          roleTask?: string | null;
          notes?: string | null;
        };
      }>;
    }>();

    const [nowH, nowM] = jamMenitSekarang.split(':').map(Number);
    const nowTotalM = (nowH ?? 0) * 60 + (nowM ?? 0);

    for (const s of slots) {
      const key = `${s.slotStart} - ${s.slotEnd}`;
      if (!grouped.has(key)) {
        const [startH, startM] = s.slotStart.split(':').map(Number);
        const [endH, endM]     = s.slotEnd.split(':').map(Number);
        const startTotalM      = (startH ?? 0) * 60 + (startM ?? 0);
        const endTotalM        = (endH ?? 0) * 60 + (endM ?? 0);

        // Slot aktif jika waktu sekarang berada di antara (slotStart - 60 menit) s/d slotEnd
        const isCurrent = nowTotalM >= (startTotalM - 60) && nowTotalM <= endTotalM;

        grouped.set(key, {
          slotStart: s.slotStart,
          slotEnd: s.slotEnd,
          label: `${s.slotStart} - ${s.slotEnd} WIB`,
          defaultScheduleId: s.scheduleId,
          isCurrent,
          coordinator: s.coordinatorName,
          personnel: [],
        });
      }

      if (s.employeeId && s.employeeName) {
        const att = attendanceMap.get(`${s.employeeId}_${s.scheduleId}`);
        const clockInStr = att?.clockInActual
          ? new Date(att.clockInActual).toLocaleTimeString('en-GB', {
              timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
            })
          : null;
        const clockOutStr = att?.clockOutActual
          ? new Date(att.clockOutActual).toLocaleTimeString('en-GB', {
              timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
            })
          : null;

        grouped.get(key)!.personnel.push({
          scheduleId:      s.scheduleId,
          orderInSlot:     s.orderInSlot,
          employeeId:      s.employeeId,
          fullName:        s.employeeName,
          nim:             s.employeeNim,
          programStudi:    s.employeeProdi,
          defaultJabatan:  s.employeeJabatan,
          hasPin:          Boolean(s.hasPin),
          isSubstitute:    Boolean(att?.isSubstitute),
          attendance: {
            isAttended:   Boolean(att),
            isClockedOut: Boolean(att?.clockOutActual),
            status:       att?.status,
            clockInTime:  clockInStr,
            clockOutTime: clockOutStr,
            lateMinutes:  att?.lateMinutes,
            roleTask:     att?.roleTask ?? null,
            notes:        att?.notes,
          },
        });
      }
    }

    // Tambahkan personel Pengganti (Badal) yang hadir hari ini meski tidak ada di jadwal rutin hari ini
    for (const att of attendancesToday) {
      if (!att.schedSlotStart || !att.schedSlotEnd) continue;
      const key = `${att.schedSlotStart} - ${att.schedSlotEnd}`;
      const group = grouped.get(key);
      if (!group) continue;
      if (group.personnel.some((p) => p.employeeId === att.employeeId)) continue;

      const clockInStr = att.clockInActual
        ? new Date(att.clockInActual).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
          })
        : null;
      const clockOutStr = att.clockOutActual
        ? new Date(att.clockOutActual).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
          })
        : null;

      group.personnel.push({
        scheduleId:     att.scheduleId,
        orderInSlot:    90,
        employeeId:     att.employeeId,
        fullName:       att.empName,
        nim:            att.empNim,
        programStudi:   att.empProdi,
        defaultJabatan: att.empJabatan,
        hasPin:         Boolean(att.empHasPin),
        isSubstitute:   true,
        attendance: {
          isAttended:   true,
          isClockedOut: Boolean(att.clockOutActual),
          status:       att.status,
          clockInTime:  clockInStr,
          clockOutTime: clockOutStr,
          lateMinutes:  att.lateMinutes,
          roleTask:     att.roleTask ?? null,
          notes:        att.notes,
        },
      });
    }

    // Ambil daftar seluruh mahasiswa aktif untuk kemudahan Kasir Pengganti (Badal) & Oper Kasir
    const allEmployees = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        nim: employees.nim,
        programStudi: employees.programStudi,
        jabatan: employees.jabatan,
        hasPin: sql<boolean>`CASE WHEN ${employees.pinHash} IS NOT NULL THEN true ELSE false END`,
      })
      .from(employees)
      .where(and(eq(employees.isActive, true), isNull(employees.deletedAt)))
      .orderBy(employees.fullName);

    return apiOk({
      hari: dayOfWeek,
      tanggal: tanggalHari,
      jamSekarang: jamMenitSekarang,
      toleransiMenit,
      shifts: Array.from(grouped.values()),
      allEmployees,
    });
  } catch (err) {
    console.error('Error fetching presensi hari ini:', err);
    return apiError('Gagal memuat jadwal presensi hari ini.', 'SERVER_ERROR', 500);
  }
}
