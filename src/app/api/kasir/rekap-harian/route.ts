// =============================================================
// Controller: GET /api/kasir/rekap-harian
// Deskripsi: Rekapitulasi transaksi harian kasir & balancing laci
// Role: Employee / Kasir (sk_kasir cookie)
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { getCashierDailyRecap } from '@/lib/services/cashierRecapService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const payload = await verifyJwt(req);
    if (!payload || payload.role !== 'employee') {
      return apiError('Akses ditolak. Sesi kasir tidak valid.', 'UNAUTHORIZED', 401);
    }

    const { searchParams } = new URL(req.url);
    const result = await getCashierDailyRecap({
      employeeId: payload.sub, // IDOR-Proof: identitas diambil langsung dari token
      tanggal: searchParams.get('tanggal') ?? undefined,
      shiftId: searchParams.get('shiftId') ?? undefined,
      page: Number(searchParams.get('page') ?? '1'),
      limit: Number(searchParams.get('limit') ?? '20'),
    });

    return apiOk(result);
  } catch (error) {
    if (error instanceof AppError) {
      return apiError(error.message, error.code, error.statusCode);
    }
    return apiError(
      error instanceof Error ? error.message : 'Terjadi kesalahan sistem internal',
      'INTERNAL_SERVER_ERROR',
      500,
    );
  }
}
