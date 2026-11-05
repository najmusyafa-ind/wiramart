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

export const runtime = 'nodejs';

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

  // 1. Cari karyawan aktif berdasarkan NIM
  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nim),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
  });

  if (!employee) {
    return apiError('Karyawan dengan NIM ini tidak ditemukan di sistem universitas.', 404);
  }

  // 2. Verifikasi Nama Asli (Fuzzy case-insensitive comparison)
  const cleanInputName = fullName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanDbName = employee.fullName.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!cleanDbName.includes(cleanInputName) && !cleanInputName.includes(cleanDbName)) {
    return apiError(
      'Nama Lengkap tidak cocok dengan data pendaftaran NIM ini. Harap gunakan nama asli resmi.',
      400,
    );
  }

  // 3. Verifikasi Program Studi (case-insensitive substring)
  const cleanInputProdi = programStudi.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanDbProdi = employee.programStudi.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!cleanDbProdi.includes(cleanInputProdi) && !cleanInputProdi.includes(cleanDbProdi)) {
    return apiError(
      'Program Studi tidak cocok dengan data pendaftaran universitas.',
      400,
    );
  }

  // 4. Hash PIN Baru dengan Bcrypt 12 rounds
  const hashedPin = await bcrypt.hash(pin, 12);
  const now = new Date();

  // 5. Simpan PIN ke database & reset counter kegagalan
  await db
    .update(employees)
    .set({
      pinHash: hashedPin,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(eq(employees.id, employee.id));

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
      redirect: '/kasir/gudang',
    },
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

  response.cookies.set('sk_kasir', accessToken, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  response.cookies.set('sk_kasir_r', refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });

  return response;
}

