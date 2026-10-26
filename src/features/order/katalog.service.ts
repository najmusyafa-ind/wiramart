// =============================================================
// Wiramart v2.0 — Katalog Service (Buyer-facing)
// Mengambil daftar produk aktif untuk PWA buyer.
// SECURITY: Tidak pernah expose cost_price (HPP) ke buyer.
// =============================================================

import { and, eq, gt, isNull, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, categories } from '@/lib/db/schema';

// ── Types ─────────────────────────────────────────────────────

/** Produk yang aman untuk ditampilkan ke buyer PWA — NO cost_price */
export type KatalogItem = {
  id: string;
  name: string;
  description: string | null;
  sellingPrice: number;       // IDR, diformat di frontend
  stockQty: number;
  unit: string;
  photoUrl: string | null;
  isAvailable: boolean;       // stockQty > 0 && isActive
  categoryId: string;
  categoryName: string;
};

// ── Repository (inline — katalog sederhana, tidak perlu file terpisah) ──

/**
 * Ambil semua produk aktif dengan nama kategori.
 * Dipakai oleh GET /api/order/katalog
 * Cache: 30 detik di level API route (Next.js revalidate)
 *
 * SECURITY:
 * - costPrice TIDAK pernah di-select
 * - isPerishable TIDAK pernah di-expose (informasi kompetitif)
 * - Hanya produk isActive=true yang tampil
 */
export async function getKatalog(): Promise<{
  items: KatalogItem[];
  lastUpdated: string;
}> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
      unit: products.unit,
      photoUrl: products.photoUrl,
      isActive: products.isActive,
      categoryId: categories.id,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        isNull(products.deletedAt),
        eq(categories.isActive, true),
        isNull(categories.deletedAt),
      ),
    )
    .orderBy(categories.name, products.name);

  const items: KatalogItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sellingPrice: Number(row.sellingPrice), // Drizzle returns decimal as string
    stockQty: row.stockQty,
    unit: row.unit,
    photoUrl: row.photoUrl,
    isAvailable: row.isActive && row.stockQty > 0,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
  }));

  return {
    items,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Validasi stok produk sebelum order dibuat.
 * Dipakai oleh order.service.ts sebelum INSERT.
 * Return false jika ada produk yang stoknya tidak mencukupi.
 */
export async function validateStockForOrder(
  items: Array<{ productId: string; quantity: number }>,
): Promise<{
  valid: boolean;
  failedItems: Array<{ productId: string; name: string; requested: number; available: number }>;
}> {
  const productIds = items.map((i) => i.productId);

  if (productIds.length === 0) {
    return { valid: true, failedItems: [] };
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      stockQty: products.stockQty,
      isActive: products.isActive,
    })
    .from(products)
    .where(and(inArray(products.id, productIds), isNull(products.deletedAt)));

  const productMap = new Map(rows.map((r) => [r.id, r]));

  const failedItems: Array<{
    productId: string;
    name: string;
    requested: number;
    available: number;
  }> = [];

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || !product.isActive) {
      failedItems.push({
        productId: item.productId,
        name: product?.name ?? 'Produk tidak ditemukan',
        requested: item.quantity,
        available: 0,
      });
      continue;
    }
    if (product.stockQty < item.quantity) {
      failedItems.push({
        productId: item.productId,
        name: product.name,
        requested: item.quantity,
        available: product.stockQty,
      });
    }
  }

  return { valid: failedItems.length === 0, failedItems };
}
