// =============================================================
// POST /api/admin/stok-adjustment — Koreksi stok produk (Stock Opname)
// Body: { productId, qtyAfter, reason }
// Auth: Admin only
//
// ATOMIC: update products.stockQty + insert stockAdjustments
// dalam satu db.transaction() — rollback jika ada error.
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, stockAdjustments } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────
const adjustSchema = z.object({
  productId: z.string().uuid('productId harus berupa UUID yang valid.'),
  qtyAfter: z
    .number()
    .int('Stok harus bilangan bulat.')
    .min(0, 'Stok tidak bisa negatif.'),
  reason: z
    .string()
    .trim()
    .min(5, 'Alasan terlalu pendek (min 5 karakter).')
    .max(300, 'Alasan terlalu panjang (maks 300 karakter).'),
});

// ─────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const session = await requireAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Format request tidak valid.', 'INVALID_JSON', 400);
    }

    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? 'Data tidak valid.',
        'VALIDATION_ERROR',
        422,
      );
    }

    const { productId, qtyAfter, reason } = parsed.data;

    // ── Fetch produk saat ini ──────────────────────────────
    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
      columns: { id: true, name: true, stockQty: true, deletedAt: true },
    });

    if (!product || product.deletedAt !== null) {
      return apiError('Produk tidak ditemukan.', 'NOT_FOUND', 404);
    }

    const qtyBefore = product.stockQty;
    const qtyDiff   = qtyAfter - qtyBefore;

    // Jika tidak ada perubahan — tolak agar tidak membuat record kosong
    if (qtyDiff === 0) {
      return apiError(
        `Stok ${product.name} sudah ${qtyBefore}. Tidak ada perubahan.`,
        'NO_CHANGE',
        422,
      );
    }

    // ── ATOMIC: update stok + insert log ──────────────────
    const now = new Date();

    await db.transaction(async (tx) => {
      // Step 1: Update stok produk
      await tx
        .update(products)
        .set({ stockQty: qtyAfter, updatedAt: now })
        .where(eq(products.id, productId));

      // Step 2: Insert stock adjustment log
      await tx.insert(stockAdjustments).values({
        productId,
        qtyBefore,
        qtyAfter,
        qtyDiff,
        reason,
        adjustedByAdminId: session.sub,
        createdAt: now,
      });
    });

    return apiOk({
      productId,
      productName: product.name,
      qtyBefore,
      qtyAfter,
      qtyDiff,
      message: `Stok "${product.name}" berhasil disesuaikan: ${qtyBefore} → ${qtyAfter} (${qtyDiff > 0 ? '+' : ''}${qtyDiff})`,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
