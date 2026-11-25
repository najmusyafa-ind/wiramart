// =============================================================
// POST /api/admin/pesanan-online/[id]
// Aksi admin pada satu pesanan:
//   verify     → WAITING_PAYMENT_VERIFICATION → WAITING_CONFIRMATION
//   confirm    → WAITING_CONFIRMATION → CONFIRMED (ACID: stok + PIN)
//   reject     → WAITING_* → REJECTED
//   assign-cs  → CONFIRMED: set assignedCsId (status tetap CONFIRMED)
//   proses     → CONFIRMED → PREPARING (butuh assignedCsId dulu)
// =============================================================

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import {
  confirmOrder,
  rejectOrder,
  verifyPayment,
  assignCs,
  prosesOrder,
  completePickupOrder,
  cancelConfirmedOrder,
} from '@/features/order/pesanan.service';
import { OrderActionSchema, AssignCsSchema, PinVerifySchema } from '@/features/order/order.types';

export const runtime = 'nodejs';

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('reject') }).extend(OrderActionSchema.shape),
  z.object({ action: z.literal('assign-cs') }).extend(AssignCsSchema.shape),
  z.object({ action: z.literal('proses') }),
  z.object({ action: z.literal('complete-pickup') }).extend(PinVerifySchema.shape),
  z.object({ action: z.literal('cancel-confirmed'), flagBuyer: z.boolean().optional() }).extend(OrderActionSchema.shape),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError('ID tidak valid', 'BAD_REQUEST', 400);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Input tidak valid', 'VALIDATION_ERROR', 422);
    }
    const body = parsed.data;

    switch (body.action) {
      case 'verify':           return apiOk({ order: await verifyPayment(id, admin.sub) });
      case 'confirm':          return apiOk({ order: await confirmOrder(id, admin.sub) });
      case 'reject':           return apiOk({ order: await rejectOrder(id, admin.sub, body.reason) });
      case 'assign-cs':        return apiOk({ order: await assignCs(id, body.csEmployeeId, admin.sub) });
      case 'proses':           return apiOk({ order: await prosesOrder(id) });
      case 'complete-pickup':  return apiOk({ order: await completePickupOrder(id, body.pin) });
      case 'cancel-confirmed': return apiOk({ order: await cancelConfirmedOrder(id, admin.sub, body.reason, Boolean(body.flagBuyer)) });
    }
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
