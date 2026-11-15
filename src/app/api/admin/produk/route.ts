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
import { eq, and, isNull, or, ilike, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getTodayWib } from '@/lib/utils/helpers';
import { getLowStockThreshold } from '@/lib/services/operationalSettingsService';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  // GET: admin ATAU kasir aktif boleh lihat daftar produk
  if (!payload) return apiError('Unauthorized', 401);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';
  const showAll = searchParams.get('showAll') === '1'; // include soft-deleted

  const lowStockThreshold = await getLowStockThreshold();

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

  const { categoryId, name, description, barcode, costPrice, sellingPrice, stockQty, unit } = parsed.data;

  // Cek kategori valid
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .limit(1);

  if (!cat) return apiError('Kategori tidak valid', 400);

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
          createdByAdminId: resolvedAdminId,
        })
        .returning();

      // Jika produk baru langsung memiliki stok awal > 0, buat batch INIT- & catat histori awal
      if (stockQty > 0) {
        const batchCode = `INIT-${getTodayWib(now).replace(/-/g, '')}-${randomInt(1000, 10000)}`;
        const [initBatch] = await tx
          .insert(stockBatches)
          .values({
            productId: row.id,
            batchCode,
            costPrice: costPrice.toString(),
            initialQty: stockQty,
            currentQty: stockQty,
            expiryClass: 'PANJANG',
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
