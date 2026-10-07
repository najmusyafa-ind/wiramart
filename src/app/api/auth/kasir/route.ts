// =============================================================
// POST /api/auth/kasir — Employee Login
// Body: { fullName: string, nim: string, programStudi: string }
// Login via kombinasi Nama + NIM + Program Studi (no password)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftSchedules, attendances, qrisSettings } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { signAccessToken, signRefreshToken } from '@/lib/utils/auth';
import { apiError } from '@/lib/utils/helpers';
import { sql } from 'drizzle-orm';
import { kasirAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const kasirLoginSchema = z.object({
  fullName: z.string().min(2, 'Nama lengkap wajib diisi').max(200).trim(),
  nim: z.string().min(1, 'NIM wajib diisi').max(20).trim(),
  programStudi: z.string().min(2, 'Program studi wajib diisi').max(100).trim(),
});

export async function POST(request: Request): Promise<Response> {
  // 1. Parse + validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('Format request tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = kasirLoginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('Data tidak lengkap', 'VALIDATION_ERROR', 422, parsed.error.format());
  }

  const { fullName, nim, programStudi } = parsed.data;

  // Rate limit per NIM — via centralized sliding window limiter (25x / 30 menit)
  const rateKey = `kasir:${nim}`;
  const checkResult = kasirAuthLimiter.check(rateKey, false);
  if (!checkResult.allowed) {
    const menitLagi = Math.ceil(checkResult.retryAfterSeconds / 60);
    return apiError(
      `Terlalu banyak percobaan login. Tunggu ±${menitLagi} menit lagi, atau minta Admin untuk mereset akses Anda.`,
      'RATE_LIMITED',
      429,
    );
  }

  // 3. Find employee — case-insensitive match untuk nama dan prodi
  // NIM case-sensitive (angka tidak punya case masalah)
  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nim),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
      // Case-insensitive comparison via SQL lower()
      sql`LOWER(${employees.fullName}) = LOWER(${fullName})`,
      sql`LOWER(${employees.programStudi}) = LOWER(${programStudi})`,
    ),
    columns: { id: true, fullName: true, jabatan: true, nim: true, programStudi: true },
  });

  if (!employee) {
    // Consume rate limit slot pada setiap percobaan gagal
    kasirAuthLimiter.check(rateKey, true);
    // SECURITY: Generic error message
    return apiError(
      'Data tidak ditemukan. Pastikan Nama, NIM, dan Program Studi sudah benar.',
      'INVALID_CREDENTIALS',
      401,
    );
  }

  // 4. Periksa shift aktif karyawan (dukung resume sesi aktif <12 jam)
  let shiftToUseId: string;

  const existingShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employee.id), eq(shifts.status, 'ACTIVE')),
  });

  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  if (existingShift) {
    const shiftAge = Date.now() - new Date(existingShift.clockIn).getTime();
    if (shiftAge > TWELVE_HOURS) {
      // Auto-close shift lama yang sudah basi (>12 jam)
      await db
        .update(shifts)
        .set({ clockOut: new Date(), status: 'CLOSED' })
        .where(eq(shifts.id, existingShift.id));

      // Buat shift baru
      const [newShift] = await db
        .insert(shifts)
        .values({
          employeeId: employee.id,
          status: 'ACTIVE',
        })
        .returning({ id: shifts.id });

      if (!newShift) {
        return apiError('Gagal membuat sesi kerja. Coba lagi.', 'SHIFT_CREATE_FAILED', 500);
      }
      shiftToUseId = newShift.id;
    } else {
      // Resume sesi shift yang sedang aktif (misal kasir me-refresh tab atau buka browser baru)
      shiftToUseId = existingShift.id;
    }
  } else {
    // 5. Buat shift baru (clock-in)
    const [newShift] = await db
      .insert(shifts)
      .values({
        employeeId: employee.id,
        status: 'ACTIVE',
      })
      .returning({ id: shifts.id });

    if (!newShift) {
      return apiError('Gagal membuat sesi kerja. Coba lagi.', 'SHIFT_CREATE_FAILED', 500);
    }
    shiftToUseId = newShift.id;
  }

  // 5b. Catat absensi (HADIR / TELAT) — sinkron (await) dengan error guard terisolasi
  // Menjamin baris absensi tidak hilang diam-diam di lingkungan serverless Vercel
  try {
    const nowWib = new Date();
    // Tentukan hari dalam Bahasa Indonesia (Asia/Jakarta)
    const hariWib = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
    }).format(nowWib).toUpperCase() as
      'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU' | 'MINGGU';

    const tanggalHari = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
    }).format(nowWib);

    const jamMenitSekarang = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    }).format(nowWib); // 'HH:MM'

    // Ambil SEMUA slot jadwal karyawan hari ini
    const allSlotsHariIni = await db
      .select({
        id:        shiftSchedules.id,
        slotStart: shiftSchedules.slotStart,
        slotEnd:   shiftSchedules.slotEnd,
      })
      .from(shiftSchedules)
      .where(and(
        eq(shiftSchedules.employeeId, employee.id),
        eq(shiftSchedules.dayOfWeek, hariWib),
        eq(shiftSchedules.isActive, true),
      ));

    if (allSlotsHariIni.length > 0) {
      // Konversi login time ke total menit sejak tengah malam
      const [jamAktual, menitAktual] = jamMenitSekarang.split(':').map(Number);
      const loginMenit = (jamAktual ?? 0) * 60 + (menitAktual ?? 0);

      let jadwalHariIni = allSlotsHariIni[0]!;
      let bestStartMenit = -1;

      for (const slot of allSlotsHariIni) {
        const [sH, sM] = slot.slotStart.split(':').map(Number);
        const slotStartMenit = (sH ?? 0) * 60 + (sM ?? 0);
        if (slotStartMenit <= loginMenit && slotStartMenit > bestStartMenit) {
          bestStartMenit = slotStartMenit;
          jadwalHariIni  = slot;
        }
      }

      const settingsRow = await db.query.qrisSettings.findFirst({
        where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
        columns: { attendanceTolerance: true },
      });
      const TOLERANSI_MENIT = settingsRow?.attendanceTolerance ?? 15;

      const [jamJadwal, menitJadwal] = jadwalHariIni.slotStart.split(':').map(Number);
      const menitJadwalTotal = (jamJadwal ?? 0) * 60 + (menitJadwal ?? 0);
      const selisihMenit     = loginMenit - menitJadwalTotal; // positif = telat

      const isTelat     = selisihMenit > TOLERANSI_MENIT;
      const lateMinutes = isTelat ? selisihMenit : 0;

      await db
        .insert(attendances)
        .values({
          employeeId:     employee.id,
          scheduleId:     jadwalHariIni.id,
          attendanceDate: tanggalHari,
          status:         isTelat ? 'TELAT' : 'HADIR',
          shiftId:        shiftToUseId,
          clockInActual:  nowWib,
          lateMinutes,
        })
        .onConflictDoNothing();
    }
  } catch (attErr) {
    // Toleran: kegagalan presensi tidak boleh memblokir kasir untuk bertugas
    console.error('[Attendance] Gagal mencatat absensi kasir:', attErr);
  }

  // 6. Generate tokens
  const accessToken = await signAccessToken({
    sub: employee.id,
    role: 'employee',
    shiftId: shiftToUseId,
    name: employee.fullName,
  });
  const refreshToken = await signRefreshToken(employee.id, 'employee');

  // Set cookies langsung di NextResponse (reliable di Next.js 16+)
  const response = NextResponse.json({
    success: true,
    data: {
      role: 'employee',
      name: employee.fullName,
      shiftId: shiftToUseId,
      redirect: '/kasir/pos',
    },
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOpts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };

  response.cookies.set('sk_kasir', accessToken, {
    ...cookieOpts,
    maxAge: 60 * 60 * 8, // 8 jam (1 shift kerja kasir)
  });
  response.cookies.set('sk_kasir_r', refreshToken, {
    ...cookieOpts,
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
