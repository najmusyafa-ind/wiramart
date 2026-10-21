// =============================================================
// src/app/api/gudang/fefo-alerts/route.ts
// Route Handler: To-Do List Gudang & Pemindaian Radar FEFO (GET)
// STANDAR: NASA-Grade Decoupling, Zod Query Parsing, Index Optimized
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  scanAndGenerateFEFOAlerts,
  getConditionReports,
} from '@/lib/services/fefoAlertService';
import { AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  const { searchParams } = new URL(req.url);
  const triggerScan = searchParams.get('scan') === 'true';
  const status = searchParams.get('status') || undefined;
  const alertLevel = searchParams.get('alertLevel') || undefined;
  const search = searchParams.get('search') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  try {
    let scanMeta = undefined;

    // Trigger pemindaian batch FEFO terbaru jika diminta
    if (triggerScan) {
      scanMeta = await scanAndGenerateFEFOAlerts();
    }

    const data = await getConditionReports({
      status,
      alertLevel,
      search,
      page,
      limit,
    });

    return apiOk({
      ...data,
      scanMeta,
    });
  } catch (error) {
    if (error instanceof AppError) return apiError(error.message, error.statusCode);
    console.error('[API Gudang FEFO Alerts GET Error]:', error);
    return apiError('Gagal memuat To-Do List kedaluwarsa FEFO', 500);
  }
}
