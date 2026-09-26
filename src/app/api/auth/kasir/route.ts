// =============================================================
// POST /api/auth/kasir — Employee Login
// Body: { fullName: string, nim: string, programStudi: string }
// Login via kombinasi Nama + NIM + Program Studi (no password)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftSchedules, attendances } from '@/lib/db/schema';
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

  // 4. Check if employee already has an ACTIVE shift (prevent concurrent login)
  const existingShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employee.id), eq(shifts.status, 'ACTIVE')),
  });

  if (existingShift) {
    // Auto-close shift yang sudah >12 jam (stale / lupa logout)
    const shiftAge = Date.now() - new Date(existingShift.clockIn).getTime();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    if (shiftAge > TWELVE_HOURS) {
      // Close shift lama secara otomatis
      await db
        .update(shifts)
        .set({ clockOut: new Date(), status: 'CLOSED' })
        .where(eq(shifts.id, existingShift.id));
    } else {
      return apiError(
        'Akun ini masih aktif di sesi lain. Lakukan logout terlebih dahulu, atau hubungi Admin untuk mereset sesi.',
        'CONCURRENT_SESSION',
        409,
      );
    }
  }

  // 5. Create new shift (clock-in)
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

  // 5b. Auto-record attendance (HADIR / TELAT) — fire and forget
  // Tidak blocking login jika gagal (jadwal mungkin belum disetup admin)
  void (async () => {
    try {
      const nowWib = new Date();
      // Nama hari dalam Bahasa Indonesia (sesuai enum day_of_week)
      const hariMap: Record<number, string> = {
        0: 'MINGGU', 1: 'SENIN', 2: 'SELASA', 3: 'RABU',
        4: 'KAMIS',  5: 'JUMAT', 6: 'SABTU',
      };
      const hariIni = hariMap[nowWib.getDay()] as
        'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU' | 'MINGGU';
      const tanggalHari = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const jamMenitSekarang = nowWib.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
      }); // 'HH:MM'

      // Cari jadwal hari ini yang di-assign ke karyawan ini
      const jadwalHariIni = await db.query.shiftSchedules.findFirst({
        where: and(
          eq(shiftSchedules.employeeId, employee.id),
          eq(shiftSchedules.dayOfWeek, hariIni),
          eq(shiftSchedules.isActive, true),
        ),
      });

      if (!jadwalHariIni) return; // Tidak ada jadwal hari ini — skip

      // Hitung keterlambatan (toleransi 15 menit)
      const TOLERANSI_MENIT = 15;
      const [jamJadwal, menitJadwal] = jadwalHariIni.slotStart.split(':').map(Number);
      const [jamAktual, menitAktual] = jamMenitSekarang.split(':').map(Number);
      const menitJadwalTotal = jamJadwal * 60 + menitJadwal;
      const menitAktualTotal = jamAktual * 60 + menitAktual;
      const selisihMenit     = menitAktualTotal - menitJadwalTotal;
      const isTelat          = selisihMenit > TOLERANSI_MENIT;
      const lateMinutes      = isTelat ? selisihMenit : 0;

      await db
        .insert(attendances)
        .values({
          employeeId:     employee.id,
          scheduleId:     jadwalHariIni.id,
          attendanceDate: tanggalHari,
          status:         isTelat ? 'TELAT' : 'HADIR',
          shiftId:        newShift.id,
          clockInActual:  nowWib,
          lateMinutes,
        })
        .onConflictDoNothing(); // Jika sudah ada record (mis. re-login) → skip
    } catch {
      // Gagal catat absensi tidak boleh block login kasir
    }
  })();

  // 6. Generate tokens
  const accessToken = await signAccessToken({
    sub: employee.id,
    role: 'employee',
    shiftId: newShift.id,
    name: employee.fullName,
  });
  const refreshToken = await signRefreshToken(employee.id, 'employee');

  // Set cookies langsung di NextResponse (reliable di Next.js 16+)
  const response = NextResponse.json({
    success: true,
    data: {
      role: 'employee',
      name: employee.fullName,
      shiftId: newShift.id,
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
