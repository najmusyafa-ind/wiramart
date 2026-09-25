// =============================================================
// Smartkasir Perwira — Next.js Proxy (Middleware)
// Next.js 16+ menggunakan konvensi "proxy.ts" (bukan middleware.ts)
// Tanggung jawab:
// 1. Proteksi route admin → redirect ke /login jika bukan admin
// 2. Proteksi route kasir → redirect ke /kasir/login jika bukan employee
// 3. Redirect jika sudah login tapi akses halaman auth
// 4. Cek maintenance mode → redirect ke /maintenance
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// Cookie names — WAJIB sinkron dengan lib/utils/auth.ts
const ADMIN_ACCESS_COOKIE = 'sk_admin';
const KASIR_ACCESS_COOKIE = 'sk_kasir';

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET ?? '');
}

type SessionPayload = { sub: string; role: string } | null;

async function getAdminPayload(request: NextRequest): Promise<SessionPayload> {
  const token = request.cookies.get(ADMIN_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'smartkasir-perwira',
    });
    const role = payload['role'] as string;
    if (role !== 'admin') return null;
    return { sub: payload.sub as string, role };
  } catch {
    return null;
  }
}

async function getKasirPayload(request: NextRequest): Promise<SessionPayload> {
  const token = request.cookies.get(KASIR_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'smartkasir-perwira',
    });
    const role = payload['role'] as string;
    if (role !== 'employee') return null;
    return { sub: payload.sub as string, role };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // --- Skip static files and API routes ---
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // --- Maintenance page: selalu accessible ---
  if (pathname === '/maintenance') {
    return NextResponse.next();
  }

  const adminSession = await getAdminPayload(request);
  const kasirSession = await getKasirPayload(request);

  // --- Check Maintenance Mode (hanya untuk non-admin) ---
  if (!adminSession) {
    const maintenanceRes = await fetch(
      `${request.nextUrl.origin}/api/maintenance/status`,
      { headers: { 'x-proxy-check': '1' } }
    ).catch(() => null);

    const isMaintenance = maintenanceRes?.ok
      ? ((await maintenanceRes.json().catch(() => ({}))) as { isMaintenance?: boolean })
          .isMaintenance ?? false
      : false;

    if (isMaintenance && pathname !== '/maintenance') {
      return NextResponse.redirect(new URL('/maintenance', request.url));
    }
  }

  // --- Root path: tampilkan landing page publik Wiramart ---
  if (pathname === '/') {
    return NextResponse.next();
  }

  // --- Auth routes (login pages): redirect jika sudah login ---
  if (pathname === '/login') {
    if (adminSession) return NextResponse.redirect(new URL('/admin/dashboard', request.url));
    if (kasirSession) return NextResponse.redirect(new URL('/kasir/pos', request.url));
    return NextResponse.next();
  }

  if (pathname === '/kasir/login') {
    if (kasirSession) return NextResponse.redirect(new URL('/kasir/pos', request.url));
    if (adminSession) return NextResponse.redirect(new URL('/admin/dashboard', request.url));
    return NextResponse.next();
  }

  // --- Admin routes (/admin/**) ---
  if (pathname.startsWith('/admin')) {
    if (!adminSession) {
      const url = new URL('/login', request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // --- Kasir routes (/kasir/**) ---
  if (pathname.startsWith('/kasir')) {
    if (!kasirSession) {
      const url = new URL('/kasir/login', request.url);
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
