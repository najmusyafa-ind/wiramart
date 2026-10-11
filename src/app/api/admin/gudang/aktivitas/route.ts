// =============================================================
// src/app/api/admin/gudang/aktivitas/route.ts
// GET: Riwayat Aktivitas Restock Petugas Gudang Shift untuk Dashboard Admin
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getWarehouseActivityLogs } from '@/lib/services/warehouseService';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await verifyJwt(req);
  if (!session || (session.role !== 'admin' && session.role !== 'employee')) {
    return apiError('Unauthorized', 401);
  }

  try {
    const activities = await getWarehouseActivityLogs(10);
    return apiOk({ activities });
  } catch (error) {
    console.error('[Admin Gudang Aktivitas Error]:', error);
    return apiError('Gagal memuat aktivitas gudang', 500);
  }
}
