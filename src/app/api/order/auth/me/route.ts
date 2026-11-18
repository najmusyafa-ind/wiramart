// =============================================================
// GET /api/order/auth/me — Status Sesi Buyer (PWA Client Check)
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk } from '@/lib/utils/helpers';
import { getBuyerSessionFromRequest, clearBuyerCookie } from '@/lib/utils/auth';
import { getActiveBuyerProfile } from '@/features/order/buyer.service';

export async function GET(req: NextRequest) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) {
    return apiOk({ authenticated: false, buyer: null });
  }

  // Pastikan akun buyer masih ada & aktif di database (jika sudah dihapus, bersihkan cookie sesi basi di browser)
  const profile = await getActiveBuyerProfile(session.sub);
  if (!profile) {
    await clearBuyerCookie();
    return apiOk({ authenticated: false, buyer: null });
  }

  return apiOk({
    authenticated: true,
    buyer: {
      id: profile.id,
      fullName: profile.name,
      nim: profile.nim,
    },
  });
}
