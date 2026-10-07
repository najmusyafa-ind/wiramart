// =============================================================
// GET /api/kasir/presensi-hari-ini
// Mengambil jadwal shift hari ini (WIB) beserta status kehadiran karyawan
// Digunakan oleh Kiosk Presensi Bersama di komputer toko
// =============================================================

import { NextResponse } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees, attendances, qrisSettings } from '@/lib/db/schema';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const HARI_MAP: Record<number, 'MINGGU' | 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU'> = {
  0: 'MINGGU', 1: 'SENIN', 2: 'SELASA', 3: 'RABU',
  4: 'KAMIS',  5: 'JUMAT', 6: 'SABTU',
};

export async function GET(): Promise<Response> {
  try {
    const nowWib = new Date();
    const dayOfWeek = HARI_MAP[nowWib.getDay()]!;
    const tanggalHari = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const jamMenitSekarang = nowWib.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    }); // 'HH:MM'

    // Ambil toleransi keterlambatan dari pengaturan (singleton)
    const settingsRow = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
      columns: { attendanceTolerance: true },
    });
    const toleransiMenit = settingsRow?.attendanceTolerance ?? 15;

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
      })
      .from(shiftSchedules)
      .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
      .where(and(
        eq(shiftSchedules.dayOfWeek, dayOfWeek),
        eq(shiftSchedules.isActive, true),
      ))
      .orderBy(shiftSchedules.slotStart, shiftSchedules.orderInSlot);

    // Ambil absensi yang sudah tercatat hari ini
    const attendancesToday = await db
      .select({
        id:             attendances.id,
        employeeId:     attendances.employeeId,
        scheduleId:     attendances.scheduleId,
        status:         attendances.status,
        clockInActual:  attendances.clockInActual,
        clockOutActual: attendances.clockOutActual,
        lateMinutes:    attendances.lateMinutes,
        notes:          attendances.notes,
      })
      .from(attendances)
      .where(eq(attendances.attendanceDate, tanggalHari));

    const attendanceMap = new Map<string, typeof attendancesToday[0]>();
    for (const att of attendancesToday) {
      attendanceMap.set(`${att.employeeId}_${att.scheduleId}`, att);
    }

    // Kelompokkan slot berdasarkan rentang waktu (mis. '08:00 - 11:30', '11:30 - 15:00')
    const grouped = new Map<string, {
      slotStart: string;
      slotEnd: string;
      label: string;
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
        attendance: {
          isAttended: boolean;
          isClockedOut: boolean;
          status?: string;
          clockInTime?: string | null;
          clockOutTime?: string | null;
          lateMinutes?: number;
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
          isCurrent,
          coordinator: s.coordinatorName,
          personnel: [],
        });
      }

      if (s.employeeId) {
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
          attendance: {
            isAttended:   Boolean(att),
            isClockedOut: Boolean(att?.clockOutActual),
            status:       att?.status,
            clockInTime:  clockInStr,
            clockOutTime: clockOutStr,
            lateMinutes:  att?.lateMinutes,
            notes:        att?.notes,
          },
        });
      }
    }

    return apiOk({
      hari: dayOfWeek,
      tanggal: tanggalHari,
      jamSekarang: jamMenitSekarang,
      toleransiMenit,
      shifts: Array.from(grouped.values()),
    });
  } catch (err) {
    console.error('Error fetching presensi hari ini:', err);
    return apiError('Gagal memuat jadwal presensi hari ini.', 'SERVER_ERROR', 500);
  }
}
