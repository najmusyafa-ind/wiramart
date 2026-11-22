// =============================================================
// /api/kasir/titipan — Buku Titipan Harian (Konsinyasi)
// Alur:
//   1. GET  : Daftar titipan hari ini + susulan (CARRYOVER/OPEN kemarin) + qty laku live dari POS + status pengingat
//   2. POST : Catat barang titipan masuk (mis. titip 10 pcs, harga setor Rp 6.000) -> ACID tambah stok + batch harian
//   3. PATCH:
//      - action='SETTLE'        : Hitung sisa fisik (mis. sisa 5 -> laku 5, deteksi selisih vs POS),
//                                 potong stok sisa retur, dan otomatis catat Uang Keluar Kas Laci (BAYAR_TITIPAN)
//                                 TANPA masuk operating_expenses (anti double-counting HPP!)
//      - action='MARK_CARRYOVER': Tandai "Diambil Besok" agar tetap muncul di daftar susulan esok hari
// =============================================================

import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, ilike, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  categories,
  consignmentEntries,
  employees,
  products,
  shifts,
  shiftCashMovements,
  stockAdjustments,
  stockBatches,
  suppliers,
  transactions,
  transactionItems,
} from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import {
  getWibDateStr,
  getWibMinutes,
  getWibSessionLabel,
  resolveActiveDrawerShift,
} from '@/lib/services/activeShiftService';
import {
  findActiveGraceShift,
  recalculateGraceShiftShortage,
  writeGraceAuditLog,
} from '@/lib/services/shiftShortageService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createConsignmentSchema = z.object({
  productId: z.string().uuid('Produk tidak valid'),
  mitraName: z.string().trim().min(2, 'Nama penitip minimal 2 huruf').max(200),
  supplierId: z.string().uuid().optional().nullable(),
  qtyInitial: z.number().int().min(1, 'Jumlah titip minimal 1').max(5_000),
  hargaSetor: z.number().finite().min(0, 'Harga setor tidak boleh negatif').max(5_000_000),
  sellingPrice: z.number().finite().min(0).max(5_000_000).optional(),
  notes: z.string().trim().max(300).optional(),
});

const patchConsignmentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('MARK_CARRYOVER'),
    id: z.string().uuid('ID titipan tidak valid'),
    notes: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('SETTLE'),
    id: z.string().uuid('ID titipan tidak valid'),
    qtyRemaining: z.number().int().min(0, 'Sisa fisik tidak boleh negatif').max(5_000),
    payoutSource: z.enum(['CASH_LACI', 'TRANSFER_PENGELOLA', 'NONE']).default('CASH_LACI'),
    notes: z.string().trim().max(300).optional(),
  }),
]);

async function getFallbackAdminId(): Promise<string | null> {
  const row =
    (await db.query.admins.findFirst({
      where: and(eq(admins.isActive, true), isNull(admins.deletedAt), eq(admins.role, 'MANAGER')),
      columns: { id: true },
    })) ??
    (await db.query.admins.findFirst({
      where: and(eq(admins.isActive, true), isNull(admins.deletedAt)),
      columns: { id: true },
    }));
  return row?.id ?? null;
}

/** Hitung jumlah pcs produk terjual di POS (COMPLETED, bukan test) pada tanggal WIB tertentu */
async function fetchSoldPosMap(
  pairs: ReadonlyArray<{ productId: string; entryDate: string }>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (pairs.length === 0) return result;

  const dates = [...new Set(pairs.map((p) => p.entryDate))].sort();
  const productIds = [...new Set(pairs.map((p) => p.productId))];
  const minDate = dates[0]!;
  const maxDate = dates[dates.length - 1]!;

  const startUtc = new Date(`${minDate}T00:00:00+07:00`);
  const endUtc = new Date(`${maxDate}T23:59:59.999+07:00`);
  const wibDayExpr = sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

  const soldRows = await db
    .select({
      productId: transactionItems.productId,
      saleDate: wibDayExpr,
      qtySold: sql<number>`COALESCE(SUM(${transactionItems.qty}), 0)::int`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.status, 'COMPLETED'),
        eq(transactions.isTest, false),
        inArray(transactionItems.productId, productIds),
        gte(transactions.createdAt, startUtc),
        lte(transactions.createdAt, endUtc),
      ),
    )
    .groupBy(transactionItems.productId, wibDayExpr);

  for (const r of soldRows) {
    result.set(`${r.productId}__${r.saleDate}`, Number(r.qtySold ?? 0));
  }
  return result;
}

// ── GET /api/kasir/titipan ────────────────────────────────────
export async function GET(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const todayWib = getWibDateStr(now);
  const dateParam = sp.get('date');
  const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayWib;
  const includeCatalog = sp.get('catalog') !== '0';

  try {
    // Ambil entri tanggal target + seluruh titipan susulan (belum selesai dari hari sebelumnya)
    const rawEntries = await db
      .select({
        id: consignmentEntries.id,
        entryDate: consignmentEntries.entryDate,
        productId: consignmentEntries.productId,
        productName: products.name,
        productUnit: products.unit,
        productStock: products.stockQty,
        supplierId: consignmentEntries.supplierId,
        mitraName: consignmentEntries.mitraName,
        qtyInitial: consignmentEntries.qtyInitial,
        hargaSetor: consignmentEntries.hargaSetor,
        sellingPrice: consignmentEntries.sellingPrice,
        status: consignmentEntries.status,
        qtySoldPos: consignmentEntries.qtySoldPos,
        qtyRemaining: consignmentEntries.qtyRemaining,
        qtySoldPhysical: consignmentEntries.qtySoldPhysical,
        qtyDiscrepancy: consignmentEntries.qtyDiscrepancy,
        totalPayout: consignmentEntries.totalPayout,
        payoutSource: consignmentEntries.payoutSource,
        cashMovementId: consignmentEntries.cashMovementId,
        settledAt: consignmentEntries.settledAt,
        notes: consignmentEntries.notes,
        createdAt: consignmentEntries.createdAt,
        createdByName: employees.fullName,
      })
      .from(consignmentEntries)
      .innerJoin(products, eq(consignmentEntries.productId, products.id))
      .leftJoin(employees, eq(consignmentEntries.createdByEmployeeId, employees.id))
      .where(
        or(
          eq(consignmentEntries.entryDate, targetDate),
          and(
            lt(consignmentEntries.entryDate, targetDate),
            inArray(consignmentEntries.status, ['OPEN', 'CARRYOVER']),
          ),
        ),
      )
      .orderBy(desc(consignmentEntries.entryDate), desc(consignmentEntries.createdAt))
      .limit(200);

    const openPairs = rawEntries
      .filter((e) => e.status !== 'SETTLED')
      .map((e) => ({ productId: e.productId, entryDate: e.entryDate }));
    const liveSoldMap = await fetchSoldPosMap(openPairs);

    const enriched = rawEntries.map((e) => {
      const hargaSetorNum = Number(e.hargaSetor ?? 0);
      const sellingPriceNum = Number(e.sellingPrice ?? 0);
      const liveSoldPos =
        e.status === 'SETTLED'
          ? (e.qtySoldPos ?? 0)
          : (liveSoldMap.get(`${e.productId}__${e.entryDate}`) ?? 0);
      const estimatedRemaining = Math.max(0, e.qtyInitial - liveSoldPos);
      const estimatedPayout = Math.round(Math.min(e.qtyInitial, liveSoldPos) * hargaSetorNum);

      return {
        id: e.id,
        entryDate: e.entryDate,
        productId: e.productId,
        productName: e.productName,
        productUnit: e.productUnit,
        productStock: e.productStock,
        supplierId: e.supplierId,
        mitraName: e.mitraName,
        qtyInitial: e.qtyInitial,
        hargaSetor: hargaSetorNum,
        sellingPrice: sellingPriceNum,
        status: e.status,
        qtySoldPos: liveSoldPos,
        qtyRemaining: e.status === 'SETTLED' ? e.qtyRemaining : estimatedRemaining,
        qtySoldPhysical: e.status === 'SETTLED' ? e.qtySoldPhysical : liveSoldPos,
        qtyDiscrepancy: e.qtyDiscrepancy,
        totalPayout: e.status === 'SETTLED' ? Number(e.totalPayout ?? 0) : estimatedPayout,
        payoutSource: e.payoutSource,
        cashMovementId: e.cashMovementId,
        settledAt: e.settledAt ? e.settledAt.toISOString() : null,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
        createdByName: e.createdByName ?? 'Kasir',
      };
    });

    const todayEntries = enriched.filter((e) => e.entryDate === targetDate);
    const carryoverEntries = enriched.filter((e) => e.entryDate < targetDate);

    // Hitung Trigger Pengingat 30-45 menit sebelum tutup shift (10:45-11:30 & 14:00-15:15 WIB)
    const nowMins = getWibMinutes(now);
    const sessionLabel = getWibSessionLabel(now);
    const activeOpenCount = todayEntries.filter((e) => e.status === 'OPEN').length;
    const carryoverCount = carryoverEntries.length;
    const isNearMorningClose = nowMins >= 10 * 60 + 45 && nowMins <= 11 * 60 + 35;
    const isNearAfternoonClose = nowMins >= 14 * 60 && nowMins <= 15 * 60 + 20;
    const minutesBeforeClose = isNearMorningClose
      ? Math.max(0, 11 * 60 + 30 - nowMins)
      : isNearAfternoonClose
        ? Math.max(0, 15 * 60 - nowMins)
        : null;
    const shouldRemind =
      (isNearMorningClose || isNearAfternoonClose) && (activeOpenCount > 0 || carryoverCount > 0);

    // Katalog produk untuk dropdown input titipan (HANYA expose suggestedHargaSetor untuk produk perishable/konsinyasi)
    let catalogProducts: Array<{
      id: string;
      name: string;
      unit: string;
      sellingPrice: number;
      stockQty: number;
      isPerishable: boolean;
      suggestedHargaSetor: number | null;
      categoryName: string | null;
    }> = [];
    let supplierList: Array<{ id: string; name: string }> = [];

    if (includeCatalog) {
      const [prodRows, supRows] = await Promise.all([
        db
          .select({
            id: products.id,
            name: products.name,
            unit: products.unit,
            sellingPrice: products.sellingPrice,
            costPrice: products.costPrice,
            stockQty: products.stockQty,
            isPerishable: products.isPerishable,
            perishableType: products.perishableType,
            categoryName: categories.name,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(eq(products.isActive, true), isNull(products.deletedAt)))
          .orderBy(desc(products.isPerishable), asc(products.name))
          .limit(300),
        db
          .select({ id: suppliers.id, name: suppliers.name })
          .from(suppliers)
          .where(and(eq(suppliers.isActive, true), isNull(suppliers.deletedAt)))
          .orderBy(asc(suppliers.name))
          .limit(100),
      ]);

      catalogProducts = prodRows.map((p) => {
        const isConsignmentLike =
          p.isPerishable ||
          p.perishableType === 'KONSINYASI' ||
          (p.categoryName ?? '').toLowerCase().includes('makanan') ||
          (p.categoryName ?? '').toLowerCase().includes('basah');
        return {
          id: p.id,
          name: p.name,
          unit: p.unit,
          sellingPrice: Number(p.sellingPrice ?? 0),
          stockQty: p.stockQty,
          isPerishable: p.isPerishable,
          suggestedHargaSetor: isConsignmentLike ? Number(p.costPrice ?? 0) : null,
          categoryName: p.categoryName ?? null,
        };
      });
      supplierList = supRows;
    }

    return apiOk({
      date: targetDate,
      todayEntries,
      carryoverEntries,
      summary: {
        activeOpenCount,
        carryoverCount,
        settledTodayCount: todayEntries.filter((e) => e.status === 'SETTLED').length,
        totalPayoutToday: todayEntries
          .filter((e) => e.status === 'SETTLED')
          .reduce((s, e) => s + e.totalPayout, 0),
        totalDiscrepancyQtyToday: todayEntries
          .filter((e) => e.status === 'SETTLED')
          .reduce((s, e) => s + Math.abs(e.qtyDiscrepancy), 0),
      },
      reminder: {
        shouldRemind,
        minutesBeforeClose,
        sessionLabel,
        activeOpenCount,
        carryoverCount,
      },
      ...(includeCatalog ? { products: catalogProducts, suppliers: supplierList } : {}),
    });
  } catch (err) {
    console.error('[titipan GET]', err);
    return apiError('Gagal memuat data titipan harian.', 'SERVER_ERROR', 500);
  }
}

// ── POST /api/kasir/titipan (Catat Titip Masuk) ───────────────
export async function POST(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const emp = await db.query.employees.findFirst({
    where: and(eq(employees.id, payload.sub as string), eq(employees.isActive, true), isNull(employees.deletedAt)),
    columns: { id: true, fullName: true, nim: true },
  });
  if (!emp) {
    return apiError('Akun kasir tidak aktif.', 'FORBIDDEN', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = createConsignmentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data titipan tidak valid', 'VALIDATION_ERROR', 422);
  }

  const { productId, mitraName, supplierId, qtyInitial, hargaSetor, notes } = parsed.data;
  const adminId = await getFallbackAdminId();
  if (!adminId) {
    return apiError('Admin sistem tidak ditemukan untuk audit stok.', 'SERVER_ERROR', 500);
  }

  const now = new Date();
  const todayWib = getWibDateStr(now);
  const compactDate = todayWib.replace(/-/g, '');

  try {
    const created = await db.transaction(async (tx) => {
      const [prod] = await tx
        .select({
          id: products.id,
          name: products.name,
          stockQty: products.stockQty,
          costPrice: products.costPrice,
          sellingPrice: products.sellingPrice,
        })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.isActive, true), isNull(products.deletedAt)))
        .limit(1)
        .for('update');

      if (!prod) return null;

      const effectiveSellingPrice =
        parsed.data.sellingPrice !== undefined && parsed.data.sellingPrice > 0
          ? parsed.data.sellingPrice
          : Number(prod.sellingPrice);

      if (hargaSetor > effectiveSellingPrice && effectiveSellingPrice > 0) {
        throw new Error('Harga setor mitra tidak boleh lebih tinggi dari harga jual produk.');
      }

      const qtyBefore = prod.stockQty;
      const qtyAfter = qtyBefore + qtyInitial;
      const shouldFillCost = Number(prod.costPrice) <= 0 && hargaSetor > 0;

      // 1. Tambah stok produk agar siap dijual di POS
      await tx
        .update(products)
        .set({
          stockQty: qtyAfter,
          isPerishable: true,
          perishableType: 'KONSINYASI',
          ...(shouldFillCost ? { costPrice: hargaSetor.toString() } : {}),
          updatedAt: now,
        })
        .where(eq(products.id, prod.id));

      // 2. Buat batch harian agar FEFO sinkron
      await tx.insert(stockBatches).values({
        productId: prod.id,
        supplierId: supplierId ?? null,
        batchCode: `TITIP-${compactDate}-${randomInt(1000, 9999)}`,
        costPrice: hargaSetor.toString(),
        initialQty: qtyInitial,
        currentQty: qtyInitial,
        expiryDate: todayWib,
        expiryClass: 'HARIAN',
        notes: `Titipan ${mitraName} (${qtyInitial} pcs) oleh ${emp.fullName}`,
      });

      // 3. Catat mutasi stok
      await tx.insert(stockAdjustments).values({
        productId: prod.id,
        qtyBefore,
        qtyAfter,
        qtyDiff: qtyInitial,
        reason: `[TITIPAN MASUK] ${mitraName} menitip ${qtyInitial} pcs @ setor Rp ${hargaSetor.toLocaleString('id-ID')} (Kasir: ${emp.fullName})`,
        adjustedByAdminId: adminId,
        createdAt: now,
      });

      // 4. Simpan baris Buku Titipan Harian
      const [entry] = await tx
        .insert(consignmentEntries)
        .values({
          entryDate: todayWib,
          productId: prod.id,
          supplierId: supplierId ?? null,
          mitraName,
          qtyInitial,
          hargaSetor: hargaSetor.toString(),
          sellingPrice: effectiveSellingPrice.toString(),
          status: 'OPEN',
          createdByEmployeeId: emp.id,
          notes: notes || null,
        })
        .returning();

      return { entry, productName: prod.name };
    });

    if (!created) {
      return apiError('Produk tidak ditemukan atau tidak aktif.', 'NOT_FOUND', 404);
    }

    return apiOk(
      {
        message: `Titipan ${mitraName} (${created.productName} ${qtyInitial} pcs) berhasil dicatat.`,
        entry: created.entry,
      },
      undefined,
      201,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal mencatat titipan harian.';
    return apiError(message, 'CONSIGNMENT_CREATE_ERROR', 422);
  }
}

// ── PATCH /api/kasir/titipan (Selesaikan Sore / Tandai Susulan) ─
export async function PATCH(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const emp = await db.query.employees.findFirst({
    where: and(eq(employees.id, payload.sub as string), eq(employees.isActive, true), isNull(employees.deletedAt)),
    columns: { id: true, fullName: true, nim: true },
  });
  if (!emp) {
    return apiError('Akun kasir tidak aktif.', 'FORBIDDEN', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = patchConsignmentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 'VALIDATION_ERROR', 422);
  }

  const now = new Date();

  if (parsed.data.action === 'MARK_CARRYOVER') {
    const [updated] = await db
      .update(consignmentEntries)
      .set({
        status: 'CARRYOVER',
        notes: parsed.data.notes ?? 'Diambil besok (susulan)',
        updatedAt: now,
      })
      .where(
        and(
          eq(consignmentEntries.id, parsed.data.id),
          inArray(consignmentEntries.status, ['OPEN', 'CARRYOVER']),
        ),
      )
      .returning({ id: consignmentEntries.id });

    if (!updated) {
      return apiError('Data titipan tidak ditemukan atau sudah diselesaikan.', 'NOT_FOUND', 404);
    }

    return apiOk({
      id: updated.id,
      status: 'CARRYOVER',
      message: 'Titipan ditandai diambil besok dan tetap muncul di daftar susulan.',
    });
  }

  // Action: SETTLE (Hitung sisa fisik + setor mitra + potong stok retur + catat Kas Laci)
  const { id, qtyRemaining, payoutSource, notes } = parsed.data;
  const adminId = await getFallbackAdminId();
  if (!adminId) {
    return apiError('Admin sistem tidak ditemukan.', 'SERVER_ERROR', 500);
  }

  // Resolusi shift aktif atau shift dalam Jeda 5 Menit bila dibayar dari CASH_LACI
  let targetShiftId: string | null = null;
  let isGraceMode = false;

  if (payoutSource === 'CASH_LACI') {
    const activeRes = await resolveActiveDrawerShift({
      employeeId: emp.id,
      employeeName: emp.fullName,
      host: req.headers.get('host'),
    });
    if (activeRes.activeShift) {
      targetShiftId = activeRes.activeShift.id;
    } else {
      const grace = await findActiveGraceShift();
      if (grace) {
        targetShiftId = grace.id;
        isGraceMode = true;
      }
    }
  }

  try {
    const settled = await db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(consignmentEntries)
        .where(eq(consignmentEntries.id, id))
        .limit(1)
        .for('update');

      if (!entry) {
        throw new Error('Data titipan tidak ditemukan.');
      }
      if (entry.status === 'SETTLED') {
        throw new Error('Titipan ini sudah diselesaikan sebelumnya.');
      }
      if (qtyRemaining > entry.qtyInitial) {
        throw new Error(`Sisa fisik (${qtyRemaining}) tidak boleh melebihi jumlah titip (${entry.qtyInitial}).`);
      }

      const [prod] = await tx
        .select({ id: products.id, name: products.name, stockQty: products.stockQty })
        .from(products)
        .where(eq(products.id, entry.productId))
        .limit(1)
        .for('update');

      if (!prod) {
        throw new Error('Produk terkait tidak ditemukan.');
      }

      // Hitung qty laku di POS pada tanggal titipan
      const startUtc = new Date(`${entry.entryDate}T00:00:00+07:00`);
      const endUtc = new Date(`${entry.entryDate}T23:59:59.999+07:00`);
      const [soldRow] = await tx
        .select({
          qtySold: sql<number>`COALESCE(SUM(${transactionItems.qty}), 0)::int`,
        })
        .from(transactionItems)
        .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
        .where(
          and(
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.isTest, false),
            eq(transactionItems.productId, entry.productId),
            gte(transactions.createdAt, startUtc),
            lte(transactions.createdAt, endUtc),
          ),
        );

      const qtySoldPos = Number(soldRow?.qtySold ?? 0);
      const qtySoldPhysical = entry.qtyInitial - qtyRemaining;
      const qtyDiscrepancy = qtySoldPhysical - qtySoldPos;
      const hargaSetorNum = Number(entry.hargaSetor ?? 0);
      const totalPayout = Math.round(qtySoldPhysical * hargaSetorNum);

      // 1. Potong stok fisik sisa yang dikembalikan ke mitra
      if (qtyRemaining > 0 && prod.stockQty > 0) {
        const deductStock = Math.min(prod.stockQty, qtyRemaining);
        const qtyAfter = prod.stockQty - deductStock;

        await tx
          .update(products)
          .set({ stockQty: qtyAfter, updatedAt: now })
          .where(eq(products.id, prod.id));

        // Kurangi batch aktif secara FEFO
        let needBatchDeduct = deductStock;
        const activeBatches = await tx
          .select({ id: stockBatches.id, currentQty: stockBatches.currentQty })
          .from(stockBatches)
          .where(and(eq(stockBatches.productId, prod.id), gt(stockBatches.currentQty, 0)))
          .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt))
          .for('update');

        for (const b of activeBatches) {
          if (needBatchDeduct <= 0) break;
          const d = Math.min(b.currentQty, needBatchDeduct);
          await tx
            .update(stockBatches)
            .set({ currentQty: sql`${stockBatches.currentQty} - ${d}`, updatedAt: now })
            .where(eq(stockBatches.id, b.id));
          needBatchDeduct -= d;
        }

        await tx.insert(stockAdjustments).values({
          productId: prod.id,
          qtyBefore: prod.stockQty,
          qtyAfter,
          qtyDiff: -deductStock,
          reason: `[TITIPAN RETUR] ${entry.mitraName}: titip ${entry.qtyInitial}, laku ${qtySoldPhysical}, sisa retur ${qtyRemaining} pcs (Kasir: ${emp.fullName})`,
          adjustedByAdminId: adminId,
          createdAt: now,
        });
      }

      // 2. Catat Uang Keluar Kas Laci otomatis jika dibayar tunai dari laci
      let cashMovementId: string | null = null;
      if (payoutSource === 'CASH_LACI' && totalPayout > 0) {
        if (!targetShiftId) {
          throw new Error(
            'Tidak ada shift aktif untuk mengeluarkan uang laci. Pilih "Transfer Pengelola" atau buka shift terlebih dahulu.',
          );
        }

        const [lockedShift] = await tx
          .select({ id: shifts.id })
          .from(shifts)
          .where(
            isGraceMode
              ? and(
                  eq(shifts.id, targetShiftId),
                  eq(shifts.status, 'CLOSED'),
                  eq(shifts.shortageStatus, 'PENDING_GRACE'),
                  gt(shifts.shortageGraceUntil, now),
                )
              : and(eq(shifts.id, targetShiftId), eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
          )
          .limit(1)
          .for('update');

        if (!lockedShift) {
          throw new Error('Shift aktif sudah ditutup atau jeda koreksi 5 menit telah habis.');
        }

        const discTag = qtyDiscrepancy !== 0 ? ` | Selisih POS: ${qtyDiscrepancy > 0 ? `+${qtyDiscrepancy}` : qtyDiscrepancy} pcs` : '';
        const gracePrefix = isGraceMode ? '[Koreksi Jeda 5m] ' : '';
        const moveNotes = `${gracePrefix}Titipan ${entry.mitraName} (${prod.name}: titip ${entry.qtyInitial}, laku ${qtySoldPhysical}, sisa ${qtyRemaining}${discTag})`;

        const [cm] = await tx
          .insert(shiftCashMovements)
          .values({
            shiftId: lockedShift.id,
            employeeId: emp.id,
            movementType: 'CASH_OUT',
            category: 'BAYAR_TITIPAN',
            amount: totalPayout.toString(),
            notes: moveNotes,
            isGraceCorrection: isGraceMode,
            consignmentEntryId: entry.id,
          })
          .returning({ id: shiftCashMovements.id });

        cashMovementId = cm?.id ?? null;
      }

      // 3. Finalisasi baris consignment_entries
      const [done] = await tx
        .update(consignmentEntries)
        .set({
          status: 'SETTLED',
          qtySoldPos,
          qtyRemaining,
          qtySoldPhysical,
          qtyDiscrepancy,
          totalPayout: totalPayout.toString(),
          payoutSource,
          cashMovementId,
          settledByEmployeeId: emp.id,
          settledAt: now,
          notes: notes ?? entry.notes,
          updatedAt: now,
        })
        .where(eq(consignmentEntries.id, entry.id))
        .returning();

      return {
        entry: done,
        productName: prod.name,
        qtySoldPos,
        qtySoldPhysical,
        qtyDiscrepancy,
        totalPayout,
        cashMovementId,
      };
    });

    let graceUpdate = null;
    if (isGraceMode && targetShiftId) {
      await writeGraceAuditLog({
        tableName: 'consignment_entries',
        recordId: settled.entry.id,
        actorType: 'EMPLOYEE',
        actorId: emp.id,
        newValues: {
          tag: 'KOREKSI_JEDA_5M_TITIPAN',
          shiftId: targetShiftId,
          totalPayout: settled.totalPayout,
          qtyDiscrepancy: settled.qtyDiscrepancy,
        },
      });
      graceUpdate = await recalculateGraceShiftShortage(targetShiftId);
    }

    return apiOk({
      message: `Titipan ${settled.entry.mitraName} (${settled.productName}) selesai. Setor Rp ${settled.totalPayout.toLocaleString('id-ID')}.`,
      ...settled,
      graceUpdate,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal menyelesaikan titipan.';
    return apiError(message, 'CONSIGNMENT_SETTLE_ERROR', 422);
  }
}
