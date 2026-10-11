// =============================================================
// GET /api/kasir/produk — Daftar produk untuk tampilan POS kasir
// SECURITY: cost_price TIDAK dikirim — hanya harga jual + stok
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { products, categories } from '@/lib/db/schema';
import { eq, and, isNull, ilike, or, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';
  const nonBarcode = searchParams.get('nonBarcode') === '1' || searchParams.get('nonBarcode') === 'true';

  const rows = await db
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
        categoryId ? eq(products.categoryId, categoryId) : undefined,
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
    .limit(150);

  // Ambil kategori untuk filter tabs
  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
    .orderBy(categories.name);

  return apiOk({ products: rows, categories: cats });
}
