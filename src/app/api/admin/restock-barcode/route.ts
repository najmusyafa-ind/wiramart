// =============================================================
// POST /api/admin/restock-barcode
// Flow: Admin scan barcode → sistem identify produk → update stok
// Body: { barcode: string, qty: number, notes?: string }
// Auth: Admin only
// Atomic: db.transaction() untuk race-condition safety
// =============================================================

import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, stockAdjustments, stockBatches, admins } from '@/lib/db/schema';
import { requireManager } from '@/lib/utils/auth';
import { apiOk, apiError, AppError, getTodayWib } from '@/lib/utils/helpers';
import { z } from 'zod';

export const runtime = 'nodejs';

const RestockSchema = z.object({
  barcode: z.string().trim().min(1),
  qty: z.number().int().positive('Jumlah harus lebih dari 0'),
  notes: z.string().trim().max(300).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const admin = await requireManager();

    const [adminRow] = await db
      .select({
        id: admins.id,
        fullName: admins.fullName,
        nidn: admins.nidn,
        role: admins.role,
      })
      .from(admins)
      .where(
        and(
          eq(admins.id, admin.sub),
          eq(admins.isActive, true),
          isNull(admins.deletedAt),
        ),
      )
      .limit(1);

    if (!adminRow || adminRow.role !== 'MANAGER') {
      throw new AppError(
        'FORBIDDEN',
        'Akses ditolak. Restock langsung via barcode khusus untuk Manager (Dosen).',
        403,
      );
    }

    const body: unknown = await req.json();
    const parse = RestockSchema.safeParse(body);
    if (!parse.success) {
      return apiError('Data tidak valid: ' + parse.error.issues[0]?.message, 'VALIDATION_ERROR', 422);
    }
    const { barcode, qty, notes } = parse.data;
    const actorLabel = adminRow.fullName || adminRow.nidn || admin.username;
    const auditReason = notes
      ? `Restock barcode (${barcode}) oleh Manager ${actorLabel}: ${notes}`
      : `Restock via barcode scan (${barcode}) oleh Manager ${actorLabel}`;

    const result = await db.transaction(async (tx) => {
      // 1. Cari dan kunci baris produk berdasarkan barcode
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
        .limit(1)
        .for('update');

      if (!product) {
        throw new AppError(
          `Produk dengan barcode "${barcode}" tidak ditemukan di database.`,
          'PRODUCT_NOT_FOUND',
          404,
        );
      }

      const now = new Date();

      // 2. Tambah stok ATOMIK di level SQL (baris terkunci selama UPDATE).
      const [updated] = await tx
        .update(products)
        .set({
          stockQty: sql`${products.stockQty} + ${qty}`,
          updatedAt: now,
        })
        .where(eq(products.id, product.id))
        .returning({ stockQty: products.stockQty });

      if (!updated) {
        throw new AppError('Produk tidak ditemukan saat update stok.', 'PRODUCT_NOT_FOUND', 404);
      }

      const afterQty = updated.stockQty;
      const beforeQty = afterQty - qty;

      // 3. Catat batch di stockBatches (FEFO inventory, tanggal WIB)
      const batchCode = `RESTOCK-${getTodayWib(now).replace(/-/g, '')}-${randomInt(1000, 10000)}`;
      const [createdBatch] = await tx
        .insert(stockBatches)
        .values({
          productId: product.id,
          batchCode,
          costPrice: product.costPrice,
          initialQty: qty,
          currentQty: qty,
          expiryClass: 'PANJANG',
          notes: auditReason,
        })
        .returning({ id: stockBatches.id });

      // 4. Catat di stockAdjustments dengan FK batchId (audit trail lengkap dengan nama Manager)
      await tx.insert(stockAdjustments).values({
        productId: product.id,
        batchId: createdBatch?.id ?? null,
        adjustedByAdminId: adminRow.id,
        qtyBefore: beforeQty,
        qtyAfter: afterQty,
        qtyDiff: qty,
        reason: auditReason,
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
