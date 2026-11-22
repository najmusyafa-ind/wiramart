// =============================================================
// src/app/api/admin/gudang/penerimaan/[id]/approve/route.ts
// Route Handler: Otorisasi 2-Layer Approval Barang Masuk oleh MANAGER (POST)
// STANDAR: Next.js 15+ Async Params, Executive Role Separation, ACID Transaction
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  approveStockReceiveDraft,
  ApprovePriceOverrideSchema,
} from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  if (payload.adminRole && payload.adminRole !== 'MANAGER' && payload.adminRole !== 'ADMIN_SHIFT') {
    return apiError('Forbidden: Hanya Admin Shift atau Manager yang berwenang menyetujui penerimaan barang.', 403);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID penerimaan barang tidak valid', 400);
  }

  try {
    let priceOverrides = undefined;
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > 0) {
      const rawBody = await req.json().catch(() => null);
      if (rawBody && typeof rawBody === 'object') {
        const parsed = ApprovePriceOverrideSchema.parse(rawBody);
        priceOverrides = parsed.priceOverrides;
      }
    }

    const result = await approveStockReceiveDraft(id, payload.sub, priceOverrides);
    return apiOk({
      message: `Penerimaan #${result.receiveNumber} berhasil disetujui. Produk & stok telah aktif di sistem kasir.`,
      data: result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Format penyesuaian harga tidak valid', 422);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Admin Gudang Approve POST Error]:', error);
    return apiError('Gagal menyetujui penerimaan barang', 500);
  }
}
