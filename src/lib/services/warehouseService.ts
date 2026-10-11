// =============================================================
// src/lib/services/warehouseService.ts
// Domain Logic Modul Petugas Gudang (Warehouse Management System)
// STANDAR: Zero-Trust Security (No HPP/costPrice leak), ACID Transaction
// =============================================================

import { db } from '@/lib/db/client';
import {
  products,
  categories,
  stockBatches,
  stockAdjustments,
  admins,
  employees,
} from '@/lib/db/schema';
import { eq, and, isNull, or, ilike, desc, asc, lte, gt, inArray, sql } from 'drizzle-orm';

// ── Tipe Data DTO (Clean Architecture) ─────────────────────────

export interface WarehouseSummaryDto {
  totalSku: number;
  outOfStockSku: number;
  lowStockSku: number;
  expiringSoonSku: number;
  todayRestockCount: number;
}

export interface WarehouseProductDto {
  id: string;
  name: string;
  barcode: string | null;
  categoryName: string;
  stockQty: number;
  unit: string;
  photoUrl: string | null;
  isPerishable: boolean;
  perishableType: string | null;
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'SAFE';
  nearestExpiryDate: string | null;
  expiryUrgency: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'SAFE' | 'NONE';
  activeBatchesCount: number;
}

export interface RestockInputDto {
  productId: string;
  qtyAdd: number;
  expiryDate?: string | null; // Format YYYY-MM-DD
  batchCode?: string | null;
  notes?: string | null;
  employeeId: string;
}

export interface RestockResultDto {
  productId: string;
  productName: string;
  qtyBefore: number;
  qtyAfter: number;
  qtyDiff: number;
  batchId?: string;
  adjustmentId: string;
  restockedAt: string;
}

export interface WarehouseActivityDto {
  id: string;
  productId: string;
  productName: string;
  qtyDiff: number;
  reason: string;
  createdAt: string;
}

// Batas minimum stok dianggap kritis (bisa disesuaikan per kategori di masa depan)
const LOW_STOCK_THRESHOLD = 5;

// =============================================================
// 1. Ringkasan Kesehatan Stok (Dashboard KPI Gudang)
// =============================================================
export async function getWarehouseSummary(): Promise<WarehouseSummaryDto> {
  const nowWib = new Date();
  const tanggalHari = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const in30Days = new Date(nowWib.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  // 1. Total SKU aktif & stok
  const activeProducts = await db
    .select({
      id: products.id,
      stockQty: products.stockQty,
    })
    .from(products)
    .where(and(eq(products.isActive, true), isNull(products.deletedAt)));

  let outOfStockSku = 0;
  let lowStockSku = 0;

  for (const p of activeProducts) {
    if (p.stockQty <= 0) {
      outOfStockSku++;
    } else if (p.stockQty <= LOW_STOCK_THRESHOLD) {
      lowStockSku++;
    }
  }

  // 2. Batch kedaluwarsa mendekati (< 30 hari atau sudah lewat) dengan sisa stok > 0
  const expiringBatches = await db
    .select({
      productId: stockBatches.productId,
    })
    .from(stockBatches)
    .where(
      and(
        gt(stockBatches.currentQty, 0),
        lte(stockBatches.expiryDate, in30Days),
      ),
    );

  const uniqueExpiringProductIds = new Set(expiringBatches.map((b) => b.productId));

  // 3. Restock hari ini oleh gudang
  const todayAdjustments = await db
    .select({ id: stockAdjustments.id })
    .from(stockAdjustments)
    .where(
      and(
        ilike(stockAdjustments.reason, '%RESTOCK GUDANG%'),
        sql`DATE(${stockAdjustments.createdAt} AT TIME ZONE 'Asia/Jakarta') = ${tanggalHari}::date`,
      ),
    );

  return {
    totalSku: activeProducts.length,
    outOfStockSku,
    lowStockSku,
    expiringSoonSku: uniqueExpiringProductIds.size,
    todayRestockCount: todayAdjustments.length,
  };
}

// =============================================================
// 2. Daftar Produk Gudang & Radar FEFO
// =============================================================
export async function getWarehouseProducts(options: {
  search?: string;
  filter?: 'semua' | 'kritis' | 'habis' | 'fefo';
  limit?: number;
  offset?: number;
}): Promise<{ items: WarehouseProductDto[]; total: number }> {
  const { search, filter = 'semua', limit = 100, offset = 0 } = options;

  const nowWib = new Date();
  const todayStr = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const in7DaysStr = new Date(nowWib.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const in30DaysStr = new Date(nowWib.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  // Base query: Produk aktif, ZERO costPrice leak
  let query = db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      stockQty: products.stockQty,
      unit: products.unit,
      photoUrl: products.photoUrl,
      isPerishable: products.isPerishable,
      perishableType: products.perishableType,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.isActive, true), isNull(products.deletedAt)))
    .$dynamic();

  // Search filter (nama / barcode)
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    query = query.where(
      or(
        ilike(products.name, q),
        eq(products.barcode, search.trim()),
        ilike(products.barcode, q),
      ),
    );
  }

  // Filter kondisi stok
  if (filter === 'habis') {
    query = query.where(lte(products.stockQty, 0));
  } else if (filter === 'kritis') {
    query = query.where(
      and(gt(products.stockQty, 0), lte(products.stockQty, LOW_STOCK_THRESHOLD)),
    );
  }

  const rows = await query.orderBy(asc(products.name)).limit(limit).offset(offset);

  // Ambil data batch aktif untuk produk-produk ini (FEFO radar)
  const productIds = rows.map((r) => r.id);
  const batchesByProduct: Record<
    string,
    { expiryDate: string | null; currentQty: number }[]
  > = {};

  if (productIds.length > 0) {
    const activeBatches = await db
      .select({
        productId: stockBatches.productId,
        expiryDate: stockBatches.expiryDate,
        currentQty: stockBatches.currentQty,
      })
      .from(stockBatches)
      .where(
        and(
          gt(stockBatches.currentQty, 0),
          inArray(stockBatches.productId, productIds),
        ),
      )
      .orderBy(asc(stockBatches.expiryDate));

    for (const b of activeBatches) {
      if (!batchesByProduct[b.productId]) {
        batchesByProduct[b.productId] = [];
      }
      batchesByProduct[b.productId]!.push(b);
    }
  }

  // Map ke DTO terstruktur dengan urgensi FEFO
  const items: WarehouseProductDto[] = rows.map((r) => {
    const batches = batchesByProduct[r.id] ?? [];
    const nearestBatch = batches.find((b) => b.expiryDate) ?? batches[0];
    const nearestExp = nearestBatch?.expiryDate ?? null;

    let expiryUrgency: WarehouseProductDto['expiryUrgency'] = 'NONE';
    if (nearestExp) {
      if (nearestExp < todayStr) {
        expiryUrgency = 'EXPIRED';
      } else if (nearestExp <= in7DaysStr) {
        expiryUrgency = 'CRITICAL';
      } else if (nearestExp <= in30DaysStr) {
        expiryUrgency = 'WARNING';
      } else {
        expiryUrgency = 'SAFE';
      }
    }

    let stockStatus: WarehouseProductDto['stockStatus'] = 'SAFE';
    if (r.stockQty <= 0) {
      stockStatus = 'OUT_OF_STOCK';
    } else if (r.stockQty <= LOW_STOCK_THRESHOLD) {
      stockStatus = 'LOW_STOCK';
    }

    return {
      id: r.id,
      name: r.name,
      barcode: r.barcode,
      categoryName: r.categoryName ?? 'Umum',
      stockQty: r.stockQty,
      unit: r.unit,
      photoUrl: r.photoUrl,
      isPerishable: r.isPerishable,
      perishableType: r.perishableType,
      stockStatus,
      nearestExpiryDate: nearestExp,
      expiryUrgency,
      activeBatchesCount: batches.length,
    };
  });

  // Jika filter FEFO: hanya tampilkan yang punya expired date mendesak (EXPIRED, CRITICAL, WARNING)
  let filteredItems = items;
  if (filter === 'fefo') {
    filteredItems = items
      .filter((i) => i.expiryUrgency === 'EXPIRED' || i.expiryUrgency === 'CRITICAL' || i.expiryUrgency === 'WARNING')
      .sort((a, b) => {
        if (!a.nearestExpiryDate) return 1;
        if (!b.nearestExpiryDate) return -1;
        return a.nearestExpiryDate.localeCompare(b.nearestExpiryDate);
      });
  }

  return {
    items: filteredItems,
    total: filteredItems.length,
  };
}

// =============================================================
// 3. Inbound Restock Barang Datang (ACID Transaction)
// =============================================================
export async function restockProductByWarehouse(
  input: RestockInputDto,
): Promise<RestockResultDto> {
  const { productId, qtyAdd, expiryDate, batchCode, notes, employeeId } = input;

  if (qtyAdd <= 0) {
    throw new Error('Jumlah restock harus lebih dari 0.');
  }

  // 1. Verifikasi Petugas (Karyawan Gudang atau Admin)
  let actorName = '';
  let actorNim = '';

  const emp = await db.query.employees.findFirst({
    where: and(eq(employees.id, employeeId), eq(employees.isActive, true)),
    columns: { id: true, fullName: true, nim: true, jabatan: true },
  });

  if (emp) {
    actorName = emp.fullName;
    actorNim = `NIM ${emp.nim}`;
  } else {
    const adm = await db.query.admins.findFirst({
      where: and(eq(admins.id, employeeId), eq(admins.isActive, true)),
      columns: { id: true, fullName: true, nidn: true },
    });
    if (adm) {
      actorName = adm.fullName;
      actorNim = adm.nidn ? `ID ${adm.nidn}` : 'ADMIN';
    } else {
      throw new Error('Petugas tidak terdaftar atau tidak aktif.');
    }
  }

  // 2. Verifikasi Produk
  const prod = await db.query.products.findFirst({
    where: and(eq(products.id, productId), isNull(products.deletedAt)),
  });

  if (!prod) {
    throw new Error('Produk tidak ditemukan atau telah dihapus.');
  }

  // 3. Cari Admin Aktif untuk Audit Trail
  const adminRow = await db.query.admins.findFirst({
    where: eq(admins.isActive, true),
    columns: { id: true },
  });

  if (!adminRow) {
    throw new Error('Sistem audit admin tidak tersedia.');
  }

  const nowWib = new Date();
  const timeStr = nowWib.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  });

  const qtyBefore = prod.stockQty;
  const qtyAfter = qtyBefore + qtyAdd;
  const autoBatchCode =
    batchCode?.trim() ||
    `IN-${nowWib.getFullYear()}${String(nowWib.getMonth() + 1).padStart(2, '0')}${String(nowWib.getDate()).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;

  let createdBatchId: string | undefined;
  let createdAdjId = '';

  // Transaksi ACID: Update Master Stok + Insert/Update Batch + Insert Audit Log
  await db.transaction(async (tx) => {
    // A. Update Master Stok Produk
    await tx
      .update(products)
      .set({
        stockQty: qtyAfter,
        updatedAt: nowWib,
      })
      .where(eq(products.id, productId));

    // B. Buat / Update Stock Batch jika ada tanggal kadaluarsa atau batch code
    const [batchRecord] = await tx
      .insert(stockBatches)
      .values({
        productId,
        batchCode: autoBatchCode,
        costPrice: prod.costPrice, // Menggunakan HPP internal produk
        initialQty: qtyAdd,
        currentQty: qtyAdd,
        expiryDate: expiryDate ? expiryDate.trim() : null,
        expiryClass: expiryDate ? 'PENDEK' : 'PANJANG',
        receivedAt: nowWib,
        notes: notes ? `Diterima oleh ${actorName} (${actorNim}): ${notes}` : `Restock gudang oleh ${actorName} (${actorNim})`,
        createdAt: nowWib,
        updatedAt: nowWib,
      })
      .returning({ id: stockBatches.id });

    createdBatchId = batchRecord?.id;

    // C. Insert ke Audit Log Stock Adjustments
    const expInfo = expiryDate ? ` Exp: ${expiryDate}` : '';
    const noteInfo = notes ? ` Catatan: ${notes}` : '';
    const reasonText = `[RESTOCK GUDANG oleh ${actorName} (${actorNim}) ${timeStr}] Masuk +${qtyAdd} ${prod.unit} (Batch: ${autoBatchCode}${expInfo}).${noteInfo}`.trim();

    const [adjRecord] = await tx
      .insert(stockAdjustments)
      .values({
        productId,
        qtyBefore,
        qtyAfter,
        qtyDiff: qtyAdd,
        reason: reasonText,
        adjustedByAdminId: adminRow.id,
        createdAt: nowWib,
      })
      .returning({ id: stockAdjustments.id });

    createdAdjId = adjRecord.id;
  });

  return {
    productId,
    productName: prod.name,
    qtyBefore,
    qtyAfter,
    qtyDiff: qtyAdd,
    batchId: createdBatchId,
    adjustmentId: createdAdjId,
    restockedAt: nowWib.toISOString(),
  };
}

// =============================================================
// 4. Log Aktivitas Restock Gudang Hari Ini
// =============================================================
export async function getWarehouseActivityLogs(limit = 20): Promise<WarehouseActivityDto[]> {
  const rows = await db
    .select({
      id: stockAdjustments.id,
      productId: stockAdjustments.productId,
      productName: products.name,
      qtyDiff: stockAdjustments.qtyDiff,
      reason: stockAdjustments.reason,
      createdAt: stockAdjustments.createdAt,
    })
    .from(stockAdjustments)
    .leftJoin(products, eq(stockAdjustments.productId, products.id))
    .where(ilike(stockAdjustments.reason, '%RESTOCK GUDANG%'))
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: r.productName ?? 'Produk',
    qtyDiff: r.qtyDiff,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  }));
}
