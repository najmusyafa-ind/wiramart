// =============================================================
// POST /api/auth/gudang/setup-pin — Pembuatan / Reset PIN Mandiri Petugas
// Verifikasi Identitas Ketat: Nama Asli + NIM + Program Studi
// Standar: Zero-Trust Verification, Bcrypt Rounds 12, Auto-Login
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { signAccessToken, signRefreshToken, apiOk, apiError } from '@/lib/utils/auth';
import { kasirAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

function normalizeWordTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isStrictNameMatch(inputName: string, dbName: string): boolean {
  const cleanIn = inputName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanDb = dbName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanIn || !cleanDb) return false;
  if (cleanIn === cleanDb) return true;
  if (cleanIn.length < Math.max(5, Math.floor(cleanDb.length * 0.55))) return false;
  const inTokens = normalizeWordTokens(inputName);
  const dbTokens = normalizeWordTokens(dbName);
  return inTokens.length > 0 && inTokens.every((t) => dbTokens.includes(t));
}

function isStrictProdiMatch(inputProdi: string, dbProdi: string): boolean {
  const stripDegree = (s: string) =>
    s
      .toLowerCase()
      .replace(/^(s1|d3|d4|s2|prodi|program\s+studi)\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
  const cleanIn = stripDegree(inputProdi);
  const cleanDb = stripDegree(dbProdi);
  return cleanIn.length >= 4 && cleanIn === cleanDb;
}

const setupPinSchema = z
  .object({
    fullName: z.string().min(2, 'Nama lengkap wajib diisi').trim(),
    nim: z.string().min(1, 'NIM wajib diisi').max(20).trim(),
    programStudi: z.string().min(2, 'Program studi wajib diisi').trim(),
    pin: z.string().regex(/^\d{6,8}$/, 'PIN harus berupa 6 hingga 8 digit angka'),
    confirmPin: z.string().regex(/^\d{6,8}$/, 'Konfirmasi PIN harus berupa 6 hingga 8 digit angka'),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'Konfirmasi PIN tidak cocok dengan PIN yang dibuat',
    path: ['confirmPin'],
  });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 400);
  }

  const parsed = setupPinSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 422);
  }

  const { fullName, nim, programStudi, pin } = parsed.data;
  const rateKey = `gudang-setup-pin:${nim}`;
  const rateCheck = kasirAuthLimiter.check(rateKey, false);
  if (!rateCheck.allowed) {
    return apiError(
      `Terlalu banyak percobaan. Tunggu ${Math.ceil(rateCheck.retryAfterSeconds / 60)} menit lagi.`,
      429,
    );
  }

  // 1. Cari karyawan aktif berdasarkan NIM
  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nim),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
  });

  if (!employee) {
    kasirAuthLimiter.check(rateKey, true);
    return apiError('Karyawan dengan NIM ini tidak ditemukan di sistem universitas.', 404);
  }

  // 1b. Zero-Trust Anti-Takeover: Tolak jika PIN sudah disetel (reset hanya oleh Manager)
  if (employee.pinHash) {
    kasirAuthLimiter.check(rateKey, true);
    return apiError(
      'Akun ini sudah memiliki PIN aktif. Silakan login dengan PIN Anda, atau minta Manager mereset PIN jika lupa.',
      409,
    );
  }

  // 2. Verifikasi Nama Asli (strict full/token match, anti substring 2 huruf)
  if (!isStrictNameMatch(fullName, employee.fullName)) {
    kasirAuthLimiter.check(rateKey, true);
    return apiError(
      'Nama Lengkap tidak cocok dengan data pendaftaran NIM ini. Harap masukkan nama lengkap resmi Anda.',
      400,
    );
  }

  // 3. Verifikasi Program Studi (exact normalized match)
  if (!isStrictProdiMatch(programStudi, employee.programStudi)) {
    kasirAuthLimiter.check(rateKey, true);
    return apiError(
      'Program Studi tidak cocok dengan data pendaftaran universitas.',
      400,
    );
  }

  // 4. Hash PIN Baru dengan Bcrypt 12 rounds
  const hashedPin = await bcrypt.hash(pin, 12);
  const now = new Date();

  // 5. Simpan PIN secara atomik hanya jika pinHash masih NULL
  const [bound] = await db
    .update(employees)
    .set({
      pinHash: hashedPin,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(and(eq(employees.id, employee.id), isNull(employees.pinHash)))
    .returning({ id: employees.id });

  if (!bound) {
    return apiError('PIN baru saja disetel pada sesi lain. Silakan login menggunakan PIN tersebut.', 409);
  }

  kasirAuthLimiter.reset(rateKey);

  // 6. Terbitkan Sesi Login Otomatis
  const accessToken = await signAccessToken({
    sub: employee.id,
    role: 'employee',
    name: employee.fullName,
  });
  const refreshToken = await signRefreshToken(employee.id, 'employee');

  const response = apiOk({
    message: `PIN Keamanan berhasil dibuat untuk ${employee.fullName}! Selamat bertugas di Gudang.`,
    data: {
      name: employee.fullName,
      nim: employee.nim,
      jabatan: employee.jabatan,
      redirect: '/gudang',
    },
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

  // Set cookie terisolasi sk_gudang (8 jam) & sk_gudang_r (30 hari) agar tidak menimpa sesi Kasir POS
  response.cookies.set('sk_gudang', accessToken, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  response.cookies.set('sk_gudang_r', refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });

  return response;
}

