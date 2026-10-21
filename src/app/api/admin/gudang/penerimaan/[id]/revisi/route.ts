// =============================================================
// src/app/api/admin/gudang/penerimaan/[id]/revisi/route.ts
// Route Handler: Manager Meminta Revisi Draft Penerimaan Barang (POST)
// STANDAR: Next.js 15+ Async Params, Executive Separation, Zod Validation
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { reviseStockReceiveDraft } from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  if (payload.adminRole && payload.adminRole !== 'MANAGER') {
    return apiError('Forbidden: Hanya akun Manager yang berwenang meminta revisi', 403);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID penerimaan barang tidak valid', 400);
  }

  try {
    const body = await req.json();
    const result = await reviseStockReceiveDraft(id, payload.sub, body);
    return apiOk({
      message: 'Draft penerimaan berhasil dikembalikan ke status revisi dengan catatan untuk petugas gudang.',
      data: result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Catatan revisi tidak valid', 400);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Admin Gudang Revisi POST Error]:', error);
    return apiError('Gagal meminta revisi penerimaan barang', 500);
  }
}
