// =============================================================
// GET /api/kasir/produk — Daftar produk untuk tampilan POS kasir
// SECURITY: cost_price TIDAK dikirim — hanya harga jual + stok
// Auth: employee JWT required (+ live active check)
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  products,
  categories,
  employees,
  admins,
  stockBatches,
  stockAdjustments,
} from '@/lib/db/schema';
import { eq, and, isNull, ilike, or, gt, lt, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getTodayWib, getStartOfTodayWib } from '@/lib/utils/helpers';
import { getLowStockThreshold } from '@/lib/services/operationalSettingsService';

const uuidSchema = z.string().uuid();

// Throttle in-memory agar pengecekan Lazy Sweep Makanan Harian ringan (maks 1x per 5 menit)
let lastLazySweepDateWib = '';
let lastLazySweepEpoch = 0;
const LAZY_SWEEP_TTL_MS = 5 * 60 * 1_000;

async function sweepYesterdayPerishableFoodIfNeeded(): Promise<void> {
  const now = new Date();
  const todayWib = getTodayWib(now);
  const nowEpoch = now.getTime();

  if (lastLazySweepDateWib === todayWib && nowEpoch - lastLazySweepEpoch < LAZY_SWEEP_TTL_MS) {
    return;
  }

  lastLazySweepDateWib = todayWib;
  lastLazySweepEpoch = nowEpoch;

  try {
    const startOfToday = getStartOfTodayWib(now);
    const staleItems = await db
      .select({
        id: products.id,
        stockQty: products.stockQty,
        unit: products.unit,
        perishableType: products.perishableType,
      })
      .from(products)
      .where(
        and(
          eq(products.isPerishable, true),
          eq(products.isActive, true),
          isNull(products.deletedAt),
          gt(products.stockQty, 0),
          lt(products.updatedAt, startOfToday),
        ),
      );

    if (staleItems.length === 0) return;

    const adminRow = await db.query.admins.findFirst({
      where: eq(admins.isActive, true),
      columns: { id: true },
    });
    if (!adminRow?.id) return;

    await db.transaction(async (tx) => {
      for (const item of staleItems) {
        const qtyBefore = item.stockQty;
        await tx
          .update(products)
          .set({ stockQty: 0, updatedAt: now })
          .where(eq(products.id, item.id));

        await tx
          .update(stockBatches)
          .set({ currentQty: 0, updatedAt: now })
          .where(and(eq(stockBatches.productId, item.id), gt(stockBatches.currentQty, 0)));

        await tx.insert(stockAdjustments).values({
          productId: item.id,
          qtyBefore,
          qtyAfter: 0,
          qtyDiff: -qtyBefore,
          reason: `[AUTO-RESET-HARIAN] Sisa Makanan Harian (${item.perishableType || 'KONSINYASI'}) dari hari sebelumnya di-reset otomatis saat pergantian hari (${qtyBefore} ${item.unit}).`,
          adjustedByAdminId: adminRow.id,
          createdAt: now,
        });
      }
    });
  } catch {
    // Non-blocking: kegagalan sweep tidak menghentikan pemuatan daftar produk POS
  }
}

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const activeEmployee = await db.query.employees.findFirst({
    where: and(
      eq(employees.id, payload.sub),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: { id: true },
  });
  if (!activeEmployee) {
    return apiError('Akun karyawan tidak aktif atau telah dinonaktifkan', 403);
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const rawCategoryId = searchParams.get('categoryId')?.trim() ?? '';
  let validCategoryId = '';
  if (rawCategoryId) {
    const parsedCat = uuidSchema.safeParse(rawCategoryId);
    if (!parsedCat.success) {
      return apiError('Parameter categoryId tidak valid', 400);
    }
    validCategoryId = parsedCat.data;
  }
  const nonBarcode = searchParams.get('nonBarcode') === '1' || searchParams.get('nonBarcode') === 'true';

  // Pastikan sisa Makanan Harian dari hari sebelumnya otomatis di-reset ke 0 sebelum dikirim ke POS
  await sweepYesterdayPerishableFoodIfNeeded();

  const [rows, cats, lowStockThreshold] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        barcode: products.barcode,
        // SECURITY: costPrice TIDAK di-select — employee tidak boleh tahu HPP
        sellingPrice: products.sellingPrice,
        stockQty: products.stockQty,
        unit: products.unit,
        photoUrl: products.photoUrl,
        categoryId: products.categoryId,
        categoryName: categories.name,
        isPerishable: products.isPerishable,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(
        and(
          eq(products.isActive, true),
          isNull(products.deletedAt),
          // Produk stok 0 TETAP ditampilkan (ditandai "Habis" di UI) agar kasir
          // tidak mengira produk belum terdaftar. Penjualan tetap dijaga di POST transaksi.
          q
            ? or(
                ilike(products.name, `%${q}%`),
                ilike(categories.name, `%${q}%`),
                ilike(products.barcode, `%${q}%`),
              )
            : undefined,
          validCategoryId ? eq(products.categoryId, validCategoryId) : undefined,
          nonBarcode
            ? or(
                isNull(products.barcode),
                sql`LENGTH(TRIM(${products.barcode})) = 0`,
                sql`${products.barcode} = ${products.name}`,
                eq(products.isPerishable, true),
                sql`LOWER(${categories.name}) = 'makanan'`,
              )
            : undefined,
        ),
      )
      .orderBy(products.name)
      .limit(150),
    // Ambil kategori untuk filter tabs
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
      .orderBy(categories.name),
    getLowStockThreshold(),
  ]);

  return apiOk({ products: rows, categories: cats, lowStockThreshold });
}
