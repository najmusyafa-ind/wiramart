// =============================================================
// src/app/api/gudang/penerimaan/[id]/submit/route.ts
// Route Handler: Pengajuan Draft Penerimaan Barang ke Manager (POST)
// STANDAR: Next.js 15+ Async Params, NASA-Grade Decoupling, Anti-IDOR Guard
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { submitStockReceiveDraft } from '@/lib/services/stockReceiveService';
import { stockSubmitLimiter } from '@/lib/utils/rate-limit';
import { AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Forbidden: Hanya petugas toko / gudang yang dapat mengajukan draft', 403);
  }

  // Rate Limiter: Maksimal 10 submit per 24 jam per employee
  const rateLimit = stockSubmitLimiter.check(payload.sub, true);
  if (!rateLimit.allowed) {
    return apiError(
      `Batas pengajuan harian tercapai. Coba lagi dalam ${Math.ceil(rateLimit.retryAfterSeconds / 60)} menit.`,
      429,
    );
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID draft tidak valid', 400);
  }

  try {
    const updated = await submitStockReceiveDraft(id, payload.sub);
    return apiOk(updated);
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Submit Draft POST Error]:', error);
    return apiError('Gagal mengajukan draft penerimaan barang', 500);
  }
}
