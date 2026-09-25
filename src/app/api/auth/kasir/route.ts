// =============================================================
// POST /api/auth/kasir — Employee Login
// Body: { fullName: string, nim: string, programStudi: string }
// Login via kombinasi Nama + NIM + Program Studi (no password)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shifts } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { signAccessToken, signRefreshToken } from '@/lib/utils/auth';
import { apiError } from '@/lib/utils/helpers';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

const kasirLoginSchema = z.object({
  fullName: z.string().min(2, 'Nama lengkap wajib diisi').max(200).trim(),
  nim: z.string().min(1, 'NIM wajib diisi').max(20).trim(),
  programStudi: z.string().min(2, 'Program studi wajib diisi').max(100).trim(),
});

// Rate limiting per NIM (prevent brute force enumeration)
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const record = failedAttempts.get(key);
  if (!record || now > record.resetAt) return true;
  return record.count < MAX_ATTEMPTS;
}

function recordFailed(key: string): void {
  const now = Date.now();
  const record = failedAttempts.get(key);
  if (!record || now > record.resetAt) {
    failedAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    record.count += 1;
  }
}

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

  // 2. Rate limit per NIM
  const rateKey = `kasir:${nim}`;
  if (!checkRateLimit(rateKey)) {
    return apiError(
      'Terlalu banyak percobaan. Coba lagi dalam 1 jam atau hubungi Admin.',
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
    recordFailed(rateKey);
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
