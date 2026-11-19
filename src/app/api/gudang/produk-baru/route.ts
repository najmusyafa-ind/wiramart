// =============================================================
// src/app/api/gudang/produk-baru/route.ts
// Route Handler: Pengajuan Produk Baru + Stok Awal oleh Petugas Gudang -> Approval Manager
// STANDAR: NASA-Grade Decoupling, Zero-Trust Zod Validation, Separation of Duties
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  proposeNewProductByWarehouse,
  ProposeNewProductSchema,
} from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses khusus Petugas Gudang atau Manager.', 401);
  }

  if (payload.role === 'admin' && payload.adminRole && payload.adminRole !== 'MANAGER') {
    return apiError(
      'Forbidden: Admin Shift hanya memiliki akses pantau gudang (read-only).',
      403,
    );
  }

  try {
    const body = await req.json();
    const validated = ProposeNewProductSchema.parse(body);
    const result = await proposeNewProductByWarehouse(payload.sub, validated, payload.role);
    return apiOk(
      {
        message: `Usulan produk baru "${validated.name}" (#${result.receiveNumber}) berhasil dikirim ke antrian Approval Manager. Produk akan tampil di Kasir setelah di-ACC Manager.`,
        data: result,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Data usulan produk baru tidak valid', 422);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Produk Baru POST Error]:', error);
    return apiError('Gagal mengajukan usulan produk baru', 500);
  }
}
