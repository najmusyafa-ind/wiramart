// =============================================================
// Smartkasir Perwira — Next.js Proxy (Middleware)
// Next.js 16+ menggunakan konvensi "proxy.ts" (bukan middleware.ts)
// Pemisahan Namespace Per Role:
//   - MANAGER     → /manager/* (+ akses monitor /gudang & /kasir)
//   - ADMIN_SHIFT → /admin/* (+ akses monitor /gudang & /kasir)
//   - GUDANG      → /gudang/* (login /gudang/login)
//   - KASIR / CS  → /kasir/*  (login /kasir/login)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import {
  ADMIN_DASHBOARD_PATH,
  ADMIN_LOGIN_PATH,
  GUDANG_LOGIN_PATH,
  KASIR_LOGIN_PATH,
  MANAGER_DASHBOARD_PATH,
  getDashboardPathForRole,
  type PortalAdminRole,
} from '@/lib/utils/routes';

// Cookie names — WAJIB sinkron dengan lib/utils/auth.ts
const ADMIN_ACCESS_COOKIE = 'sk_admin';
const KASIR_ACCESS_COOKIE = 'sk_kasir';
const STATIC_ASSET_REGEX = /\.(?:ico|png|jpg|jpeg|svg|webp|gif|css|js|map|txt|xml|webmanifest|woff2?)$/i;

function getJwtSecret(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  return new TextEncoder().encode(secret);
}

type AdminSessionPayload = {
  sub: string;
  role: 'admin';
  adminRole?: PortalAdminRole;
} | null;

type KasirSessionPayload = {
  sub: string;
  role: 'employee';
} | null;

async function getAdminPayload(request: NextRequest): Promise<AdminSessionPayload> {
  const token = request.cookies.get(ADMIN_ACCESS_COOKIE)?.value;
  const secret = getJwtSecret();
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'smartkasir-perwira',
      algorithms: ['HS256'],
    });
    if (payload['role'] !== 'admin' || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }
    const rawAdminRole = payload['adminRole'];
    const adminRole: PortalAdminRole | undefined =
      rawAdminRole === 'MANAGER'
        ? 'MANAGER'
        : rawAdminRole === 'ADMIN_SHIFT'
        ? 'ADMIN_SHIFT'
        : undefined;
    return { sub: payload.sub, role: 'admin', adminRole };
  } catch {
    return null;
  }
}

async function getKasirPayload(request: NextRequest): Promise<KasirSessionPayload> {
  const token = request.cookies.get(KASIR_ACCESS_COOKIE)?.value;
  const secret = getJwtSecret();
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'smartkasir-perwira',
      algorithms: ['HS256'],
    });
    if (payload['role'] !== 'employee' || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }
    return { sub: payload.sub, role: 'employee' };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // --- Skip static files and API routes ---
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    STATIC_ASSET_REGEX.test(pathname)
  ) {
    return NextResponse.next();
  }

  // --- Maintenance page: selalu accessible ---
  if (pathname === '/maintenance') {
    return NextResponse.next();
  }

  const adminSession = await getAdminPayload(request);
  const kasirSession = await getKasirPayload(request);

  // --- Check Maintenance Mode ---
  if (!adminSession) {
    const isMaintenance = request.cookies.get('sk_maintenance')?.value === '1';

    const maintenanceExempt = [
      '/maintenance',
      ADMIN_LOGIN_PATH,
      KASIR_LOGIN_PATH,
      GUDANG_LOGIN_PATH,
      '/kasir/gudang/login',
      '/daftar',
      '/setup',
    ];
    if (isMaintenance && !maintenanceExempt.includes(pathname)) {
      return NextResponse.redirect(new URL('/maintenance', request.url));
    }
  }

  // --- Root path: tampilkan landing page publik Wiramart ---
  if (pathname === '/') {
    return NextResponse.next();
  }

  // --- Transisi URL lama Gudang (/kasir/gudang/*) → (/gudang/*) ---
  if (pathname === '/kasir/gudang' || pathname.startsWith('/kasir/gudang/')) {
    const mappedPath = pathname.replace(/^\/kasir\/gudang/, '/gudang');
    return NextResponse.redirect(new URL(`${mappedPath}${search}`, request.url));
  }

  // --- Auth routes (login pages): redirect jika admin sudah login ---
  if (pathname === ADMIN_LOGIN_PATH) {
    if (adminSession) {
      return NextResponse.redirect(
        new URL(getDashboardPathForRole(adminSession.adminRole), request.url),
      );
    }
    return NextResponse.next();
  }

  if (pathname === KASIR_LOGIN_PATH || pathname === GUDANG_LOGIN_PATH) {
    return NextResponse.next();
  }

  // --- Gudang routes (/gudang & /gudang/**) ---
  if (pathname === '/gudang' || pathname.startsWith('/gudang/')) {
    if (!kasirSession && !adminSession) {
      const url = new URL(GUDANG_LOGIN_PATH, request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // --- Manager routes (/manager & /manager/**) ---
  if (pathname === '/manager' || pathname.startsWith('/manager/')) {
    if (!adminSession) {
      const url = new URL(ADMIN_LOGIN_PATH, request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    if (adminSession.adminRole !== 'MANAGER') {
      return NextResponse.redirect(new URL(ADMIN_DASHBOARD_PATH, request.url));
    }
    return NextResponse.next();
  }

  // --- Admin Shift routes (/admin & /admin/**) ---
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!adminSession) {
      const url = new URL(ADMIN_LOGIN_PATH, request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    if (adminSession.adminRole === 'MANAGER') {
      const target =
        pathname === '/admin'
          ? MANAGER_DASHBOARD_PATH
          : `${pathname.replace(/^\/admin/, '/manager')}${search}`;
      return NextResponse.redirect(new URL(target, request.url));
    }
    return NextResponse.next();
  }

  // --- Kasir routes (/kasir/**) ---
  if (pathname.startsWith('/kasir')) {
    if (!kasirSession && !adminSession) {
      const url = new URL(KASIR_LOGIN_PATH, request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api).*)',
  ],
};
