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
import { products, transactions, transactionItems, transactionPayments, shifts } from '@/lib/db/schema';
import { eq, and, isNull, inArray, gte, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// Validation Schema
// ─────────────────────────────────────────────────────────────
const PaymentSplitItemSchema = z.object({
  paymentMethod: z.enum(['CASH', 'QRIS']),
  amount: z.number().positive('Nominal pembayaran harus lebih dari 0'),
  cashReceived: z.number().nonnegative().optional(),
});

const TransaksiSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1, 'Minimal 1 item'),
  // paymentMethod tunggal (backward compatibility untuk klien lama)
  paymentMethod: z.enum(['CASH', 'QRIS']).optional(),
  cashReceived: z.number().nonnegative().optional(),
  // Array pembayaran multi-metode (Split Payment baru)
  payments: z.array(PaymentSplitItemSchema).min(1).optional(),
});

// ─────────────────────────────────────────────────────────────
// Invoice Number Generator
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

const MAX_INVOICE_ATTEMPTS = 3;

// ─────────────────────────────────────────────────────────────
// Idempotensi
// ─────────────────────────────────────────────────────────────
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Sidik jari isi belanja dan pembayaran (urutan item & metode tidak berpengaruh) → 64 hex, muat di varchar(64). */
function hashRequest(
  items: ReadonlyArray<{ productId: string; qty: number }>,
  payments: ReadonlyArray<{ paymentMethod: 'CASH' | 'QRIS'; amount: number; cashReceived?: number }>,
): string {
  const lines = items
    .map((i): [string, number] => [i.productId, i.qty])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
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
      id:            transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      grossAmount:   transactions.grossAmount,
      changeAmount:  transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
      requestHash:   transactions.requestHash,
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
      grossAmount:   Number(row.grossAmount),
      changeAmount:  row.changeAmount === null ? null : Number(row.changeAmount),
      paymentMethod: row.paymentMethod,
      replayed:      true,
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

  if (idempotencyKey) {
    const replay = await findReplay(employeeId, idempotencyKey, requestHash);
    if (replay) return replay;
  }

  // ── Cek shift aktif karyawan (di luar tx — READ ONLY check) ─
  const [activeShift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.employeeId, employeeId),
        eq(shifts.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  if (!activeShift) {
    return apiError('Tidak ada shift aktif. Silakan login ulang.', 403);
  }

  // ── Fetch semua produk yang dibutuhkan (di luar tx — READ) ──
  const productIds = items.map((i) => i.productId);
  const productRows = await db
    .select({
      id:           products.id,
      name:         products.name,
      costPrice:    products.costPrice,
      sellingPrice: products.sellingPrice,
      stockQty:     products.stockQty,
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

  // ── Hitung total (di luar tx) ──────────────────────────────
  // CATATAN: Harga di sini hanya untuk perhitungan awal / validasi cash.
  // Stok AKAN di-revalidasi ulang di dalam DB transaction (race condition safe).
  let grossAmount = 0;
  let totalHpp = 0;

  const itemsToInsert = items.map((item) => {
    const prod = productRows.find((p) => p.id === item.productId)!;
    // Drizzle mengembalikan decimal sebagai string di runtime — String() lebih aman dari cast
    const sellingPrice = parseFloat(String(prod.sellingPrice));
    const costPrice    = parseFloat(String(prod.costPrice));
    const subtotalSell = sellingPrice * item.qty;
    const subtotalCost = costPrice * item.qty;

    grossAmount += subtotalSell;
    totalHpp    += subtotalCost;

    return {
      productId:             item.productId,
      productNameSnapshot:   prod.name,
      costPriceSnapshot:     String(prod.costPrice),
      sellingPriceSnapshot:  String(prod.sellingPrice),
      qty:                   item.qty,
      subtotalCost:          subtotalCost.toString(),
      subtotalSell:          subtotalSell.toString(),
    };
  });

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
          shiftId:        activeShift.id,
          employeeId,
          paymentMethod:  primaryPaymentMethod,
          status:         'COMPLETED',
          grossAmount:    grossAmount.toString(),
          totalHpp:       totalHpp.toString(),
          grossProfit:    grossProfit.toString(),
          cashReceived:   cashReceivedTotal !== null ? cashReceivedTotal.toString() : null,
          changeAmount:   changeAmount !== null ? changeAmount.toString() : null,
          idempotencyKey,
          requestHash:    idempotencyKey ? requestHash : null,
        })
        .returning({
          id:            transactions.id,
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
          amount:        p.amount.toString(),
          cashReceived:  p.cashReceived !== undefined ? p.cashReceived.toString() : null,
          changeAmount:  p.changeAmount !== undefined ? p.changeAmount.toString() : null,
        })),
      );

      // Step 3: Decrement stok atomik + guard
      for (const item of itemsByLockOrder) {
        const updated = await tx
          .update(products)
          .set({
            stockQty:  sql`${products.stockQty} - ${item.qty}`,
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

  try {
    // Unique violation (23505) punya dua kemungkinan penyebab:
    //  (a) kunci idempotensi sudah direbut request kembar → kembalikan hasilnya (replay)
    //  (b) nomor invoice bentrok → ulang dengan nomor baru
    // Stok ikut di-rollback oleh transaksi yang gagal, jadi aman diulang.
    let result: Awaited<ReturnType<typeof runTransaction>> | undefined;
    for (let attempt = 1; attempt <= MAX_INVOICE_ATTEMPTS; attempt++) {
      try {
        result = await runTransaction(generateInvoiceNumber());
        break;
      } catch (err) {
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
        transactionId:  result.id,
        invoiceNumber:  result.invoiceNumber,
        grossAmount,
        changeAmount,
        paymentMethod:  primaryPaymentMethod,
        payments:       normalizedPayments,
      },
      201,
    );
  } catch (err) {
    // Unique constraint violation yang tidak terselesaikan (invoice bentrok berulang)
    if (readPgCode(err) === '23505') {
      return apiError('Nomor invoice duplikat. Silakan coba lagi.', 503);
    }

    // Handle race condition: stok berubah di antara pre-check dan tx
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') {
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

    return apiError('Transaksi gagal. Silakan coba lagi.', 500);
  }
}
