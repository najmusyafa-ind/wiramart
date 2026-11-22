// =============================================================
// POST /api/kasir/presensi
// Endpoint untuk mencatat kehadiran (Presensi Masuk & Presensi Pulang)
// Mendukung 4 Peran Toko Resmi: Ketua Admin, Kasir, Pelayan, Gudang
// =============================================================

import { z } from 'zod';
import { eq, and, ne, inArray, sql, gte, lt, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees, attendances, qrisSettings, shifts } from '@/lib/db/schema';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { getWibMinutes } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';

const presensiSchema = z.object({
  action:       z.enum(['CLOCK_IN', 'CLOCK_OUT']).default('CLOCK_IN'),
  employeeId:   z.string().uuid('ID Karyawan tidak valid'),
  scheduleId:   z.string().uuid('ID Jadwal tidak valid'),
  roleTask:     z.enum([
    'Admin Shift', 'Kepala Gudang', 'Kasir', 'Customer Service',
    'Ketua Admin', 'Pelayan', 'Gudang', 'Admin Kasir', 'Kepala Kasir',
    'CS Pelayan', 'CS',
  ]).optional(),
  isSubstitute: z.boolean().optional().default(false),
  notes:        z.string().max(255).optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('Format request tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = presensiSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('Data presensi tidak lengkap', 'VALIDATION_ERROR', 422, parsed.error.format());
  }

  const { action, employeeId, scheduleId, isSubstitute, notes } = parsed.data;
  const roleTask = parsed.data.roleTask ?? 'Kasir';

  try {
    // 1. Verifikasi Karyawan
    const employee = await db.query.employees.findFirst({
      where: and(eq(employees.id, employeeId), eq(employees.isActive, true)),
      columns: { id: true, fullName: true, nim: true, jabatan: true },
    });

    if (!employee) {
      return apiError('Karyawan tidak ditemukan atau tidak aktif.', 'NOT_FOUND', 404);
    }

    // 2. Verifikasi Slot Jadwal
    const schedule = await db.query.shiftSchedules.findFirst({
      where: and(eq(shiftSchedules.id, scheduleId), eq(shiftSchedules.isActive, true)),
      columns: { id: true, dayOfWeek: true, slotStart: true, slotEnd: true, employeeId: true },
    });

    if (!schedule) {
      return apiError('Slot jadwal tidak ditemukan atau tidak aktif.', 'NOT_FOUND', 404);
    }

    const nowWib = new Date();
    const tanggalHari = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const jamMenitSekarang = nowWib.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    }); // 'HH:MM'

    // =========================================================
    // AKSI 1: CLOCK_OUT (Presensi Pulang)
    // =========================================================
    if (action === 'CLOCK_OUT') {
      const existing = await db.query.attendances.findFirst({
        where: and(
          eq(attendances.employeeId, employeeId),
          eq(attendances.scheduleId, scheduleId),
          eq(attendances.attendanceDate, tanggalHari),
        ),
      });

      if (!existing) {
        return apiError(
          'Belum ada catatan presensi masuk hari ini. Lakukan Presensi Masuk terlebih dahulu.',
          'NOT_ATTENDED_YET',
          404,
        );
      }

      if (existing.clockOutActual) {
        const jamOut = new Date(existing.clockOutActual).toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
        });
        return apiError(
          `Anda sudah melakukan presensi pulang sebelumnya pada pukul ${jamOut} WIB.`,
          'ALREADY_CLOCKED_OUT',
          409,
        );
      }

      // Hitung durasi kerja aktif (menit)
      const clockInTime = existing.clockInActual ? new Date(existing.clockInActual).getTime() : nowWib.getTime();
      const durasiMenit = Math.max(0, Math.round((nowWib.getTime() - clockInTime) / 60000));
      const durasiJam = Math.floor(durasiMenit / 60);
      const sisaMenit = durasiMenit % 60;
      const durasiTeks = durasiJam > 0 ? `${durasiJam} jam ${sisaMenit} menit` : `${sisaMenit} menit`;

      const appendNotes = notes ? `${existing.notes ?? ''} | Pulang: ${notes.trim()}`.trim() : existing.notes;

      await db
        .update(attendances)
        .set({
          clockOutActual: nowWib,
          notes:          appendNotes,
          updatedAt:      nowWib,
        })
        .where(eq(attendances.id, existing.id));

      return apiOk({
        id: existing.id,
        fullName: employee.fullName,
        nim: employee.nim,
        jamPresensi: jamMenitSekarang,
        durasiMenit,
        durasiTeks,
        message: `Presensi pulang berhasil! Terima kasih atas dedikasinya (${durasiTeks}).`,
      });
    }

    // =========================================================
    // AKSI 2: CLOCK_IN (Presensi Masuk)
    // =========================================================
    // Cek apakah sudah pernah presensi di jadwal dan tanggal ini
    const existing = await db.query.attendances.findFirst({
      where: and(
        eq(attendances.employeeId, employeeId),
        eq(attendances.scheduleId, scheduleId),
        eq(attendances.attendanceDate, tanggalHari),
      ),
    });

    if (existing) {
      return apiError(
        `Anda sudah melakukan presensi hari ini (${existing.status}).`,
        'ALREADY_ATTENDED',
        409,
      );
    }

    // Hitung keterlambatan berdasarkan toleransi + perlindungan serah terima shift pagi
    const settingsRow = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
      columns: { attendanceTolerance: true },
    });
    const toleransiMenit = settingsRow?.attendanceTolerance ?? 15;

    const [jamAktual, menitAktual] = jamMenitSekarang.split(':').map(Number);
    const [jamJadwal, menitJadwal] = schedule.slotStart.split(':').map(Number);

    const loginMenitTotal  = (jamAktual ?? 0) * 60 + (menitAktual ?? 0);
    const jadwalMenitTotal = (jamJadwal ?? 0) * 60 + (menitJadwal ?? 0);

    // Jika Shift Siang (>= 11:00) dan Shift Pagi baru selesai melewati jam mulai siang,
    // gunakan jam selesai Shift Pagi (maks +60 mnt) sebagai patokan agar tim siang tidak dihukum menunggu laci.
    let patokanMenitTotal = jadwalMenitTotal;
    if (!isSubstitute && jadwalMenitTotal >= 11 * 60) {
      const startOfDayWib = new Date(`${tanggalHari}T00:00:00+07:00`);
      const noonWib = new Date(`${tanggalHari}T11:15:00+07:00`);
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
        const outMin = getWibMinutes(new Date(ms.clockOut));
        if (outMin > patokanMenitTotal) {
          patokanMenitTotal = Math.min(jadwalMenitTotal + 60, outMin);
        }
      }
    }

    const selisihMenit = loginMenitTotal - patokanMenitTotal; // positif = telat
    const isTelat      = isSubstitute ? false : selisihMenit > toleransiMenit;
    const lateMinutes  = isSubstitute ? 0 : (isTelat ? selisihMenit : 0);
    const status       = isSubstitute ? 'PENGGANTI' : (isTelat ? 'TELAT' : 'HADIR');

    // ── ATURAN KUOTA PERAN SHIFT ──
    // Admin Shift & Kasir: Maksimal 1 orang per shift (laci & otorisasi tunggal).
    // Gudang & CS Pelayan: Fleksibel / Boleh > 1 orang.
    if (roleTask === 'Kasir' || roleTask === 'Admin Shift') {
      const siblingSchedules = await db.query.shiftSchedules.findMany({
        where: and(
          eq(shiftSchedules.dayOfWeek, schedule.dayOfWeek),
          eq(shiftSchedules.slotStart, schedule.slotStart),
          eq(shiftSchedules.slotEnd, schedule.slotEnd),
          eq(shiftSchedules.isActive, true),
        ),
        columns: { id: true },
      });
      const siblingScheduleIds = siblingSchedules.map((s) => s.id);

      if (siblingScheduleIds.length > 0) {
        const existingRoleAtt = await db
          .select({
            id: attendances.id,
            employeeName: employees.fullName,
          })
          .from(attendances)
          .innerJoin(employees, eq(attendances.employeeId, employees.id))
          .where(
            and(
              eq(attendances.attendanceDate, tanggalHari),
              inArray(attendances.scheduleId, siblingScheduleIds),
              ne(attendances.employeeId, employeeId),
              sql`(${attendances.roleTask} = ${roleTask} OR ${attendances.notes} ILIKE ${`%Peran: ${roleTask}%`})`,
            )
          )
          .limit(1);

        if (existingRoleAtt.length > 0) {
          const occName = existingRoleAtt[0]?.employeeName ?? 'rekan shift lain';
          return apiError(
            `Peran ${roleTask} pada shift ini sudah diisi oleh ${occName}. Silakan pilih tugas Gudang atau CS Pelayan.`,
            'ROLE_LIMIT_REACHED',
            422,
          );
        }
      }
    }

    const cleanNotes = notes?.trim();
    const subTag = isSubstitute ? ' | Pengganti' : '';
    const fullNotes = `Peran: ${roleTask}${subTag}${cleanNotes ? ` | ${cleanNotes}` : ''}`;

    // Simpan record absensi masuk (tanpa menimpa permanen employees.jabatan)
    const [saved] = await db
      .insert(attendances)
      .values({
        employeeId,
        scheduleId,
        attendanceDate:     tanggalHari,
        status,
        clockInActual:      nowWib,
        lateMinutes,
        roleTask,
        verificationSource: isSubstitute ? 'BADAL_KIOSK' : 'KIOSK',
        isSubstitute,
        notes:              fullNotes,
      })
      .returning({ id: attendances.id });

    return apiOk({
      id: saved.id,
      fullName: employee.fullName,
      nim: employee.nim,
      roleTask,
      status,
      isSubstitute,
      jamPresensi: jamMenitSekarang,
      lateMinutes,
      message: isSubstitute
        ? `${employee.fullName} tercatat hadir sebagai Pengganti (${roleTask}).`
        : `${employee.fullName} tercatat ${status} sebagai ${roleTask}.`,
    });
  } catch (err) {
    console.error('Error recording presensi:', err);
    return apiError('Gagal mencatat presensi. Coba lagi.', 'SERVER_ERROR', 500);
  }
}
