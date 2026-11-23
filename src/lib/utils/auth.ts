// =============================================================
// Smartkasir Perwira — Auth Library
// QUAD SESSION SUPPORT (1 Perangkat Multi-Tab Tanpa Tabrakan):
//   Admin  → cookie: sk_admin  (path: /)
//   Kasir  → cookie: sk_kasir  (path: /)
//   Gudang → cookie: sk_gudang (path: /)
//   Buyer  → cookie: sk_buyer  (path: /, 7 hari)
// Semua 4 sesi bisa berjalan bersamaan di browser yang sama.
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

// Terpisah per role agar 4 sesi bisa berjalan bersamaan di 1 perangkat
const ADMIN_ACCESS_COOKIE   = 'sk_admin';
const ADMIN_REFRESH_COOKIE  = 'sk_admin_r';
const KASIR_ACCESS_COOKIE   = 'sk_kasir';
const KASIR_REFRESH_COOKIE  = 'sk_kasir_r';
const GUDANG_ACCESS_COOKIE  = 'sk_gudang';
const GUDANG_REFRESH_COOKIE = 'sk_gudang_r';
const BUYER_ACCESS_COOKIE   = 'sk_buyer'; // path=/, 7 hari

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
export type AdminRole = 'MANAGER' | 'ADMIN_SHIFT';

export type AdminTokenPayload = {
  sub: string;    // admin id
  role: 'admin';
  adminRole?: AdminRole;
  username: string;
  iat?: number;   // JWT Issued-At (Unix seconds) untuk binding idle timeout ke sesi aktif
};

export type EmployeeTokenPayload = {
  sub: string;    // employee id
  role: 'employee';
  shiftId?: string;
  name: string;
  iat?: number;   // JWT Issued-At (Unix seconds) untuk binding idle timeout ke sesi aktif
};

/** Buyer session — login via NIM + Nama (tanpa password) */
export type BuyerTokenPayload = {
  sub: string;  // buyer.id (UUID)
  role: 'buyer';
  nim: string;
  name: string;
};

export type TokenPayload = AdminTokenPayload | EmployeeTokenPayload | BuyerTokenPayload;

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
  role: 'admin' | 'employee' | 'gudang';
};

export async function setAuthCookies({ accessToken, refreshToken, role }: SetCookieOptions): Promise<void> {
  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === 'production';

  const accessCookieName =
    role === 'admin'
      ? ADMIN_ACCESS_COOKIE
      : role === 'gudang'
      ? GUDANG_ACCESS_COOKIE
      : KASIR_ACCESS_COOKIE;
  const refreshCookieName =
    role === 'admin'
      ? ADMIN_REFRESH_COOKIE
      : role === 'gudang'
      ? GUDANG_REFRESH_COOKIE
      : KASIR_REFRESH_COOKIE;

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

export async function clearAuthCookies(role?: 'admin' | 'employee' | 'gudang'): Promise<void> {
  const cookieStore = await cookies();

  if (!role || role === 'admin') {
    cookieStore.delete({ name: ADMIN_ACCESS_COOKIE, path: '/' });
    cookieStore.delete({ name: ADMIN_REFRESH_COOKIE, path: '/' });
  }
  if (!role || role === 'employee') {
    cookieStore.delete({ name: KASIR_ACCESS_COOKIE, path: '/' });
    cookieStore.delete({ name: KASIR_REFRESH_COOKIE, path: '/' });
  }
  if (!role || role === 'gudang') {
    cookieStore.delete({ name: GUDANG_ACCESS_COOKIE, path: '/' });
    cookieStore.delete({ name: GUDANG_REFRESH_COOKIE, path: '/' });
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

/** Baca session petugas gudang dari cookie sk_gudang */
export async function getGudangSession(): Promise<EmployeeTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(GUDANG_ACCESS_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'employee') return null;
  return payload as EmployeeTokenPayload;
}

/**
 * getCurrentSession — backward-compat:
 * Cek admin cookie dulu, lalu kasir, lalu gudang.
 * Digunakan di logout route untuk mendeteksi role aktif.
 */
export async function getCurrentSession(): Promise<TokenPayload | null> {
  const adminSession = await getAdminSession();
  if (adminSession) return adminSession;
  const kasirSession = await getKasirSession();
  if (kasirSession) return kasirSession;
  return getGudangSession();
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
    throw new AppError('FORBIDDEN', 'Akses ditolak. Hanya Admin/Manager yang dapat melakukan ini.', 403);
  }
  return session;
}

export async function requireManager(): Promise<AdminTokenPayload> {
  const session = await requireAdmin();
  if (session.adminRole !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Akses ditolak. Fitur ini khusus untuk Manager (Dosen).', 403);
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
 * Baca dan verifikasi JWT dari cookie di API route request (Quad-Session Isolated).
 * Prioritas otomatis berdasarkan header `x-portal-scope` & path:
 * - Header `x-portal-scope: admin` atau `/api/admin/*` → sk_admin → sk_kasir → sk_gudang
 * - Header `x-portal-scope: gudang` atau `/api/gudang/*` atau `/api/kasir/gudang` → sk_gudang → sk_admin → sk_kasir
 * - `/api/kasir/*` (POS, shift, transaksi) atau lainnya → sk_kasir → sk_admin (TIDAK pernah membaca sk_gudang)
 */
export async function verifyJwt(req: NextRequest): Promise<TokenPayload | null> {
  const pathname = req.nextUrl.pathname;
  const portalScope = req.headers.get('x-portal-scope')?.toLowerCase();

  const tryCookie = async (cookieName: string): Promise<TokenPayload | null> => {
    const token = req.cookies.get(cookieName)?.value;
    if (!token) return null;
    return verifyToken(token);
  };

  const isAdminScoped = portalScope === 'admin' || pathname.startsWith('/api/admin');
  const isGudangScoped =
    !isAdminScoped &&
    (portalScope === 'gudang' ||
      pathname.startsWith('/api/gudang') ||
      pathname === '/api/kasir/gudang' ||
      pathname.startsWith('/api/kasir/gudang/'));

  const cookieOrder: readonly string[] = isAdminScoped
    ? [ADMIN_ACCESS_COOKIE, KASIR_ACCESS_COOKIE, GUDANG_ACCESS_COOKIE]
    : isGudangScoped
    ? [GUDANG_ACCESS_COOKIE, ADMIN_ACCESS_COOKIE, KASIR_ACCESS_COOKIE]
    : [KASIR_ACCESS_COOKIE, ADMIN_ACCESS_COOKIE];

  for (const cookieName of cookieOrder) {
    const payload = await tryCookie(cookieName);
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

// =============================================================
// BUYER AUTH — Cookie sk_buyer (path=/order, 7 hari)
// TIDAK ada password. Login = NIM + Nama Lengkap match di DB.
// =============================================================

const BUYER_ACCESS_TOKEN_EXPIRY     = '7d';
const BUYER_ACCESS_MAX_AGE_SECONDS  = 60 * 60 * 24 * 7; // 7 hari

/** Sign JWT untuk buyer (7 hari, path=/order) */
export async function signBuyerToken(payload: BuyerTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(BUYER_ACCESS_TOKEN_EXPIRY)
    .setIssuer('smartkasir-perwira')
    .sign(getJwtSecret());
}

/** Set cookie sk_buyer — HttpOnly, path=/order, 7 hari */
export async function setBuyerCookie(accessToken: string): Promise<void> {
  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === 'production';
  cookieStore.set(BUYER_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    // path '/' (bukan '/order'): API ada di /api/order/*, cookie ber-path '/order' TIDAK akan terkirim ke sana.
    // Aman: nama cookie unik + role 'buyer' dicek; guard admin/kasir tidak membaca sk_buyer.
    path: '/',
    maxAge: BUYER_ACCESS_MAX_AGE_SECONDS,
  });
}

/** Hapus cookie sk_buyer */
export async function clearBuyerCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: BUYER_ACCESS_COOKIE, path: '/' });
  cookieStore.delete({ name: BUYER_ACCESS_COOKIE, path: '/order' }); // legacy
}

/** Baca buyer session dari cookie sk_buyer (Server Component / Server Action) */
export async function getBuyerSession(): Promise<BuyerTokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(BUYER_ACCESS_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'buyer') return null;
  return payload as BuyerTokenPayload;
}

/** Guard buyer session — lempar 401 jika tidak ada */
export async function requireBuyer(): Promise<BuyerTokenPayload> {
  const session = await getBuyerSession();
  if (!session) {
    throw new AppError('UNAUTHORIZED', 'Sesi tidak ditemukan. Silakan login kembali.', 401);
  }
  return session;
}

/**
 * Baca buyer session dari NextRequest (API route).
 * Dipakai di /api/order/* route handlers.
 */
export function getBuyerSessionFromRequest(req: NextRequest): Promise<BuyerTokenPayload | null> {
  const token = req.cookies.get(BUYER_ACCESS_COOKIE)?.value;
  if (!token) return Promise.resolve(null);
  return verifyToken(token).then((payload) => {
    if (!payload || payload.role !== 'buyer') return null;
    return payload as BuyerTokenPayload;
  });
}
