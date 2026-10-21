// =============================================================
// src/app/api/admin/gudang/fefo-alerts/[id]/decide/route.ts
// Route Handler: Manager Menetapkan Keputusan FEFO & Auto-Generate Barcode Diskon (POST)
// STANDAR: Next.js 15+ Async Params, Executive Role Separation, ACID Transaction
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { decideConditionReport } from '@/lib/services/fefoAlertService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  // Separation of Duty Guard: Hanya Manager yang berwenang
  if (payload.adminRole && payload.adminRole !== 'MANAGER') {
    return apiError('Forbidden: Hanya akun Manager yang berwenang menetapkan keputusan FEFO.', 403);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID laporan kondisi tidak valid', 400);
  }

  try {
    const body = await req.json();
    const result = await decideConditionReport(id, payload.sub, body);
    return apiOk({
      message:
        result.discountBarcode
          ? `Keputusan DISKON disetujui. Barcode diskon khusus: ${result.discountBarcode}`
          : 'Keputusan Manager berhasil ditetapkan.',
      data: result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Data keputusan tidak valid', 400);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Admin Gudang Decide POST Error]:', error);
    return apiError('Gagal memproses keputusan Manager', 500);
  }
}
