// =============================================================
// Smartkasir Perwira — Attendance Lateness Calculator (SSOT)
// Opsi A (berlaku mulai 2026-11-24):
//   - Toleransi bawaan 30 menit (diambil dari qris_settings.attendance_tolerance).
//     Contoh Shift Pagi 07:30 -> batas tepat waktu 08:00.
//     Contoh Shift Siang 11:30 -> batas tepat waktu 12:00.
//   - Menit telat (lateMinutes) dihitung SETELAH melewati batas toleransi
//     (08:01 = 1 menit telat, 08:05 = 5 menit, 08:15 = 15 menit, dst.)
//     sehingga tidak terjadi lompatan ekstrem 0% -> 18% pada menit ke-1.
//   - Pelindung serah-terima Shift Siang (>= 11:00): jika Shift Pagi baru
//     tutup melewati jam mulai siang, patokan bergeser ke jam tutup Shift Pagi
//     (maks +60 menit) — konsisten di Kiosk Presensi dan Login Kasir.
// =============================================================

import { and, gte, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { getWibMinutes } from '@/lib/services/activeShiftService';
import { getOperationalSettings } from '@/lib/services/operationalSettingsService';

export type AttendanceComputedStatus = 'HADIR' | 'TELAT' | 'PENGGANTI';

export interface ComputeAttendanceLatenessInput {
  /** Waktu clock-in aktual dalam menit sejak 00:00 WIB */
  clockInMinutesWib: number;
  /** Jam mulai slot jadwal format 'HH:MM' */
  slotStart: string;
  /** Toleransi keterlambatan aktif (menit, default 30) */
  toleranceMinutes: number;
  /** Daftar jam tutup Shift Pagi (menit sejak 00:00 WIB) hari yang sama */
  morningShiftClockOutMinutes?: readonly number[];
  /** True bila petugas hadir sebagai pengganti (badal) */
  isSubstitute?: boolean;
}

export interface ComputedAttendanceLateness {
  status: AttendanceComputedStatus;
  isTelat: boolean;
  lateMinutes: number;
  patokanMenitTotal: number;
  graceEndMinutes: number;
  toleranceMinutes: number;
}

function parseHhMmToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr ?? 0);
  const m = Number(mStr ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/**
 * Fungsi murni (deterministik, mudah diuji) untuk menghitung status & menit telat (Opsi A).
 */
export function computeAttendanceLateness(
  input: ComputeAttendanceLatenessInput,
): ComputedAttendanceLateness {
  const toleranceMinutes = Math.max(0, Math.floor(input.toleranceMinutes));
  const jadwalMenitTotal = parseHhMmToMinutes(input.slotStart);
  const isSubstitute = Boolean(input.isSubstitute);

  let patokanMenitTotal = jadwalMenitTotal;

  // Pelindung serah terima Shift Siang (>= 11:00):
  // jika Shift Pagi selesai melewati jam mulai siang, geser patokan maks +60 mnt.
  if (!isSubstitute && jadwalMenitTotal >= 11 * 60 && input.morningShiftClockOutMinutes?.length) {
    for (const outMin of input.morningShiftClockOutMinutes) {
      if (Number.isFinite(outMin) && outMin > patokanMenitTotal) {
        patokanMenitTotal = Math.min(jadwalMenitTotal + 60, outMin);
      }
    }
  }

  const graceEndMinutes = patokanMenitTotal + toleranceMinutes;
  const menitLewatBatas = input.clockInMinutesWib - graceEndMinutes;

  const isTelat = isSubstitute ? false : menitLewatBatas > 0;
  const lateMinutes = isSubstitute ? 0 : isTelat ? menitLewatBatas : 0;
  const status: AttendanceComputedStatus = isSubstitute
    ? 'PENGGANTI'
    : isTelat
      ? 'TELAT'
      : 'HADIR';

  return {
    status,
    isTelat,
    lateMinutes,
    patokanMenitTotal,
    graceEndMinutes,
    toleranceMinutes,
  };
}

/**
 * Resolver server-side: membaca toleransi operasional aktif + jam tutup Shift Pagi
 * hari yang sama, lalu menghitung keterlambatan dengan `computeAttendanceLateness`.
 */
export async function resolveAttendanceLateness(params: {
  nowWib: Date;
  attendanceDate: string;
  slotStart: string;
  isSubstitute?: boolean;
}): Promise<ComputedAttendanceLateness> {
  const settings = await getOperationalSettings();
  const jadwalMenitTotal = parseHhMmToMinutes(params.slotStart);
  const clockInMinutesWib = getWibMinutes(params.nowWib);

  const morningShiftClockOutMinutes: number[] = [];
  if (!params.isSubstitute && jadwalMenitTotal >= 11 * 60) {
    const startOfDayWib = new Date(`${params.attendanceDate}T00:00:00+07:00`);
    const noonWib = new Date(`${params.attendanceDate}T11:15:00+07:00`);
    const morningShifts = await db
      .select({ clockOut: shifts.clockOut })
      .from(shifts)
      .where(
        and(
          gte(shifts.clockIn, startOfDayWib),
          lt(shifts.clockIn, noonWib),
          isNotNull(shifts.clockOut),
        ),
      );

    for (const ms of morningShifts) {
      if (!ms.clockOut) continue;
      morningShiftClockOutMinutes.push(getWibMinutes(new Date(ms.clockOut)));
    }
  }

  return computeAttendanceLateness({
    clockInMinutesWib,
    slotStart: params.slotStart,
    toleranceMinutes: settings.attendanceTolerance,
    morningShiftClockOutMinutes,
    isSubstitute: params.isSubstitute,
  });
}

/**
 * Penjaga Cron PASS 2 (Auto-Alpha):
 * Mencegah jadwal yang baru dibuat/diubah SETELAH jam shift berakhir (mis. diinput malam hari)
 * otomatis memberi status TIDAK_HADIR (Alpha) surut untuk hari yang sama.
 */
export function shouldSkipAutoAlphaForScheduleUpdate(params: {
  slotEndEpoch: number;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): boolean {
  const createdMs = params.createdAt ? new Date(params.createdAt).getTime() : NaN;
  const updatedMs = params.updatedAt ? new Date(params.updatedAt).getTime() : NaN;
  if (Number.isFinite(createdMs) && createdMs > params.slotEndEpoch) return true;
  if (Number.isFinite(updatedMs) && updatedMs > params.slotEndEpoch) return true;
  return false;
}
