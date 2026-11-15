// =============================================================
// GET /api/cron/expire-orders
// Sistem expire pesanan yang sudah 2 jam tanpa konfirmasi.
// Dipanggil via Vercel Cron / external scheduler setiap 5 menit.
// Auth: Authorization: Bearer {CRON_SECRET}
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { expireDueOrders } from '@/features/order/pesanan.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Validasi CRON_SECRET
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError('Cron tidak dikonfigurasi.', 'CONFIG_ERROR', 500);

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const expired = await expireDueOrders({ limit: 100 });
  return apiOk({ expired });
}
