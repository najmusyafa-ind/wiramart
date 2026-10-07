// =============================================================
// /api/admin/gudang/batch — Manajemen Batch Stok & FEFO Kedaluwarsa
// GET:  Ambil daftar batch, filter status kedaluwarsa & summary alert
// POST: Penerimaan barang masuk per batch (tambah batch + update stok produk atomik)
// Auth: Admin / Manajer Toko
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { stockBatches, products, stockAdjustments, type ExpiryClass } from '@/lib/db/schema';
import { eq, and, sql, gte, lte, lt, desc, asc, like, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// GET: List Batches & Summary Alert Kedaluwarsa
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Memerlukan hak akses Admin/Manajer.', 403);
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') || 'ALL'; // ALL | EXPIRED | EXPIRING_7 | EXPIRING_30 | ACTIVE
  const expiryClassFilter = searchParams.get('expiryClass'); // HARIAN | PENDEK | PANJANG
  const productId = searchParams.get('productId');
  const q = searchParams.get('q')?.trim() || '';

  const todayStr = new Date().toISOString().slice(0, 10);
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // 1. Ambil summary statistik kedaluwarsa
    const [summaryResult] = await db
      .select({
        totalBatches: sql<number>`COUNT(*)::int`,
        totalStockInBatches: sql<number>`COALESCE(SUM(${stockBatches.currentQty}), 0)::int`,
        expiredCount: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} < ${todayStr} AND ${stockBatches.currentQty} > 0), 0)::int`,
        expiring7Count: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} >= ${todayStr} AND ${stockBatches.expiryDate} <= ${in7Days} AND ${stockBatches.currentQty} > 0), 0)::int`,
        expiring30Count: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} > ${in7Days} AND ${stockBatches.expiryDate} <= ${in30Days} AND ${stockBatches.currentQty} > 0), 0)::int`,
      })
      .from(stockBatches);

    // 2. Query batch records dengan relasi produk
    const query = db
      .select({
        id: stockBatches.id,
        productId: stockBatches.productId,
        productName: products.name,
        productBarcode: products.barcode,
        productUnit: products.unit,
        productTotalStock: products.stockQty,
        batchCode: stockBatches.batchCode,
        costPrice: stockBatches.costPrice,
        initialQty: stockBatches.initialQty,
        currentQty: stockBatches.currentQty,
        expiryDate: stockBatches.expiryDate,
        expiryClass: stockBatches.expiryClass,
        receivedAt: stockBatches.receivedAt,
        notes: stockBatches.notes,
        createdAt: stockBatches.createdAt,
      })
      .from(stockBatches)
      .innerJoin(products, eq(stockBatches.productId, products.id))
      .where(
        and(
          isNull(products.deletedAt),
          productId ? eq(stockBatches.productId, productId) : undefined,
          expiryClassFilter ? eq(stockBatches.expiryClass, expiryClassFilter as ExpiryClass) : undefined,
          q ? sql`(${products.name} ILIKE ${'%' + q + '%'} OR ${stockBatches.batchCode} ILIKE ${'%' + q + '%'} OR ${products.barcode} ILIKE ${'%' + q + '%'})` : undefined,
          statusFilter === 'EXPIRED'
            ? sql`${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} < ${todayStr} AND ${stockBatches.currentQty} > 0`
            : statusFilter === 'EXPIRING_7'
            ? sql`${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} >= ${todayStr} AND ${stockBatches.expiryDate} <= ${in7Days} AND ${stockBatches.currentQty} > 0`
            : statusFilter === 'EXPIRING_30'
            ? sql`${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} > ${in7Days} AND ${stockBatches.expiryDate} <= ${in30Days} AND ${stockBatches.currentQty} > 0`
            : statusFilter === 'ACTIVE'
            ? sql`${stockBatches.currentQty} > 0`
            : undefined,
        ),
      )
      .orderBy(asc(stockBatches.expiryDate), desc(stockBatches.createdAt))
      .limit(200);

    const rows = await query;

    // Hitung status komputasi per batch untuk visual UI
    const enrichedBatches = rows.map((b) => {
      let expiryStatus: 'EXPIRED' | 'CRITICAL_7' | 'WARNING_30' | 'SAFE' | 'NO_EXPIRY' = 'NO_EXPIRY';
      let daysRemaining: number | null = null;

      if (b.expiryDate) {
        const expTime = new Date(b.expiryDate + 'T00:00:00Z').getTime();
        const nowTime = new Date(todayStr + 'T00:00:00Z').getTime();
        daysRemaining = Math.round((expTime - nowTime) / (1000 * 60 * 60 * 24));

        if (daysRemaining < 0) {
          expiryStatus = 'EXPIRED';
        } else if (daysRemaining <= 7) {
          expiryStatus = 'CRITICAL_7';
        } else if (daysRemaining <= 30) {
          expiryStatus = 'WARNING_30';
        } else {
          expiryStatus = 'SAFE';
        }
      }

      return {
        ...b,
        expiryStatus,
        daysRemaining,
      };
    });

    return apiOk({
      batches: enrichedBatches,
      summary: {
        totalBatches: summaryResult?.totalBatches ?? 0,
        totalStockInBatches: summaryResult?.totalStockInBatches ?? 0,
        expiredCount: summaryResult?.expiredCount ?? 0,
        expiring7Count: summaryResult?.expiring7Count ?? 0,
        expiring30Count: summaryResult?.expiring30Count ?? 0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal memuat batch stok';
    return apiError(message, 500);
  }
}

// ─────────────────────────────────────────────────────────────
// POST: Input Penerimaan Barang / Batch Masuk Baru
// ─────────────────────────────────────────────────────────────
const CreateBatchSchema = z.object({
  productId: z.string().uuid('Product ID tidak valid'),
  batchCode: z.string().trim().max(50).optional(),
  costPrice: z.number().nonnegative('HPP tidak boleh negatif'),
  initialQty: z.number().int().positive('Jumlah masuk harus lebih dari 0'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD').nullable().optional(),
  expiryClass: z.enum(['HARIAN', 'PENDEK', 'PANJANG']).default('PANJANG'),
  supplierName: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Memerlukan hak akses Admin/Manajer.', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid.', 400);
  }

  const parsed = CreateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message || 'Data input tidak valid.', 422);
  }

  const {
    productId,
    costPrice,
    initialQty,
    expiryDate,
    expiryClass,
    supplierName,
    notes,
  } = parsed.data;

  // Verifikasi aturan tanggal kedaluwarsa untuk kelas HARIAN & PENDEK (Bagian 4.6 & Bagian 26)
  if ((expiryClass === 'HARIAN' || expiryClass === 'PENDEK') && !expiryDate) {
    return apiError(
      `Produk dengan kelas "${expiryClass}" wajib mencantumkan tanggal kedaluwarsa (expiry date).`,
      422,
    );
  }

  const batchCode =
    parsed.data.batchCode ||
    `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Verifikasi produk ada & aktif
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, productId), isNull(products.deletedAt)))
        .limit(1);

      if (!product) {
        throw new Error('PROD_NOT_FOUND: Produk tidak ditemukan atau telah dihapus.');
      }

      // 2. Simpan batch baru ke stock_batches
      const [newBatch] = await tx
        .insert(stockBatches)
        .values({
          productId,
          batchCode,
          costPrice: costPrice.toString(),
          initialQty,
          currentQty: initialQty,
          expiryDate: expiryDate || null,
          expiryClass,
          notes: supplierName ? `Pemasok: ${supplierName}. ${notes || ''}`.trim() : notes || null,
        })
        .returning();

      // 3. Update total stok & HPP terbaru produk secara atomik
      const [updatedProduct] = await tx
        .update(products)
        .set({
          stockQty: sql`${products.stockQty} + ${initialQty}`,
          costPrice: costPrice > 0 ? costPrice.toString() : product.costPrice,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning({ stockQty: products.stockQty });

      // 4. Catat riwayat di stockAdjustments untuk audit trail
      await tx.insert(stockAdjustments).values({
        productId,
        adjustedByAdminId: session.sub,
        qtyBefore: product.stockQty,
        qtyAfter: updatedProduct.stockQty,
        qtyDiff: initialQty,
        reason: `Penerimaan batch ${batchCode} (${initialQty} unit)${supplierName ? ` dari ${supplierName}` : ''}`,
      });

      return { newBatch, totalStock: updatedProduct.stockQty };
    });

    return apiOk(
      {
        batch: result.newBatch,
        totalStock: result.totalStock,
      },
      201,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal menyimpan penerimaan batch baru';
    return apiError(message, 500);
  }
}
