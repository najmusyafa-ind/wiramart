// =============================================================
// PATCH & DELETE /api/nota-belanja/[id]
// Thin Controller — Eksklusif MANAGER (403 untuk Admin Shift & Gudang)
// =============================================================

import type { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
import {
  DeleteReceiptSchema,
  PatchReceiptSchema,
  ReceiptIdSchema,
  requireManagerNotaActor,
  softDeletePurchaseReceipt,
  updatePurchaseReceipt,
} from '@/lib/services/purchaseReceiptService';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext): Promise<Response> {
  try {
    const manager = await requireManagerNotaActor(req);
    const idCheck = ReceiptIdSchema.safeParse((await params).id);
    if (!idCheck.success) return apiError('ID arsip nota tidak valid.', 400);

    const body = await req.json().catch(() => null);
    const parsed = PatchReceiptSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Data pembaruan nota tidak valid.', 400);
    }

    const updated = await updatePurchaseReceipt(manager, idCheck.data, parsed.data);
    return apiOk({ receipt: updated });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.statusCode);
    return apiError('Gagal memperbarui arsip nota.', 500);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext): Promise<Response> {
  try {
    const manager = await requireManagerNotaActor(req);
    const idCheck = ReceiptIdSchema.safeParse((await params).id);
    if (!idCheck.success) return apiError('ID arsip nota tidak valid.', 400);

    const body = await req.json().catch(() => ({}));
    const parsed = DeleteReceiptSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Alasan penghapusan tidak valid.', 400);
    }

    const deleted = await softDeletePurchaseReceipt(
      manager,
      idCheck.data,
      parsed.data.reason ?? 'Dihapus oleh Manager',
    );
    return apiOk({ deleted });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.statusCode);
    return apiError('Gagal menghapus arsip nota.', 500);
  }
}
