// =============================================================
// Smartkasir Perwira — Auth Library
// DUAL SESSION SUPPORT:
//   Admin  → cookie: sk_admin  (path: /)
//   Kasir  → cookie: sk_kasir  (path: /)
// Dua role bisa login bersamaan di browser yang sama (tab berbeda).
// =============================================================

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { AppError } from '@/lib/utils/helpers';

// --- Constants ---
const BCRYPT_ROUNDS = 12;
// 8 jam = durasi 1 shift kasir. Token tidak perlu refresh selama shift berlangsung.
// Refresh token 30 hari untuk auto-login kembali jika browser ditutup antar shift.
const ACCESS_TOKEN_EXPIRY = '8h';
const REFRESH_TOKEN_EXPIRY = '30d';
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 jam dalam detik

// Terpisah per role agar dua sesi bisa berjalan bersamaan
const ADMIN_ACCESS_COOKIE   = 'sk_admin';
const ADMIN_REFRESH_COOKIE  = 'sk_admin_r';
const KASIR_ACCESS_COOKIE   = 'sk_kasir';
const KASIR_REFRESH_COOKIE  = 'sk_kasir_r';

// --- JWT Secret ---
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError(
      'CONFIG_ERROR',
      'JWT_SECRET tidak dikonfigurasi atau terlalu pendek (min 32 karakter)',
      500,
      false,
    );
  }
  return new TextEncoder().encode(secret);
}

// --- Token Payload Types ---
export type AdminTokenPayload = {
  sub: string;    // admin id
  role: 'admin';
  username: string;
};

export type EmployeeTokenPayload = {
  sub: string;    // employee id
  role: 'employee';
  shiftId: string;
  name: string;
};

export type TokenPayload = AdminTokenPayload | EmployeeTokenPayload;

// --- Password Hashing ---
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  // SECURITY: Always run hash compare even if password is obviously wrong
  return bcrypt.compare(password, hash);
}

// --- JWT Generation ---
export async function signAccessToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .setIssuer('smartkasir-perwira')
    .sign(getJwtSecret());
}

export async function signRefreshToken(sub: string, role: string): Promise<string> {
  return new SignJWT({ sub, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .setIssuer('smartkasir-perwira')
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'smartkasir-perwira',
    });
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

// --- Cookie Options Helper ---
type SetCookieOptions = {
  accessToken: string;
  refreshToken: string;
  role: 'admin' | 'employee';
};

export async function setAuthCookies({ accessToken, refreshToken, role }: SetCookieOptions): Promise<void> {
  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === 'production';

  const accessCookieName  = role === 'admin' ? ADMIN_ACCESS_COOKIE  : KASIR_ACCESS_COOKIE;
  const refreshCookieName = role === 'admin' ? ADMIN_REFRESH_COOKIE : KASIR_REFRESH_COOKIE;

  cookieStore.set(accessCookieName, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS, // 8 jam (1 shift)
  });

  cookieStore.set(refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export async function clearAuthCookies(role?: 'admin' | 'employee'): Promise<void> {
  const cookieStore = await cookies();

  if (!role || role === 'admin') {
    cookieStore.delete(ADMIN_ACCESS_COOKIE);
    cookieStore.delete(ADMIN_REFRESH_COOKIE);
  }
  if (!role || role === 'employee') {
    cookieStore.delete(KASIR_ACCESS_COOKIE);
    cookieStore.delete(KASIR_REFRESH_COOKIE);
  }
}

// --- Session Readers (role-specific) ---

/** Baca session admin dari cookie sk_admin */
export async function getAdminSession(): Promise<AdminTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') return null;
  return payload as AdminTokenPayload;
}

/** Baca session kasir dari cookie sk_kasir */
export async function getKasirSession(): Promise<EmployeeTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(KASIR_ACCESS_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'employee') return null;
  return payload as EmployeeTokenPayload;
}

/**
 * getCurrentSession — backward-compat:
 * Cek admin cookie dulu, lalu kasir.
 * Digunakan di logout route untuk mendeteksi role aktif.
 */
export async function getCurrentSession(): Promise<TokenPayload | null> {
  const adminSession = await getAdminSession();
  if (adminSession) return adminSession;
  const kasirSession = await getKasirSession();
  return kasirSession;
}

export async function requireAuth(): Promise<TokenPayload> {
  const session = await getCurrentSession();
  if (!session) {
    throw new AppError('UNAUTHORIZED', 'Sesi tidak ditemukan. Silakan login kembali.', 401);
  }
  return session;
}

export async function requireAdmin(): Promise<AdminTokenPayload> {
  const session = await getAdminSession();
  if (!session) {
    throw new AppError('FORBIDDEN', 'Akses ditolak. Hanya Admin yang dapat melakukan ini.', 403);
  }
  return session;
}

export async function requireEmployee(): Promise<EmployeeTokenPayload> {
  const session = await getKasirSession();
  if (!session) {
    throw new AppError('FORBIDDEN', 'Akses tidak valid untuk role ini.', 403);
  }
  return session;
}

// --- API Route Helpers ---

/**
 * Baca dan verifikasi JWT dari cookie di API route request.
 * Cek sk_kasir dulu (prioritas kasir API), lalu sk_admin.
 * Role dicek secara eksplisit di masing-masing route handler.
 */
export async function verifyJwt(req: NextRequest): Promise<TokenPayload | null> {
  // Coba kasir token
  const kasirToken = req.cookies.get(KASIR_ACCESS_COOKIE)?.value;
  if (kasirToken) {
    const payload = await verifyToken(kasirToken);
    if (payload) return payload;
  }
  // Coba admin token
  const adminToken = req.cookies.get(ADMIN_ACCESS_COOKIE)?.value;
  if (adminToken) {
    const payload = await verifyToken(adminToken);
    if (payload) return payload;
  }
  return null;
}

/**
 * apiOk / apiError — definisi lokal untuk backward-compat dengan semua API routes.
 * Route memanggil: apiError('pesan', 401) dan apiOk({ data })
 * JANGAN re-export dari helpers.ts karena signature helpers berbeda.
 */

export function apiOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(message: unknown, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status });
}
