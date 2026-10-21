// =============================================================
// src/app/api/cron/scan-fefo/route.ts
// Background Cron: Engine Pemindaian Harian FEFO Radar (Setiap Hari 06:00 WIB)
// PRD Wiramart v3.0 — Fase 2.3: Cron Job & Early Warning Radar
// =============================================================

import { NextRequest } from 'next/server';
import { scanAndGenerateFEFOAlerts } from '@/lib/services/fefoAlertService';
import { apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  // Verifikasi Authorization jika cron secret disetel
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return apiError('Unauthorized Cron Request', 401);
    }
  } else if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return apiError('Unauthorized Cron Request', 401);
  }

  try {
    const startTime = Date.now();
    const result = await scanAndGenerateFEFOAlerts();
    const durationMs = Date.now() - startTime;

    console.log(
      `[CRON FEFO Radar] Selesai dalam ${durationMs}ms: ${result.scannedBatches} batch diperiksa, ` +
        `+${result.newAlerts} alert baru, ${result.updatedAlerts} diperbarui.`,
    );

    return apiOk({
      message: 'FEFO Early Warning Radar scan berhasil dieksekusi.',
      timestamp: new Date().toISOString(),
      durationMs,
      data: result,
    });
  } catch (error) {
    console.error('[CRON FEFO Radar Error]:', error);
    return apiError('Gagal menjalankan cron FEFO radar', 500);
  }
}

// Izinkan POST untuk trigger manual dari sistem/admin
export async function POST(req: NextRequest) {
  return GET(req);
}
