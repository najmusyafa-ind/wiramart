// =============================================================
// POST /api/auth/logout — Logout Terisolasi (Admin / Kasir / Gudang)
// Body optional: { role: 'admin' | 'employee' | 'gudang' }
// Jika role disertakan, hanya hapus cookie untuk role itu (Quad-Session Safe).
// =============================================================

import { getAdminSession, getKasirSession, getGudangSession, clearAuthCookies } from '@/lib/utils/auth';
import { apiOk } from '@/lib/utils/helpers';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  // Coba baca role dari request body (opsional)
  let requestedRole: 'admin' | 'employee' | 'gudang' | undefined;
  try {
    const body = await request.json();
    if (body?.role === 'admin' || body?.role === 'employee' || body?.role === 'gudang') {
      requestedRole = body.role;
    }
  } catch {
    // Body kosong atau bukan JSON — tidak masalah
  }

  if (requestedRole === 'admin') {
    await clearAuthCookies('admin');
    return apiOk({ message: 'Logout admin berhasil', redirect: '/login' });
  }

  if (requestedRole === 'gudang') {
    // Hapus cookie sk_gudang SAJA — tidak pernah menyentuh sesi kasir POS (sk_kasir)
    await clearAuthCookies('gudang');
    return apiOk({ message: 'Logout gudang berhasil', redirect: '/gudang/login' });
  }

  if (requestedRole === 'employee') {
    // Logout kasir (Hapus cookie sk_kasir tanpa menutup shift secara diam-diam — Cacat 4 Opsi A)
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

  const gudangSession = await getGudangSession();
  if (gudangSession) {
    await clearAuthCookies('gudang');
    return apiOk({ message: 'Logout gudang berhasil', redirect: '/gudang/login' });
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
