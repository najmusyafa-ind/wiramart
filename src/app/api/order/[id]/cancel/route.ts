// =============================================================
// POST /api/order/[id]/cancel — Buyer batalkan pesanannya (IDOR-safe di service)
// =============================================================

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getBuyerSessionFromRequest } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { cancelByBuyer } from '@/features/order/pesanan.service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) return apiError('Silakan login terlebih dahulu', 'UNAUTHORIZED', 401);

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError('ID pesanan tidak valid', 'BAD_REQUEST', 400);

  try {
    return apiOk({ order: await cancelByBuyer(id, session.sub) });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Gagal membatalkan pesanan.', 'INTERNAL_ERROR', 500);
  }
}
