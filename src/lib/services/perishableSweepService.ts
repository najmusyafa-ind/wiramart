// =============================================================
// Smartkasir Perwira — Perishable Daily Food Sweep Service (SSOT)
// Menjaga agar sisa Makanan Harian dari hari sebelumnya otomatis
// dibersihkan ke 0, TANPA menghapus stok yang secara resmi disimpan
// ke chiller untuk besok (expiryDate >= todayWib).
// =============================================================

import { and, eq, gt, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  products,
  stockAdjustments,
  stockBatches,
} from '@/lib/db/schema';
import { getStartOfTodayWib, getTodayWib } from '@/lib/utils/helpers';

export interface PerishableSweepCandidate {
  id: string;
  stockQty: number;
  unit: string;
  perishableType: string | null;
}

export interface ActiveBatchExpiryInfo {
  productId: string;
  currentQty: number;
  expiryDate: string | null;
}

/**
 * Menentukan apakah sebuah batch aktif masih berlaku untuk hari WIB ini
 * (termasuk stok yang baru masuk hari ini atau disimpan di chiller hingga hari ini/esok).
 */
export function isBatchProtectedForToday(
  expiryDate: string | null | undefined,
  todayWib: string,
): boolean {
  return Boolean(expiryDate && expiryDate >= todayWib);
}

/**
 * Pure selector (teruji unit test): menyaring kandidat makanan harian yang
 * boleh di-reset ke 0 (mengecualikan produk yang masih punya batch aktif valid >= todayWib).
 */
export function filterSweepablePerishableProducts<T extends PerishableSweepCandidate>(
  candidates: ReadonlyArray<T>,
  activeBatches: ReadonlyArray<ActiveBatchExpiryInfo>,
  todayWib: string,
): T[] {
  const protectedIds = new Set<string>();
  for (const batch of activeBatches) {
    if (batch.currentQty > 0 && isBatchProtectedForToday(batch.expiryDate, todayWib)) {
      protectedIds.add(batch.productId);
    }
  }
  return candidates.filter((item) => !protectedIds.has(item.id));
}

export interface SweepPerishableOptions {
  now?: Date;
  onlyUpdatedBeforeStartOfToday: boolean;
  reasonMode: 'AUTO_CRON_MIDNIGHT' | 'AUTO_RESET_HARIAN';
}

/**
 * Membersihkan stok Makanan Harian kedaluwarsa secara ACID + terkunci baris (.for('update')),
 * sambil menghormati stok chiller resmi (batch aktif dengan expiryDate >= todayWib).
 */
export async function sweepExpiredPerishableProducts(
  options: SweepPerishableOptions,
): Promise<number> {
  const now = options.now ?? new Date();
  const todayWib = getTodayWib(now);
  const startOfToday = getStartOfTodayWib(now);

  const conditions = [
    eq(products.isPerishable, true),
    eq(products.isActive, true),
    isNull(products.deletedAt),
    gt(products.stockQty, 0),
  ];
  if (options.onlyUpdatedBeforeStartOfToday) {
    conditions.push(lt(products.updatedAt, startOfToday));
  }

  const candidates = await db
    .select({
      id: products.id,
      stockQty: products.stockQty,
      unit: products.unit,
      perishableType: products.perishableType,
    })
    .from(products)
    .where(and(...conditions))
    .limit(500);

  if (candidates.length === 0) return 0;

  const candidateIds = candidates.map((c) => c.id);
  const validBatches = await db
    .select({
      productId: stockBatches.productId,
      currentQty: stockBatches.currentQty,
      expiryDate: stockBatches.expiryDate,
    })
    .from(stockBatches)
    .where(
      and(
        inArray(stockBatches.productId, candidateIds),
        gt(stockBatches.currentQty, 0),
        gte(stockBatches.expiryDate, todayWib),
      ),
    );

  const toSweep = filterSweepablePerishableProducts(candidates, validBatches, todayWib);
  if (toSweep.length === 0) return 0;

  const adminRow =
    (await db.query.admins.findFirst({
      where: and(
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
        eq(admins.role, 'MANAGER'),
      ),
      columns: { id: true },
    })) ??
    (await db.query.admins.findFirst({
      where: and(eq(admins.isActive, true), isNull(admins.deletedAt)),
      columns: { id: true },
    }));

  if (!adminRow?.id) return 0;

  let sweptCount = 0;

  await db.transaction(async (tx) => {
    for (const item of toSweep) {
      const [locked] = await tx
        .select({
          id: products.id,
          stockQty: products.stockQty,
          unit: products.unit,
          perishableType: products.perishableType,
        })
        .from(products)
        .where(
          and(
            eq(products.id, item.id),
            eq(products.isPerishable, true),
            eq(products.isActive, true),
            isNull(products.deletedAt),
            gt(products.stockQty, 0),
          ),
        )
        .limit(1)
        .for('update');

      if (!locked) continue;

      const [protectedBatch] = await tx
        .select({ id: stockBatches.id })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.productId, locked.id),
            gt(stockBatches.currentQty, 0),
            gte(stockBatches.expiryDate, todayWib),
          ),
        )
        .limit(1);

      if (protectedBatch) continue;

      const qtyBefore = locked.stockQty;
      const typeLabel = locked.perishableType || 'KONSINYASI';

      await tx
        .update(products)
        .set({ stockQty: 0, updatedAt: now })
        .where(eq(products.id, locked.id));

      await tx
        .update(stockBatches)
        .set({ currentQty: 0, updatedAt: now })
        .where(
          and(
            eq(stockBatches.productId, locked.id),
            gt(stockBatches.currentQty, 0),
          ),
        );

      const reason =
        options.reasonMode === 'AUTO_CRON_MIDNIGHT'
          ? `[AUTO-CRON-MIDNIGHT] Sapu otomatis sisa Makanan Harian (${typeLabel}). Sisa hari sebelumnya dibersihkan (${qtyBefore} ${locked.unit}).`
          : `[AUTO-RESET-HARIAN] Sisa Makanan Harian (${typeLabel}) dari hari sebelumnya di-reset otomatis saat pergantian hari (${qtyBefore} ${locked.unit}).`;

      await tx.insert(stockAdjustments).values({
        productId: locked.id,
        qtyBefore,
        qtyAfter: 0,
        qtyDiff: -qtyBefore,
        reason,
        adjustedByAdminId: adminRow.id,
        createdAt: now,
      });

      sweptCount += 1;
    }
  });

  return sweptCount;
}
