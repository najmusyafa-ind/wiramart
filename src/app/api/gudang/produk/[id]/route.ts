// =============================================================
// PATCH & DELETE /api/gudang/produk/[id]
// Opsi B: Petugas Gudang, Admin Shift, & Manager berwenang edit & hapus
// produk secara langsung (saling backup). FEFO & Keuangan tetap eksklusif Manager.
// STANDAR: Zero-Trust Auth, Zod Validation, ACID Batch Sync & Audit Trail
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  employees,
  products,
  stockBatches,
  stockAdjustments,
} from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const GudangPatchProductSchema = z.object({
  name: z.string().trim().min(2, 'Nama produk minimal 2 karakter').max(200).optional(),
  categoryId: z.string().uuid('Kategori tidak valid').optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  costPrice: z.number().nonnegative('HPP tidak boleh negatif').optional(),
  sellingPrice: z.number().positive('Harga jual harus lebih dari 0').optional(),
  stockQty: z.number().int().nonnegative('Stok tidak boleh negatif').optional(),
  isPerishable: z.boolean().optional(),
  perishableType: z.enum(['KONSINYASI', 'BELI_LEPAS']).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
});

async function authorizeWarehouseEditor(req: NextRequest): Promise<
  | { ok: true; actorLabel: string; auditAdminId: string }
  | { ok: false; response: Response }
> {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return { ok: false, response: apiError('Unauthorized: Akses khusus Gudang / Admin Shift / Manager', 401) };
  }

  let actorLabel = '';
  let auditAdminId: string | null = null;

  if (payload.role === 'admin') {
    const adm = await db.query.admins.findFirst({
      where: and(eq(admins.id, payload.sub), eq(admins.isActive, true), isNull(admins.deletedAt)),
      columns: { id: true, fullName: true, role: true },
    });
    if (!adm) {
      return { ok: false, response: apiError('Sesi admin tidak aktif atau sudah dinonaktifkan', 403) };
    }
    actorLabel = `${adm.fullName} (${adm.role})`;
    auditAdminId = adm.id;
  } else {
    const emp = await db.query.employees.findFirst({
      where: and(eq(employees.id, payload.sub), eq(employees.isActive, true), isNull(employees.deletedAt)),
      columns: { id: true, fullName: true, nim: true, jabatan: true, isKetuaShift: true },
    });
    if (!emp) {
      return { ok: false, response: apiError('Akun petugas tidak aktif atau tidak ditemukan', 403) };
    }
    actorLabel = `${emp.fullName} (NIM ${emp.nim} • ${emp.jabatan})`;
  }

  if (!auditAdminId) {
    const [mgr] = await db
      .select({ id: admins.id })
      .from(admins)
      .where(and(eq(admins.isActive, true), isNull(admins.deletedAt), eq(admins.role, 'MANAGER')))
      .limit(1);
    const [anyAdm] = !mgr
      ? await db
          .select({ id: admins.id })
          .from(admins)
          .where(and(eq(admins.isActive, true), isNull(admins.deletedAt)))
          .limit(1)
      : [mgr];
    auditAdminId = anyAdm?.id ?? null;
  }

  if (!auditAdminId) {
    return { ok: false, response: apiError('Sistem audit admin tidak tersedia', 500) };
  }

  return { ok: true, actorLabel, auditAdminId };
}

export async function PATCH(req: NextRequest, ctx: Context) {
  const auth = await authorizeWarehouseEditor(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError('ID produk tidak valid', 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 400);
  }

  const parsed = GudangPatchProductSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Input edit produk tidak valid', 422);
  }

  const data = parsed.data;
  const now = new Date();

  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .for('update')
      .limit(1);

    if (!existing) {
      return { ok: false as const, status: 404, message: 'Produk tidak ditemukan' };
    }

    const updateValues: Partial<typeof products.$inferInsert> = { updatedAt: now };

    if (data.name !== undefined) {
      const [dupName] = await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(
          and(
            ne(products.id, id),
            isNull(products.deletedAt),
            sql`LOWER(TRIM(${products.name})) = ${data.name.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (dupName) {
        return { ok: false as const, status: 409, message: `Nama produk "${dupName.name}" sudah digunakan.` };
      }
      updateValues.name = data.name;
    }

    if (data.barcode !== undefined) {
      const cleanBarcode = data.barcode?.trim() || null;
      if (cleanBarcode) {
        const [dupBc] = await tx
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(and(eq(products.barcode, cleanBarcode), ne(products.id, id), isNull(products.deletedAt)))
          .limit(1);
        if (dupBc) {
          return {
            ok: false as const,
            status: 409,
            message: `Barcode "${cleanBarcode}" sudah dipakai produk "${dupBc.name}".`,
          };
        }
      }
      updateValues.barcode = cleanBarcode;
    }

    if (data.categoryId !== undefined) updateValues.categoryId = data.categoryId;
    if (data.unit !== undefined) updateValues.unit = data.unit;
    if (data.costPrice !== undefined) updateValues.costPrice = data.costPrice.toString();
    if (data.sellingPrice !== undefined) updateValues.sellingPrice = data.sellingPrice.toString();
    if (data.isPerishable !== undefined) updateValues.isPerishable = data.isPerishable;
    if (data.perishableType !== undefined) updateValues.perishableType = data.perishableType;
    if (data.stockQty !== undefined) updateValues.stockQty = data.stockQty;

    const [updated] = await tx
      .update(products)
      .set(updateValues)
      .where(eq(products.id, id))
      .returning();

    // Sinkronisasi stock_batches & catat stock_adjustments jika stok berubah
    if (data.stockQty !== undefined && data.stockQty !== existing.stockQty) {
      const targetQty = data.stockQty;
      const batches = await tx
        .select()
        .from(stockBatches)
        .where(eq(stockBatches.productId, id))
        .orderBy(sql`${stockBatches.receivedAt} DESC`);

      if (targetQty === 0) {
        await tx
          .update(stockBatches)
          .set({ currentQty: 0, updatedAt: now })
          .where(eq(stockBatches.productId, id));
      } else if (batches.length === 0) {
        await tx.insert(stockBatches).values({
          productId: id,
          batchCode: `EDIT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`,
          costPrice: updateValues.costPrice ?? existing.costPrice,
          initialQty: targetQty,
          currentQty: targetQty,
          expiryDate: null,
          expiryClass: 'PANJANG',
          receivedAt: now,
          notes: `Edit stok langsung oleh ${auth.actorLabel}`,
        });
      } else {
        for (let i = 0; i < batches.length; i++) {
          const b = batches[i]!;
          if (i === 0) {
            await tx
              .update(stockBatches)
              .set({
                currentQty: targetQty,
                initialQty: Math.max(b.initialQty, targetQty),
                updatedAt: now,
              })
              .where(eq(stockBatches.id, b.id));
          } else if (b.currentQty !== 0) {
            await tx
              .update(stockBatches)
              .set({ currentQty: 0, updatedAt: now })
              .where(eq(stockBatches.id, b.id));
          }
        }
      }

      await tx.insert(stockAdjustments).values({
        productId: id,
        qtyBefore: existing.stockQty,
        qtyAfter: targetQty,
        qtyDiff: targetQty - existing.stockQty,
        reason: data.reason
          ? `[EDIT PRODUK GUDANG • ${auth.actorLabel}] ${data.reason}`
          : `[EDIT PRODUK GUDANG • ${auth.actorLabel}] Penyesuaian stok langsung`,
        adjustedByAdminId: auth.auditAdminId,
        createdAt: now,
      });
    }

    return { ok: true as const, product: updated };
  });

  if (!txResult.ok) {
    return apiError(txResult.message, txResult.status);
  }

  return apiOk({
    message: `Produk "${txResult.product.name}" berhasil diperbarui.`,
    product: txResult.product,
  });
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const auth = await authorizeWarehouseEditor(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError('ID produk tidak valid', 400);
  }

  const now = new Date();
  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: products.id, name: products.name, stockQty: products.stockQty })
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)))
      .for('update')
      .limit(1);

    if (!existing) {
      return { ok: false as const, status: 404, message: 'Produk tidak ditemukan' };
    }

    await tx
      .update(products)
      .set({ isActive: false, stockQty: 0, deletedAt: now, updatedAt: now })
      .where(eq(products.id, id));

    await tx
      .update(stockBatches)
      .set({ currentQty: 0, updatedAt: now })
      .where(eq(stockBatches.productId, id));

    if (existing.stockQty > 0) {
      await tx.insert(stockAdjustments).values({
        productId: id,
        qtyBefore: existing.stockQty,
        qtyAfter: 0,
        qtyDiff: -existing.stockQty,
        reason: `[HAPUS PRODUK GUDANG • ${auth.actorLabel}] Soft-delete produk dari katalog`,
        adjustedByAdminId: auth.auditAdminId,
        createdAt: now,
      });
    }

    return { ok: true as const, name: existing.name };
  });

  if (!txResult.ok) {
    return apiError(txResult.message, txResult.status);
  }

  return apiOk({
    message: `Produk "${txResult.name}" berhasil dihapus dari katalog aktif.`,
  });
}
