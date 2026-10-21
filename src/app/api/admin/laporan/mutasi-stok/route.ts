// =============================================================
// src/app/api/admin/laporan/mutasi-stok/route.ts
// API Route Handler: Laporan Mutasi Stok Terintegrasi (Fase 5)
// Wiramart v3.0: Sistem Manajemen Terintegrasi
// STANDAR: NASA-Grade Decoupling, Zod Query Validation, requireManager() Guard
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireManager } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { StockMutationReportService } from '@/lib/services/stockMutationReportService';

export const runtime = 'nodejs';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  startDate: z.string().regex(DATE_REGEX, 'Format startDate harus YYYY-MM-DD').optional(),
  endDate: z.string().regex(DATE_REGEX, 'Format endDate harus YYYY-MM-DD').optional(),
  categoryId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireManager();

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      categoryId: searchParams.get('categoryId') || undefined,
      search: searchParams.get('search') || undefined,
    });

    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? 'Filter parameter tidak valid.',
        'VALIDATION_ERROR',
        422,
      );
    }

    const report = await StockMutationReportService.getReport(parsed.data);

    return apiOk(report);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[laporan/mutasi-stok GET]', err);
    return apiError('Gagal memuat laporan mutasi stok.', 'SERVER_ERROR', 500);
  }
}
