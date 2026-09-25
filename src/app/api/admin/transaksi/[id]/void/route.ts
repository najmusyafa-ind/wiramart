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
//    a. Update transactions.status → VOID (+ voidReason, voidedByAdminId, voidedAt)
//    b. Kembalikan stok setiap produk (reverse transactionItems.qty)
//    c. Catat di audit_logs
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
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
    const items = await db
      .select({
        productId: transactionItems.productId,
        qty:       transactionItems.qty,
      })
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, transactionId));

    if (items.length === 0) {
      return apiError(
        'Item transaksi tidak ditemukan. Tidak dapat memproses void.',
        'NO_ITEMS',
        422,
      );
    }

    // ── Fetch stok produk saat ini ───────────────────────────
    const productIds = [...new Set(items.map((i) => i.productId))];

    // Fetch stok saat ini untuk semua produk yang terlibat
    const productMap = new Map<string, number>();
    for (const pid of productIds) {
      const [row] = await db
        .select({ id: products.id, stockQty: products.stockQty })
        .from(products)
        .where(eq(products.id, pid))
        .limit(1);
      if (row) productMap.set(row.id, row.stockQty);
    }

    // ─────────────────────────────────────────────────────────
    // ATOMIC TRANSACTION — void + reverse stok + audit log
    // ─────────────────────────────────────────────────────────
    const now = new Date();

    await db.transaction(async (tx) => {
      // Step 1: Update status transaksi → VOID
      await tx
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
            eq(transactions.status, 'COMPLETED'), // double-check untuk mencegah race condition
          ),
        );

      // Step 2: Kembalikan stok setiap produk
      for (const item of items) {
        const currentQty = productMap.get(item.productId) ?? 0;
        await tx
          .update(products)
          .set({
            stockQty:  currentQty + item.qty,
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
      message:       `Transaksi ${trx.invoiceNumber} berhasil di-void. Stok ${items.length} produk telah dikembalikan.`,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
