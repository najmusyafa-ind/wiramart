// =============================================================
// GET /api/order/[id]  — Detail satu pesanan (PROTECTED: buyer, IDOR-safe)
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { getOrderDetail } from '@/features/order/order.service';
import { assertActiveBuyer } from '@/features/order/buyer.repository';
import { resolvePaymentProofUrl } from '@/features/order/payment-proof';
import { getBuyerSessionFromRequest } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { onlineOrderItems, qrisSettings } from '@/lib/db/schema';
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
    await assertActiveBuyer(session.sub);
    const order = await getOrderDetail(id);

    if (!order) {
      return apiError('Pesanan tidak ditemukan', 'NOT_FOUND', 404);
    }

    // IDOR check — 404 (bukan 403) agar keberadaan order orang lain tidak bocor
    if (order.buyerId !== session.sub) {
      return apiError('Pesanan tidak ditemukan', 'NOT_FOUND', 404);
    }

    // Ambil items pesanan, fresh signed proof URL, dan info QRIS/toko untuk instruksi pembayaran
    const [items, resolvedProofUrl, qrisRow] = await Promise.all([
      db.select().from(onlineOrderItems).where(eq(onlineOrderItems.orderId, order.id)),
      resolvePaymentProofUrl(order.paymentProofUrl),
      db.query.qrisSettings.findFirst({
        columns: {
          qrImageUrl: true,
          accountName: true,
          storeName: true,
          storePhone: true,
        },
      }),
    ]);

    return apiOk({
      order: { ...order, paymentProofUrl: resolvedProofUrl },
      items,
      paymentInfo: {
        qrImageUrl: qrisRow?.qrImageUrl ?? null,
        merchantName: qrisRow?.accountName ?? qrisRow?.storeName ?? 'Wiramart UNPERBA',
        storePhone: qrisRow?.storePhone ?? null,
      },
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; statusCode?: number };
    return apiError(e.message ?? 'Gagal mengambil detail pesanan', e.code ?? 'INTERNAL_ERROR', e.statusCode ?? 500);
  }
}
