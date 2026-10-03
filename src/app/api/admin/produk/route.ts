// =============================================================
// GET  /api/admin/produk — Daftar produk (dengan kategori)
// POST /api/admin/produk — Tambah produk baru (admin + kasir aktif)
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { products, categories, employees, admins } from '@/lib/db/schema';
import { eq, and, isNull, or, ilike } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  // GET: admin ATAU kasir aktif boleh lihat daftar produk
  if (!payload) return apiError('Unauthorized', 401);

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
      barcode: products.barcode,
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
  barcode: z.string().max(100).optional(),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().positive(),
  stockQty: z.number().int().nonnegative().default(0),
  unit: z.string().max(20).default('pcs'),
});

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  // POST: admin ATAU kasir aktif boleh tambah produk baru
  if (!payload) return apiError('Unauthorized', 401);

  // ── Resolusi createdByAdminId (FK ke tabel admins) ──────────────────────
  // Jika kasir yang memanggil, gunakan adminId yang mendaftarkan kasir tsb.
  // Mencegah FK violation saat UUID kasir di-insert ke kolom admin FK.
  let resolvedAdminId: string;
  if (payload.role === 'admin') {
    resolvedAdminId = payload.sub as string;
  } else {
    // Kasir (employee): ambil createdByAdminId dari data employee
    const [emp] = await db
      .select({ createdByAdminId: employees.createdByAdminId })
      .from(employees)
      .where(eq(employees.id, payload.sub as string))
      .limit(1);

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

  const [created] = await db
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

  return apiOk(created, 201);
}
