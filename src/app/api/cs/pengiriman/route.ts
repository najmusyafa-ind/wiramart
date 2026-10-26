// =============================================================
// GET /api/cs/pengiriman
// Daftar antrean pesanan pengantaran untuk CS Runner (Karyawan / Kasir).
// Ponytail Mode: Minimal boilerplate, reuse verifyJwt & listDeliveriesForCs.
// =============================================================

import { type NextRequest } from 'next/server';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { listDeliveriesForCs } from '@/features/order/cs.service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const session = await verifyJwt(req);
    if (!session || (session.role !== 'employee' && session.role !== 'admin')) {
      return apiError('Akses ditolak. Silakan login sebagai kasir/staf.', 'UNAUTHORIZED', 401);
    }

    // Jika employee: ambil pesanan yang di-assign ke employee ini
    // Jika admin: izinkan filter via query param ?csId=... atau default session sub
    const sp = req.nextUrl.searchParams;
    const targetCsId = session.role === 'admin' ? (sp.get('csId') ?? session.sub) : session.sub;

    const deliveries = await listDeliveriesForCs(targetCsId);
    return apiOk({ deliveries });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
