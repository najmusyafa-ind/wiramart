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
import { eq, and, gt, asc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, stockAdjustments, stockBatches } from '@/lib/db/schema';
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

    // ── ATOMIC: kunci baris → baca stok → update → sinkronisasi batch → log ─────
    // SELECT ... FOR UPDATE memastikan penjualan/restock konkuren menunggu,
    // sehingga qtyBefore & qtyDiff pada log audit selalu akurat.
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .select({
          id: products.id,
          name: products.name,
          costPrice: products.costPrice,
          stockQty: products.stockQty,
          deletedAt: products.deletedAt,
        })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1)
        .for('update');

      if (!product || product.deletedAt !== null) {
        throw new AppError('Produk tidak ditemukan.', 'NOT_FOUND', 404);
      }

      const qtyBefore = product.stockQty;
      const qtyDiff   = qtyAfter - qtyBefore;

      // Jika tidak ada perubahan — tolak agar tidak membuat record kosong
      if (qtyDiff === 0) {
        throw new AppError(
          `Stok ${product.name} sudah ${qtyBefore}. Tidak ada perubahan.`,
          'NO_CHANGE',
          422,
        );
      }

      // Step 1: Update stok produk
      await tx
        .update(products)
        .set({ stockQty: qtyAfter, updatedAt: now })
        .where(eq(products.id, productId));

      // Step 2: Sinkronisasi stockBatches (Invarian: stock_qty = sum(stockBatches.currentQty))
      if (qtyDiff > 0) {
        // Opname menemukan kelebihan fisik: buat batch penyesuaian baru
        const batchCode = `OPNAME-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
        await tx.insert(stockBatches).values({
          productId,
          batchCode,
          costPrice: product.costPrice,
          initialQty: qtyDiff,
          currentQty: qtyDiff,
          expiryClass: 'PANJANG',
          notes: `Penyesuaian stok opname (+${qtyDiff}): ${reason}`,
        });
      } else if (qtyDiff < 0) {
        // Opname menemukan kekurangan fisik (kehilangan / kerusakan / susut):
        // Kurangi batch-batch aktif secara berurutan menurut FEFO
        let neededDeduct = Math.abs(qtyDiff);
        const activeBatches = await tx
          .select({
            id: stockBatches.id,
            currentQty: stockBatches.currentQty,
          })
          .from(stockBatches)
          .where(
            and(
              eq(stockBatches.productId, productId),
              gt(stockBatches.currentQty, 0),
            ),
          )
          .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt));

        for (const b of activeBatches) {
          if (neededDeduct <= 0) break;
          const deduct = Math.min(b.currentQty, neededDeduct);
          await tx
            .update(stockBatches)
            .set({
              currentQty: sql`${stockBatches.currentQty} - ${deduct}`,
              updatedAt: now,
            })
            .where(eq(stockBatches.id, b.id));
          neededDeduct -= deduct;
        }
      }

      // Step 3: Insert stock adjustment log
      await tx.insert(stockAdjustments).values({
        productId,
        qtyBefore,
        qtyAfter,
        qtyDiff,
        reason,
        adjustedByAdminId: session.sub,
        createdAt: now,
      });

      return { name: product.name, qtyBefore, qtyDiff };
    });

    const { name, qtyBefore, qtyDiff } = result;

    return apiOk({
      productId,
      productName: name,
      qtyBefore,
      qtyAfter,
      qtyDiff,
      message: `Stok "${name}" berhasil disesuaikan: ${qtyBefore} → ${qtyAfter} (${qtyDiff > 0 ? '+' : ''}${qtyDiff})`,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
