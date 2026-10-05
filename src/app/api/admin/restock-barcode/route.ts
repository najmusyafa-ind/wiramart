// =============================================================
// POST /api/admin/restock-barcode
// Flow: Admin scan barcode → sistem identify produk → update stok
// Body: { barcode: string, qty: number, notes?: string }
// Auth: Admin only
// Atomic: db.transaction() untuk race-condition safety
// =============================================================

import { NextRequest } from 'next/server';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, stockAdjustments } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { z } from 'zod';

export const runtime = 'nodejs';

const RestockSchema = z.object({
  barcode: z.string().min(1),
  qty: z.number().int().positive('Jumlah harus lebih dari 0'),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const admin = await requireAdmin();

    const body: unknown = await req.json();
    const parse = RestockSchema.safeParse(body);
    if (!parse.success) {
      return apiError('Data tidak valid: ' + parse.error.issues[0]?.message, 'VALIDATION_ERROR', 422);
    }
    const { barcode, qty, notes } = parse.data;

    const result = await db.transaction(async (tx) => {
      // 1. Cari produk berdasarkan barcode
      const [product] = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.barcode, barcode),
            eq(products.isActive, true),
            isNull(products.deletedAt),
          ),
        )
        .limit(1);

      if (!product) {
        throw new AppError(
          `Produk dengan barcode "${barcode}" tidak ditemukan di database.`,
          'PRODUCT_NOT_FOUND',
          404,
        );
      }

      // 2. Tambah stok ATOMIK di level SQL (baris terkunci selama UPDATE).
      //    Jangan hitung di JS dari hasil SELECT di atas: penjualan yang masuk di
      //    sela SELECT dan UPDATE akan tertimpa (lost update).
      const [updated] = await tx
        .update(products)
        .set({
          stockQty:  sql`${products.stockQty} + ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, product.id))
        .returning({ stockQty: products.stockQty });

      if (!updated) {
        throw new AppError('Produk tidak ditemukan saat update stok.', 'PRODUCT_NOT_FOUND', 404);
      }

      const afterQty  = updated.stockQty;
      const beforeQty = afterQty - qty;

      // 3. Catat di stockAdjustments (audit trail)
      await tx.insert(stockAdjustments).values({
        productId:         product.id,
        adjustedByAdminId: admin.sub,          // AdminTokenPayload.sub = admin UUID
        qtyBefore:         beforeQty,
        qtyAfter:          afterQty,
        qtyDiff:           qty,                // delta positif = restock
        reason:            notes ?? `Restock via barcode scan: ${barcode}`,
      });

      return { product, beforeQty, afterQty, deltaQty: qty };
    });

    return apiOk({
      productId:   result.product.id,
      productName: result.product.name,
      barcode,
      beforeQty:   result.beforeQty,
      afterQty:    result.afterQty,
      deltaQty:    result.deltaQty,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
