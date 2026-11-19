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
import { stockSubmitLimiter } from '@/lib/utils/rate-limit';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses khusus Petugas Gudang, Admin Shift, atau Manager.', 401);
  }

  // Opsi B: Petugas Gudang, Admin Shift, & Manager berwenang menambah produk baru langsung (saling backup).
  if (payload.role === 'employee') {
    const rateLimit = stockSubmitLimiter.check(`newprod:${payload.sub}`, true);
    if (!rateLimit.allowed) {
      return apiError(
        `Batas input produk baru harian tercapai. Coba lagi dalam ${Math.ceil(rateLimit.retryAfterSeconds / 60)} menit.`,
        429,
      );
    }
  }

  try {
    const body = await req.json();
    const validated = ProposeNewProductSchema.parse(body);
    const result = await proposeNewProductByWarehouse(payload.sub, validated, payload.role);
    return apiOk(
      {
        message: `Produk baru "${validated.name}" (#${result.receiveNumber}) berhasil ditambahkan dan langsung aktif di katalog Kasir & Gudang.`,
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
