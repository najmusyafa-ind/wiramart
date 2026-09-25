// =============================================================
// GET /api/kasir/produk — Daftar produk untuk tampilan POS kasir
// SECURITY: cost_price TIDAK dikirim — hanya harga jual + stok
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { products, categories } from '@/lib/db/schema';
import { eq, and, isNull, gt, ilike, or } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      // SECURITY: costPrice TIDAK di-select — employee tidak boleh tahu HPP
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
      unit: products.unit,
      photoUrl: products.photoUrl,
      categoryId: products.categoryId,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        isNull(products.deletedAt),
        gt(products.stockQty, 0), // hanya tampilkan yang ada stok
        q
          ? or(
              ilike(products.name, `%${q}%`),
              ilike(categories.name, `%${q}%`),
            )
          : undefined,
        categoryId ? eq(products.categoryId, categoryId) : undefined,
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
