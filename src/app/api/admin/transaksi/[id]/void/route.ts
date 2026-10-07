// =============================================================
// POST /api/admin/transaksi/[id]/void — Batalkan transaksi (void)
// Params: id = transaction UUID
// Body:   { alasan: string }
// Auth:   Admin only
//
// Logic:
// 1. Verifikasi admin auth
// 2. Fetch transaksi + items (READ di luar tx)
// 3. Guard: status harus COMPLETED, umur < 24 jam
// 4. ATOMIC TX:
//    a. Update transactions.status → VOID dengan guard WHERE status='COMPLETED'
//       (cek ganda untuk race condition — dua admin void bersamaan)
//    b. Kembalikan stok setiap produk ATOMIK: stock_qty = stock_qty + qty
//       (bukan nilai JS basi) — lock ordering by productId agar tanpa deadlock
//    c. Catat di audit_logs
//
// v1.1 — Fix D16 (Fase 0.5):
//  • Stok dikembalikan via UPDATE atomik `stock_qty = stock_qty + qty`.
//    Nilai JS yang dibaca SEBELUM transaksi tidak lagi dipakai → tidak ada
//    stok negatif/loncat saat dua kasir/admin void bersamaan.
//  • Lock ordering deterministik by productId mencegah deadlock.
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  transactions,
  transactionItems,
  products,
  auditLogs,
} from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// 24 jam dalam milidetik
const VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

const voidSchema = z.object({
  alasan: z
    .string()
    .trim()
    .min(1, 'Alasan void wajib diisi.')
    .min(5, 'Alasan terlalu pendek (minimum 5 karakter).')
    .max(300, 'Alasan terlalu panjang (maksimum 300 karakter).'),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  try {
    const session = await requireAdmin();
    const { id: transactionId } = await params;

    // Validasi UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(transactionId)) {
      return apiError('ID transaksi tidak valid.', 'INVALID_ID', 400);
    }

    // ── Validasi body ────────────────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Format request tidak valid.', 'INVALID_JSON', 400);
    }

    const parsed = voidSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? 'Data tidak valid.',
        'VALIDATION_ERROR',
        422,
      );
    }

    const { alasan } = parsed.data;

    // ── Fetch transaksi + items (READ di luar tx) ────────────
    const trx = await db.query.transactions.findFirst({
      where: eq(transactions.id, transactionId),
      columns: {
        id:            true,
        invoiceNumber: true,
        status:        true,
        createdAt:     true,
        employeeId:    true,
      },
    });

    if (!trx) {
      return apiError('Transaksi tidak ditemukan.', 'NOT_FOUND', 404);
    }

    if (trx.status === 'VOID') {
      return apiError(
        'Transaksi ini sudah di-void sebelumnya.',
        'ALREADY_VOIDED',
        409,
      );
    }

    if (trx.status !== 'COMPLETED') {
      return apiError(
        'Hanya transaksi berstatus COMPLETED yang bisa di-void.',
        'INVALID_STATUS',
        422,
      );
    }

    // ── Cek batas waktu 24 jam ───────────────────────────────
    const ageMs = Date.now() - new Date(trx.createdAt).getTime();
    if (ageMs > VOID_WINDOW_MS) {
      const hours = Math.floor(ageMs / 3600000);
      return apiError(
        `Transaksi sudah berumur ${hours} jam. Void hanya diizinkan dalam 24 jam pertama.`,
        'VOID_WINDOW_EXPIRED',
        422,
      );
    }

    // ── Fetch transaction items untuk reverse stok ───────────
    const itemsRaw = await db
      .select({
        productId: transactionItems.productId,
        qty:       transactionItems.qty,
      })
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, transactionId));

    if (itemsRaw.length === 0) {
      return apiError(
        'Item transaksi tidak ditemukan. Tidak dapat memproses void.',
        'NO_ITEMS',
        422,
      );
    }

    // ─────────────────────────────────────────────────────────
    // ATOMIC TRANSACTION — void + reverse stok atomik + audit log
    //
    // D16 Fix: Stok dikembalikan via `stock_qty = stock_qty + qty`
    // (atomik di server DB, bukan nilai JS yang dibaca sebelumnya).
    // Lock ordering by productId mencegah deadlock saat dua void
    // menyentuh produk yang sama dalam urutan berbeda.
    // ─────────────────────────────────────────────────────────
    const now = new Date();

    // Sort items by productId untuk lock ordering deterministik
    const itemsByLockOrder = [...itemsRaw].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );

    await db.transaction(async (tx) => {
      // Step 1: Update status transaksi → VOID dengan guard WHERE status='COMPLETED'
      // Guard ini penting: jika dua admin menekan void bersamaan, hanya satu yang sukses.
      const updated = await tx
        .update(transactions)
        .set({
          status:           'VOID',
          voidReason:       alasan,
          voidedByAdminId:  session.sub,
          voidedAt:         now,
          updatedAt:        now,
        })
        .where(
          and(
            eq(transactions.id, transactionId),
            eq(transactions.status, 'COMPLETED'), // guard race condition
          ),
        )
        .returning({ id: transactions.id });

      // Jika baris tidak terupdate, transaksi sudah di-void duluan oleh request lain
      if (updated.length === 0) {
        throw new Error('ALREADY_VOIDED_RACE');
      }

      // Step 2: Kembalikan stok ATOMIK — stock_qty = stock_qty + qty
      // Tidak ada nilai JS yang dibaca; Postgres langsung menjumlahkan di server.
      for (const item of itemsByLockOrder) {
        await tx
          .update(products)
          .set({
            stockQty:  sql`${products.stockQty} + ${item.qty}`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId));
      }

      // Step 3: Catat di audit_logs
      await tx.insert(auditLogs).values({
        tableName:  'transactions',
        recordId:   transactionId,
        action:     'UPDATE',
        oldValues:  JSON.stringify({ status: 'COMPLETED' }),
        newValues:  JSON.stringify({
          status:          'VOID',
          voidReason:      alasan,
          voidedByAdminId: session.sub,
          voidedAt:        now.toISOString(),
        }),
        actorType:  'ADMIN',
        actorId:    session.sub,
      });
    });

    return apiOk({
      transactionId,
      invoiceNumber: trx.invoiceNumber,
      status:        'VOID',
      voidedAt:      now.toISOString(),
      message:       `Transaksi ${trx.invoiceNumber} berhasil di-void. Stok ${itemsRaw.length} produk telah dikembalikan.`,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    // Race condition: transaksi sudah di-void oleh request lain
    if (err instanceof Error && err.message === 'ALREADY_VOIDED_RACE') {
      return apiError(
        'Transaksi ini sudah di-void oleh permintaan lain. Muat ulang halaman.',
        'ALREADY_VOIDED',
        409,
      );
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
