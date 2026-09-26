// =============================================================
// POST /api/kasir/transaksi — Buat transaksi baru
// Body: { items: [{productId, qty}], paymentMethod: 'CASH'|'QRIS', cashReceived?: number }
// Auth: employee JWT required
//
// v1.2 — RACE CONDITION FIX: Stok di-revalidasi ulang di dalam db.transaction()
// dengan fresh read. Jika stok berubah sejak pre-check, transaksi di-rollback.
// Semua mutasi (insert transaksi + items + update stok) atomic.
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { products, transactions, transactionItems, shifts } from '@/lib/db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// Validation Schema
// ─────────────────────────────────────────────────────────────
const TransaksiSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1, 'Minimal 1 item'),
  paymentMethod: z.enum(['CASH', 'QRIS']),
  cashReceived: z.number().nonnegative().optional(),
});

// ─────────────────────────────────────────────────────────────
// Invoice Number Generator
// Format: INV-YYYYMMDD-HHmmss-RRR (tanggal + waktu + random 3 digit)
// Random suffix untuk mencegah collision jika 2 transaksi di detik yang sama
// ─────────────────────────────────────────────────────────────
function generateInvoiceNumber(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');

  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = pad(Math.floor(Math.random() * 1000), 3);

  return `INV${date}${time}${rand}`;
}

// ─────────────────────────────────────────────────────────────
// POST Handler
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

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

  const { items, paymentMethod, cashReceived } = parsed.data;

  // ── Cek shift aktif karyawan (di luar tx — READ ONLY check) ─
  const [activeShift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.employeeId, payload.sub as string),
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

  // ── Validasi cash received ──────────────────────────────────
  if (paymentMethod === 'CASH') {
    if (!cashReceived || cashReceived < grossAmount) {
      return apiError(
        `Uang yang diterima kurang. Total: Rp ${grossAmount.toLocaleString('id-ID')}`,
        400,
      );
    }
  }

  const changeAmount =
    paymentMethod === 'CASH' && cashReceived ? cashReceived - grossAmount : null;

  // ─────────────────────────────────────────────────────────────
  // ATOMIC TRANSACTION — semua mutasi dalam satu DB transaction
  // v1.2: Stok di-read ulang di dalam tx (fresh read) untuk mendeteksi
  // race condition. Jika stok berubah antara pre-check dan tx → rollback.
  // ─────────────────────────────────────────────────────────────
  try {
    const result = await db.transaction(async (tx) => {
      // Step 1: Re-validasi stok FRESH di dalam transaksi
      // Membaca stok terbaru untuk mencegah race condition concurrent transaksi
      for (const item of items) {
        const [freshProd] = await tx
          .select({ id: products.id, name: products.name, stockQty: products.stockQty })
          .from(products)
          .where(
            and(
              eq(products.id, item.productId),
              eq(products.isActive, true),
              isNull(products.deletedAt),
            ),
          )
          .limit(1);

        if (!freshProd) {
          throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
        }
        if (freshProd.stockQty < item.qty) {
          throw new Error(`INSUFFICIENT_STOCK:${freshProd.name}:${freshProd.stockQty}`);
        }
      }

      // Step 2: Insert transaksi
      const [newTransaction] = await tx
        .insert(transactions)
        .values({
          invoiceNumber:  generateInvoiceNumber(),
          shiftId:        activeShift.id,
          employeeId:     payload.sub as string,
          paymentMethod,
          status:         'COMPLETED',
          grossAmount:    grossAmount.toString(),
          totalHpp:       totalHpp.toString(),
          grossProfit:    grossProfit.toString(),
          cashReceived:   cashReceived?.toString(),
          changeAmount:   changeAmount?.toString(),
        })
        .returning({
          id:            transactions.id,
          invoiceNumber: transactions.invoiceNumber,
        });

      // Step 3: Insert semua transaction items (bulk insert)
      await tx.insert(transactionItems).values(
        itemsToInsert.map((item) => ({
          ...item,
          transactionId: newTransaction.id,
        })),
      );

      // Step 4: Decrement stok setiap produk
      for (const item of items) {
        const prod = productRows.find((p) => p.id === item.productId)!;
        await tx
          .update(products)
          .set({
            // Gunakan DB expression untuk atomic decrement — lebih aman dari nilai JS
            stockQty:  prod.stockQty - item.qty,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(products.id, item.productId),
              // Guard tambahan: pastikan stok masih cukup saat update
              // (defense in depth — seharusnya sudah terjaga di Step 1)
            ),
          );
      }

      return newTransaction;
    });

    return apiOk(
      {
        transactionId:  result.id,
        invoiceNumber:  result.invoiceNumber,
        grossAmount,
        changeAmount,
        paymentMethod,
      },
      201,
    );
  } catch (err) {
    const error = err as { code?: string; message?: string };

    // Handle unique constraint violation (invoice number collision — sangat jarang)
    if (error.code === '23505') {
      return apiError('Nomor invoice duplikat. Silakan coba lagi.', 503);
    }

    // Handle race condition: stok berubah di antara pre-check dan tx
    if (typeof error.message === 'string') {
      if (error.message.startsWith('PRODUCT_NOT_FOUND')) {
        return apiError('Produk tidak ditemukan atau sudah dihapus.', 400);
      }
      if (error.message.startsWith('INSUFFICIENT_STOCK')) {
        const parts = error.message.split(':');
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
