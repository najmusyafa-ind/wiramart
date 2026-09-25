// =============================================================
// PATCH /api/admin/produk/[id] — Update produk
// DELETE /api/admin/produk/[id] — Soft delete produk
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

type Context = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  costPrice: z.number().nonnegative().optional(),
  sellingPrice: z.number().positive().optional(),
  stockQty: z.number().int().nonnegative().optional(),
  unit: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
  categoryId: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, ctx: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.flatten().fieldErrors, 422);

  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), isNull(products.deletedAt)))
    .limit(1);

  if (!existing) return apiError('Produk tidak ditemukan', 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description.trim();
  if (parsed.data.costPrice !== undefined) updateData.costPrice = parsed.data.costPrice.toString();
  if (parsed.data.sellingPrice !== undefined) updateData.sellingPrice = parsed.data.sellingPrice.toString();
  if (parsed.data.stockQty !== undefined) updateData.stockQty = parsed.data.stockQty;
  if (parsed.data.unit !== undefined) updateData.unit = parsed.data.unit;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (parsed.data.categoryId !== undefined) updateData.categoryId = parsed.data.categoryId;

  const [updated] = await db
    .update(products)
    .set(updateData)
    .where(eq(products.id, id))
    .returning();

  return apiOk(updated);
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const { id } = await ctx.params;

  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), isNull(products.deletedAt)))
    .limit(1);

  if (!existing) return apiError('Produk tidak ditemukan', 404);

  await db
    .update(products)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(products.id, id));

  return apiOk({ message: 'Produk berhasil dihapus' });
}
