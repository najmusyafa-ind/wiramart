// =============================================================
// POST /api/kasir/presensi
// Endpoint untuk mencatat kehadiran (Presensi Masuk & Presensi Pulang)
// Mendukung 4 Peran Toko Resmi: Ketua Admin, Kasir, Pelayan, Gudang
// =============================================================

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees, attendances, qrisSettings } from '@/lib/db/schema';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const presensiSchema = z.object({
  action:     z.enum(['CLOCK_IN', 'CLOCK_OUT']).default('CLOCK_IN'),
  employeeId: z.string().uuid('ID Karyawan tidak valid'),
  scheduleId: z.string().uuid('ID Jadwal tidak valid'),
  roleTask:   z.enum([
    'Ketua Admin', 'Kasir', 'Pelayan', 'Gudang',
    'Customer Service', 'Kepala Gudang', 'Admin Kasir',
  ]).optional(),
  notes:      z.string().max(255).optional(),
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

  const { action, employeeId, scheduleId, notes } = parsed.data;
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

    // Hitung keterlambatan berdasarkan toleransi
    const settingsRow = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
      columns: { attendanceTolerance: true },
    });
    const toleransiMenit = settingsRow?.attendanceTolerance ?? 15;

    const [jamAktual, menitAktual] = jamMenitSekarang.split(':').map(Number);
    const [jamJadwal, menitJadwal] = schedule.slotStart.split(':').map(Number);

    const loginMenitTotal  = (jamAktual ?? 0) * 60 + (menitAktual ?? 0);
    const jadwalMenitTotal = (jamJadwal ?? 0) * 60 + (menitJadwal ?? 0);
    const selisihMenit     = loginMenitTotal - jadwalMenitTotal; // positif = telat

    const isTelat     = selisihMenit > toleransiMenit;
    const lateMinutes = isTelat ? selisihMenit : 0;
    const status      = isTelat ? 'TELAT' : 'HADIR';

    const fullNotes = `Peran: ${roleTask}${notes ? ` | ${notes.trim()}` : ''}`;

    // Simpan record absensi masuk
    const [saved] = await db
      .insert(attendances)
      .values({
        employeeId,
        scheduleId,
        attendanceDate: tanggalHari,
        status,
        clockInActual:  nowWib,
        lateMinutes,
        notes:          fullNotes,
      })
      .returning({ id: attendances.id });

    // Update jabatan aktual di profil karyawan jika berubah
    if (employee.jabatan !== roleTask) {
      await db
        .update(employees)
        .set({ jabatan: roleTask, updatedAt: nowWib })
        .where(eq(employees.id, employeeId));
    }

    return apiOk({
      id: saved.id,
      fullName: employee.fullName,
      nim: employee.nim,
      roleTask,
      status,
      jamPresensi: jamMenitSekarang,
      lateMinutes,
      message: `Presensi berhasil! ${employee.fullName} tercatat ${status} sebagai ${roleTask}.`,
    });
  } catch (err) {
    console.error('Error recording presensi:', err);
    return apiError('Gagal mencatat presensi. Coba lagi.', 'SERVER_ERROR', 500);
  }
}
