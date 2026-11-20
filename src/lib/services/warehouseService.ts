// =============================================================
// src/lib/services/warehouseService.ts
// Domain Logic Modul Petugas Gudang (Warehouse Management System)
// Proteksi HPP & Transaksi ACID
// =============================================================

import { randomInt } from 'crypto';
import { db } from '@/lib/db/client';
import {
  products,
  categories,
  stockBatches,
  stockAdjustments,
  stockReceiveDrafts,
  stockReceiveItems,
  productConditionReports,
  admins,
  employees,
  shifts,
  shiftSchedules,
  type ExpiryClass,
} from '@/lib/db/schema';
import {
  eq,
  and,
  isNull,
  isNotNull,
  or,
  ilike,
  desc,
  asc,
  lte,
  gt,
  gte,
  inArray,
  notInArray,
  exists,
  sql,
  type SQL,
} from 'drizzle-orm';
import { getTodayWib, getOffsetDateWib } from '@/lib/utils/helpers';
import { getLowStockThreshold } from '@/lib/services/operationalSettingsService';

function deriveExpiryClass(expiryDateStr: string): ExpiryClass {
  const todayStr = getTodayWib();
  const today = new Date(`${todayStr}T00:00:00Z`);
  const exp = new Date(`${expiryDateStr}T00:00:00Z`);
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 2) return 'HARIAN';
  if (diffDays <= 14) return 'PENDEK';
  return 'PANJANG';
}

// ── Tipe Data DTO (Clean Architecture) ─────────────────────────

export interface WarehouseSummaryDto {
  totalSku: number;
  outOfStockSku: number;
  lowStockSku: number;
  lowStockThreshold: number;
  expiringSoonSku: number;
  activeFefoAlertCount: number;
  todayRestockCount: number;
  perishableSku: number;
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
  bonusQty?: number;
  unitCostPrice?: number;
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
  bonusQty: number;
  effectiveCostPrice: number;
  batchId?: string;
  adjustmentId: string;
  restockedAt: string;
}

export interface WarehouseActivityDto {
  id: string;
  productId: string;
  productName: string;
  categoryName?: string;
  qtyDiff: number;
  reason: string;
  createdAt: string;
  actorName?: string;
  actorNim?: string;
  shiftInfo?: string;
  batchCode?: string;
  expiryDate?: string | null;
  notes?: string | null;
  formattedDate?: string;
  formattedTime?: string;
}

// =============================================================
// 1. Ringkasan Kesehatan Stok (Dashboard KPI Gudang)
// =============================================================
export async function getWarehouseSummary(): Promise<WarehouseSummaryDto> {
  const nowWib = new Date();
  const todayStr = getTodayWib(nowWib);
  const in7Days = getOffsetDateWib(7, nowWib);
  const lowStockThreshold = await getLowStockThreshold();

  // 1. Total SKU aktif & stok + batch FEFO (<= 7 hari / expired) + alert FEFO terbuka + restock hari ini secara paralel
  const [activeProducts, expiringBatches, [openAlertStats], [todayAdjustmentStats]] = await Promise.all([
    db
      .select({
        id: products.id,
        stockQty: products.stockQty,
        isPerishable: products.isPerishable,
      })
      .from(products)
      .where(and(eq(products.isActive, true), isNull(products.deletedAt))),
    db
      .select({
        productId: stockBatches.productId,
      })
      .from(stockBatches)
      .innerJoin(products, eq(stockBatches.productId, products.id))
      .where(
        and(
          eq(products.isActive, true),
          isNull(products.deletedAt),
          isNotNull(stockBatches.expiryDate),
          gt(stockBatches.currentQty, 0),
          lte(stockBatches.expiryDate, in7Days),
        ),
      ),
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*), 0)::int`,
      })
      .from(productConditionReports)
      .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
      .innerJoin(products, eq(stockBatches.productId, products.id))
      .where(
        and(
          eq(products.isActive, true),
          isNull(products.deletedAt),
          gt(stockBatches.currentQty, 0),
          notInArray(productConditionReports.status, ['EXECUTED', 'CLOSED']),
        ),
      ),
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*), 0)::int`,
      })
      .from(stockAdjustments)
      .where(
        and(
          or(
            ilike(stockAdjustments.reason, '%RESTOCK GUDANG%'),
            ilike(stockAdjustments.reason, '%PENERIMAAN ACC%'),
          ),
          sql`DATE(${stockAdjustments.createdAt} AT TIME ZONE 'Asia/Jakarta') = ${todayStr}::date`,
        ),
      ),
  ]);

  let outOfStockSku = 0;
  let lowStockSku = 0;
  let perishableSku = 0;

  for (const p of activeProducts) {
    // Murni produk yang ditandai is_perishable = true (bukan semua non-barcode)
    if (p.isPerishable) {
      perishableSku++;
    }
    if (p.stockQty <= 0) {
      outOfStockSku++;
    } else if (p.stockQty <= lowStockThreshold) {
      lowStockSku++;
    }
  }

  const uniqueExpiringProductIds = new Set(expiringBatches.map((b) => b.productId));
  const activeFefoAlertCount = openAlertStats?.count ?? 0;

  return {
    totalSku: activeProducts.length,
    outOfStockSku,
    lowStockSku,
    lowStockThreshold,
    expiringSoonSku: Math.max(uniqueExpiringProductIds.size, activeFefoAlertCount),
    activeFefoAlertCount,
    todayRestockCount: todayAdjustmentStats?.count ?? 0,
    perishableSku,
  };
}

export interface WarehouseApprovalNotificationItem {
  id: string;
  receiveNumber: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISED';
  deliveryNote: string | null;
  managerNote: string | null;
  isNewProductProposal: boolean;
  productSummary: string;
  updatedAt: string;
}

export interface WarehouseApprovalNotificationsDto {
  rejectedCount: number;
  revisedCount: number;
  pendingCount: number;
  approvedTodayCount: number;
  recentItems: WarehouseApprovalNotificationItem[];
}

export async function getWarehouseApprovalNotifications(
  employeeId?: string,
): Promise<WarehouseApprovalNotificationsDto> {
  const nowWib = new Date();
  const todayStr = getTodayWib(nowWib);
  const sevenDaysAgo = new Date(nowWib.getTime() - 7 * 24 * 60 * 60 * 1000);

  const baseConds: SQL[] = [isNull(stockReceiveDrafts.deletedAt)];
  if (employeeId) {
    baseConds.push(eq(stockReceiveDrafts.createdByEmployeeId, employeeId));
  }

  const recentDrafts = await db
    .select({
      id: stockReceiveDrafts.id,
      receiveNumber: stockReceiveDrafts.receiveNumber,
      status: stockReceiveDrafts.status,
      deliveryNote: stockReceiveDrafts.deliveryNote,
      managerNote: stockReceiveDrafts.managerNote,
      updatedAt: stockReceiveDrafts.updatedAt,
      approvedAt: stockReceiveDrafts.approvedAt,
    })
    .from(stockReceiveDrafts)
    .where(
      and(
        ...baseConds,
        inArray(stockReceiveDrafts.status, ['REJECTED', 'REVISED', 'APPROVED', 'SUBMITTED']),
        gte(stockReceiveDrafts.updatedAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(stockReceiveDrafts.updatedAt))
    .limit(20);

  const draftIds = recentDrafts.map((d) => d.id);
  const itemsByDraft = new Map<string, string[]>();
  if (draftIds.length > 0) {
    const itemRows = await db
      .select({
        draftId: stockReceiveItems.draftId,
        productName: products.name,
        qty: stockReceiveItems.qty,
      })
      .from(stockReceiveItems)
      .innerJoin(products, eq(stockReceiveItems.productId, products.id))
      .where(inArray(stockReceiveItems.draftId, draftIds));

    for (const row of itemRows) {
      const list = itemsByDraft.get(row.draftId) ?? [];
      list.push(`${row.productName} (+${row.qty})`);
      itemsByDraft.set(row.draftId, list);
    }
  }

  let rejectedCount = 0;
  let revisedCount = 0;
  let pendingCount = 0;
  let approvedTodayCount = 0;

  const recentItems: WarehouseApprovalNotificationItem[] = recentDrafts.map((d) => {
    if (d.status === 'REJECTED') rejectedCount++;
    else if (d.status === 'REVISED') revisedCount++;
    else if (d.status === 'SUBMITTED') pendingCount++;
    else if (d.status === 'APPROVED') {
      const approvedDay = d.approvedAt
        ? new Date(d.approvedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
        : '';
      if (approvedDay === todayStr) approvedTodayCount++;
    }

    const prods = itemsByDraft.get(d.id) ?? [];
    const productSummary =
      prods.length === 0
        ? d.deliveryNote || d.receiveNumber
        : prods.length <= 2
          ? prods.join(', ')
          : `${prods.slice(0, 2).join(', ')} +${prods.length - 2} lainnya`;

    return {
      id: d.id,
      receiveNumber: d.receiveNumber,
      status: d.status,
      deliveryNote: d.deliveryNote,
      managerNote: d.managerNote,
      isNewProductProposal: Boolean(d.deliveryNote?.startsWith('[USULAN PRODUK BARU]')),
      productSummary,
      updatedAt: d.updatedAt.toISOString(),
    };
  });

  return {
    rejectedCount,
    revisedCount,
    pendingCount,
    approvedTodayCount,
    recentItems: recentItems.slice(0, 12),
  };
}

export async function getActiveWarehouseCategories(): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
    .orderBy(asc(categories.name));
}

// =============================================================
// 2. Daftar Produk Gudang & Radar FEFO
// =============================================================
export async function getWarehouseProducts(options: {
  search?: string;
  filter?: 'semua' | 'kritis' | 'habis' | 'fefo' | 'perishable';
  limit?: number;
  offset?: number;
}): Promise<{ items: WarehouseProductDto[]; total: number; lowStockThreshold: number }> {
  const { search, filter = 'semua', limit = 100, offset = 0 } = options;

  const nowWib = new Date();
  const todayStr = getTodayWib(nowWib);
  const in7DaysStr = getOffsetDateWib(7, nowWib);
  const in30DaysStr = getOffsetDateWib(30, nowWib);
  const lowStockThreshold = await getLowStockThreshold();

  const conditions: SQL[] = [
    eq(products.isActive, true),
    isNull(products.deletedAt),
  ];

  // Search filter (nama / barcode)
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(products.name, q),
        eq(products.barcode, search.trim()),
        ilike(products.barcode, q),
      )!,
    );
  }

  // Filter kondisi stok
  if (filter === 'habis') {
    conditions.push(lte(products.stockQty, 0));
  } else if (filter === 'kritis') {
    conditions.push(
      gt(products.stockQty, 0),
      lte(products.stockQty, lowStockThreshold),
    );
  } else if (filter === 'perishable') {
    conditions.push(eq(products.isPerishable, true));
  } else if (filter === 'fefo') {
    // Dorong filter FEFO ke SQL agar tidak terpotong LIMIT/OFFSET produk abjad awal
    conditions.push(
      exists(
        db
          .select({ id: stockBatches.id })
          .from(stockBatches)
          .where(
            and(
              eq(stockBatches.productId, products.id),
              gt(stockBatches.currentQty, 0),
              isNotNull(stockBatches.expiryDate),
              lte(stockBatches.expiryDate, in30DaysStr),
            ),
          ),
      ),
    );
  }

  const rows = await db
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
    .where(and(...conditions))
    .orderBy(asc(products.name))
    .limit(limit)
    .offset(offset);

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
    } else if (r.stockQty <= lowStockThreshold) {
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

  // Urutkan filter FEFO dari yang paling cepat kedaluwarsa
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
    lowStockThreshold,
  };
}

// =============================================================
// 3. Inbound Restock Barang Datang (ACID Transaction)
// =============================================================
export async function restockProductByWarehouse(
  input: RestockInputDto,
): Promise<RestockResultDto> {
  const { productId, qtyAdd, expiryDate, batchCode, notes, employeeId } = input;
  const safeBonusQty = Math.max(0, Math.floor(input.bonusQty ?? 0));
  const totalAdded = qtyAdd + safeBonusQty;

  if (!Number.isInteger(qtyAdd) || qtyAdd <= 0) {
    throw new Error('Jumlah restock harus berupa bilangan bulat positif.');
  }

  // 1. Verifikasi Petugas (Gudang, Admin Shift, atau Manager aktif)
  let actorName = '';
  let actorNim = '';
  let callerAdminId: string | null = null;

  const emp = await db.query.employees.findFirst({
    where: and(
      eq(employees.id, employeeId),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: { id: true, fullName: true, nim: true, jabatan: true },
  });

  if (emp) {
    actorName = emp.fullName;
    actorNim = `NIM ${emp.nim}`;
  } else {
    const adm = await db.query.admins.findFirst({
      where: and(
        eq(admins.id, employeeId),
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
      ),
      columns: { id: true, fullName: true, nidn: true, role: true },
    });
    if (adm) {
      actorName = adm.fullName;
      actorNim = adm.nidn ? `ID ${adm.nidn} (${adm.role})` : adm.role;
      callerAdminId = adm.id;
    } else {
      throw new Error('Petugas tidak terdaftar atau tidak aktif.');
    }
  }

  // 2. Cari Admin Aktif untuk FK Audit Trail stockAdjustments
  const auditAdminId =
    callerAdminId ??
    (
      await db.query.admins.findFirst({
        where: and(
          eq(admins.isActive, true),
          isNull(admins.deletedAt),
          eq(admins.role, 'MANAGER'),
        ),
        columns: { id: true },
      })
    )?.id ??
    (
      await db.query.admins.findFirst({
        where: and(eq(admins.isActive, true), isNull(admins.deletedAt)),
        columns: { id: true },
      })
    )?.id;

  if (!auditAdminId) {
    throw new Error('Sistem audit admin tidak tersedia.');
  }

  const nowWib = new Date();
  const todayCompact = getTodayWib(nowWib).replace(/-/g, '');
  const wibShifted = new Date(nowWib.getTime() + 7 * 60 * 60 * 1000);
  const dayNames = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'] as const;
  const currentDay = dayNames[wibShifted.getUTCDay()];
  const hour = String(wibShifted.getUTCHours()).padStart(2, '0');
  const min = String(wibShifted.getUTCMinutes()).padStart(2, '0');
  const timeStr = `${hour}:${min}`;

  const autoBatchCode =
    batchCode?.trim() || `IN-${todayCompact}-${randomInt(1000, 10000)}`;
  const cleanExpiryDate = expiryDate?.trim() || null;
  const todayStrWib = getTodayWib(nowWib);
  if (!cleanExpiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanExpiryDate)) {
    throw new Error('Tanggal kedaluwarsa (Expired Date) wajib diisi untuk semua barang masuk (termasuk makanan harian).');
  }
  if (cleanExpiryDate < todayStrWib) {
    throw new Error(`Tanggal kedaluwarsa (${cleanExpiryDate}) sudah terlewat. Tidak dapat menerima barang kedaluwarsa.`);
  }
  const computedExpiryClass = deriveExpiryClass(cleanExpiryDate);

  let productName = '';
  let qtyBefore = 0;
  let qtyAfter = 0;
  let effectiveCostPrice = 0;
  let createdBatchId: string | undefined;
  let createdAdjId = '';

  // 3. Transaksi ACID: Lock Produk -> Update Stok -> Insert Batch -> Audit Log
  await db.transaction(async (tx) => {
    const [lockedProduct] = await tx
      .select({
        id: products.id,
        name: products.name,
        stockQty: products.stockQty,
        costPrice: products.costPrice,
        unit: products.unit,
        isActive: products.isActive,
        deletedAt: products.deletedAt,
      })
      .from(products)
      .where(eq(products.id, productId))
      .for('update')
      .limit(1);

    if (!lockedProduct || !lockedProduct.isActive || lockedProduct.deletedAt) {
      throw new Error('Produk tidak ditemukan, nonaktif, atau telah dihapus.');
    }

    productName = lockedProduct.name;
    qtyBefore = lockedProduct.stockQty;
    qtyAfter = qtyBefore + totalAdded;

    const baseUnitCost =
      input.unitCostPrice !== undefined && input.unitCostPrice >= 0
        ? input.unitCostPrice
        : Number(lockedProduct.costPrice ?? 0);
    effectiveCostPrice =
      safeBonusQty > 0 && totalAdded > 0
        ? Math.round((qtyAdd * baseUnitCost) / totalAdded)
        : baseUnitCost;

    // A. Update Master Stok Produk secara atomik pada baris terkunci
    await tx
      .update(products)
      .set({
        stockQty: sql`${products.stockQty} + ${totalAdded}`,
        updatedAt: nowWib,
      })
      .where(eq(products.id, productId));

    const bonusLabel =
      safeBonusQty > 0
        ? ` (${qtyAdd} beli + ${safeBonusQty} bonus gratis supplier; HPP efektif Rp ${effectiveCostPrice.toLocaleString('id-ID')})`
        : '';

    // B. Buat Stock Batch baru (FEFO/FIFO tracking)
    const [batchRecord] = await tx
      .insert(stockBatches)
      .values({
        productId,
        batchCode: autoBatchCode,
        costPrice: effectiveCostPrice.toString(),
        initialQty: totalAdded,
        currentQty: totalAdded,
        expiryDate: cleanExpiryDate,
        expiryClass: computedExpiryClass,
        receivedAt: nowWib,
        notes: notes
          ? `Diterima oleh ${actorName} (${actorNim})${bonusLabel}: ${notes}`
          : `Restock gudang oleh ${actorName} (${actorNim})${bonusLabel}`,
        createdAt: nowWib,
        updatedAt: nowWib,
      })
      .returning({ id: stockBatches.id });

    createdBatchId = batchRecord?.id;

    // C. Deteksi Sesi Shift aktif atau jadwal piket WIB saat restock
    let shiftLabel = '';
    try {
      const activeShift = await tx.query.shifts.findFirst({
        where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
        orderBy: [desc(shifts.clockIn)],
        with: {
          employee: {
            columns: { fullName: true, nim: true },
          },
        },
      });

      if (activeShift?.employee) {
        shiftLabel = `Shift Kasir Aktif: ${activeShift.employee.fullName} (NIM ${activeShift.employee.nim})`;
      } else {
        const sched = await tx.query.shiftSchedules.findFirst({
          where: and(
            eq(shiftSchedules.dayOfWeek, currentDay),
            eq(shiftSchedules.isActive, true),
            lte(shiftSchedules.slotStart, timeStr),
            gt(shiftSchedules.slotEnd, timeStr),
          ),
        });

        if (sched) {
          let assignedEmployeeName = '';
          if (sched.employeeId) {
            const empSched = await tx.query.employees.findFirst({
              where: eq(employees.id, sched.employeeId),
              columns: { fullName: true, nim: true },
            });
            if (empSched) {
              assignedEmployeeName = ` (${empSched.fullName})`;
            }
          }
          const koord = sched.coordinatorName ? ` • Koordinator: ${sched.coordinatorName}` : '';
          shiftLabel = `Jadwal ${currentDay} (${sched.slotStart}–${sched.slotEnd} WIB)${assignedEmployeeName}${koord}`;
        } else {
          shiftLabel = `Shift ${currentDay} (${timeStr} WIB)`;
        }
      }
    } catch (err) {
      console.warn('[warehouseService] Gagal mendeteksi shift:', err);
    }

    const shiftInfoText = shiftLabel ? ` • ${shiftLabel}` : '';

    // D. Insert ke Audit Log Stock Adjustments
    const expInfo = cleanExpiryDate ? ` Exp: ${cleanExpiryDate}` : '';
    const bonusInfo =
      safeBonusQty > 0
        ? ` [${qtyAdd} beli + ${safeBonusQty} bonus gratis; HPP efektif Rp ${effectiveCostPrice.toLocaleString('id-ID')}]`
        : '';
    const noteInfo = notes ? ` Catatan: ${notes}` : '';
    const reasonText = `[RESTOCK GUDANG${shiftInfoText} • Petugas: ${actorName} (${actorNim}) • ${timeStr} WIB] Masuk +${totalAdded} ${lockedProduct.unit}${bonusInfo} (Batch: ${autoBatchCode}${expInfo}).${noteInfo}`.trim();

    const [adjRecord] = await tx
      .insert(stockAdjustments)
      .values({
        productId,
        batchId: createdBatchId ?? null,
        qtyBefore,
        qtyAfter,
        qtyDiff: totalAdded,
        reason: reasonText,
        adjustedByAdminId: auditAdminId,
        createdAt: nowWib,
      })
      .returning({ id: stockAdjustments.id });

    createdAdjId = adjRecord.id;
  });

  return {
    productId,
    productName,
    qtyBefore,
    qtyAfter,
    qtyDiff: totalAdded,
    bonusQty: safeBonusQty,
    effectiveCostPrice,
    batchId: createdBatchId,
    adjustmentId: createdAdjId,
    restockedAt: nowWib.toISOString(),
  };
}

// =============================================================
// 4. Log Aktivitas Restock Gudang Terbaru
// =============================================================
export async function getWarehouseActivityLogs(limit = 50): Promise<WarehouseActivityDto[]> {
  const rows = await db
    .select({
      id: stockAdjustments.id,
      productId: stockAdjustments.productId,
      productName: products.name,
      categoryName: categories.name,
      qtyDiff: stockAdjustments.qtyDiff,
      reason: stockAdjustments.reason,
      createdAt: stockAdjustments.createdAt,
    })
    .from(stockAdjustments)
    .leftJoin(products, eq(stockAdjustments.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      or(
        ilike(stockAdjustments.reason, '%RESTOCK GUDANG%'),
        ilike(stockAdjustments.reason, '%PENERIMAAN ACC%'),
      ),
    )
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const dateObj = new Date(r.createdAt);

    const formattedDate = dateObj.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const formattedTime = `${dateObj.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    })} WIB`;

    const reasonStr = r.reason || '';

    let actorName: string | undefined;
    let actorNim: string | undefined;
    const actorMatch =
      reasonStr.match(/oleh\s+([^(]+)\s*\(([^)]+)\)/i) ||
      reasonStr.match(/Petugas:\s+([^(]+)\s*\(([^)]+)\)/i);
    if (actorMatch) {
      actorName = actorMatch[1].trim();
      actorNim = actorMatch[2].trim();
    }

    let shiftInfo: string | undefined;
    const shiftMatch = reasonStr.match(/(?:Shift[^\•\•\]]+|Jadwal[^\•\•\]]+)/i);
    if (shiftMatch) {
      shiftInfo = shiftMatch[0].trim();
    }

    let batchCode: string | undefined;
    const batchMatch = reasonStr.match(/Batch:\s*([A-Za-z0-9\-]+)/i);
    if (batchMatch) {
      batchCode = batchMatch[1].trim();
    }

    let expiryDate: string | undefined;
    const expMatch = reasonStr.match(/Exp:\s*([0-9\-]+)/i);
    if (expMatch) {
      expiryDate = expMatch[1].trim();
    }

    let notes: string | undefined;
    const noteMatch = reasonStr.match(/Catatan:\s*([^.]+)/i);
    if (noteMatch) {
      notes = noteMatch[1].trim();
    }

    return {
      id: r.id,
      productId: r.productId,
      productName: r.productName ?? 'Produk',
      categoryName: r.categoryName ?? 'Umum',
      qtyDiff: r.qtyDiff,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      actorName,
      actorNim,
      shiftInfo,
      batchCode,
      expiryDate,
      notes,
      formattedDate,
      formattedTime,
    };
  });
}
