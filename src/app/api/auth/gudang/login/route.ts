// =============================================================
// POST /api/auth/gudang/login — Login Khusus Petugas Gudang (NIM + PIN)
// Standar: Zero-Trust Security, Anti-Brute-Force Lockout (5x salah = 15m)
// =============================================================

import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { signAccessToken, signRefreshToken, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

const loginGudangSchema = z.object({
  nim: z.string().min(1, 'NIM wajib diisi').max(20).trim(),
  pin: z.string().regex(/^\d{6,8}$/, 'PIN harus berupa 6 hingga 8 digit angka'),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 400);
  }

  const parsed = loginGudangSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Input tidak valid', 422);
  }

  const { nim, pin } = parsed.data;

  // 1. Cari karyawan aktif berdasarkan NIM
  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nim),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
  });

  if (!employee) {
    return apiError('Karyawan dengan NIM ini tidak ditemukan atau dinonaktifkan.', 404);
  }

  // 2. Cek apakah karyawan sudah punya PIN
  if (!employee.pinHash) {
    return NextResponse.json(
      {
        success: false,
        needSetupPin: true,
        message: 'Akun Anda belum memiliki PIN Keamanan. Silakan buat PIN mandiri terlebih dahulu.',
        data: {
          nim: employee.nim,
          fullName: employee.fullName,
          programStudi: employee.programStudi,
        },
      },
      { status: 200 },
    );
  }

  // 3. Cek Status Lockout (jika pernah salah 5x)
  const now = new Date();
  if (employee.pinLockedUntil && new Date(employee.pinLockedUntil) > now) {
    const diffMs = new Date(employee.pinLockedUntil).getTime() - now.getTime();
    const remainingMins = Math.max(1, Math.ceil(diffMs / 60000));
    return apiError(
      `Akun terkunci sementara karena salah PIN 5 kali. Coba lagi dalam ${remainingMins} menit demi keamanan.`,
      423,
    );
  }

  // 4. Verifikasi PIN dengan bcrypt
  const isMatch = await bcrypt.compare(pin, employee.pinHash);

  if (!isMatch) {
    const currentFailed = (employee.pinFailedAttempts || 0) + 1;
    const shouldLock = currentFailed >= 5;
    const lockTime = shouldLock ? new Date(now.getTime() + 15 * 60 * 1000) : null;

    await db
      .update(employees)
      .set({
        pinFailedAttempts: shouldLock ? 5 : currentFailed,
        pinLockedUntil: lockTime,
        updatedAt: now,
      })
      .where(eq(employees.id, employee.id));

    if (shouldLock) {
      return apiError(
        'PIN salah 5 kali berturut-turut. Akses gudang dikunci selama 15 menit.',
        423,
      );
    }

    return apiError(`PIN salah! Sisa percobaan: ${5 - currentFailed} kali.`, 401);
  }

  // 5. Login Berhasil: Reset kegagalan PIN
  await db
    .update(employees)
    .set({
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(eq(employees.id, employee.id));

  // 6. Terbitkan Token Sesi Kasir/Gudang
  const accessToken = await signAccessToken({
    sub: employee.id,
    role: 'employee',
    name: employee.fullName,
  });
  const refreshToken = await signRefreshToken(employee.id, 'employee');

  const response = apiOk({
    name: employee.fullName,
    nim: employee.nim,
    jabatan: employee.jabatan,
    redirect: '/kasir/gudang',
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

  // Set cookie sk_kasir (8 jam) & sk_kasir_r (30 hari)
  response.cookies.set('sk_kasir', accessToken, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  response.cookies.set('sk_kasir_r', refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });

  return response;
}

