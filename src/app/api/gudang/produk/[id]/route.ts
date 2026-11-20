// =============================================================
// PATCH & DELETE /api/gudang/produk/[id]
// Opsi B: Petugas Gudang, Admin Shift, & Manager berwenang edit & hapus
// produk serta memperbarui tanggal kedaluwarsa (expired) per batch secara
// langsung (saling backup). FEFO diskon & keuangan tetap eksklusif Manager.
// STANDAR: Zero-Trust Auth, Zod Validation, ACID Batch + FEFO Sync & Audit Trail
// =============================================================

import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, asc, desc, eq, gt, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  discountBarcodes,
  discountPolicies,
  employees,
  productConditionReports,
  products,
  stockBatches,
  stockAdjustments,
  type ExpiryClass,
} from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getOffsetDateWib, getTodayWib } from '@/lib/utils/helpers';

type FefoAlertLevel = (typeof productConditionReports.$inferInsert)['alertLevel'];

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (y < 2020 || y > 2040 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function diffDaysFromToday(expiryDateStr: string, todayStr: string): number {
  const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
  const expMs = new Date(`${expiryDateStr}T00:00:00Z`).getTime();
  return Math.ceil((expMs - todayMs) / (1000 * 60 * 60 * 24));
}

function deriveExpiryClass(expiryDateStr: string | null, todayStr: string): ExpiryClass {
  if (!expiryDateStr) return 'PANJANG';
  const diffDays = diffDaysFromToday(expiryDateStr, todayStr);
  if (diffDays <= 2) return 'HARIAN';
  if (diffDays <= 14) return 'PENDEK';
  return 'PANJANG';
}

function classifyFefoAlertLevel(daysRemaining: number): FefoAlertLevel {
  if (daysRemaining <= 1) return 'H1_KRITIS';
  if (daysRemaining <= 3) return 'H3_URGENT';
  if (daysRemaining <= 5) return 'H5_WARNING';
  return 'H7_WATCH';
}

const NullableExpiryDateSchema = z
  .string()
  .trim()
  .refine((val) => isValidCalendarDate(val), {
    message: 'Tanggal kedaluwarsa tidak valid (gunakan format YYYY-MM-DD, tahun 2020–2040)',
  })
  .nullable();

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
  expiryDate: NullableExpiryDateSchema.optional(),
  batchUpdates: z
    .array(
      z.object({
        batchId: z.string().uuid('ID batch tidak valid'),
        expiryDate: NullableExpiryDateSchema,
      }),
    )
    .max(50, 'Maksimal 50 batch per permintaan')
    .optional(),
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

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function syncLinkedBatchDiscounts(tx: DbTx, batchId: string, remainingBatchQty: number, now: Date) {
  const linkedPolicies = await tx
    .select({ id: discountPolicies.id })
    .from(discountPolicies)
    .where(and(eq(discountPolicies.batchId, batchId), eq(discountPolicies.isActive, true)));

  if (linkedPolicies.length === 0) return;
  const policyIds = linkedPolicies.map((p) => p.id);

  await tx
    .update(discountBarcodes)
    .set({
      remainingQty: sql`LEAST(${discountBarcodes.remainingQty}, ${remainingBatchQty})`,
      ...(remainingBatchQty <= 0 ? { isActive: false } : {}),
    })
    .where(and(inArray(discountBarcodes.policyId, policyIds), eq(discountBarcodes.isActive, true)));

  if (remainingBatchQty <= 0) {
    await tx
      .update(discountPolicies)
      .set({ isActive: false, updatedAt: now })
      .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));
  } else {
    await tx
      .update(discountPolicies)
      .set({
        allowedQty: sql`LEAST(${discountPolicies.allowedQty}, ${discountPolicies.soldQty} + ${remainingBatchQty})`,
        updatedAt: now,
      })
      .where(and(inArray(discountPolicies.id, policyIds), eq(discountPolicies.isActive, true)));
  }
}

/**
 * Sinkronisasi relasional langsung antara stock_batches.expiry_date dengan:
 * 1) product_condition_reports (Radar & To-Do FEFO Gudang/Manager)
 * 2) discount_policies & discount_barcodes (promo FEFO Kasir POS)
 */
async function syncFefoRelationsForBatches(
  tx: DbTx,
  batchIds: string[],
  todayStr: string,
  in7DaysStr: string,
  now: Date,
) {
  const uniqueIds = Array.from(new Set(batchIds));
  if (uniqueIds.length === 0) return;

  const currentBatches = await tx
    .select({
      id: stockBatches.id,
      currentQty: stockBatches.currentQty,
      expiryDate: stockBatches.expiryDate,
    })
    .from(stockBatches)
    .where(inArray(stockBatches.id, uniqueIds));

  for (const b of currentBatches) {
    const [existingReport] = await tx
      .select({
        id: productConditionReports.id,
        status: productConditionReports.status,
        managerDecision: productConditionReports.managerDecision,
      })
      .from(productConditionReports)
      .where(eq(productConditionReports.batchId, b.id))
      .limit(1);

    // Kasus 1: Stok batch 0 -> tutup alert terbuka & matikan diskon
    if (b.currentQty <= 0) {
      await syncLinkedBatchDiscounts(tx, b.id, 0, now);
      if (
        existingReport &&
        ['ALERT_ONLY', 'SUBMITTED', 'MANAGER_REVIEW', 'APPROVED'].includes(existingReport.status)
      ) {
        await tx
          .update(productConditionReports)
          .set({ status: 'CLOSED', updatedAt: now })
          .where(eq(productConditionReports.id, existingReport.id));
      }
      continue;
    }

    // Kasus 2: Tanggal expired kosong atau aman (> 7 hari)
    if (!b.expiryDate || b.expiryDate > in7DaysStr) {
      if (existingReport && existingReport.status === 'ALERT_ONLY') {
        await tx
          .update(productConditionReports)
          .set({ status: 'CLOSED', updatedAt: now })
          .where(eq(productConditionReports.id, existingReport.id));
      }
      continue;
    }

    // Kasus 3: Masuk jendela FEFO (<= 7 hari) atau sudah EXPIRED (< today)
    const daysRemaining = diffDaysFromToday(b.expiryDate, todayStr);
    const alertLevel = classifyFefoAlertLevel(daysRemaining);
    const isAlreadyExpired = b.expiryDate < todayStr;

    // Sinkronisasi promo FEFO aktif pada batch ini
    const activePolicies = await tx
      .select({ id: discountPolicies.id, validUntil: discountPolicies.validUntil })
      .from(discountPolicies)
      .where(and(eq(discountPolicies.batchId, b.id), eq(discountPolicies.isActive, true)));

    if (activePolicies.length > 0) {
      if (isAlreadyExpired) {
        const policyIds = activePolicies.map((p) => p.id);
        await tx
          .update(discountPolicies)
          .set({ isActive: false, updatedAt: now })
          .where(inArray(discountPolicies.id, policyIds));
        await tx
          .update(discountBarcodes)
          .set({ isActive: false, remainingQty: 0 })
          .where(and(inArray(discountBarcodes.policyId, policyIds), eq(discountBarcodes.isActive, true)));
      } else {
        for (const p of activePolicies) {
          if (p.validUntil > b.expiryDate) {
            await tx
              .update(discountPolicies)
              .set({ validUntil: b.expiryDate, updatedAt: now })
              .where(eq(discountPolicies.id, p.id));
          }
        }
      }
    }

    if (!existingReport) {
      await tx.insert(productConditionReports).values({
        batchId: b.id,
        alertLevel,
        qtyAtAlert: b.currentQty,
        daysRemainingAtAlert: daysRemaining,
        status: 'ALERT_ONLY',
      });
    } else if (existingReport.status === 'ALERT_ONLY' || existingReport.status === 'CLOSED') {
      await tx
        .update(productConditionReports)
        .set({
          status: 'ALERT_ONLY',
          alertLevel,
          qtyAtAlert: b.currentQty,
          daysRemainingAtAlert: daysRemaining,
          updatedAt: now,
        })
        .where(eq(productConditionReports.id, existingReport.id));
    } else if (
      isAlreadyExpired &&
      existingReport.status === 'APPROVED' &&
      (existingReport.managerDecision === 'DISCOUNT' || existingReport.managerDecision === 'DISPLAY_FRONT')
    ) {
      await tx
        .update(productConditionReports)
        .set({
          status: 'ALERT_ONLY',
          alertLevel: 'H1_KRITIS',
          qtyAtAlert: b.currentQty,
          daysRemainingAtAlert: daysRemaining,
          managerDecision: null,
          approvedDiscountPct: null,
          managerNote:
            '[AUTO-BLOKIR EXPIRED] Tanggal kedaluwarsa batch sudah terlewat. Diskon dinonaktifkan otomatis; wajib tarik & musnahkan/retur.',
          updatedAt: now,
        })
        .where(eq(productConditionReports.id, existingReport.id));
    }
  }
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
  const todayStr = getTodayWib(now);
  const in7DaysStr = getOffsetDateWib(7, now);

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

    // 1. Proses pembaruan tanggal kedaluwarsa per batch (IDOR-safe: wajib milik productId ini)
    const expiryChangeNotes: string[] = [];
    const touchedBatchIds: string[] = [];
    let createdNewBatchWithExpiry = false;

    if (data.batchUpdates && data.batchUpdates.length > 0) {
      const reqBatchIds = Array.from(new Set(data.batchUpdates.map((u) => u.batchId)));
      const ownedBatches = await tx
        .select({
          id: stockBatches.id,
          batchCode: stockBatches.batchCode,
          expiryDate: stockBatches.expiryDate,
        })
        .from(stockBatches)
        .where(and(eq(stockBatches.productId, id), inArray(stockBatches.id, reqBatchIds)))
        .for('update');

      if (ownedBatches.length !== reqBatchIds.length) {
        return {
          ok: false as const,
          status: 404,
          message: 'Satu atau lebih batch tidak ditemukan pada produk ini.',
        };
      }

      const ownedMap = new Map(ownedBatches.map((b) => [b.id, b]));
      for (const upd of data.batchUpdates) {
        const prev = ownedMap.get(upd.batchId)!;
        const nextExp = upd.expiryDate ?? null;
        if (prev.expiryDate !== nextExp) {
          const nextClass = deriveExpiryClass(nextExp, todayStr);
          await tx
            .update(stockBatches)
            .set({
              expiryDate: nextExp,
              expiryClass: nextClass,
              updatedAt: now,
            })
            .where(eq(stockBatches.id, upd.batchId));

          touchedBatchIds.push(upd.batchId);
          expiryChangeNotes.push(
            `#${prev.batchCode}: ${prev.expiryDate ?? 'kosong'} -> ${nextExp ?? 'kosong'}`,
          );
        }
      }
    }

    // 2. Sinkronisasi stock_batches secara aman (multi-batch FEFO preserving) jika stok berubah
    const stockChanged = data.stockQty !== undefined && data.stockQty !== existing.stockQty;
    if (stockChanged && data.stockQty !== undefined) {
      const targetQty = data.stockQty;
      const activeBatches = await tx
        .select({
          id: stockBatches.id,
          batchCode: stockBatches.batchCode,
          currentQty: stockBatches.currentQty,
          initialQty: stockBatches.initialQty,
          expiryDate: stockBatches.expiryDate,
          receivedAt: stockBatches.receivedAt,
        })
        .from(stockBatches)
        .where(and(eq(stockBatches.productId, id), gt(stockBatches.currentQty, 0)))
        .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.receivedAt), asc(stockBatches.id))
        .for('update');

      const totalBatchQty = activeBatches.reduce((acc, b) => acc + b.currentQty, 0);

      if (targetQty === 0) {
        for (const b of activeBatches) {
          await tx
            .update(stockBatches)
            .set({ currentQty: 0, updatedAt: now })
            .where(eq(stockBatches.id, b.id));
          await syncLinkedBatchDiscounts(tx, b.id, 0, now);
          touchedBatchIds.push(b.id);
        }
      } else if (targetQty > totalBatchQty) {
        const delta = targetQty - totalBatchQty;
        if (activeBatches.length === 0) {
          const nextExp = data.expiryDate ?? (updated.isPerishable ? todayStr : null);
          const newCode = `EDIT-${todayStr.replace(/-/g, '')}-${randomInt(1000, 10000)}`;
          const [insertedBatch] = await tx
            .insert(stockBatches)
            .values({
              productId: id,
              batchCode: newCode,
              costPrice: updateValues.costPrice ?? existing.costPrice,
              initialQty: delta,
              currentQty: delta,
              expiryDate: nextExp,
              expiryClass: deriveExpiryClass(nextExp, todayStr),
              receivedAt: now,
              notes: `Edit stok langsung oleh ${auth.actorLabel}`,
            })
            .returning({ id: stockBatches.id });
          createdNewBatchWithExpiry = true;
          if (insertedBatch) touchedBatchIds.push(insertedBatch.id);
          if (nextExp) {
            expiryChangeNotes.push(`#${newCode}: Exp ${nextExp}`);
          }
        } else {
          // Tambahkan selisih pada batch terbaru agar batch lama FEFO tetap utuh
          const newest = [...activeBatches].sort(
            (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
          )[0]!;
          const nextQty = newest.currentQty + delta;
          await tx
            .update(stockBatches)
            .set({
              currentQty: nextQty,
              initialQty: Math.max(newest.initialQty, nextQty),
              updatedAt: now,
            })
            .where(eq(stockBatches.id, newest.id));
          touchedBatchIds.push(newest.id);
        }
      } else if (targetQty < totalBatchQty) {
        // Kurangi secara FEFO (batch expired terdekat keluar duluan) + sinkronisasi diskon
        let reduceRemaining = totalBatchQty - targetQty;
        for (const b of activeBatches) {
          if (reduceRemaining <= 0) break;
          const deduct = Math.min(b.currentQty, reduceRemaining);
          const [updatedBatch] = await tx
            .update(stockBatches)
            .set({
              currentQty: sql`${stockBatches.currentQty} - ${deduct}`,
              updatedAt: now,
            })
            .where(and(eq(stockBatches.id, b.id), gte(stockBatches.currentQty, deduct)))
            .returning({ id: stockBatches.id, currentQty: stockBatches.currentQty });

          if (updatedBatch) {
            await syncLinkedBatchDiscounts(tx, updatedBatch.id, updatedBatch.currentQty, now);
            touchedBatchIds.push(updatedBatch.id);
          }
          reduceRemaining -= deduct;
        }
      }
    }

    // 3. Shorthand single-batch expiryDate (jika dikirim tanpa batchUpdates dan tidak baru saja buat batch baru)
    if (
      data.expiryDate !== undefined &&
      (!data.batchUpdates || data.batchUpdates.length === 0) &&
      !createdNewBatchWithExpiry
    ) {
      const [primaryBatch] = await tx
        .select({
          id: stockBatches.id,
          batchCode: stockBatches.batchCode,
          expiryDate: stockBatches.expiryDate,
        })
        .from(stockBatches)
        .where(and(eq(stockBatches.productId, id), gt(stockBatches.currentQty, 0)))
        .orderBy(asc(stockBatches.expiryDate), desc(stockBatches.receivedAt))
        .for('update')
        .limit(1);

      if (primaryBatch && primaryBatch.expiryDate !== data.expiryDate) {
        await tx
          .update(stockBatches)
          .set({
            expiryDate: data.expiryDate,
            expiryClass: deriveExpiryClass(data.expiryDate, todayStr),
            updatedAt: now,
          })
          .where(eq(stockBatches.id, primaryBatch.id));

        touchedBatchIds.push(primaryBatch.id);
        expiryChangeNotes.push(
          `#${primaryBatch.batchCode}: ${primaryBatch.expiryDate ?? 'kosong'} -> ${data.expiryDate ?? 'kosong'}`,
        );
      }
    }

    // 4. Sinkronkan relasi FEFO (product_condition_reports & discount_policies/barcodes) secara atomik
    await syncFefoRelationsForBatches(tx, touchedBatchIds, todayStr, in7DaysStr, now);

    // 5. Catat jejak audit ke stock_adjustments jika stok ATAU tanggal expired berubah
    if (stockChanged || expiryChangeNotes.length > 0) {
      const uniqueTouched = Array.from(new Set(touchedBatchIds));
      const linkedBatchId = uniqueTouched.length === 1 ? uniqueTouched[0] : null;
      const expirySuffix =
        expiryChangeNotes.length > 0 ? ` | Exp: ${expiryChangeNotes.join('; ')}` : '';
      const prefix = stockChanged ? 'EDIT PRODUK GUDANG' : 'EDIT EXPIRED GUDANG';
      const baseNote = data.reason
        ? data.reason
        : stockChanged
          ? 'Penyesuaian stok langsung'
          : 'Pembaruan tanggal kedaluwarsa batch';

      await tx.insert(stockAdjustments).values({
        productId: id,
        batchId: linkedBatchId,
        qtyBefore: existing.stockQty,
        qtyAfter: updated.stockQty,
        qtyDiff: updated.stockQty - existing.stockQty,
        reason: `[${prefix} • ${auth.actorLabel}] ${baseNote}${expirySuffix}`.slice(0, 500),
        adjustedByAdminId: auth.auditAdminId,
        createdAt: now,
      });
    }

    return { ok: true as const, product: updated, expiryUpdatedCount: expiryChangeNotes.length };
  });

  if (!txResult.ok) {
    return apiError(txResult.message, txResult.status);
  }

  return apiOk({
    message:
      txResult.expiryUpdatedCount > 0
        ? `Produk "${txResult.product.name}" & ${txResult.expiryUpdatedCount} tanggal expired batch berhasil diperbarui.`
        : `Produk "${txResult.product.name}" berhasil diperbarui.`,
    product: txResult.product,
    expiryUpdatedCount: txResult.expiryUpdatedCount,
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

    const activeBatches = await tx
      .select({ id: stockBatches.id })
      .from(stockBatches)
      .where(and(eq(stockBatches.productId, id), gt(stockBatches.currentQty, 0)))
      .for('update');

    await tx
      .update(products)
      .set({ isActive: false, stockQty: 0, deletedAt: now, updatedAt: now })
      .where(eq(products.id, id));

    await tx
      .update(stockBatches)
      .set({ currentQty: 0, updatedAt: now })
      .where(eq(stockBatches.productId, id));

    for (const b of activeBatches) {
      await syncLinkedBatchDiscounts(tx, b.id, 0, now);
    }

    // Tutup seluruh alert FEFO terbuka untuk batch produk yang dihapus
    const allProductBatches = await tx
      .select({ id: stockBatches.id })
      .from(stockBatches)
      .where(eq(stockBatches.productId, id));
    if (allProductBatches.length > 0) {
      await tx
        .update(productConditionReports)
        .set({ status: 'CLOSED', updatedAt: now })
        .where(
          and(
            inArray(
              productConditionReports.batchId,
              allProductBatches.map((b) => b.id),
            ),
            inArray(productConditionReports.status, ['ALERT_ONLY', 'SUBMITTED', 'MANAGER_REVIEW', 'APPROVED']),
          ),
        );
    }

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
