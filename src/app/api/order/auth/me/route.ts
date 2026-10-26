// =============================================================
// GET /api/order/auth/me — Status Sesi Buyer (PWA Client Check)
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk } from '@/lib/utils/helpers';
import { getBuyerSessionFromRequest } from '@/lib/utils/auth';

export async function GET(req: NextRequest) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) {
    return apiOk({ authenticated: false, buyer: null });
  }

  return apiOk({
    authenticated: true,
    buyer: {
      id: session.sub,
      fullName: session.name,
      nim: session.nim,
    },
  });
}
