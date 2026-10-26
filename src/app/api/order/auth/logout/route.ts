// =============================================================
// POST /api/order/auth/logout
// Hapus cookie sk_buyer — tidak perlu body apapun
// GET  /api/order/auth/logout — return sesi saat ini (untuk hydration client)
// =============================================================

import { type NextRequest, NextResponse } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { clearBuyerCookie, getBuyerSessionFromRequest } from '@/lib/utils/auth';

/** GET — cek apakah user sedang login (untuk client-side hydration) */
export async function GET(req: NextRequest) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) return apiOk(null);
  return apiOk({
    isLoggedIn: true,
    nim: session.nim,
    name: session.name,
  });
}

/** POST — logout (hapus cookie) */
export async function POST() {
  try {
    await clearBuyerCookie();
    return apiOk({ message: 'Berhasil logout' });
  } catch {
    return apiError('Gagal logout', 'LOGOUT_ERROR', 500);
  }
}
