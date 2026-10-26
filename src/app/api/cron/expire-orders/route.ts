// =============================================================
// GET /api/cron/expire-orders
// Sistem expire pesanan yang sudah 2 jam tanpa konfirmasi.
// Dipanggil via Vercel Cron / external scheduler setiap 5 menit.
// Auth: Authorization: Bearer {CRON_SECRET}
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { db } from '@/lib/db/client';
import { onlineOrders } from '@/lib/db/schema';
import { and, isNull, lte, inArray } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Validasi CRON_SECRET
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError('Cron tidak dikonfigurasi.', 'CONFIG_ERROR', 500);

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const now = new Date();

  // Ambil semua pesanan WAITING_* yang sudah melewati expired_at
  const expired = await db
    .select({ id: onlineOrders.id })
    .from(onlineOrders)
    .where(
      and(
        inArray(onlineOrders.status, ['WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION']),
        lte(onlineOrders.expiredAt, now),
        isNull(onlineOrders.deletedAt),
      ),
    )
    .limit(100); // FinOps guard: maksimal 100 per run

  if (expired.length === 0) return apiOk({ expired: 0 });

  const ids = expired.map((r) => r.id);

  await db
    .update(onlineOrders)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(inArray(onlineOrders.id, ids));

  return apiOk({ expired: ids.length });
}
