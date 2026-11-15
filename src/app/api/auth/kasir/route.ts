// =============================================================
// POST /api/auth/kasir — Employee Login (Opsi B1: Progressive Soft Migration NIM + PIN)
// Aturan:
//   - Jika employee.pinHash SUDAH ADA: Wajib login dengan NIM + PIN (bcrypt + lockout 5x/15m).
//   - Jika employee.pinHash MASIH NULL: Diizinkan masuk via mode transisi (NIM + Nama/Prodi),
//     atau sekaligus menyetel PIN pribadi baru (newPin + confirmNewPin + verifikasi Nama + Prodi).
// =============================================================

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftSchedules, attendances, qrisSettings } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { signAccessToken, signRefreshToken } from '@/lib/utils/auth';
import { apiError } from '@/lib/utils/helpers';
import { kasirAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const PIN_REGEX = /^\d{6,8}$/;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

function normalizeIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isIdentityMatch(inputValue: string, dbValue: string): boolean {
  const cleanIn = normalizeIdentityText(inputValue);
  const cleanDb = normalizeIdentityText(dbValue);
  if (!cleanIn || !cleanDb) return false;
  return cleanDb.includes(cleanIn) || cleanIn.includes(cleanDb);
}

const kasirLoginSchema = z
  .object({
    nim: z.string().min(1, 'NIM wajib diisi').max(20).trim(),
    pin: z.string().trim().optional(),
    newPin: z.string().trim().optional(),
    confirmNewPin: z.string().trim().optional(),
    fullName: z.string().max(200).trim().optional(),
    programStudi: z.string().max(100).trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.pin && !PIN_REGEX.test(data.pin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pin'],
        message: 'PIN harus berupa 6 hingga 8 digit angka',
      });
    }
    if (data.newPin) {
      if (!PIN_REGEX.test(data.newPin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['newPin'],
          message: 'PIN baru harus berupa 6 hingga 8 digit angka',
        });
      }
      if (data.newPin !== (data.confirmNewPin ?? '')) {
        ctx.addIssue({
          code: 'custom',
          path: ['confirmNewPin'],
          message: 'Konfirmasi PIN tidak cocok dengan PIN baru',
        });
      }
    }
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
    return apiError(
      parsed.error.issues[0]?.message ?? 'NIM atau PIN tidak valid',
      'VALIDATION_ERROR',
      422,
      parsed.error.format(),
    );
  }

  const { fullName, nim, programStudi } = parsed.data;
  const pin = parsed.data.pin || undefined;
  const newPin = parsed.data.newPin || undefined;

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

  // 3. Find employee — Prioritas 1: NIM (ID resmi unik mahasiswa UNPERBA)
  const employeeColumns = {
    id: true,
    fullName: true,
    jabatan: true,
    nim: true,
    programStudi: true,
    pinHash: true,
    pinFailedAttempts: true,
    pinLockedUntil: true,
  } as const;

  let employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nim),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: employeeColumns,
  });

  // Prioritas 2 (Fallback hanya jika mode tanpa PIN dan Nama diberikan)
  if (!employee && !pin && fullName && fullName.length >= 3) {
    employee = await db.query.employees.findFirst({
      where: and(
        sql`LOWER(${employees.fullName}) = LOWER(${fullName})`,
        eq(employees.isActive, true),
        isNull(employees.deletedAt),
      ),
      columns: employeeColumns,
    });
  }

  if (!employee) {
    // Consume rate limit slot pada setiap percobaan gagal
    kasirAuthLimiter.check(rateKey, true);
    return apiError(
      'Data mahasiswa tidak ditemukan di sistem Wiramart. Pastikan NIM sudah terdaftar oleh Admin/Koordinator.',
      'INVALID_CREDENTIALS',
      401,
    );
  }

  // 3b. Zero-Trust Enforcement: Akun Petugas Gudang WAJIB login via PIN di Portal Gudang (/kasir/gudang/login)
  const isGudang = (employee.jabatan ?? '').toLowerCase().includes('gudang');
  if (isGudang) {
    return apiError(
      'Akun Anda terdaftar sebagai Petugas Gudang & Logistik. Demi standar keamanan inventaris, silakan login melalui Portal Gudang menggunakan NIM & PIN.',
      'GUDANG_PIN_AUTH_REQUIRED',
      403,
    );
  }

  // 3c. Opsi B1 Progressive Soft Migration: Verifikasi PIN jika sudah terdaftar, atau masa transisi jika belum
  let hasPinAfterLogin = Boolean(employee.pinHash);
  const now = new Date();

  if (employee.pinHash) {
    if (employee.pinLockedUntil && new Date(employee.pinLockedUntil) > now) {
      const diffMs = new Date(employee.pinLockedUntil).getTime() - now.getTime();
      const remainingMins = Math.max(1, Math.ceil(diffMs / 60000));
      return apiError(
        `Akun terkunci sementara karena salah PIN ${MAX_PIN_ATTEMPTS} kali. Coba lagi dalam ${remainingMins} menit atau minta Dosen/Pengelola mereset PIN.`,
        'PIN_LOCKED',
        423,
      );
    }

    if (!pin) {
      return apiError(
        `Akun ${employee.fullName} sudah menggunakan PIN Keamanan. Masukkan PIN 6–8 digit Anda.`,
        'PIN_REQUIRED',
        401,
      );
    }

    const isPinMatch = await bcrypt.compare(pin, employee.pinHash);
    if (!isPinMatch) {
      const nextFailed = (employee.pinFailedAttempts || 0) + 1;
      const shouldLock = nextFailed >= MAX_PIN_ATTEMPTS;
      const lockUntil = shouldLock ? new Date(now.getTime() + PIN_LOCK_MINUTES * 60 * 1000) : null;

      await db
        .update(employees)
        .set({
          pinFailedAttempts: shouldLock ? MAX_PIN_ATTEMPTS : nextFailed,
          pinLockedUntil: lockUntil,
          updatedAt: now,
        })
        .where(eq(employees.id, employee.id));

      kasirAuthLimiter.check(rateKey, true);

      if (shouldLock) {
        return apiError(
          `PIN salah ${MAX_PIN_ATTEMPTS} kali berturut-turut. Akses dikunci ${PIN_LOCK_MINUTES} menit demi keamanan. Hubungi Dosen/Pengelola jika lupa PIN.`,
          'PIN_LOCKED',
          423,
        );
      }

      return apiError(
        `PIN salah. Sisa ${MAX_PIN_ATTEMPTS - nextFailed} kesempatan sebelum terkunci sementara.`,
        'INVALID_PIN',
        401,
      );
    }

    if (employee.pinFailedAttempts > 0 || employee.pinLockedUntil) {
      await db
        .update(employees)
        .set({ pinFailedAttempts: 0, pinLockedUntil: null, updatedAt: now })
        .where(eq(employees.id, employee.id));
    }
  } else {
    // Belum memiliki PIN (Masa Transisi Lunak Opsi B1)
    if (pin && !newPin) {
      return apiError(
        'Akun Anda belum memiliki PIN. Silakan masuk dengan mode transisi (Nama + NIM + Prodi) atau buat PIN baru.',
        'PIN_NOT_SET',
        401,
      );
    }

    if (fullName && !isIdentityMatch(fullName, employee.fullName)) {
      kasirAuthLimiter.check(rateKey, true);
      return apiError(
        'Nama Lengkap tidak cocok dengan NIM yang terdaftar. Periksa kembali ejaan nama Anda.',
        'INVALID_CREDENTIALS',
        401,
      );
    }

    if (programStudi && !isIdentityMatch(programStudi, employee.programStudi)) {
      kasirAuthLimiter.check(rateKey, true);
      return apiError(
        'Program Studi tidak cocok dengan data pendaftaran NIM ini.',
        'INVALID_CREDENTIALS',
        401,
      );
    }

    // Jika kasir sekalian memilih membuat PIN pribadi saat login perdana
    if (newPin) {
      if (!fullName || !programStudi) {
        return apiError(
          'Untuk membuat PIN pribadi baru, lengkapi Nama Lengkap dan Program Studi terlebih dahulu.',
          'IDENTITY_VERIFICATION_REQUIRED',
          422,
        );
      }

      const hashedPin = await bcrypt.hash(newPin, 12);
      const [boundPin] = await db
        .update(employees)
        .set({
          pinHash: hashedPin,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          updatedAt: now,
        })
        .where(and(eq(employees.id, employee.id), isNull(employees.pinHash)))
        .returning({ id: employees.id });

      if (!boundPin) {
        return apiError(
          'PIN baru saja disetel pada sesi lain. Silakan login menggunakan NIM dan PIN tersebut.',
          'PIN_ALREADY_SET',
          409,
        );
      }

      hasPinAfterLogin = true;
    }
  }

  // 4. Periksa shift aktif karyawan (dukung resume sesi aktif <12 jam)
  // Cacat 2 Opsi A: Login HANYA otentikasi akun, TIDAK otomatis membuat shift baru tanpa modal awal.
  // Shift baru HANYA dibuat secara resmi saat Buka Shift (input modal awal) di POS.
  let shiftToUseId: string | undefined = undefined;

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
      shiftToUseId = undefined;
    } else {
      // Resume sesi shift yang sedang aktif
      shiftToUseId = existingShift.id;
    }
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

  // Khusus Kasir yang lolos otentikasi diarahkan ke POS
  const redirectUrl = '/kasir/pos';

  // Set cookies langsung di NextResponse (reliable di Next.js 16+)
  const response = NextResponse.json({
    success: true,
    data: {
      role: 'employee',
      name: employee.fullName,
      jabatan: employee.jabatan,
      shiftId: shiftToUseId,
      hasPin: hasPinAfterLogin,
      redirect: redirectUrl,
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
