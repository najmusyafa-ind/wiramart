// =============================================================
// POST /api/cs/pengiriman/[id]
// Aksi runner pada satu pesanan pengantaran:
//   berangkat      → PREPARING → OUT_FOR_DELIVERY
//   verifikasi-pin → OUT_FOR_DELIVERY → COMPLETED (validasi PIN 6-digit)
//   no-show        → pencatatan buyer tidak ada di lokasi (no_show_count++)
// Ponytail Mode: 1 route handler dengan discriminated union, zero bloat.
// =============================================================

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import {
  berangkatDelivery,
  verifyHandoverPin,
  recordNoShow,
} from '@/features/order/cs.service';

export const runtime = 'nodejs';

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('berangkat') }),
  z.object({
    action: z.literal('verifikasi-pin'),
    pin: z
      .string()
      .trim()
      .length(6, 'PIN serah terima harus tepat 6 digit angka')
      .regex(/^\d{6}$/, 'PIN harus berupa 6 digit angka'),
  }),
  z.object({ action: z.literal('no-show') }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await verifyJwt(req);
    if (!session || (session.role !== 'employee' && session.role !== 'admin')) {
      return apiError('Akses ditolak. Silakan login sebagai kasir/staf.', 'UNAUTHORIZED', 401);
    }

    const { id } = await params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) {
      return apiError('ID pesanan tidak valid', 'BAD_REQUEST', 400);
    }

    const rawJson = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(rawJson);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Input tidak valid', 'VALIDATION_ERROR', 422);
    }

    const body = parsed.data;
    const isAdmin = session.role === 'admin';
    const csEmployeeId = session.sub;

    switch (body.action) {
      case 'berangkat': {
        const order = await berangkatDelivery(id, csEmployeeId, isAdmin);
        return apiOk({ order, message: 'Status diubah ke Sedang Diantar.' });
      }
      case 'verifikasi-pin': {
        const order = await verifyHandoverPin(id, csEmployeeId, body.pin, isAdmin);
        return apiOk({ order, message: 'Serah terima berhasil. Pesanan selesai!' });
      }
      case 'no-show': {
        const res = await recordNoShow(id, csEmployeeId, isAdmin);
        return apiOk({
          order: res.order,
          noShowCount: res.noShowCount,
          isMaxReached: res.isMaxReached,
          message: res.isMaxReached
            ? 'Pembeli sudah 2x tidak ada di lokasi. Admin dapat membatalkan pesanan ini.'
            : 'No-show berhasil dicatat.',
        });
      }
    }
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
