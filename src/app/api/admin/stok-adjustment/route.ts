// =============================================================
// POST /api/admin/stok-adjustment — Koreksi stok produk (Stock Opname)
// Body: { productId, qtyAfter, reason }
// Auth: Admin only
//
// ATOMIC: update products.stockQty + insert stockAdjustments
// dalam satu db.transaction() — rollback jika ada error.
// =============================================================

import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, gt, gte, asc, desc, ilike, or, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  products,
  stockAdjustments,
  stockBatches,
  admins,
  discountPolicies,
  discountBarcodes,
} from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError, getTodayWib } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// =============================================================
// GET — Riwayat Audit Koreksi Stok (Kapan, Oleh Siapa, Berapa ke Berapa)
// Mendukung paginasi & pencarian agar data histori dapat ditelusuri lengkap.
// =============================================================
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId');
    const q = searchParams.get('q')?.trim() ?? '';
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '50', 10) || 50));
    const offset = (page - 1) * limit;

    if (productId && !z.string().uuid().safeParse(productId).success) {
      return apiError('Parameter productId tidak valid.', 'BAD_REQUEST', 400);
    }

    const conditions = [];
    if (productId) {
      conditions.push(eq(stockAdjustments.productId, productId));
    }
    if (q) {
      conditions.push(
        or(
          ilike(products.name, `%${q}%`),
          ilike(stockAdjustments.reason, `%${q}%`),
          ilike(admins.fullName, `%${q}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [countRow]] = await Promise.all([
      db
        .select({
          id: stockAdjustments.id,
          productId: stockAdjustments.productId,
          productName: products.name,
          unit: products.unit,
          qtyBefore: stockAdjustments.qtyBefore,
          qtyAfter: stockAdjustments.qtyAfter,
          qtyDiff: stockAdjustments.qtyDiff,
          reason: stockAdjustments.reason,
          createdAt: stockAdjustments.createdAt,
          adminName: admins.fullName,
          adminNidn: admins.nidn,
          adminRole: admins.role,
        })
        .from(stockAdjustments)
        .innerJoin(products, eq(stockAdjustments.productId, products.id))
        .leftJoin(admins, eq(stockAdjustments.adjustedByAdminId, admins.id))
        .where(whereClause)
        .orderBy(desc(stockAdjustments.createdAt), desc(stockAdjustments.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(stockAdjustments)
        .innerJoin(products, eq(stockAdjustments.productId, products.id))
        .leftJoin(admins, eq(stockAdjustments.adjustedByAdminId, admins.id))
        .where(whereClause),
    ]);

    const total = countRow?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return apiOk({
      items: rows,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[stok-adjustment GET]', err);
    return apiError('Gagal memuat riwayat koreksi stok.', 'SERVER_ERROR', 500);
  }
}

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
        // Opname menemukan kelebihan fisik: buat batch penyesuaian baru memakai tanggal WIB
        const batchCode = `OPNAME-${getTodayWib(now).replace(/-/g, '')}-${randomInt(1000, 10000)}`;
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
        // Kurangi batch-batch aktif berurutan FEFO dengan FOR UPDATE & sinkronkan promo diskon
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
          .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt), asc(stockBatches.id))
          .for('update');

        for (const b of activeBatches) {
          if (neededDeduct <= 0) break;
          const deduct = Math.min(b.currentQty, neededDeduct);
          const [updatedBatch] = await tx
            .update(stockBatches)
            .set({
              currentQty: sql`${stockBatches.currentQty} - ${deduct}`,
              updatedAt: now,
            })
            .where(and(eq(stockBatches.id, b.id), gte(stockBatches.currentQty, deduct)))
            .returning({
              id: stockBatches.id,
              currentQty: stockBatches.currentQty,
            });

          if (updatedBatch) {
            const linkedPolicies = await tx
              .select({ id: discountPolicies.id })
              .from(discountPolicies)
              .where(
                and(
                  eq(discountPolicies.batchId, b.id),
                  eq(discountPolicies.isActive, true),
                ),
              );

            if (linkedPolicies.length > 0) {
              const policyIds = linkedPolicies.map((p) => p.id);
              await tx
                .update(discountBarcodes)
                .set({
                  remainingQty: sql`LEAST(${discountBarcodes.remainingQty}, ${updatedBatch.currentQty})`,
                  ...(updatedBatch.currentQty <= 0 ? { isActive: false } : {}),
                })
                .where(
                  and(
                    inArray(discountBarcodes.policyId, policyIds),
                    eq(discountBarcodes.isActive, true),
                  ),
                );

              if (updatedBatch.currentQty <= 0) {
                await tx
                  .update(discountPolicies)
                  .set({ isActive: false, updatedAt: now })
                  .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));
              } else {
                await tx
                  .update(discountPolicies)
                  .set({
                    allowedQty: sql`LEAST(${discountPolicies.allowedQty}, ${discountPolicies.soldQty} + ${updatedBatch.currentQty})`,
                    updatedAt: now,
                  })
                  .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));
              }
            }
          }

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
