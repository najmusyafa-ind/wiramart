// =============================================================
// src/lib/services/stockMutationReportService.ts
// Service Layer: Laporan Rekonsiliasi Mutasi Stok Terintegrasi (Fase 5)
// Wiramart v3.0: Sistem Manajemen Terintegrasi
// STANDAR: NASA-Grade Decoupling, Vectorized Aggregation, Zero Defect
// =============================================================

import { eq, and, gte, lt, sql, ilike, isNull, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  products,
  categories,
  stockBatches,
  stockReceiveDrafts,
  stockReceiveItems,
  transactions,
  transactionItems,
  productConditionReports,
} from '@/lib/db/schema';
import { getWibDate } from '@/lib/services/managerDutyService';

export type ProductMutationRow = {
  productId: string;
  productName: string;
  categoryName: string;
  unit: string;
  initialStock: number;
  qtyIn: number;
  totalHppIn: number;
  qtyOut: number;
  totalGrossOut: number;
  discountedQtyOut: number;
  qtyDestroyed: number;
  lossAmountDestroyed: number;
  qtyReturned: number;
  finalStock: number;
};

export type StockMutationReportResult = {
  period: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalProducts: number;
    totalInitialStock: number;
    totalQtyIn: number;
    totalHppIn: number;
    totalQtyOut: number;
    totalGrossOut: number;
    totalDiscountedQtyOut: number;
    totalDestroyedQty: number;
    totalLossAmount: number;
    totalReturnedQty: number;
    totalFinalStock: number;
  };
  items: ProductMutationRow[];
};

export type StockMutationReportFilter = {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  search?: string;
};

export class StockMutationReportService {
  static async getReport(filter: StockMutationReportFilter = {}): Promise<StockMutationReportResult> {
    const today = getWibDate();
    const startDate = filter.startDate || today;
    const endDate = filter.endDate || today;

    // Zona waktu Asia/Jakarta (WIB = UTC+7)
    const start = new Date(`${startDate}T00:00:00+07:00`);
    const nextEndDate = new Date(new Date(`${endDate}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000);
    const nextDateStr = nextEndDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const endExclusive = new Date(`${nextDateStr}T00:00:00+07:00`);

    // 1. Ambil daftar produk aktif
    const productWhere = [isNull(products.deletedAt)];
    if (filter.categoryId) {
      productWhere.push(eq(products.categoryId, filter.categoryId));
    }
    if (filter.search && filter.search.trim()) {
      productWhere.push(ilike(products.name, `%${filter.search.trim()}%`));
    }

    const productList = await db
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        categoryId: products.categoryId,
        categoryName: categories.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(...productWhere))
      .orderBy(products.name);

    if (productList.length === 0) {
      return {
        period: { startDate, endDate },
        summary: {
          totalProducts: 0,
          totalInitialStock: 0,
          totalQtyIn: 0,
          totalHppIn: 0,
          totalQtyOut: 0,
          totalGrossOut: 0,
          totalDiscountedQtyOut: 0,
          totalDestroyedQty: 0,
          totalLossAmount: 0,
          totalReturnedQty: 0,
          totalFinalStock: 0,
        },
        items: [],
      };
    }

    // 2. Agregasi Stok Masuk dari Penerimaan Supplier yang APPROVED
    const incomingData = await db
      .select({
        productId: stockReceiveItems.productId,
        qtyIn: sql<string>`COALESCE(SUM(${stockReceiveItems.qty}), 0)`,
        totalHppIn: sql<string>`COALESCE(SUM(${stockReceiveItems.qty} * CAST(${stockReceiveItems.costPrice} AS NUMERIC)), 0)`,
      })
      .from(stockReceiveItems)
      .innerJoin(stockReceiveDrafts, eq(stockReceiveItems.draftId, stockReceiveDrafts.id))
      .where(
        and(
          eq(stockReceiveDrafts.status, 'APPROVED'),
          gte(stockReceiveDrafts.approvedAt, start),
          lt(stockReceiveDrafts.approvedAt, endExclusive),
        ),
      )
      .groupBy(stockReceiveItems.productId);

    const incomingMap = new Map<string, { qtyIn: number; totalHppIn: number }>();
    for (const row of incomingData) {
      incomingMap.set(row.productId, {
        qtyIn: Number(row.qtyIn) || 0,
        totalHppIn: Math.round(Number(row.totalHppIn) || 0),
      });
    }

    // 3. Agregasi Stok Keluar dari Transaksi Kasir yang COMPLETED
    const outgoingData = await db
      .select({
        productId: transactionItems.productId,
        qtyOut: sql<string>`COALESCE(SUM(${transactionItems.qty}), 0)`,
        totalGrossOut: sql<string>`COALESCE(SUM(CAST(${transactionItems.subtotalSell} AS NUMERIC)), 0)`,
        discountedQtyOut: sql<string>`COALESCE(SUM(CASE WHEN ${transactionItems.discountPolicyId} IS NOT NULL THEN ${transactionItems.qty} ELSE 0 END), 0)`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.isTest, false),
          gte(transactions.createdAt, start),
          lt(transactions.createdAt, endExclusive),
        ),
      )
      .groupBy(transactionItems.productId);

    const outgoingMap = new Map<
      string,
      { qtyOut: number; totalGrossOut: number; discountedQtyOut: number }
    >();
    for (const row of outgoingData) {
      outgoingMap.set(row.productId, {
        qtyOut: Number(row.qtyOut) || 0,
        totalGrossOut: Math.round(Number(row.totalGrossOut) || 0),
        discountedQtyOut: Number(row.discountedQtyOut) || 0,
      });
    }

    // 4. Agregasi FEFO Tindakan: Write-off (Pemusnahan) & Retur Supplier
    const fefoData = await db
      .select({
        productId: productConditionReports.productId,
        decision: productConditionReports.managerDecision,
        qty: sql<string>`COALESCE(SUM(${productConditionReports.qtyAtAlert}), 0)`,
        lossAmount: sql<string>`COALESCE(SUM(${productConditionReports.qtyAtAlert} * CAST(${stockBatches.costPrice} AS NUMERIC)), 0)`,
      })
      .from(productConditionReports)
      .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
      .where(
        and(
          gte(productConditionReports.decidedAt, start),
          lt(productConditionReports.decidedAt, endExclusive),
        ),
      )
      .groupBy(productConditionReports.productId, productConditionReports.managerDecision);

    const fefoMap = new Map<
      string,
      { qtyDestroyed: number; lossAmountDestroyed: number; qtyReturned: number }
    >();
    for (const row of fefoData) {
      const existing = fefoMap.get(row.productId) || {
        qtyDestroyed: 0,
        lossAmountDestroyed: 0,
        qtyReturned: 0,
      };
      if (row.decision === 'DESTROY') {
        existing.qtyDestroyed += Number(row.qty) || 0;
        existing.lossAmountDestroyed += Math.round(Number(row.lossAmount) || 0);
      } else if (row.decision === 'RETURN_SUPPLIER') {
        existing.qtyReturned += Number(row.qty) || 0;
      }
      fefoMap.set(row.productId, existing);
    }

    // 5. Agregasi Stok Fisik Terkini (Current Stock dari stock_batches)
    const currentStockData = await db
      .select({
        productId: stockBatches.productId,
        currentStock: sql<string>`COALESCE(SUM(${stockBatches.currentQty}), 0)`,
      })
      .from(stockBatches)
      .groupBy(stockBatches.productId);

    const currentStockMap = new Map<string, number>();
    for (const row of currentStockData) {
      currentStockMap.set(row.productId, Number(row.currentStock) || 0);
    }

    // 6. Susun Rincian Per Produk & Hitung Stok Awal
    const items: ProductMutationRow[] = [];

    let totalInitialStock = 0;
    let totalQtyIn = 0;
    let totalHppIn = 0;
    let totalQtyOut = 0;
    let totalGrossOut = 0;
    let totalDiscountedQtyOut = 0;
    let totalDestroyedQty = 0;
    let totalLossAmount = 0;
    let totalReturnedQty = 0;
    let totalFinalStock = 0;

    for (const p of productList) {
      const inInfo = incomingMap.get(p.id) || { qtyIn: 0, totalHppIn: 0 };
      const outInfo = outgoingMap.get(p.id) || { qtyOut: 0, totalGrossOut: 0, discountedQtyOut: 0 };
      const fefoInfo = fefoMap.get(p.id) || {
        qtyDestroyed: 0,
        lossAmountDestroyed: 0,
        qtyReturned: 0,
      };
      const finalStock = currentStockMap.get(p.id) || 0;

      // Formula Rekonsiliasi: Stok Awal = Stok Akhir - Masuk + Keluar + Musnah + Retur
      const initialStock = Math.max(
        0,
        finalStock - inInfo.qtyIn + outInfo.qtyOut + fefoInfo.qtyDestroyed + fefoInfo.qtyReturned,
      );

      items.push({
        productId: p.id,
        productName: p.name,
        categoryName: p.categoryName || 'Umum',
        unit: p.unit || 'pcs',
        initialStock,
        qtyIn: inInfo.qtyIn,
        totalHppIn: inInfo.totalHppIn,
        qtyOut: outInfo.qtyOut,
        totalGrossOut: outInfo.totalGrossOut,
        discountedQtyOut: outInfo.discountedQtyOut,
        qtyDestroyed: fefoInfo.qtyDestroyed,
        lossAmountDestroyed: fefoInfo.lossAmountDestroyed,
        qtyReturned: fefoInfo.qtyReturned,
        finalStock,
      });

      totalInitialStock += initialStock;
      totalQtyIn += inInfo.qtyIn;
      totalHppIn += inInfo.totalHppIn;
      totalQtyOut += outInfo.qtyOut;
      totalGrossOut += outInfo.totalGrossOut;
      totalDiscountedQtyOut += outInfo.discountedQtyOut;
      totalDestroyedQty += fefoInfo.qtyDestroyed;
      totalLossAmount += fefoInfo.lossAmountDestroyed;
      totalReturnedQty += fefoInfo.qtyReturned;
      totalFinalStock += finalStock;
    }

    return {
      period: {
        startDate,
        endDate,
      },
      summary: {
        totalProducts: items.length,
        totalInitialStock,
        totalQtyIn,
        totalHppIn,
        totalQtyOut,
        totalGrossOut,
        totalDiscountedQtyOut,
        totalDestroyedQty,
        totalLossAmount,
        totalReturnedQty,
        totalFinalStock,
      },
      items,
    };
  }
}
