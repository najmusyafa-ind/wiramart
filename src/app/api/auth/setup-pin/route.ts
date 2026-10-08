// =============================================================
// POST /api/auth/setup-pin — Setup PIN Baru untuk Admin Kasir / Admin Shift
// Body: { nim: string, pin: string }
// Digunakan saat Admin Shift / Kepala Admin pertama kali membuat PIN 6-digit
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, admins } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { signAccessToken, signRefreshToken } from '@/lib/utils/auth';
import { apiError } from '@/lib/utils/helpers';
import { adminAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const setupPinSchema = z.object({
  nim: z.string().min(1, 'NIM wajib diisi').max(20).trim(),
  pin: z.string().regex(/^\d{6}$/, 'PIN harus berupa 6 digit angka (0-9)'),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('Format request tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = setupPinSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data PIN tidak valid',
      'VALIDATION_ERROR',
      422,
      parsed.error.format(),
    );
  }

  const { nim, pin } = parsed.data;
  const rateKey = `setup-pin:${nim}`;

  const checkResult = adminAuthLimiter.check(rateKey, false);
  if (!checkResult.allowed) {
    return apiError(
      `Terlalu banyak percobaan. Coba lagi dalam ${checkResult.retryAfterSeconds} detik.`,
      'RATE_LIMITED',
      429,
    );
  }

  // 1. Cari karyawan berdasarkan NIM
  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nim),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
  });

  if (!employee) {
    adminAuthLimiter.check(rateKey, true);
    return apiError('Data karyawan dengan NIM tersebut tidak ditemukan.', 'NOT_FOUND', 404);
  }

  // 2. Verifikasi eligibilitas sebagai Admin Shift
  const isEligibleAdmin =
    employee.isKetuaShift ||
    employee.jabatan.toLowerCase().includes('admin') ||
    employee.jabatan.toLowerCase().includes('kepala');

  if (!isEligibleAdmin) {
    return apiError(
      'Hanya Admin Shift / Kepala Admin yang dapat membuat PIN Pengelola.',
      'FORBIDDEN',
      403,
    );
  }

  // 3. Hash PIN dengan bcrypt (rounds 12)
  const hashedPin = await bcrypt.hash(pin, 12);
  const now = new Date();

  // 4. Update data PIN di tabel employees
  await db
    .update(employees)
    .set({
      pinHash: hashedPin,
      isKetuaShift: true,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(eq(employees.id, employee.id));

  // 5. Upsert ke tabel admins sebagai role ADMIN_SHIFT
  const [adminRow] = await db
    .insert(admins)
    .values({
      nidn: employee.nim,
      fullName: employee.fullName,
      passwordHash: hashedPin,
      role: 'ADMIN_SHIFT',
      isActivated: true,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: admins.nidn,
      set: {
        fullName: employee.fullName,
        passwordHash: hashedPin,
        role: 'ADMIN_SHIFT',
        isActivated: true,
        isActive: true,
        updatedAt: now,
      },
    })
    .returning({ id: admins.id, role: admins.role, fullName: admins.fullName, nidn: admins.nidn });

  // 6. Reset rate limit
  adminAuthLimiter.reset(rateKey);

  const adminId = adminRow?.id ?? employee.id;
  const adminRole = 'ADMIN_SHIFT';

  // 7. Terbitkan token otentikasi admin
  const accessToken = await signAccessToken({
    sub: adminId,
    role: 'admin',
    adminRole,
    username: employee.nim,
  });
  const refreshToken = await signRefreshToken(adminId, 'admin');

  const response = NextResponse.json({
    success: true,
    message: `PIN 6-digit berhasil dibuat untuk ${employee.fullName}. Selamat bertugas!`,
    data: {
      role: 'admin',
      adminRole,
      name: employee.fullName,
      redirect: '/admin/dashboard',
    },
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

  response.cookies.set('sk_admin', accessToken, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  response.cookies.set('sk_admin_r', refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });

  return response;
}
