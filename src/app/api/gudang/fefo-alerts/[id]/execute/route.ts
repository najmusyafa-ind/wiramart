// =============================================================
// src/app/api/gudang/fefo-alerts/[id]/execute/route.ts
// Route Handler: Petugas Gudang Mencatat Eksekusi Tindakan di Lapangan (POST)
// STANDAR: Next.js 15+ Async Params, Zod Validation, Zero-Trust Execution
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { executeConditionReport } from '@/lib/services/fefoAlertService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Forbidden: Eksekusi tindakan hanya untuk petugas gudang', 403);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID laporan kondisi tidak valid', 400);
  }

  try {
    const body = await req.json();
    const result = await executeConditionReport(id, payload.sub, body);
    return apiOk({
      message: 'Eksekusi tindakan di lapangan berhasil dicatat.',
      data: result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Catatan eksekusi tidak valid', 400);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Execute POST Error]:', error);
    return apiError('Gagal mencatat eksekusi tindakan', 500);
  }
}
