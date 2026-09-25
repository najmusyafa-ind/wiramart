// =============================================================
// POST /api/auth/admin — Admin Login (Dosen)
// Body: { nidn: string, password: string }
// NIDN = Nomor Induk Dosen Nasional (atau NIDK sebagai fallback)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { verifyPassword, signAccessToken, signRefreshToken } from '@/lib/utils/auth';
import { apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const loginSchema = z.object({
  nidn: z.string().min(1, 'NIDN/NIDK wajib diisi').max(20).trim(),
  password: z.string().min(1, 'Password wajib diisi').max(200),
});

// Rate limiting (in-memory — production: gunakan Redis)
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 jam

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const record = failedAttempts.get(key);
  if (!record || now > record.resetAt) return true;
  return record.count < MAX_ATTEMPTS;
}
function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const record = failedAttempts.get(key);
  if (!record || now > record.resetAt) {
    failedAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else { record.count += 1; }
}
function clearAttempts(key: string): void { failedAttempts.delete(key); }

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format request tidak valid', 'INVALID_JSON', 400); }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('Data tidak lengkap', 'VALIDATION_ERROR', 422, parsed.error.format());
  }

  const { nidn, password } = parsed.data;

  if (!checkRateLimit(nidn)) {
    return apiError('Terlalu banyak percobaan. Coba lagi dalam 1 jam.', 'RATE_LIMITED', 429);
  }

  // Cari admin berdasarkan NIDN atau NIDK (salah satu cocok)
  const admin = await db.query.admins.findFirst({
    where: and(
      or(eq(admins.nidn, nidn), eq(admins.nidk, nidn)),
      eq(admins.isActive, true),
      isNull(admins.deletedAt),
    ),
    columns: {
      id: true, nidn: true, passwordHash: true,
      fullName: true, isActive: true, isActivated: true,
    },
  });

  // Akun belum diaktivasi (dosen belum set password)
  if (admin && !admin.isActivated) {
    return apiError(
      'Akun belum diaktivasi. Silakan klik "Aktivasi Akun" untuk mengatur password pertama kali.',
      'NOT_ACTIVATED',
      403,
    );
  }

  // Security: selalu verifikasi password meski user tidak ditemukan (cegah timing attack)
  const DUMMY_HASH = '$2b$12$dummyhashtopreventtimingattacksXXXXXXXXXXXXX';
  const isValid = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH);

  if (!admin || !isValid || !admin.isActive) {
    recordFailedAttempt(nidn);
    return apiError('NIDN/NIDK atau password salah.', 'INVALID_CREDENTIALS', 401);
  }

  clearAttempts(nidn);

  const accessToken = await signAccessToken({ sub: admin.id, role: 'admin', username: admin.nidn });
  const refreshToken = await signRefreshToken(admin.id, 'admin');

  const response = NextResponse.json({
    success: true,
    data: { role: 'admin', name: admin.fullName, redirect: '/admin/dashboard' },
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

  response.cookies.set('sk_admin', accessToken, { ...cookieOpts, maxAge: 60 * 60 * 8 });
  response.cookies.set('sk_admin_r', refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });

  return response;
}
