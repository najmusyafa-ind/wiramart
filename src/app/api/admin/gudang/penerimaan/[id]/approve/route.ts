// =============================================================
// src/app/api/admin/gudang/penerimaan/[id]/approve/route.ts
// Route Handler: Otorisasi 2-Layer Approval Barang Masuk oleh MANAGER (POST)
// STANDAR: Next.js 15+ Async Params, Executive Role Separation, ACID Transaction
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { approveStockReceiveDraft } from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  // Separation of Duty Guard: Tolak ADMIN_SHIFT secara cepat di level HTTP
  if (payload.adminRole && payload.adminRole !== 'MANAGER') {
    return apiError('Forbidden: Hanya akun Manager (Dosen) yang berwenang menyetujui penerimaan barang.', 403);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID penerimaan barang tidak valid', 400);
  }

  try {
    const result = await approveStockReceiveDraft(id, payload.sub);
    return apiOk({
      message: `Penerimaan #${result.receiveNumber} berhasil disetujui. Stok telah masuk ke sistem kasir.`,
      data: result,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Admin Gudang Approve POST Error]:', error);
    return apiError('Gagal menyetujui penerimaan barang', 500);
  }
}
