// =============================================================
// src/app/api/gudang/fefo-alerts/[id]/lapor/route.ts
// Route Handler: Petugas Gudang Menginput Laporan Kondisi Fisik & Saran (POST)
// STANDAR: Next.js 15+ Async Params, Zod Validation, Zero-Trust Architecture
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { submitConditionReport } from '@/lib/services/fefoAlertService';
import { conditionReportLimiter } from '@/lib/utils/rate-limit';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Forbidden: Pelaporan kondisi hanya untuk petugas gudang', 403);
  }

  // Rate Limiter: Maksimal 50 laporan per 24 jam per employee
  const rateLimit = conditionReportLimiter.check(payload.sub, true);
  if (!rateLimit.allowed) {
    return apiError(
      `Batas pelaporan harian tercapai. Coba lagi dalam ${Math.ceil(rateLimit.retryAfterSeconds / 60)} menit.`,
      429,
    );
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID laporan kondisi tidak valid', 400);
  }

  try {
    const body = await req.json();
    const result = await submitConditionReport(id, payload.sub, body);
    return apiOk({
      message: 'Laporan kondisi fisik barang berhasil dikirim ke Manager.',
      data: result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Data laporan tidak valid', 400);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Lapor Kondisi POST Error]:', error);
    return apiError('Gagal mengirimkan laporan kondisi fisik', 500);
  }
}
