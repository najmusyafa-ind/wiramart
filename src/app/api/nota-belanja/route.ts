// =============================================================
// GET & POST /api/nota-belanja
// Thin Controller — Validasi Zod & Delegasi ke purchaseReceiptService
// Akses: MANAGER (Full), ADMIN_SHIFT (Upload + Galeri), GUDANG (Upload + Galeri tanpa nominal)
// =============================================================

import type { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
import {
  CreateReceiptMetaSchema,
  ListReceiptsQuerySchema,
  createPurchaseReceipt,
  listPurchaseReceipts,
  resolveNotaActor,
} from '@/lib/services/purchaseReceiptService';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const actor = await resolveNotaActor(req);
    const sp = req.nextUrl.searchParams;
    const parsed = ListReceiptsQuerySchema.safeParse({
      category: sp.get('category') ?? undefined,
      month: sp.get('month') ?? undefined,
      search: sp.get('search') ?? undefined,
      page: sp.get('page') ?? undefined,
      limit: sp.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Parameter filter tidak valid.', 400);
    }
    const result = await listPurchaseReceipts(actor, parsed.data);
    return apiOk(result);
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.statusCode);
    return apiError('Gagal memuat arsip nota belanja.', 500);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const actor = await resolveNotaActor(req);
    const formData = await req.formData().catch(() => null);
    if (!formData) return apiError('Format request wajib multipart/form-data.', 400);

    const foto = formData.get('foto');
    if (!(foto instanceof File) || foto.size === 0) {
      return apiError('Foto nota wajib dilampirkan.', 400);
    }

    const strOrUndef = (key: string) => {
      const val = formData.get(key);
      return typeof val === 'string' && val.trim() !== '' ? val.trim() : undefined;
    };

    const parsed = CreateReceiptMetaSchema.safeParse({
      receiptDate: strOrUndef('receiptDate'),
      category: strOrUndef('category'),
      merchantName: strOrUndef('merchantName') ?? '',
      invoiceNumber: strOrUndef('invoiceNumber') ?? null,
      paymentStatus: strOrUndef('paymentStatus') ?? null,
      totalAmount: strOrUndef('totalAmount') ?? 0,
      stockAmount: strOrUndef('stockAmount') ?? 0,
      operationalAmount: strOrUndef('operationalAmount') ?? 0,
      consignmentAmount: strOrUndef('consignmentAmount') ?? 0,
      operationalItems: strOrUndef('operationalItems') ?? null,
      description: strOrUndef('description') ?? null,
      syncToOpex: formData.get('syncToOpex') === 'true',
      expenseCategory: strOrUndef('expenseCategory'),
    });

    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Data nota tidak valid.', 400);
    }

    const created = await createPurchaseReceipt(actor, foto, parsed.data);
    return apiOk({ receipt: created }, 201);
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.statusCode);
    return apiError('Gagal menyimpan arsip nota belanja.', 500);
  }
}
