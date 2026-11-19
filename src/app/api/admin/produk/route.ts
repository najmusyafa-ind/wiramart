// =============================================================
// GET  /api/admin/produk — Daftar produk (dengan kategori)
// POST /api/admin/produk — Tambah produk baru (admin + kasir aktif)
// =============================================================

import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  products,
  categories,
  employees,
  admins,
  stockBatches,
  stockAdjustments,
} from '@/lib/db/schema';
import { eq, and, isNull, or, ilike, gt, lt, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getTodayWib, getStartOfTodayWib } from '@/lib/utils/helpers';
import { getLowStockThreshold } from '@/lib/services/operationalSettingsService';

let lastAdminLazySweepDateWib = '';
let lastAdminLazySweepEpoch = 0;
const ADMIN_LAZY_SWEEP_TTL_MS = 5 * 60 * 1_000;

async function sweepYesterdayPerishableInAdmin(): Promise<void> {
  const now = new Date();
  const todayWib = getTodayWib(now);
  const nowEpoch = now.getTime();
  if (
    lastAdminLazySweepDateWib === todayWib &&
    nowEpoch - lastAdminLazySweepEpoch < ADMIN_LAZY_SWEEP_TTL_MS
  ) {
    return;
  }
  lastAdminLazySweepDateWib = todayWib;
  lastAdminLazySweepEpoch = nowEpoch;

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
    // Non-blocking
  }
}

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  // GET: admin ATAU kasir aktif boleh lihat daftar produk
  if (!payload) return apiError('Unauthorized', 401);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';
  const showAll = searchParams.get('showAll') === '1'; // include soft-deleted

  const lowStockThreshold = await getLowStockThreshold();
  await sweepYesterdayPerishableInAdmin();

  const [rows, cats, [summaryRow]] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
        stockQty: products.stockQty,
        unit: products.unit,
        photoUrl: products.photoUrl,
        isActive: products.isActive,
        isPerishable: products.isPerishable,
        perishableType: products.perishableType,
        deletedAt: products.deletedAt,
        createdAt: products.createdAt,
        categoryId: products.categoryId,
        categoryName: categories.name,
        barcode: products.barcode,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(
        and(
          showAll ? undefined : isNull(products.deletedAt),
          q
            ? or(
                ilike(products.name, `%${q}%`),
                ilike(categories.name, `%${q}%`),
                ilike(products.barcode, `%${q}%`),
              )
            : undefined,
          categoryId ? eq(products.categoryId, categoryId) : undefined,
        ),
      )
      .orderBy(products.name)
      .limit(200),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
      .orderBy(categories.name),
    // Hitung metrik stok rendah & habis di server pada seluruh produk aktif
    db
      .select({
        totalActiveProducts: sql<number>`COUNT(*)::int`,
        outOfStockCount: sql<number>`COUNT(*) FILTER (WHERE ${products.stockQty} = 0)::int`,
        lowStockCount: sql<number>`COUNT(*) FILTER (WHERE ${products.stockQty} > 0 AND ${products.stockQty} <= ${lowStockThreshold})::int`,
      })
      .from(products)
      .where(and(eq(products.isActive, true), isNull(products.deletedAt))),
  ]);

  return apiOk({
    products: rows,
    categories: cats,
    lowStockThreshold,
    summary: {
      totalActiveProducts: summaryRow?.totalActiveProducts ?? 0,
      lowStockCount: summaryRow?.lowStockCount ?? 0,
      outOfStockCount: summaryRow?.outOfStockCount ?? 0,
    },
  });
}

const CreateProductSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  barcode: z.string().max(100).nullable().optional(),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().positive(),
  stockQty: z.number().int().nonnegative().default(0),
  unit: z.string().max(20).default('pcs'),
  isPerishable: z.boolean().optional().default(false),
  perishableType: z.enum(['KONSINYASI', 'BELI_LEPAS']).optional().default('KONSINYASI'),
});

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  // POST: admin ATAU kasir aktif boleh tambah produk baru
  if (!payload) return apiError('Unauthorized', 401);

  // ── Resolusi createdByAdminId (FK ke tabel admins) & nama pelaku ────────
  let resolvedAdminId: string;
  let actorLabel: string;
  if (payload.role === 'admin') {
    const [adm] = await db
      .select({ id: admins.id, fullName: admins.fullName, nidn: admins.nidn, role: admins.role })
      .from(admins)
      .where(eq(admins.id, payload.sub))
      .limit(1);
    resolvedAdminId = adm?.id ?? payload.sub;
    const displayName = adm?.fullName || adm?.nidn || payload.username;
    actorLabel = `${displayName} (${adm?.role ?? payload.adminRole ?? 'ADMIN'})`;
  } else {
    // Kasir (employee): ambil createdByAdminId & nama kasir dari data employee
    const [emp] = await db
      .select({
        fullName: employees.fullName,
        createdByAdminId: employees.createdByAdminId,
      })
      .from(employees)
      .where(eq(employees.id, payload.sub))
      .limit(1);

    actorLabel = emp?.fullName ? `${emp.fullName} (Kasir)` : 'Kasir';

    if (emp?.createdByAdminId) {
      resolvedAdminId = emp.createdByAdminId;
    } else {
      // Fallback: pakai admin pertama yang terdaftar di sistem
      const [firstAdmin] = await db
        .select({ id: admins.id })
        .from(admins)
        .limit(1);
      if (!firstAdmin) return apiError('Tidak ada admin terdaftar di sistem', 500);
      resolvedAdminId = firstAdmin.id;
    }
  }

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = CreateProductSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.flatten().fieldErrors, 422);

  const {
    categoryId,
    name,
    description,
    barcode,
    costPrice,
    sellingPrice,
    stockQty,
    unit,
    isPerishable,
    perishableType,
  } = parsed.data;

  // Cek kategori valid
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .limit(1);

  if (!cat) return apiError('Kategori tidak valid', 400);

  // Guard Anti-Duplikat Case-Insensitive (mencegah "ayam geprek" vs "Ayam Geprek")
  const normalizedName = name.trim().toLowerCase();
  const [dupName] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(
        isNull(products.deletedAt),
        sql`LOWER(TRIM(${products.name})) = ${normalizedName}`,
      ),
    )
    .limit(1);

  if (dupName) {
    return apiError(
      `Produk dengan nama "${dupName.name}" sudah terdaftar di katalog (pencocokan tidak membedakan huruf besar/kecil). Gunakan nama varian yang spesifik, misal tambahkan rasa/ukuran.`,
      409,
    );
  }

  let created: (typeof products.$inferSelect) | undefined;
  try {
    created = await db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(products)
        .values({
          categoryId,
          name: name.trim(),
          description: description?.trim(),
          barcode: barcode?.trim() || undefined,
          costPrice: costPrice.toString(),
          sellingPrice: sellingPrice.toString(),
          stockQty,
          unit,
          isPerishable,
          perishableType,
          createdByAdminId: resolvedAdminId,
        })
        .returning();

      // Jika produk baru langsung memiliki stok awal > 0, buat batch INIT- & catat histori awal
      if (stockQty > 0) {
        const todayStr = getTodayWib(now);
        const batchCode = `INIT-${todayStr.replace(/-/g, '')}-${randomInt(1000, 10000)}`;
        const [initBatch] = await tx
          .insert(stockBatches)
          .values({
            productId: row.id,
            batchCode,
            costPrice: costPrice.toString(),
            initialQty: stockQty,
            currentQty: stockQty,
            expiryDate: isPerishable ? todayStr : undefined,
            expiryClass: isPerishable ? 'HARIAN' : 'PANJANG',
            notes: `Stok awal produk baru oleh ${actorLabel}`,
          })
          .returning({ id: stockBatches.id });

        await tx.insert(stockAdjustments).values({
          productId: row.id,
          batchId: initBatch?.id ?? null,
          qtyBefore: 0,
          qtyAfter: stockQty,
          qtyDiff: stockQty,
          reason: `Stok awal saat tambah produk oleh ${actorLabel}`,
          adjustedByAdminId: resolvedAdminId,
          createdAt: now,
        });
      }

      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return apiError('Barcode sudah dipakai produk lain. Gunakan barcode berbeda atau kosongkan field barcode.', 409);
    }
    console.error('[POST /api/admin/produk] DB error:', err);
    return apiError('Gagal menyimpan produk ke database.', 500);
  }

  return apiOk(created, 201);
}

// Helper: deteksi PostgreSQL unique constraint violation (termasuk yang dibungkus Drizzle)
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && (err as { code: unknown }).code === '23505') return true;
  if (
    'cause' in err &&
    typeof (err as { cause: unknown }).cause === 'object' &&
    (err as { cause: unknown }).cause !== null &&
    'code' in ((err as { cause: { code?: unknown } }).cause)
  ) {
    return (err as { cause: { code: unknown } }).cause.code === '23505';
  }
  return false;
}
