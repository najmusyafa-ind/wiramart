// =============================================================
// /api/kasir/makanan-sisa — Cut-off Sisa Makanan Harian (Jam 15:00 WIB)
// Mendukung Kelas H / E1: Makanan Cepat Basi & Non-Barcode (Cilok, Siomai, Ricebowl, Gorengan)
// =============================================================

import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { eq, and, isNull, or, ilike, gt, asc, desc, sql, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  products,
  categories,
  stockAdjustments,
  admins,
  employees,
  stockBatches,
  discountPolicies,
  discountBarcodes,
} from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getTodayWib } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const cutOffDispositionSchema = z.enum([
  'RETUR',
  'BUANG_BASI',
  'HABIS',
  'SIMPAN',
  'MAKAN_PETUGAS',
  'OBRAL',
]);

type CutOffDisposition = z.infer<typeof cutOffDispositionSchema>;

const DISPOSITION_LABELS: Record<CutOffDisposition, string> = {
  RETUR: 'Retur ke Mitra Penitip',
  BUANG_BASI: 'Dibuang (Basi)',
  MAKAN_PETUGAS: 'Makan Petugas / Konsumsi Internal',
  OBRAL: 'Obral Balik Modal HPP',
  HABIS: 'Habis Terjual',
  SIMPAN: 'Disimpan di Kulkas / Chiller',
};

const cutOffItemSchema = z.object({
  productId: z.string().uuid(),
  qtySisaFisik: z.number().int().min(0).max(10_000),
  disposition: cutOffDispositionSchema,
  notes: z.string().max(200).optional(),
});

const cutOffBatchSchema = z.object({
  items: z.array(cutOffItemSchema).min(1, 'Minimal satu item makanan harus dilaporkan'),
});

async function getActiveEmployee(employeeId: string) {
  return db.query.employees.findFirst({
    where: and(
      eq(employees.id, employeeId),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: { id: true, fullName: true, nim: true },
  });
}

// GET: Ambil daftar makanan harian / perishable untuk formulir cut-off
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const emp = await getActiveEmployee(payload.sub);
  if (!emp) {
    return apiError('Akun karyawan tidak ditemukan atau telah dinonaktifkan', 403);
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
      unit: products.unit,
      categoryName: categories.name,
      isPerishable: products.isPerishable,
      perishableType: products.perishableType,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        isNull(products.deletedAt),
        or(
          eq(products.isPerishable, true),
          ilike(categories.name, '%basah%'),
          ilike(categories.name, '%konsinyasi%'),
        ),
      ),
    )
    .orderBy(desc(products.stockQty), asc(products.name));

  return apiOk({ items: rows });
}

// POST: Catat cut-off sisa makanan jam 15:00 WIB
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const emp = await getActiveEmployee(payload.sub);
  if (!emp) {
    return apiError('Akun karyawan tidak ditemukan atau telah dinonaktifkan', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 400);
  }

  const parsed = cutOffBatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 422);
  }

  const { items } = parsed.data;

  // Cari admin aktif untuk FK audit record stock_adjustments
  const adminRow =
    (await db.query.admins.findFirst({
      where: and(
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
        eq(admins.role, 'MANAGER'),
      ),
      columns: { id: true },
    })) ??
    (await db.query.admins.findFirst({
      where: and(eq(admins.isActive, true), isNull(admins.deletedAt)),
      columns: { id: true },
    }));

  const adminId = adminRow?.id;
  if (!adminId) {
    return apiError('Tidak ada sistem admin yang aktif untuk otorisasi stok', 500);
  }

  const nowWib = new Date();
  const wibShifted = new Date(nowWib.getTime() + 7 * 60 * 60 * 1000);
  const timeStr = `${String(wibShifted.getUTCHours()).padStart(2, '0')}:${String(wibShifted.getUTCMinutes()).padStart(2, '0')} WIB`;
  const todayCompact = getTodayWib(nowWib).replace(/-/g, '');

  try {
    let adjustedCount = 0;

    // Eksekusi penyesuaian stok per item dalam satu transaksi ACID
    await db.transaction(async (tx) => {
      for (const item of items) {
        const [existing] = await tx
          .select({
            id: products.id,
            stockQty: products.stockQty,
            costPrice: products.costPrice,
            name: products.name,
          })
          .from(products)
          .where(
            and(
              eq(products.id, item.productId),
              eq(products.isActive, true),
              isNull(products.deletedAt),
            ),
          )
          .limit(1)
          .for('update');

        if (!existing) continue;

        const qtyBefore = existing.stockQty;
        const qtyAfter = item.disposition === 'SIMPAN' ? item.qtySisaFisik : 0;
        const qtyDiff = qtyAfter - qtyBefore;

        // Update stok produk, batch FEFO, & sinkronisasi promo jika ada mutasi stok
        if (qtyDiff !== 0) {
          adjustedCount += 1;

          // 1. Update master stok produk
          await tx
            .update(products)
            .set({ stockQty: qtyAfter, updatedAt: nowWib })
            .where(eq(products.id, item.productId));

          // 2. Sinkronisasi batch stok & promo diskon terkait
          if (qtyAfter === 0) {
            await tx
              .update(stockBatches)
              .set({ currentQty: 0, updatedAt: nowWib })
              .where(
                and(
                  eq(stockBatches.productId, item.productId),
                  gt(stockBatches.currentQty, 0),
                ),
              );

            const productPolicies = await tx
              .select({ id: discountPolicies.id })
              .from(discountPolicies)
              .where(eq(discountPolicies.productId, item.productId));

            if (productPolicies.length > 0) {
              const policyIds = productPolicies.map((p) => p.id);
              await tx
                .update(discountBarcodes)
                .set({ isActive: false, remainingQty: 0 })
                .where(
                  and(
                    inArray(discountBarcodes.policyId, policyIds),
                    eq(discountBarcodes.isActive, true),
                  ),
                );

              await tx
                .update(discountPolicies)
                .set({ isActive: false, updatedAt: nowWib })
                .where(
                  and(
                    inArray(discountPolicies.id, policyIds),
                    eq(discountPolicies.isActive, true),
                  ),
                );
            }
          } else if (qtyDiff < 0) {
            // Kurangi batch aktif menurut FEFO sebanyak penyusutan sisa fisik (terkunci .for('update'))
            let neededDeduct = Math.abs(qtyDiff);
            const activeBatches = await tx
              .select({
                id: stockBatches.id,
                currentQty: stockBatches.currentQty,
              })
              .from(stockBatches)
              .where(
                and(
                  eq(stockBatches.productId, item.productId),
                  gt(stockBatches.currentQty, 0),
                ),
              )
              .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt))
              .for('update');

            for (const b of activeBatches) {
              if (neededDeduct <= 0) break;
              const deduct = Math.min(b.currentQty, neededDeduct);
              const [updatedBatch] = await tx
                .update(stockBatches)
                .set({
                  currentQty: sql`${stockBatches.currentQty} - ${deduct}`,
                  updatedAt: nowWib,
                })
                .where(eq(stockBatches.id, b.id))
                .returning({ id: stockBatches.id, currentQty: stockBatches.currentQty });

              if (updatedBatch) {
                const linkedPolicies = await tx
                  .select({
                    id: discountPolicies.id,
                    allowedQty: discountPolicies.allowedQty,
                    soldQty: discountPolicies.soldQty,
                  })
                  .from(discountPolicies)
                  .where(
                    and(
                      eq(discountPolicies.batchId, updatedBatch.id),
                      eq(discountPolicies.isActive, true),
                    ),
                  );

                for (const pol of linkedPolicies) {
                  const maxAllowed = pol.soldQty + updatedBatch.currentQty;
                  const cappedRemaining = Math.min(
                    Math.max(0, pol.allowedQty - pol.soldQty),
                    updatedBatch.currentQty,
                  );
                  const shouldRemainActive = cappedRemaining > 0;
                  const newAllowedQty = Math.min(pol.allowedQty, maxAllowed);

                  if (newAllowedQty !== pol.allowedQty || !shouldRemainActive) {
                    await tx
                      .update(discountPolicies)
                      .set({
                        allowedQty: newAllowedQty,
                        isActive: shouldRemainActive,
                        updatedAt: nowWib,
                      })
                      .where(eq(discountPolicies.id, pol.id));

                    await tx
                      .update(discountBarcodes)
                      .set({
                        remainingQty: cappedRemaining,
                        isActive: shouldRemainActive,
                      })
                      .where(
                        and(
                          eq(discountBarcodes.policyId, pol.id),
                          eq(discountBarcodes.isActive, true),
                        ),
                      );
                  }
                }
              }

              neededDeduct -= deduct;
            }
          } else if (qtyDiff > 0) {
            // Jika ada penambahan fisik saat opname sore, buat batch penyesuaian harian (WIB + randomInt)
            const batchCode = `HARIAN-${todayCompact}-${randomInt(1000, 10000)}`;
            await tx.insert(stockBatches).values({
              productId: item.productId,
              batchCode,
              costPrice: existing.costPrice,
              initialQty: qtyDiff,
              currentQty: qtyDiff,
              expiryClass: 'HARIAN',
              notes: `Sisa makanan simpan cut-off oleh ${emp.fullName} (${emp.nim}) (+${qtyDiff} pcs)`,
            });
          }

          const dispLabel = DISPOSITION_LABELS[item.disposition];

          const costNum = parseFloat(existing.costPrice) || 0;
          const lossCost =
            item.disposition === 'BUANG_BASI' || item.disposition === 'MAKAN_PETUGAS'
              ? Math.abs(qtyDiff) * costNum
              : 0;
          const lossInfo =
            lossCost > 0
              ? item.disposition === 'MAKAN_PETUGAS'
                ? ` [Beban Konsumsi Toko: Rp ${lossCost.toLocaleString('id-ID')}]`
                : ` [Nilai Susut Basi: Rp ${lossCost.toLocaleString('id-ID')}]`
              : '';

          const cleanNotes = item.notes?.trim();
          const reasonNote = `[SISA-MAKANAN ${timeStr} • Kasir: ${emp.fullName} (${emp.nim})] ${dispLabel} (Sisa fisik: ${item.qtySisaFisik} pcs). ${cleanNotes ? `Catatan: ${cleanNotes}` : ''}${lossInfo}`.trim();

          await tx.insert(stockAdjustments).values({
            productId: item.productId,
            qtyBefore,
            qtyAfter,
            qtyDiff,
            reason: reasonNote,
            adjustedByAdminId: adminId,
            createdAt: nowWib,
          });
        }
      }
    });

    return apiOk({
      message:
        adjustedCount > 0
          ? `Cut-off sisa ${items.length} produk (${adjustedCount} penyesuaian stok) berhasil disimpan secara atomik.`
          : `Laporan cut-off ${items.length} produk diterima (tidak ada perubahan stok).`,
      processedCount: adjustedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal menyimpan cut-off sisa makanan';
    return apiError(message, 500);
  }
}
