// =============================================================
// PATCH /api/admin/produk/[id] — Update produk
// DELETE /api/admin/produk/[id] — Soft delete produk
// =============================================================

import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  products,
  stockBatches,
  stockAdjustments,
  admins,
  discountPolicies,
  discountBarcodes,
} from '@/lib/db/schema';
import { eq, and, isNull, ne, gt, gte, asc, inArray, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getTodayWib, getOffsetDateWib } from '@/lib/utils/helpers';

type Context = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  barcode: z.string().max(100).nullable().optional(),
  costPrice: z.number().nonnegative().optional(),
  sellingPrice: z.number().positive().optional(),
  stockQty: z.number().int().nonnegative().optional(),
  // Stok yang dilihat user saat form dibuka. Dipakai untuk mendeteksi tabrakan
  // dengan penjualan/restock yang terjadi selama form terbuka.
  expectedStockQty: z.number().int().nonnegative().optional(),
  stockAdjustmentReason: z.string().max(300).optional(),
  unit: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
  isPerishable: z.boolean().optional(),
  perishableType: z.enum(['KONSINYASI', 'BELI_LEPAS']).optional(),
  categoryId: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, ctx: Context) {
  const payload = await verifyJwt(req);
  // PATCH: Admin Shift & Manager aktif boleh edit produk (berbarcode & non-barcode), harga, dan stok opname
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const [activeAdmin] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.id, payload.sub), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);
  if (!activeAdmin) return apiError('Sesi admin tidak aktif atau sudah dinonaktifkan', 403);

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError('ID produk tidak valid', 400);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Invalid JSON', 400); }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return apiError(parsed.error.flatten().fieldErrors, 422);

  const { stockQty, expectedStockQty } = parsed.data;
  // Stok hanya diubah jika user memang mengirim nilai berbeda dari expectedStockQty
  // (atau expectedStockQty tidak dikirim oleh klien lama).
  const isStockUpdateRequested =
    stockQty !== undefined &&
    (expectedStockQty === undefined || stockQty !== expectedStockQty);

  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: products.id,
        stockQty: products.stockQty,
        name: products.name,
        costPrice: products.costPrice,
      })
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .for('update')
      .limit(1);

    if (!existing) {
      return { ok: false as const, status: 404, message: 'Produk tidak ditemukan' };
    }

    if (
      isStockUpdateRequested &&
      expectedStockQty !== undefined &&
      existing.stockQty !== expectedStockQty
    ) {
      return {
        ok: false as const,
        status: 409,
        message:
          `Stok produk berubah sejak halaman dimuat (stok sekarang: ${existing.stockQty}). ` +
          'Muat ulang halaman, lalu ulangi perubahan stok.',
      };
    }

    const updateData: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) {
      const cleanName = parsed.data.name.trim();
      const [dupName] = await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(
          and(
            ne(products.id, id),
            isNull(products.deletedAt),
            sql`LOWER(TRIM(${products.name})) = ${cleanName.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (dupName) {
        return {
          ok: false as const,
          status: 409,
          message: `Nama produk "${dupName.name}" sudah digunakan produk lain (pencocokan tidak membedakan huruf besar/kecil).`,
        };
      }
      updateData.name = cleanName;
    }
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description.trim();
    if (parsed.data.costPrice !== undefined) updateData.costPrice = parsed.data.costPrice.toString();
    if (parsed.data.sellingPrice !== undefined) updateData.sellingPrice = parsed.data.sellingPrice.toString();
    if (isStockUpdateRequested && stockQty !== undefined) {
      updateData.stockQty = stockQty;
    }
    if (parsed.data.unit !== undefined) updateData.unit = parsed.data.unit;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (parsed.data.isPerishable !== undefined) updateData.isPerishable = parsed.data.isPerishable;
    if (parsed.data.perishableType !== undefined) updateData.perishableType = parsed.data.perishableType;
    if (parsed.data.categoryId !== undefined) updateData.categoryId = parsed.data.categoryId;

    if (parsed.data.barcode !== undefined) {
      const newBarcode = parsed.data.barcode?.trim() || null;
      if (newBarcode) {
        const [duplicate] = await tx
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(
            and(
              eq(products.barcode, newBarcode),
              ne(products.id, id),
              isNull(products.deletedAt),
            ),
          )
          .limit(1);
        if (duplicate) {
          return {
            ok: false as const,
            status: 409,
            message: `Barcode sudah digunakan oleh produk "${duplicate.name}"`,
          };
        }
      }
      updateData.barcode = newBarcode;
    }

    const [updated] = await tx
      .update(products)
      .set(updateData)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .returning();

    if (!updated) {
      return { ok: false as const, status: 404, message: 'Produk tidak ditemukan' };
    }

    // Sinkronisasi batch inventaris & catat audit bila ada perubahan stok
    if (isStockUpdateRequested) {
      const now = new Date();
      const currentBatches = await tx
        .select({
          id: stockBatches.id,
          currentQty: stockBatches.currentQty,
        })
        .from(stockBatches)
        .where(and(eq(stockBatches.productId, id), gt(stockBatches.currentQty, 0)))
        .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt), asc(stockBatches.id))
        .for('update');

      const totalBatchQty = currentBatches.reduce((acc, b) => acc + b.currentQty, 0);
      const newStock = updated.stockQty;

      if (newStock > totalBatchQty) {
        // Penambahan stok manual -> buat batch baru memakai tanggal WIB
        const deltaBatch = newStock - totalBatchQty;
        const todayStr = getTodayWib(now);
        const batchCode = `ADJ-${todayStr.replace(/-/g, '')}-${randomInt(1000, 10000)}`;
        await tx.insert(stockBatches).values({
          productId: id,
          batchCode,
          costPrice: updated.costPrice,
          initialQty: deltaBatch,
          currentQty: deltaBatch,
          expiryDate: updated.isPerishable ? todayStr : getOffsetDateWib(180, now),
          expiryClass: updated.isPerishable ? 'HARIAN' : 'PANJANG',
          notes: 'Penyesuaian stok manual katalog produk',
        });
      } else if (newStock < totalBatchQty) {
        // Pengurangan stok manual -> kurangi batch aktif berurutan FEFO & sinkronkan promo terkait
        let reduceRemaining = totalBatchQty - newStock;
        for (const b of currentBatches) {
          if (reduceRemaining <= 0) break;
          const deduct = Math.min(b.currentQty, reduceRemaining);
          const [updatedBatch] = await tx
            .update(stockBatches)
            .set({
              currentQty: sql`${stockBatches.currentQty} - ${deduct}`,
              updatedAt: now,
            })
            .where(and(eq(stockBatches.id, b.id), gte(stockBatches.currentQty, deduct)))
            .returning({
              id: stockBatches.id,
              currentQty: stockBatches.currentQty,
            });

          if (updatedBatch) {
            const linkedPolicies = await tx
              .select({ id: discountPolicies.id })
              .from(discountPolicies)
              .where(
                and(
                  eq(discountPolicies.batchId, b.id),
                  eq(discountPolicies.isActive, true),
                ),
              );

            if (linkedPolicies.length > 0) {
              const policyIds = linkedPolicies.map((p) => p.id);
              await tx
                .update(discountBarcodes)
                .set({
                  remainingQty: sql`LEAST(${discountBarcodes.remainingQty}, ${updatedBatch.currentQty})`,
                  ...(updatedBatch.currentQty <= 0 ? { isActive: false } : {}),
                })
                .where(
                  and(
                    inArray(discountBarcodes.policyId, policyIds),
                    eq(discountBarcodes.isActive, true),
                  ),
                );

              if (updatedBatch.currentQty <= 0) {
                await tx
                  .update(discountPolicies)
                  .set({ isActive: false, updatedAt: now })
                  .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));
              } else {
                await tx
                  .update(discountPolicies)
                  .set({
                    allowedQty: sql`LEAST(${discountPolicies.allowedQty}, ${discountPolicies.soldQty} + ${updatedBatch.currentQty})`,
                    updatedAt: now,
                  })
                  .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));
              }
            }
          }

          reduceRemaining -= deduct;
        }
      }

      // Catat riwayat audit stok lengkap dengan identitas pelaku yang sebenarnya & alasan
      if (existing.stockQty !== updated.stockQty) {
        const delta = updated.stockQty - existing.stockQty;
        const [actorAdmin] = await tx
          .select({
            id: admins.id,
            fullName: admins.fullName,
            nidn: admins.nidn,
            role: admins.role,
          })
          .from(admins)
          .where(eq(admins.id, payload.sub))
          .limit(1);

        let adminId = actorAdmin?.id ?? null;
        if (!adminId) {
          const [firstAdmin] = await tx.select({ id: admins.id }).from(admins).limit(1);
          adminId = firstAdmin?.id ?? null;
        }

        if (adminId) {
          const actorName = actorAdmin?.fullName || actorAdmin?.nidn || payload.username;
          const actorRole = actorAdmin?.role ?? payload.adminRole ?? 'ADMIN';
          const customReason = parsed.data.stockAdjustmentReason?.trim();
          const reason = customReason
            ? `Edit stok master produk oleh ${actorName} (${actorRole}): ${customReason}`
            : `Edit stok master produk oleh ${actorName} (${actorRole})`;

          await tx.insert(stockAdjustments).values({
            productId: id,
            qtyBefore: existing.stockQty,
            qtyAfter: updated.stockQty,
            qtyDiff: delta,
            reason,
            adjustedByAdminId: adminId,
            createdAt: now,
          });
        }
      }
    }

    return { ok: true as const, data: updated };
  });

  if (!txResult.ok) {
    return apiError(txResult.message, txResult.status);
  }
  return apiOk(txResult.data);
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const [activeAdmin] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.id, payload.sub), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);
  if (!activeAdmin) return apiError('Sesi admin tidak aktif atau sudah dinonaktifkan', 403);

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError('ID produk tidak valid', 400);
  }

  const deletedOk = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .for('update')
      .limit(1);

    if (!existing) return false;

    const now = new Date();
    await tx
      .update(products)
      .set({ deletedAt: now, isActive: false, updatedAt: now })
      .where(eq(products.id, id));

    const productPolicies = await tx
      .select({ id: discountPolicies.id })
      .from(discountPolicies)
      .where(eq(discountPolicies.productId, id));

    if (productPolicies.length > 0) {
      const policyIds = productPolicies.map((p) => p.id);
      await tx
        .update(discountPolicies)
        .set({ isActive: false, updatedAt: now })
        .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));

      await tx
        .update(discountBarcodes)
        .set({ isActive: false, remainingQty: 0 })
        .where(and(inArray(discountBarcodes.policyId, policyIds), eq(discountBarcodes.isActive, true)));
    }

    return true;
  });

  if (!deletedOk) return apiError('Produk tidak ditemukan', 404);
  return apiOk({ message: 'Produk berhasil dihapus' });
}
