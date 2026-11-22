// =============================================================
// POST /api/gudang/penerimaan/[id]/tarik
// Tarik kembali draft SUBMITTED ke DRAFT selama masa jeda 5 menit
// Auth: employee (pembuat draft) atau admin (Admin Shift / Manager)
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { cancelSubmittedStockReceiveDraft } from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID penerimaan tidak valid', 400);
  }

  try {
    const reverted = await cancelSubmittedStockReceiveDraft(id, payload.sub, payload.role);
    return apiOk({
      message: `Draft #${reverted.receiveNumber} berhasil ditarik kembali. Silakan edit dan ajukan ulang.`,
      data: reverted,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Tarik Draft POST Error]:', error);
    return apiError('Gagal menarik draft penerimaan barang', 500);
  }
}
