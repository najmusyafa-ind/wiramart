// =============================================================
// /api/admin/gudang/batch — Manajemen Batch Stok & FEFO Kedaluwarsa
// GET:  Ambil daftar batch, filter status kedaluwarsa & summary alert
// POST: Penerimaan barang masuk per batch (tambah batch + update stok produk atomik)
// Auth: Admin / Manajer Toko
// =============================================================

import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  stockBatches,
  products,
  stockAdjustments,
  admins,
  discountPolicies,
  discountBarcodes,
  type ExpiryClass,
} from '@/lib/db/schema';
import { eq, and, sql, gte, desc, asc, isNull, inArray } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getTodayWib, getOffsetDateWib } from '@/lib/utils/helpers';
import { resolveNormalizedSupplierId } from '@/lib/services/supplierResolver';

export const runtime = 'nodejs';

async function requireActiveManager(req: NextRequest) {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return { ok: false as const, status: 401, error: 'Unauthorized: Memerlukan sesi Admin/Manager.' };
  }

  const [adminRow] = await db
    .select({
      id: admins.id,
      role: admins.role,
      fullName: admins.fullName,
      nidn: admins.nidn,
    })
    .from(admins)
    .where(
      and(
        eq(admins.id, session.sub),
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
      ),
    )
    .limit(1);

  if (!adminRow || adminRow.role !== 'MANAGER') {
    return {
      ok: false as const,
      status: 403,
      error: 'Akses ditolak. Mutasi langsung batch stok hanya berhak disetujui oleh Manager (Dosen).',
    };
  }

  return { ok: true as const, admin: adminRow };
}

// ─────────────────────────────────────────────────────────────
// GET: List Batches & Summary Alert Kedaluwarsa
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await verifyJwt(req);
  if (!session || (session.role !== 'admin' && session.role !== 'employee')) {
    return apiError('Akses ditolak. Memerlukan hak akses Admin atau Petugas Gudang.', 403);
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') || 'ALL'; // ALL | EXPIRED | EXPIRING_7 | EXPIRING_30 | ACTIVE
  const expiryClassFilter = searchParams.get('expiryClass'); // HARIAN | PENDEK | PANJANG
  const productId = searchParams.get('productId');
  const q = searchParams.get('q')?.trim() || '';

  if (productId && !z.string().uuid().safeParse(productId).success) {
    return apiError('Parameter productId tidak valid.', 400);
  }

  const todayStr = getTodayWib();
  const in7Days = getOffsetDateWib(7);
  const in30Days = getOffsetDateWib(30);

  try {
    // 1. Ambil summary statistik kedaluwarsa khusus produk yang masih aktif/belum dihapus
    const [summaryResult] = await db
      .select({
        totalBatches: sql<number>`COUNT(*)::int`,
        totalStockInBatches: sql<number>`COALESCE(SUM(${stockBatches.currentQty}), 0)::int`,
        expiredCount: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} < ${todayStr} AND ${stockBatches.currentQty} > 0), 0)::int`,
        expiring7Count: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} >= ${todayStr} AND ${stockBatches.expiryDate} <= ${in7Days} AND ${stockBatches.currentQty} > 0), 0)::int`,
        expiring30Count: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${stockBatches.expiryDate} IS NOT NULL AND ${stockBatches.expiryDate} > ${in7Days} AND ${stockBatches.expiryDate} <= ${in30Days} AND ${stockBatches.currentQty} > 0), 0)::int`,
      })
      .from(stockBatches)
      .innerJoin(products, eq(stockBatches.productId, products.id))
      .where(isNull(products.deletedAt));

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
        costPrice: session.role === 'admin' ? b.costPrice : '0',
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
  expiryDate: z
    .string({ message: 'Tanggal kedaluwarsa (expiry date) wajib diisi untuk semua barang masuk' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  expiryClass: z.enum(['HARIAN', 'PENDEK', 'PANJANG']).optional(),
  supplierId: z.string().uuid('Supplier ID tidak valid').nullable().optional(),
  supplierName: z.string().trim().max(100).optional(),
  invoiceNumber: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireActiveManager(req);
  if (!auth.ok) {
    return apiError(auth.error, auth.status);
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
    supplierId,
    supplierName,
    invoiceNumber,
    notes,
  } = parsed.data;

  const todayStrNow = getTodayWib();
  if (expiryDate < todayStrNow) {
    return apiError(
      `Tanggal kedaluwarsa (${expiryDate}) sudah terlewat. Tidak dapat menerima barang kedaluwarsa.`,
      422,
    );
  }
  const diffDaysExp = Math.ceil(
    (new Date(`${expiryDate}T00:00:00Z`).getTime() - new Date(`${todayStrNow}T00:00:00Z`).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const resolvedExpiryClass: ExpiryClass =
    expiryClass ?? (diffDaysExp <= 2 ? 'HARIAN' : diffDaysExp <= 14 ? 'PENDEK' : 'PANJANG');

  const now = new Date();
  const batchCode =
    parsed.data.batchCode ||
    `BATCH-${getTodayWib(now).replace(/-/g, '')}-${randomInt(1000, 10000)}`;

  const combinedNotes = [
    supplierName ? `Pemasok: ${supplierName}` : '',
    invoiceNumber ? `No. Nota: ${invoiceNumber}` : '',
    notes || '',
  ]
    .filter(Boolean)
    .join(' | ') || null;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Kunci & verifikasi produk ada & tidak dihapus
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, productId), isNull(products.deletedAt)))
        .for('update')
        .limit(1);

      if (!product) {
        throw new Error('PROD_NOT_FOUND: Produk tidak ditemukan atau telah dihapus.');
      }

      // 2. Resolve supplier 3NF & simpan batch baru ke stock_batches
      const resolvedSupplierId = await resolveNormalizedSupplierId(tx, {
        supplierId,
        supplierName,
        createdByAdminId: auth.admin.id,
        autoNote: 'Terdaftar otomatis dari penerimaan batch manual Manager',
      });

      const [newBatch] = await tx
        .insert(stockBatches)
        .values({
          productId,
          supplierId: resolvedSupplierId,
          batchCode,
          costPrice: costPrice.toString(),
          initialQty,
          currentQty: initialQty,
          expiryDate,
          expiryClass: resolvedExpiryClass,
          notes: combinedNotes,
        })
        .returning();

      // 3. Update total stok & HPP terbaru produk secara atomik
      const [updatedProduct] = await tx
        .update(products)
        .set({
          stockQty: sql`${products.stockQty} + ${initialQty}`,
          costPrice: costPrice > 0 ? costPrice.toString() : product.costPrice,
          updatedAt: now,
        })
        .where(eq(products.id, productId))
        .returning({ stockQty: products.stockQty });

      const afterQty = updatedProduct.stockQty;
      const beforeQty = afterQty - initialQty;
      const managerLabel = auth.admin.fullName || auth.admin.nidn;

      // 4. Catat riwayat di stockAdjustments dengan batchId FK untuk audit trail
      await tx.insert(stockAdjustments).values({
        productId,
        batchId: newBatch.id,
        adjustedByAdminId: auth.admin.id,
        qtyBefore: beforeQty,
        qtyAfter: afterQty,
        qtyDiff: initialQty,
        reason: `Penerimaan batch ${batchCode} (+${initialQty} unit) oleh Manager ${managerLabel}${supplierName ? ` dari ${supplierName}` : ''}${invoiceNumber ? ` (Nota: ${invoiceNumber})` : ''}`,
      });

      return { newBatch, totalStock: afterQty };
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
    const statusCode = message.startsWith('PROD_NOT_FOUND') ? 404 : 500;
    return apiError(message, statusCode);
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH: Write-off / Pemusnahan / Retur Batch Kedaluwarsa/Rusak
// ─────────────────────────────────────────────────────────────
const WriteOffBatchSchema = z.object({
  batchId: z.string().uuid('Batch ID tidak valid'),
  qty: z.number().int().positive('Jumlah write-off harus lebih dari 0'),
  action: z.enum(['EXPIRED', 'RUSAK', 'HILANG', 'RETUR_PEMASOK', 'DISPOSISI_HARIAN']),
  reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(300),
});

export async function PATCH(req: NextRequest) {
  const auth = await requireActiveManager(req);
  if (!auth.ok) {
    return apiError(auth.error, auth.status);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid.', 400);
  }

  const parsed = WriteOffBatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message || 'Data input tidak valid.', 422);
  }

  const { batchId, qty, action, reason } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Lookup non-blocking productId lalu kunci urut deterministik: products -> stock_batches (anti-deadlock)
      const [batchMeta] = await tx
        .select({ productId: stockBatches.productId })
        .from(stockBatches)
        .where(eq(stockBatches.id, batchId))
        .limit(1);

      if (!batchMeta) {
        throw new Error('BATCH_NOT_FOUND: Batch stok tidak ditemukan.');
      }

      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.id, batchMeta.productId), isNull(products.deletedAt)))
        .limit(1)
        .for('update');

      if (!product) {
        throw new Error('PROD_NOT_FOUND: Produk tidak ditemukan atau telah dihapus.');
      }

      const [batch] = await tx
        .select()
        .from(stockBatches)
        .where(eq(stockBatches.id, batchId))
        .limit(1)
        .for('update');

      if (!batch) {
        throw new Error('BATCH_NOT_FOUND: Batch stok tidak ditemukan.');
      }

      if (batch.currentQty < qty) {
        throw new Error(
          `INSUFFICIENT_BATCH_QTY: Sisa stok pada batch ini hanya ${batch.currentQty} unit (diminta write-off ${qty} unit).`,
        );
      }

      if (product.stockQty < qty) {
        throw new Error(
          `INSUFFICIENT_PROD_STOCK: Total stok produk di rak hanya ${product.stockQty} unit (diminta write-off ${qty} unit).`,
        );
      }

      const now = new Date();

      // 3. Potong stok batch dengan guard atomik
      const [updatedBatch] = await tx
        .update(stockBatches)
        .set({
          currentQty: sql`${stockBatches.currentQty} - ${qty}`,
          updatedAt: now,
        })
        .where(and(eq(stockBatches.id, batchId), gte(stockBatches.currentQty, qty)))
        .returning();

      if (!updatedBatch) {
        throw new Error('INSUFFICIENT_BATCH_QTY: Stok batch berubah saat write-off diproses.');
      }

      // 3b. Sinkronkan kebijakan diskon & barcode diskon yang menempel pada batch ini
      const linkedPolicies = await tx
        .select({ id: discountPolicies.id })
        .from(discountPolicies)
        .where(and(eq(discountPolicies.batchId, batchId), eq(discountPolicies.isActive, true)));

      if (linkedPolicies.length > 0) {
        const policyIds = linkedPolicies.map((p) => p.id);
        await tx
          .update(discountBarcodes)
          .set({
            remainingQty: sql`LEAST(${discountBarcodes.remainingQty}, ${updatedBatch.currentQty})`,
            ...(updatedBatch.currentQty <= 0 ? { isActive: false } : {}),
          })
          .where(and(inArray(discountBarcodes.policyId, policyIds), eq(discountBarcodes.isActive, true)));

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

      // 4. Potong total stok produk secara atomik
      const [updatedProduct] = await tx
        .update(products)
        .set({
          stockQty: sql`${products.stockQty} - ${qty}`,
          updatedAt: now,
        })
        .where(and(eq(products.id, batch.productId), gte(products.stockQty, qty)))
        .returning({ stockQty: products.stockQty });

      if (!updatedProduct) {
        throw new Error('INSUFFICIENT_PROD_STOCK: Stok produk berubah saat write-off diproses.');
      }

      // 5. Catat ke stockAdjustments untuk audit trail & laporan susut barang
      const actionLabel =
        action === 'EXPIRED'
          ? 'Kedaluwarsa'
          : action === 'RUSAK'
          ? 'Barang Rusak'
          : action === 'HILANG'
          ? 'Barang Hilang'
          : action === 'RETUR_PEMASOK'
          ? 'Retur Pemasok'
          : 'Disposisi Harian';

      const costPriceNum = parseFloat(batch.costPrice) || 0;
      const totalLostCost = costPriceNum * qty;
      const managerLabel = auth.admin.fullName || auth.admin.nidn;

      await tx.insert(stockAdjustments).values({
        productId: batch.productId,
        batchId: updatedBatch.id,
        adjustedByAdminId: auth.admin.id,
        qtyBefore: product.stockQty,
        qtyAfter: updatedProduct.stockQty,
        qtyDiff: -qty,
        reason: `[WRITE-OFF:${action}] ${actionLabel} oleh Manager ${managerLabel} - ${reason} (Batch: ${batch.batchCode}, HPP: Rp ${costPriceNum.toLocaleString('id-ID')}, Nilai Susut: Rp ${totalLostCost.toLocaleString('id-ID')})`,
      });

      return {
        batch: updatedBatch,
        totalStock: updatedProduct.stockQty,
        qtyWrittenOff: qty,
        action,
        totalLostCost,
      };
    });

    return apiOk(
      {
        message: `Write-off ${result.qtyWrittenOff} unit berhasil diproses.`,
        data: result,
      },
      200,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal memproses write-off batch';
    const statusCode =
      message.startsWith('BATCH_NOT_FOUND') || message.startsWith('PROD_NOT_FOUND')
        ? 404
        : message.startsWith('INSUFFICIENT')
        ? 422
        : 500;
    return apiError(message, statusCode);
  }
}
