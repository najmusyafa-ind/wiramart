// =============================================================
// GET  /api/admin/produk — Daftar produk (dengan kategori)
// POST /api/admin/produk — Tambah produk baru
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { products, categories } from '@/lib/db/schema';
import { eq, and, isNull, or, ilike, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const categoryId = searchParams.get('categoryId') ?? '';
  const showAll = searchParams.get('showAll') === '1'; // include soft-deleted

  const rows = await db
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
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        showAll ? undefined : isNull(products.deletedAt),
        q ? or(ilike(products.name, `%${q}%`)) : undefined,
        categoryId ? eq(products.categoryId, categoryId) : undefined,
      ),
    )
    .orderBy(products.name)
    .limit(200);

  // Also return categories for filter dropdown
  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
    .orderBy(categories.name);

  return apiOk({ products: rows, categories: cats });
}

const CreateProductSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().positive(),
  stockQty: z.number().int().nonnegative().default(0),
  unit: z.string().max(20).default('pcs'),
});

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = CreateProductSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.flatten().fieldErrors, 422);

  const { categoryId, name, description, costPrice, sellingPrice, stockQty, unit } = parsed.data;

  // Cek kategori valid
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .limit(1);

  if (!cat) return apiError('Kategori tidak valid', 400);

  const [created] = await db
    .insert(products)
    .values({
      categoryId,
      name: name.trim(),
      description: description?.trim(),
      costPrice: costPrice.toString(),
      sellingPrice: sellingPrice.toString(),
      stockQty,
      unit,
      createdByAdminId: payload.sub as string,
    })
    .returning();

  return apiOk(created, 201);
}
