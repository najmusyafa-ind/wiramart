// =============================================================
// GET /api/admin/pesanan-online?status=A,B&limit=50 — Daftar pesanan (ADMIN)
// =============================================================

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { listOrdersForAdmin } from '@/features/order/pesanan.service';

export const runtime = 'nodejs';

const STATUSES = [
  'WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING',
  'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED',
] as const;

const QuerySchema = z.object({
  status: z.array(z.enum(STATUSES)).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const raw = sp.get('status');
    const parsed = QuerySchema.safeParse({
      status: raw ? raw.split(',') : undefined,
      limit: sp.get('limit') ?? undefined,
    });
    if (!parsed.success) return apiError('Parameter tidak valid', 'VALIDATION_ERROR', 422);

    const orders = await listOrdersForAdmin(parsed.data.status ?? null, parsed.data.limit);
    return apiOk({ orders });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
