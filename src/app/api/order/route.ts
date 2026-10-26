// =============================================================
// POST /api/order         — Buat pesanan baru (PROTECTED: buyer)
// GET  /api/order         — Riwayat pesanan buyer (PROTECTED: buyer)
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { CreateOrderSchema } from '@/features/order/order.types';
import { createOnlineOrder, getOrdersByBuyerId } from '@/features/order/order.service';
import { getBuyerSessionFromRequest } from '@/lib/utils/auth';
import { buyerOrderLimiter } from '@/lib/utils/rate-limit';

// ── POST: Buat pesanan ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Guard: harus login sebagai buyer
  const session = await getBuyerSessionFromRequest(req);
  if (!session) {
    return apiError('Silakan login terlebih dahulu', 'UNAUTHORIZED', 401);
  }

  // Rate limit per buyer (5 order / 24 jam)
  const limited = await buyerOrderLimiter.check(`buyer:${session.sub}`);
  if (!limited.allowed) {
    return apiError(
      `Batas pembuatan pesanan hari ini sudah tercapai (maks 5). Coba lagi besok.`,
      'RATE_LIMITED',
      429,
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Input tidak valid', 'VALIDATION_ERROR', 422);
  }

  try {
    const order = await createOnlineOrder(session.sub, parsed.data);
    return apiOk({ order }, undefined, 201);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; statusCode?: number };
    return apiError(e.message ?? 'Gagal membuat pesanan', e.code, e.statusCode ?? 500);
  }
}

// ── GET: Riwayat pesanan ───────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) {
    return apiError('Silakan login terlebih dahulu', 'UNAUTHORIZED', 401);
  }

  try {
    const orders = await getOrdersByBuyerId(session.sub);
    return apiOk({ orders });
  } catch (err: unknown) {
    const e = err as { message?: string };
    return apiError(e.message ?? 'Gagal mengambil riwayat pesanan', 'INTERNAL_ERROR', 500);
  }
}
