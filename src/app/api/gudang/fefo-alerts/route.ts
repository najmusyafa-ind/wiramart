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

import { z } from 'zod';

export const runtime = 'nodejs';

const FefoAlertsQuerySchema = z.object({
  scan: z.enum(['true', 'false']).optional(),
  status: z.string().max(50).optional(),
  alertLevel: z.string().max(20).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  const { searchParams } = new URL(req.url);
  const rawParams: Record<string, string> = {};
  searchParams.forEach((val, key) => {
    if (val) rawParams[key] = val;
  });

  const parsed = FefoAlertsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return apiError(
      `Parameter tidak valid: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    );
  }

  const { scan, status, alertLevel, search, page, limit } = parsed.data;
  const triggerScan = scan === 'true';

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
