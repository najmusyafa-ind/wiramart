// =============================================================
// POST /api/auth/logout — Logout (Admin & Employee)
// Body optional: { role: 'admin' | 'employee' }
// Jika role disertakan, hanya hapus cookie untuk role itu.
// Jika tidak, deteksi otomatis dari token yang ada.
// Untuk employee: close active shift (clock-out)
// =============================================================

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { getAdminSession, getKasirSession, clearAuthCookies } from '@/lib/utils/auth';
import { apiOk } from '@/lib/utils/helpers';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  // Coba baca role dari request body (opsional)
  let requestedRole: 'admin' | 'employee' | undefined;
  try {
    const body = await request.json();
    if (body?.role === 'admin' || body?.role === 'employee') {
      requestedRole = body.role;
    }
  } catch {
    // Body kosong atau bukan JSON — tidak masalah
  }

  if (requestedRole === 'admin') {
    // Logout admin saja
    await clearAuthCookies('admin');
    return apiOk({ message: 'Logout admin berhasil', redirect: '/login' });
  }

  if (requestedRole === 'employee') {
    // Logout kasir (Hapus cookie tanpa menutup shift secara diam-diam — Cacat 4 Opsi A)
    // Penutupan shift resmi WAJIB melalui /api/kasir/shift/tutup dengan Blind Count actualCash
    await clearAuthCookies('employee');
    return apiOk({ message: 'Logout kasir berhasil', redirect: '/kasir/login' });
  }

  // Auto-detect: cek session mana yang aktif
  const kasirSession = await getKasirSession();
  if (kasirSession) {
    await clearAuthCookies('employee');
    return apiOk({ message: 'Logout kasir berhasil', redirect: '/kasir/login' });
  }

  const adminSession = await getAdminSession();
  if (adminSession) {
    await clearAuthCookies('admin');
    return apiOk({ message: 'Logout admin berhasil', redirect: '/login' });
  }

  // Tidak ada sesi aktif — clear semua cookie
  await clearAuthCookies();
  return apiOk({ message: 'Logout berhasil' });
}
