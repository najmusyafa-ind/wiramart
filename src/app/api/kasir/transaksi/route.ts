// =============================================================
// POST /api/kasir/transaksi — Buat transaksi baru
// Body: { items: [{productId, qty}], paymentMethod: 'CASH'|'QRIS', cashReceived?: number }
// Header (opsional): Idempotency-Key — 16–64 karakter [A-Za-z0-9_-], 1 kunci per percobaan checkout
// Auth: employee JWT required
//
// v1.2 — RACE CONDITION FIX: Stok di-revalidasi ulang di dalam db.transaction()
// dengan fresh read. Jika stok berubah sejak pre-check, transaksi di-rollback.
// Semua mutasi (insert transaksi + items + update stok) atomic.
//
// v1.3 — Fase 0.4a:
//  • Stok dikurangi lewat UPDATE atomik `stock_qty = stock_qty - n WHERE stock_qty >= n`
//    (bukan nilai JS basi). Baris yang gagal guard → rollback seluruh transaksi.
//  • Item di-update berurutan menurut productId (lock ordering → tanpa deadlock).
//  • Nomor invoice memakai jam WIB (Asia/Jakarta) + acak kriptografis; bentrok → retry.
//
// v1.4 — Fase 0.4b (idempotensi, D17):
//  • Kunci idempotensi unik per karyawan (unique index parsial di DB).
//  • Kunci sama + isi belanja sama  → hasil transaksi yang sama (replay, tanpa stok ganda).
//  • Kunci sama + isi belanja beda  → 409.
//  • Urutan tx: INSERT transaksi dulu (merebut kunci), baru kurangi stok. Dengan begitu
//    request kembar yang kalah balapan mendapat replay, bukan "stok tidak cukup".
//  • Header opsional → klien lama tetap berfungsi selama masa transisi.
// =============================================================

import { createHash, randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { products, transactions, transactionItems, transactionPayments, shifts, stockBatches, transactionLogs, discountPolicies, discountBarcodes } from '@/lib/db/schema';
import { eq, and, isNull, inArray, gte, gt, lt, asc, desc, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────
// Validation Schema
// ─────────────────────────────────────────────────────────────
const PaymentSplitItemSchema = z.object({
  paymentMethod: z.enum(['CASH', 'QRIS']),
  amount: z.number().positive('Nominal pembayaran harus lebih dari 0'),
  cashReceived: z.number().nonnegative().optional(),
});

const TransaksiItemSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().positive(),
  discountPolicyId: z.string().uuid().optional(),
  discountBarcode: z.string().optional(),
});

const TransaksiSchema = z.object({
  items: z.array(TransaksiItemSchema).min(1, 'Minimal 1 item'),
  // paymentMethod tunggal (backward compatibility untuk klien lama)
  paymentMethod: z.enum(['CASH', 'QRIS']).optional(),
  cashReceived: z.number().nonnegative().optional(),
  // Array pembayaran multi-metode (Split Payment baru)
  payments: z.array(PaymentSplitItemSchema).min(1).optional(),
});

// ─────────────────────────────────────────────────────────────
// Invoice Number Generator & WIB Date Helper
// Format: INVYYYYMMDDHHmmssRRR (tanggal + waktu WIB + random 3 digit)
// Server (Vercel) berjalan di UTC, jadi zona waktu WIB dipaksa eksplisit.
// Random suffix (crypto) untuk mencegah collision jika 2 transaksi di detik yang sama;
// jika tetap bentrok (unique violation), transaksi diulang dengan nomor baru.
// ─────────────────────────────────────────────────────────────
const WIB_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function generateInvoiceNumber(): string {
  const p: Record<string, string> = {};
  for (const part of WIB_PARTS.formatToParts(new Date())) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const rand = String(randomInt(0, 1000)).padStart(3, '0');
  return `INV${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}${rand}`;
}

function getTodayWIB(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

const MAX_INVOICE_ATTEMPTS = 3;

// ─────────────────────────────────────────────────────────────
// Idempotensi
// ─────────────────────────────────────────────────────────────
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Sidik jari isi belanja dan pembayaran (urutan item & metode tidak berpengaruh) → 64 hex, muat di varchar(64). */
function hashRequest(
  items: ReadonlyArray<{ productId: string; qty: number; discountPolicyId?: string; discountBarcode?: string }>,
  payments: ReadonlyArray<{ paymentMethod: 'CASH' | 'QRIS'; amount: number; cashReceived?: number }>,
): string {
  const lines = items
    .map((i): [string, number, string] => [i.productId, i.qty, i.discountPolicyId ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[1] - b[1]));
  const paymentLines = payments
    .map((p): [string, number, number] => [p.paymentMethod, p.amount, p.cashReceived ?? 0])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256')
    .update(JSON.stringify({ lines, payments: paymentLines }))
    .digest('hex');
}

/** Ambil kode error Postgres, baik langsung maupun terbungkus lewat rantai `cause`. */
function readPgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && typeof cur === 'object' && cur !== null; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Cari transaksi hasil kunci ini. null = belum ada. */
async function findReplay(employeeId: string, key: string, requestHash: string) {
  const [row] = await db
    .select({
      id: transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      grossAmount: transactions.grossAmount,
      changeAmount: transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
      requestHash: transactions.requestHash,
    })
    .from(transactions)
    .where(and(eq(transactions.employeeId, employeeId), eq(transactions.idempotencyKey, key)))
    .limit(1);

  if (!row) return null;

  if (row.requestHash !== requestHash) {
    return apiError(
      'Kunci transaksi ini sudah dipakai untuk belanja yang berbeda. Muat ulang halaman kasir lalu coba lagi.',
      409,
    );
  }

  return apiOk(
    {
      transactionId: row.id,
      invoiceNumber: row.invoiceNumber,
      grossAmount: Number(row.grossAmount),
      changeAmount: row.changeAmount === null ? null : Number(row.changeAmount),
      paymentMethod: row.paymentMethod,
      replayed: true,
    },
    200,
  );
}

// ─────────────────────────────────────────────────────────────
// POST Handler
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }
  const employeeId = payload.sub as string;

  // ── Parse & validasi body ───────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 400);
  }

  const parsed = TransaksiSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { items, paymentMethod, cashReceived, payments } = parsed.data;

  // Siapkan ringkasan pembayaran awal untuk hash request idempotensi
  const initialPayments: Array<{
    paymentMethod: 'CASH' | 'QRIS';
    amount: number;
    cashReceived?: number;
  }> = payments && payments.length > 0
      ? payments
      : paymentMethod
        ? [{ paymentMethod, amount: 0, cashReceived }]
        : [];

  // ── Idempotensi: replay SEBELUM pre-check stok/shift ────────
  // (setelah sukses, stok sudah berkurang & shift bisa saja sudah ditutup —
  //  replay harus tetap mengembalikan hasil yang sama)
  const rawKey = req.headers.get('idempotency-key');
  let idempotencyKey: string | null = null;
  if (rawKey !== null) {
    if (!IDEMPOTENCY_KEY_RE.test(rawKey)) {
      return apiError('Idempotency-Key tidak valid', 400);
    }
    idempotencyKey = rawKey;
  }
  const requestHash = hashRequest(items, initialPayments);

  try {
    if (idempotencyKey) {
      const replay = await findReplay(employeeId, idempotencyKey, requestHash);
      if (replay) return replay;
    }

    // ── Mode Sandbox / Testing Guard (Localhost Isolation) ──────
    const host = req.headers.get('host') || '';
    const isLocalhost =
      process.env.NODE_ENV !== 'production' ||
      host.includes('localhost') ||
      host.includes('127.0.0.1');
    const isTestingMode: boolean =
      isLocalhost || Boolean(payload.name && payload.name.toLowerCase().includes('testing'));

    // ── Cek shift aktif laci kas (Single Cash Drawer per Shift — Cacat 1 Opsi A) ─
    let activeShiftId: string | null = null;

    // 1. Cek shift aktif milik kasir ini sendiri
    const [ownShift] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.employeeId, employeeId),
          eq(shifts.status, 'ACTIVE'),
          isNull(shifts.clockOut),
        ),
      )
      .limit(1);

    if (ownShift) {
      activeShiftId = ownShift.id;
    } else if (isTestingMode) {
      // Di localhost / akun testing: Buat shift sandbox terisolasi otomatis
      // agar 100% TIDAK PERNAH mengadopsi atau menyenggol shift laci toko fisik!
      const [sandboxShift] = await db
        .insert(shifts)
        .values({
          employeeId,
          status: 'ACTIVE',
          modalAwal: '100000.00',
          notes: '[LOCALHOST DEMO SANDBOX] Shift terisolasi khusus pengujian',
          auditFlags: 'NORMAL',
        })
        .returning({ id: shifts.id });
      activeShiftId = sandboxShift.id;
    } else {
      // 2. Cek shift aktif toko yang dibuka oleh rekan shift (<12 jam)
      const [teamShift] = await db
        .select({ id: shifts.id, clockIn: shifts.clockIn })
        .from(shifts)
        .where(
          and(
            eq(shifts.status, 'ACTIVE'),
            isNull(shifts.clockOut),
          ),
        )
        .orderBy(desc(shifts.clockIn))
        .limit(1);

      if (teamShift) {
        const shiftAge = Date.now() - new Date(teamShift.clockIn).getTime();
        // Ambang batas adopsi shift rekan: maks 4.5 jam (1 sesi roster UNPERBA)
        // Mencegah kasir shift baru mewarisi shift shift sebelumnya yang belum ditutup
        const FOUR_AND_HALF_HOURS = 4.5 * 60 * 60 * 1000;
        if (shiftAge <= FOUR_AND_HALF_HOURS) {
          activeShiftId = teamShift.id;
        }
      }
    }

    if (!activeShiftId) {
      return apiError('Tidak ada shift kasir yang aktif. Buka shift terlebih dahulu.', 403);
    }

    // ── Fetch semua produk yang dibutuhkan (di luar tx — READ) ──
    const productIds = items.map((i) => i.productId);
    const productRows = await db
      .select({
        id: products.id,
        name: products.name,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
        stockQty: products.stockQty,
      })
      .from(products)
      .where(
        and(
          inArray(products.id, productIds),
          eq(products.isActive, true),
          isNull(products.deletedAt),
        ),
      );

    // ── Validasi produk & stok (di luar tx — fail fast sebelum masuk DB tx) ──
    for (const item of items) {
      const prod = productRows.find((p) => p.id === item.productId);
      if (!prod) {
        return apiError(`Produk tidak ditemukan: ${item.productId}`, 400);
      }
      if (prod.stockQty < item.qty) {
        return apiError(`Stok "${prod.name}" tidak cukup. Tersisa: ${prod.stockQty}`, 400);
      }
    }

    // ── Validasi diskon darurat FEFO (jika ada) ──────────────────
    const policyIds = items
      .map((i) => i.discountPolicyId)
      .filter((id): id is string => Boolean(id));

    let activePolicies: Array<{
      id: string;
      productId: string;
      batchId: string | null;
      discountPct: string;
      discountedPrice: number;
      isActive: boolean;
      validUntil: string;
    }> = [];

    if (policyIds.length > 0) {
      const todayWIB = getTodayWIB();
      activePolicies = await db
        .select({
          id: discountPolicies.id,
          productId: discountPolicies.productId,
          batchId: discountPolicies.batchId,
          discountPct: discountPolicies.discountPct,
          discountedPrice: discountPolicies.discountedPrice,
          isActive: discountPolicies.isActive,
          validUntil: discountPolicies.validUntil,
        })
        .from(discountPolicies)
        .where(inArray(discountPolicies.id, policyIds));

      for (const item of items) {
        if (item.discountPolicyId) {
          const policy = activePolicies.find((pol) => pol.id === item.discountPolicyId);
          if (!policy) {
            return apiError(`Kebijakan diskon darurat (${item.discountPolicyId}) tidak ditemukan.`, 400);
          }
          if (!policy.isActive) {
            return apiError(`Kebijakan diskon darurat untuk produk ini sudah dinonaktifkan.`, 400);
          }
          if (policy.validUntil < todayWIB) {
            return apiError(`Kebijakan diskon darurat telah kedaluwarsa (${policy.validUntil}).`, 400);
          }
          if (policy.productId !== item.productId) {
            return apiError(`Kebijakan diskon tidak cocok dengan produk yang dipilih.`, 400);
          }
        }
      }
    }

    // ── Hitung total (di luar tx) ──────────────────────────────
    // CATATAN: Harga di sini hanya untuk perhitungan awal / validasi cash.
    // Stok AKAN di-revalidasi ulang di dalam DB transaction (race condition safe).
    let grossAmount = 0;
    let totalHpp = 0;

    // ── Pre-compute effective price per item (termasuk diskon) ──
    // Ini dilakukan di luar .map() agar bisa return apiError jika ada
    // item yang harga efektifnya di bawah HPP (guard nilai minus).
    type EffectiveItem = {
      productId: string;
      productNameSnapshot: string;
      costPriceSnapshot: string;
      sellingPriceSnapshot: string;
      qty: number;
      subtotalCost: number;
      subtotalSell: number;
      discountPolicyId: string | null;
    };

    const effectiveItems: EffectiveItem[] = [];

    for (const item of items) {
      const prod = productRows.find((p) => p.id === item.productId)!;
      const costPrice = parseFloat(String(prod.costPrice));

      let sellingPrice = parseFloat(String(prod.sellingPrice));
      let productName = prod.name;

      if (item.discountPolicyId) {
        const policy = activePolicies.find((pol) => pol.id === item.discountPolicyId);
        if (policy) {
          sellingPrice = Number(policy.discountedPrice);
          const pct = Math.round(Number(policy.discountPct));
          productName = `[DISKON ${pct}%] ${prod.name}`;
        }
      }

      // ── GUARD: Harga jual tidak boleh di bawah HPP ─────────────────
      // Root cause nilai minus: kasir menjual produk di bawah harga modal.
      // Aturan Wiramart: sellingPrice >= costPrice (zero-loss policy per unit).
      // Pengecualian: HPP = 0 (produk tanpa HPP terdaftar) → dilewati.
      // Untuk clearance produk perishable yang perlu dijual rugi, dosen/manager
      // WAJIB membuat Discount Policy resmi via menu Admin — bukan override kasir.
      if (costPrice > 0 && sellingPrice < costPrice) {
        return apiError(
          `❌ Harga jual "${prod.name}" (Rp ${Math.round(sellingPrice).toLocaleString('id-ID')}) ` +
          `di bawah HPP (Rp ${Math.round(costPrice).toLocaleString('id-ID')}). ` +
          `Transaksi tidak bisa dilanjutkan. Hubungi Manager untuk membuat kebijakan diskon resmi.`,
          400,
        );
      }

      const subtotalSell = sellingPrice * item.qty;
      const subtotalCost = costPrice * item.qty;

      grossAmount += subtotalSell;
      totalHpp += subtotalCost;

      effectiveItems.push({
        productId: item.productId,
        productNameSnapshot: productName,
        costPriceSnapshot: String(prod.costPrice),
        sellingPriceSnapshot: sellingPrice.toString(),
        qty: item.qty,
        subtotalCost,
        subtotalSell,
        discountPolicyId: item.discountPolicyId ?? null,
      });
    }

    const itemsToInsert = effectiveItems.map((ei) => ({
      ...ei,
      subtotalCost: ei.subtotalCost.toString(),
      subtotalSell: ei.subtotalSell.toString(),
    }));



    const grossProfit = grossAmount - totalHpp;

    // ── Normalisasi & Validasi Pecahan Pembayaran (Split Payment) ──
    let normalizedPayments: Array<{
      paymentMethod: 'CASH' | 'QRIS';
      amount: number;
      cashReceived?: number;
      changeAmount?: number;
    }> = [];

    if (payments && payments.length > 0) {
      normalizedPayments = payments.map((p) => ({ ...p }));
    } else if (paymentMethod) {
      normalizedPayments = [
        {
          paymentMethod,
          amount: grossAmount,
          cashReceived,
        },
      ];
    } else {
      return apiError('Metode pembayaran wajib ditentukan.', 422);
    }

    // 1. Validasi total nominal pembayaran harus tepat sama dengan tagihan (grossAmount)
    const totalPaidAmount = normalizedPayments.reduce((acc, p) => acc + p.amount, 0);
    if (Math.abs(totalPaidAmount - grossAmount) > 0.01) {
      return apiError(
        `Total pembayaran (Rp ${totalPaidAmount.toLocaleString('id-ID')}) tidak cocok dengan tagihan (Rp ${grossAmount.toLocaleString('id-ID')}).`,
        400,
      );
    }

    // 2. Validasi per pecahan metode pembayaran
    let totalCashChange = 0;
    let primaryPaymentMethod: 'CASH' | 'QRIS' = 'CASH';

    const cashPart = normalizedPayments.find((p) => p.paymentMethod === 'CASH');
    const qrisPart = normalizedPayments.find((p) => p.paymentMethod === 'QRIS');

    if (cashPart && !qrisPart) {
      primaryPaymentMethod = 'CASH';
    } else if (qrisPart && !cashPart) {
      primaryPaymentMethod = 'QRIS';
    } else {
      // Kombinasi CASH + QRIS
      primaryPaymentMethod = 'CASH';
    }

    for (const p of normalizedPayments) {
      if (p.paymentMethod === 'QRIS') {
        p.cashReceived = undefined;
        p.changeAmount = undefined;
      } else if (p.paymentMethod === 'CASH') {
        if (p.cashReceived === undefined || p.cashReceived < p.amount) {
          return apiError(
            `Uang tunai diterima (Rp ${(p.cashReceived || 0).toLocaleString('id-ID')}) kurang dari porsi tunai (Rp ${p.amount.toLocaleString('id-ID')}).`,
            400,
          );
        }
        p.changeAmount = p.cashReceived - p.amount;
        totalCashChange += p.changeAmount;
      }
    }

    const changeAmount = cashPart ? totalCashChange : null;
    const cashReceivedTotal = cashPart?.cashReceived ?? null;

    // ─────────────────────────────────────────────────────────────
    // ATOMIC TRANSACTION — semua mutasi dalam satu DB transaction
    // v1.3: Pengurangan stok = satu UPDATE atomik bersyarat per produk.
    // Postgres mengunci baris saat UPDATE; transaksi konkuren menunggu lalu
    // mengevaluasi ulang guard `stock_qty >= qty` terhadap nilai TERBARU.
    // Guard gagal → throw → seluruh transaksi di-rollback (tanpa stok negatif).
    // v1.4: INSERT transaksi lebih dulu agar kunci idempotensi direbut sebelum
    // baris produk dikunci.
    // ─────────────────────────────────────────────────────────────
    // Urutan lock deterministik (by productId) agar 2 transaksi dengan produk
    // sama tetapi urutan scan berbeda tidak saling deadlock.
    const itemsByLockOrder = [...items].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );

    const runTransaction = (invoiceNumber: string) =>
      db.transaction(async (tx) => {
        // Step 1: Insert transaksi (merebut kunci idempotensi bila ada)
        const [newTransaction] = await tx
          .insert(transactions)
          .values({
            invoiceNumber,
            shiftId: activeShiftId,
            employeeId,
            paymentMethod: primaryPaymentMethod,
            status: 'COMPLETED',
            grossAmount: grossAmount.toString(),
            totalHpp: totalHpp.toString(),
            grossProfit: grossProfit.toString(),
            cashReceived: cashReceivedTotal !== null ? cashReceivedTotal.toString() : null,
            changeAmount: changeAmount !== null ? changeAmount.toString() : null,
            idempotencyKey,
            requestHash: idempotencyKey ? requestHash : null,
            isTest: isTestingMode,
          })
          .returning({
            id: transactions.id,
            invoiceNumber: transactions.invoiceNumber,
          });

        // Step 2: Insert semua transaction items (bulk insert)
        await tx.insert(transactionItems).values(
          itemsToInsert.map((item) => ({
            ...item,
            transactionId: newTransaction.id,
          })),
        );

        // Step 2b: Insert pecahan pembayaran ke transactionPayments (Split Payment)
        await tx.insert(transactionPayments).values(
          normalizedPayments.map((p) => ({
            transactionId: newTransaction.id,
            paymentMethod: p.paymentMethod,
            amount: p.amount.toString(),
            cashReceived: p.cashReceived !== undefined ? p.cashReceived.toString() : null,
            changeAmount: p.changeAmount !== undefined ? p.changeAmount.toString() : null,
          })),
        );

        // Step 2c: Decrement kuota discount_barcodes & increment sold_qty discount_policies
        for (const item of items) {
          if (item.discountPolicyId) {
            const barcodeWhere = item.discountBarcode
              ? and(
                eq(discountBarcodes.policyId, item.discountPolicyId),
                eq(discountBarcodes.barcode, item.discountBarcode),
                gte(discountBarcodes.remainingQty, item.qty),
              )
              : and(
                eq(discountBarcodes.policyId, item.discountPolicyId),
                gte(discountBarcodes.remainingQty, item.qty),
              );

            const updatedBarcode = await tx
              .update(discountBarcodes)
              .set({
                remainingQty: sql`${discountBarcodes.remainingQty} - ${item.qty}`,
              })
              .where(barcodeWhere)
              .returning({ id: discountBarcodes.id });

            if (updatedBarcode.length === 0) {
              throw new Error(`DISCOUNT_DEPLETED:${item.discountPolicyId}`);
            }

            await tx
              .update(discountPolicies)
              .set({
                soldQty: sql`${discountPolicies.soldQty} + ${item.qty}`,
                updatedAt: new Date(),
              })
              .where(eq(discountPolicies.id, item.discountPolicyId));
          }
        }

        // Step 3: Decrement stok atomik + guard & FEFO Batch Consumption
        const todayIsoDate = new Date().toISOString().slice(0, 10);

        for (const item of itemsByLockOrder) {
          const itemPolicy = item.discountPolicyId
            ? activePolicies.find((pol) => pol.id === item.discountPolicyId)
            : undefined;

          // 3a. Ambil seluruh batch aktif produk ini (diurutkan FEFO)
          const allActiveBatches = await tx
            .select({
              id: stockBatches.id,
              currentQty: stockBatches.currentQty,
              expiryDate: stockBatches.expiryDate,
              expiryClass: stockBatches.expiryClass,
            })
            .from(stockBatches)
            .where(
              and(
                eq(stockBatches.productId, item.productId),
                gt(stockBatches.currentQty, 0),
              ),
            )
            .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt));

          if (allActiveBatches.length > 0) {
            // Filter batch yang aman untuk dijual (belum lewat tanggal kedaluwarsa)
            const validBatches = allActiveBatches
              .filter((b) => {
                if (!b.expiryDate) return true;
                if (b.expiryClass === 'PANJANG') return true;
                return b.expiryDate >= todayIsoDate;
              })
              .sort((a, b) => {
                // Jika item ini dibeli via diskon darurat dari batch tertentu, prioritaskan batch tersebut
                if (itemPolicy?.batchId) {
                  if (a.id === itemPolicy.batchId) return -1;
                  if (b.id === itemPolicy.batchId) return 1;
                }
                return 0;
              });

            // 3b. Konsumsi stok hanya dari batch-batch yang VALID (FEFO) — Cacat 5 Opsi B
            // Jika kuantitas batch lebih sedikit dari total stok produk, kurangi batch yang ada
            // dan sisa kekurangan dikonsumsi langsung dari products.stockQty (Step 3c) tanpa memblokir transaksi
            let needed = item.qty;
            for (const b of validBatches) {
              if (needed <= 0) break;
              const deduct = Math.min(b.currentQty, needed);
              await tx
                .update(stockBatches)
                .set({
                  currentQty: sql`${stockBatches.currentQty} - ${deduct}`,
                  updatedAt: new Date(),
                })
                .where(eq(stockBatches.id, b.id));
              needed -= deduct;
            }
          }

          // 3c. Decrement total stok produk secara atomik dengan guard
          const updated = await tx
            .update(products)
            .set({
              stockQty: sql`${products.stockQty} - ${item.qty}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(products.id, item.productId),
                eq(products.isActive, true),
                isNull(products.deletedAt),
                gte(products.stockQty, item.qty),
              ),
            )
            .returning({ id: products.id });

          if (updated.length === 0) {
            // Bedakan penyebab agar pesan ke kasir akurat
            const [fresh] = await tx
              .select({ name: products.name, stockQty: products.stockQty })
              .from(products)
              .where(
                and(
                  eq(products.id, item.productId),
                  eq(products.isActive, true),
                  isNull(products.deletedAt),
                ),
              )
              .limit(1);
            if (!fresh) throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
            throw new Error(`INSUFFICIENT_STOCK:${fresh.name}:${fresh.stockQty}`);
          }
        }

        return newTransaction;
      });

    // ─────────────────────────────────────────────────────────────
    // EKSEKUSI TRANSAKSI + LOG COMMIT / ROLLBACK EKSPLISIT
    //
    // Pola identik dengan Prisma $transaction:
    //   try {
    //     await db.transaction(...)  ← BEGIN otomatis oleh Drizzle/PG
    //     console.log('COMMIT')      ← hanya jika TIDAK ada error
    //   } catch (err) {
    //     console.log('ROLLBACK')    ← hanya jika ADA error (otomatis oleh PG)
    //   }
    // ─────────────────────────────────────────────────────────────
    let result: Awaited<ReturnType<typeof runTransaction>> | undefined;
    for (let attempt = 1; attempt <= MAX_INVOICE_ATTEMPTS; attempt++) {
      const invoiceNumber = generateInvoiceNumber();

      // ── 🟡 BEGIN ────────────────────────────────────────────────
      // Drizzle/PostgreSQL otomatis mengirim perintah BEGIN ke DB.
      // Semua operasi INSERT + UPDATE di bawah bersifat ATOMIC.
      console.log(`\n[DB TRANSACTION] 🟡 BEGIN — memulai transaksi...`);
      console.log(`  Invoice : ${invoiceNumber}`);
      console.log(`  Items   : ${items.length} produk | Total: Rp ${grossAmount.toLocaleString('id-ID')} | Metode: ${primaryPaymentMethod}`);

      try {
        result = await runTransaction(invoiceNumber);

        // ── ✅ COMMIT ──────────────────────────────────────────────
        // runTransaction() resolve tanpa error → Drizzle/PostgreSQL
        // mengirim perintah COMMIT. Data TERSIMPAN PERMANEN ke DB.
        console.log(`[DB TRANSACTION] ✅ COMMIT — transaksi berhasil!`);
        console.log(`  Transaction ID : ${result.id}`);
        console.log(`  Invoice        : ${result.invoiceNumber}`);
        console.log(`  Status         : COMPLETED — data tersimpan permanen di Supabase`);
        console.log(`  Stok produk    : berhasil dikurangi secara atomik\n`);

        // ── Catat COMMIT ke tabel transaction_logs (di LUAR tx utama) ──
        // Ditulis di luar agar log ini TIDAK ikut di-rollback.
        // Bukti nyata di Supabase: SELECT * FROM transaction_logs
        await db.insert(transactionLogs).values({
          employeeId: employeeId,
          shiftId: activeShiftId ?? undefined,
          invoiceAttempt: result.invoiceNumber,
          attemptNumber: attempt,
          itemCount: items.length,
          grossAmount: grossAmount.toString(),
          paymentMethod: primaryPaymentMethod,
          outcome: 'COMMITTED',
          transactionId: result.id,
          rollbackReason: null,
        });
        console.log(`  [AUDIT LOG] ✅ Dicatat ke tabel transaction_logs (outcome: COMMITTED)\n`);

        break;

      } catch (err) {
        // ── ❌ ROLLBACK ────────────────────────────────────────────
        // runTransaction() throw error → Drizzle/PostgreSQL otomatis
        // mengirim perintah ROLLBACK. SEMUA INSERT + UPDATE dibatalkan.
        // Data transaksi, item, & stok TIDAK JADI tersimpan ke DB.
        const rollbackMsg = (err as { message?: string })?.message ?? 'Error tidak diketahui';
        console.error(`[DB TRANSACTION] ❌ ROLLBACK — transaksi dibatalkan! (percobaan ke-${attempt})`);
        console.error(`  Alasan : ${rollbackMsg}`);
        console.error(`  Status : TIDAK ADA data yang tersimpan ke DB`);
        console.error(`  Stok   : TIDAK BERKURANG — rollback atomik oleh PostgreSQL\n`);

        // ── Catat ROLLBACK ke tabel transaction_logs (di LUAR tx utama) ──
        // Karena tx utama sudah di-rollback, satu-satunya cara mencatat
        // kegagalan ini adalah INSERT di koneksi TERPISAH (di luar tx).
        // Ini adalah bukti nyata di Supabase bahwa ROLLBACK benar terjadi.
        try {
          await db.insert(transactionLogs).values({
            employeeId: employeeId,
            shiftId: activeShiftId ?? undefined,
            invoiceAttempt: invoiceNumber,
            attemptNumber: attempt,
            itemCount: items.length,
            grossAmount: grossAmount.toString(),
            paymentMethod: primaryPaymentMethod,
            outcome: 'ROLLED_BACK',
            transactionId: null,
            rollbackReason: rollbackMsg.substring(0, 500),
          });
          console.error(`  [AUDIT LOG] ❌ Dicatat ke tabel transaction_logs (outcome: ROLLED_BACK)\n`);
        } catch (logErr) {
          console.error('  [AUDIT LOG] Gagal mencatat log rollback:', logErr);
        }

        if (readPgCode(err) === '23505') {
          if (idempotencyKey) {
            const replay = await findReplay(employeeId, idempotencyKey, requestHash);
            if (replay) return replay;
          }
          if (attempt < MAX_INVOICE_ATTEMPTS) continue;
        }
        throw err;
      }
    }
    if (!result) {
      return apiError('Transaksi gagal. Silakan coba lagi.', 500);
    }

    return apiOk(
      {
        transactionId: result.id,
        invoiceNumber: result.invoiceNumber,
        grossAmount,
        changeAmount,
        paymentMethod: primaryPaymentMethod,
        payments: normalizedPayments,
      },
      201,
    );
  } catch (err) {
    const errObj = err as { code?: string; message?: unknown };
    const errMsg = typeof errObj?.message === 'string' ? errObj.message : '';

    // Deteksi koneksi offline / Wi-Fi mati saat transaksi
    if (
      errObj?.code === 'ENOTFOUND' ||
      errObj?.code === 'ECONNRESET' ||
      errMsg.includes('ENOTFOUND') ||
      errMsg.includes('ECONNRESET') ||
      errMsg.includes('Failed query')
    ) {
      console.warn('[API /kasir/transaksi] Database offline / Network disconnect:', errMsg);
      return apiError('Koneksi internet terputus. Transaksi otomatis dibatalkan.', 503);
    }

    // Unique constraint violation yang tidak terselesaikan (invoice bentrok berulang)
    if (readPgCode(err) === '23505') {
      return apiError('Nomor invoice duplikat. Silakan coba lagi.', 503);
    }

    // Handle race condition: stok berubah di antara pre-check dan tx
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') {
      if (message.startsWith('DISCOUNT_DEPLETED')) {
        return apiError(
          'Kuota barcode diskon darurat untuk item ini sudah habis terpakai oleh transaksi lain.',
          400,
        );
      }
      if (message.startsWith('EXPIRED_PRODUCT')) {
        const parts = message.split(':');
        const prodName = parts[1] ?? 'produk';
        return apiError(
          `Produk "${prodName}" memiliki stok yang sudah kedaluwarsa dan diblokir untuk dijual. Segera serahkan ke Kepala Gudang untuk write-off.`,
          400,
        );
      }
      if (message.startsWith('PRODUCT_NOT_FOUND')) {
        return apiError('Produk tidak ditemukan atau sudah dihapus.', 400);
      }
      if (message.startsWith('INSUFFICIENT_STOCK')) {
        const parts = message.split(':');
        const prodName = parts[1] ?? 'produk';
        const remaining = parts[2] ?? '0';
        return apiError(
          `Stok "${prodName}" tidak cukup. Tersisa: ${remaining} (diperbarui real-time).`,
          400,
        );
      }
    }

    console.error('Error saat memproses transaksi:', err);
    return apiError('Transaksi gagal. Silakan coba lagi.', 500);
  }
}
