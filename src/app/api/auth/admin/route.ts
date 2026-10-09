// =============================================================
// POST /api/auth/admin — Login Pengelola (Manager Dosen & Admin Kasir / Shift)
// Body: { nidn: string, password?: string, checkOnly?: boolean }
// NIDN = Nomor Induk Dosen Nasional (Dosen) atau NIM (Admin Shift Mahasiswa)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { admins, employees } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { verifyPassword, signAccessToken, signRefreshToken } from '@/lib/utils/auth';
import { apiError, apiOk } from '@/lib/utils/helpers';
import { adminAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const loginSchema = z.object({
  nidn: z.string().min(1, 'NIDN/NIM wajib diisi').max(50).trim(),
  password: z.string().max(200).optional().default(''),
  checkOnly: z.boolean().optional().default(false),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('Format request tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('Data tidak lengkap', 'VALIDATION_ERROR', 422, parsed.error.format());
  }

  const { nidn, password, checkOnly } = parsed.data;
  const rateKey = `admin:${nidn}`;

  // 1. Rate limiting check
  const checkResult = adminAuthLimiter.check(rateKey, false);
  if (!checkResult.allowed) {
    return apiError(
      `Terlalu banyak percobaan. Coba lagi dalam ${checkResult.retryAfterSeconds} detik.`,
      'RATE_LIMITED',
      429,
    );
  }

  // 2. Cari di tabel admins (berdasarkan NIDN, NIDK, atau NIM)
  const admin = await db.query.admins.findFirst({
    where: and(
      or(eq(admins.nidn, nidn), eq(admins.nidk, nidn)),
      eq(admins.isActive, true),
      isNull(admins.deletedAt),
    ),
    columns: {
      id: true,
      nidn: true,
      passwordHash: true,
      fullName: true,
      role: true,
      isActive: true,
      isActivated: true,
    },
  });

  // 3. Cari juga di tabel employees (untuk mencocokkan Admin Kasir / Kepala Admin)
  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.nim, nidn),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: {
      id: true,
      nim: true,
      fullName: true,
      jabatan: true,
      isKetuaShift: true,
      pinHash: true,
      isActive: true,
    },
  });

  const isEligibleEmployeeAdmin = Boolean(
    employee &&
      (employee.isKetuaShift ||
        employee.jabatan.toLowerCase().includes('admin') ||
        employee.jabatan.toLowerCase().includes('kepala')),
  );

  // ── FITUR CHECK ONLY (Frontend Inspection Saat User Mengetik NIM/NIDN) ──
  if (checkOnly) {
    if (admin) {
      const hasPinOrPassword = Boolean(admin.passwordHash || employee?.pinHash);
      return apiOk({
        exists: true,
        fullName: admin.fullName,
        role: admin.role,
        isManager: admin.role === 'MANAGER',
        needSetupPin: admin.role === 'ADMIN_SHIFT' && !hasPinOrPassword,
      });
    }

    if (employee && isEligibleEmployeeAdmin) {
      return apiOk({
        exists: true,
        fullName: employee.fullName,
        role: 'ADMIN_SHIFT',
        isManager: false,
        jabatan: employee.jabatan,
        needSetupPin: !employee.pinHash,
      });
    }

    return apiOk({ exists: false });
  }

  // ── LOGIKA OTENTIKASI & DETEKSI PIN ───────────────────────────────────

  // Kasus A: Karyawan Admin Shift terdaftar di employees tapi BELUM ADA di admins / BELUM MEMBUAT PIN
  // (Kondisi Akun Terdaftar: pinHash null)
  if ((!admin && employee && isEligibleEmployeeAdmin && !employee.pinHash) ||
      (admin && admin.role === 'ADMIN_SHIFT' && !admin.passwordHash && !employee?.pinHash)) {
    const targetName = employee?.fullName ?? admin?.fullName ?? 'Admin Shift';
    const targetNim = employee?.nim ?? admin?.nidn ?? nidn;
    const targetJabatan = employee?.jabatan ?? 'Kepala Admin';

    return NextResponse.json(
      {
        success: false,
        code: 'NEED_SETUP_PIN',
        data: {
          nim: targetNim,
          fullName: targetName,
          jabatan: targetJabatan,
        },
        message: `Halo ${targetName}! Akun Anda terdaftar sebagai ${targetJabatan} tetapi belum membuat PIN 6-digit. Silakan buat PIN baru untuk melanjutkan.`,
      },
      { status: 200 },
    );
  }

  // Kasus B: Admin terdaftar di tabel admins
  if (admin) {
    // Akun dosen belum diaktivasi (belum set password pertama kali)
    if (!admin.isActivated && admin.role === 'MANAGER') {
      return apiError(
        'Akun Manager Dosen belum diaktivasi. Silakan hubungi koordinator atau aktivasi akun Anda.',
        'NOT_ACTIVATED',
        403,
      );
    }

    // Tentukan hash yang digunakan (admin.passwordHash atau fallback employee.pinHash)
    const effectiveHash = admin.passwordHash || employee?.pinHash;
    const DUMMY_HASH = '$2b$12$dummyhashtopreventtimingattacksXXXXXXXXXXXXX';
    const isValid = await verifyPassword(password, effectiveHash ?? DUMMY_HASH);

    if (!isValid || !effectiveHash) {
      adminAuthLimiter.check(rateKey, true);
      const isShiftAdmin = admin.role === 'ADMIN_SHIFT';
      return apiError(
        isShiftAdmin ? 'PIN atau Password Admin Kasir salah.' : 'NIDN atau password Manager salah.',
        'INVALID_CREDENTIALS',
        401,
      );
    }

    // Login Sukses
    adminAuthLimiter.reset(rateKey);

    const adminRole = (admin.role as 'MANAGER' | 'ADMIN_SHIFT') ?? 'ADMIN_SHIFT';
    const accessToken = await signAccessToken({
      sub: admin.id,
      role: 'admin',
      adminRole,
      username: admin.nidn,
    });
    const refreshToken = await signRefreshToken(admin.id, 'admin');

    const response = NextResponse.json({
      success: true,
      data: {
        role: 'admin',
        adminRole,
        name: admin.fullName,
        redirect: '/admin/dashboard',
      },
    });

    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOpts = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };

    response.cookies.set('sk_admin', accessToken, { ...cookieOpts, maxAge: 60 * 60 * 8 });
    response.cookies.set('sk_admin_r', refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });

    return response;
  }

  // Kasus C: Tidak ada di tabel admins, tetapi ada di tabel employees dengan PIN yang sudah aktif
  if (employee && isEligibleEmployeeAdmin) {
    if (!employee.pinHash) {
      return NextResponse.json(
        {
          success: false,
          code: 'NEED_SETUP_PIN',
          data: {
            nim: employee.nim,
            fullName: employee.fullName,
            jabatan: employee.jabatan,
          },
          message: `Halo ${employee.fullName}! Akun Anda belum memiliki PIN 6-digit. Silakan buat PIN baru.`,
        },
        { status: 200 },
      );
    }

    // Verifikasi PIN yang diinput
    const isValidPin = await verifyPassword(password, employee.pinHash);
    if (!isValidPin) {
      adminAuthLimiter.check(rateKey, true);
      return apiError('PIN Admin Kasir salah. Masukkan 6 digit PIN yang benar.', 'INVALID_CREDENTIALS', 401);
    }

    // Sinkronkan ke tabel admins
    const [syncedAdmin] = await db
      .insert(admins)
      .values({
        nidn: employee.nim,
        fullName: employee.fullName,
        passwordHash: employee.pinHash,
        role: 'ADMIN_SHIFT',
        isActivated: true,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: admins.nidn,
        set: {
          fullName: employee.fullName,
          passwordHash: employee.pinHash,
          role: 'ADMIN_SHIFT',
          isActivated: true,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: admins.id });

    adminAuthLimiter.reset(rateKey);

    const adminId = syncedAdmin?.id ?? employee.id;
    const adminRole = 'ADMIN_SHIFT';

    const accessToken = await signAccessToken({
      sub: adminId,
      role: 'admin',
      adminRole,
      username: employee.nim,
    });
    const refreshToken = await signRefreshToken(adminId, 'admin');

    const response = NextResponse.json({
      success: true,
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

  // Kasus D: Karyawan biasa (bukan admin shift / bukan ketua shift) mencoba login admin
  if (employee && !isEligibleEmployeeAdmin) {
    adminAuthLimiter.check(rateKey, true);
    return apiError(
      'Akun ini terdaftar sebagai Karyawan Kasir biasa. Silakan login melalui tab "Karyawan".',
      'FORBIDDEN_ROLE',
      403,
    );
  }

  // Kasus E: Tidak ditemukan sama sekali
  adminAuthLimiter.check(rateKey, true);
  return apiError('NIDN / NIM tidak terdaftar.', 'NOT_FOUND', 401);
}
