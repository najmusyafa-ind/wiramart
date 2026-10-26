// =============================================================
// GET /api/order/[id]  — Detail satu pesanan (PROTECTED: buyer, IDOR-safe)
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { getOrderDetail } from '@/features/order/order.service';
import { getBuyerSessionFromRequest } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { onlineOrderItems } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) {
    return apiError('Silakan login terlebih dahulu', 'UNAUTHORIZED', 401);
  }

  const { id } = await params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) return apiError('ID pesanan tidak valid', 'BAD_REQUEST', 400);

  try {
    const order = await getOrderDetail(id);

    if (!order) {
      return apiError('Pesanan tidak ditemukan', 'NOT_FOUND', 404);
    }

    // IDOR check — 404 (bukan 403) agar keberadaan order orang lain tidak bocor
    if (order.buyerId !== session.sub) {
      return apiError('Pesanan tidak ditemukan', 'NOT_FOUND', 404);
    }

    // Ambil items pesanan
    const items = await db
      .select()
      .from(onlineOrderItems)
      .where(eq(onlineOrderItems.orderId, order.id));

    return apiOk({ order, items });
  } catch (err: unknown) {
    const e = err as { message?: string };
    return apiError(e.message ?? 'Gagal mengambil detail pesanan', 'INTERNAL_ERROR', 500);
  }
}
