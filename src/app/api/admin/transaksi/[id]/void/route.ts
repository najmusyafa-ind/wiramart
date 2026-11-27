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
import { eq, and, sql, desc, inArray, gte, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  shifts,
  transactions,
  transactionItems,
  products,
  stockBatches,
  auditLogs,
  dailyClosings,
} from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError, getTodayWib } from '@/lib/utils/helpers';
import { recalculateGraceShiftShortage } from '@/lib/services/shiftShortageService';

export const runtime = 'nodejs';

// Manager: 24 jam | Admin Shift: 10 menit & maks 3x VOID per hari (anti-fraud retail)
const VOID_WINDOW_MANAGER_MS = 24 * 60 * 60 * 1000;
const VOID_WINDOW_ADMIN_SHIFT_MS = 10 * 60 * 1000;
const ADMIN_SHIFT_MAX_VOIDS_PER_DAY = 3;
const ADMIN_SHIFT_MIN_REASON_LEN = 10;

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

    // Verifikasi status aktif & role aktual admin di database (Zero-Trust)
    const activeAdmin = await db.query.admins.findFirst({
      where: and(
        eq(admins.id, session.sub),
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
      ),
      columns: { id: true, fullName: true, role: true },
    });
    if (!activeAdmin) {
      return apiError('Akun pengelola tidak aktif atau telah dinonaktifkan.', 'FORBIDDEN', 403);
    }
    const isManager = activeAdmin.role === 'MANAGER';

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
    if (!isManager && alasan.length < ADMIN_SHIFT_MIN_REASON_LEN) {
      return apiError(
        `Alasan void oleh Admin Shift wajib jelas (minimal ${ADMIN_SHIFT_MIN_REASON_LEN} karakter).`,
        'VALIDATION_ERROR',
        422,
      );
    }

    // ── Fetch transaksi + items (READ di luar tx) ────────────
    const trx = await db.query.transactions.findFirst({
      where: eq(transactions.id, transactionId),
      columns: {
        id:            true,
        invoiceNumber: true,
        status:        true,
        createdAt:     true,
        employeeId:    true,
        shiftId:       true,
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

    // ── Cek batas waktu (Manager: 24 jam | Admin Shift: 10 menit + kuota 3x/hari) ──
    const ageMs = Date.now() - new Date(trx.createdAt).getTime();
    if (isManager) {
      if (ageMs > VOID_WINDOW_MANAGER_MS) {
        const hours = Math.floor(ageMs / 3600000);
        return apiError(
          `Transaksi sudah berumur ${hours} jam. Void hanya diizinkan dalam 24 jam pertama.`,
          'VOID_WINDOW_EXPIRED',
          422,
        );
      }
    } else {
      if (ageMs > VOID_WINDOW_ADMIN_SHIFT_MS) {
        const mins = Math.floor(ageMs / 60000);
        return apiError(
          `Transaksi sudah berumur ${mins} menit. Batas VOID mandiri Admin Shift maksimal 10 menit (lewat 10 menit wajib oleh Manager).`,
          'VOID_WINDOW_EXPIRED',
          403,
        );
      }

      const todayStartWib = new Date(`${getTodayWib()}T00:00:00+07:00`);
      const [{ count: todayVoidCount }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(
          and(
            eq(transactions.status, 'VOID'),
            eq(transactions.voidedByAdminId, activeAdmin.id),
            gte(transactions.voidedAt, todayStartWib),
          ),
        );

      if (todayVoidCount >= ADMIN_SHIFT_MAX_VOIDS_PER_DAY) {
        return apiError(
          `Kuota VOID mandiri Admin Shift hari ini sudah mencapai batas (${ADMIN_SHIFT_MAX_VOIDS_PER_DAY}x/hari). Hubungi Manager untuk pembatalan tambahan.`,
          'VOID_DAILY_LIMIT',
          429,
        );
      }
    }

    // ── Guard Tutup Buku (Fase 3 & Bagian 13 I2): Cek apakah tanggal transaksi sudah terkunci ──
    const trxDateStr = new Date(trx.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const lockedDay = await db.query.dailyClosings.findFirst({
      where: and(
        eq(dailyClosings.closingDate, trxDateStr),
        inArray(dailyClosings.status, ['LOCKED', 'AUDITED']),
      ),
    });

    if (lockedDay) {
      return apiError(
        `Transaksi pada tanggal ${trxDateStr} sudah Tutup Buku (${lockedDay.status}). Tidak dapat di-void secara normal. Hubungi Manager Toko.`,
        'DATE_LOCKED',
        403,
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
    // Sinkronisasi Batch (FEFO Reversal): stockBatches.currentQty
    // juga dipulihkan agar saldo batch gudang tidak desinkron.
    // Lock ordering by productId mencegah deadlock saat dua void
    // menyentuh produk yang sama dalam urutan berbeda.
    // ─────────────────────────────────────────────────────────
    const now = new Date();

    // Sort items by productId untuk lock ordering deterministik
    const itemsByLockOrder = [...itemsRaw].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );

    await db.transaction(async (tx) => {
      // Step 0 (Admin Shift anti-TOCTOU): Lock baris admin & verifikasi ulang kuota 3x/hari secara atomik
      if (!isManager) {
        await tx
          .select({ id: admins.id })
          .from(admins)
          .where(eq(admins.id, activeAdmin.id))
          .for('update');

        const todayStartWibTx = new Date(`${getTodayWib(now)}T00:00:00+07:00`);
        const [{ count: lockedVoidCount }] = await tx
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(transactions)
          .where(
            and(
              eq(transactions.status, 'VOID'),
              eq(transactions.voidedByAdminId, activeAdmin.id),
              gte(transactions.voidedAt, todayStartWibTx),
            ),
          );
        if (lockedVoidCount >= ADMIN_SHIFT_MAX_VOIDS_PER_DAY) {
          throw new AppError(
            'VOID_DAILY_LIMIT',
            `Kuota VOID mandiri Admin Shift hari ini sudah mencapai batas (${ADMIN_SHIFT_MAX_VOIDS_PER_DAY}x/hari). Hubungi Manager untuk pembatalan tambahan.`,
            429,
          );
        }
      }

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

      // Step 2: Kembalikan stok ATOMIK — products.stockQty & sinkronkan stockBatches (Reverse FEFO)
      for (const item of itemsByLockOrder) {
        // 2a. Update total stok produk di tabel products
        await tx
          .update(products)
          .set({
            stockQty:  sql`${products.stockQty} + ${item.qty}`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId));

        // 2b. Sinkronisasi pengembalian stok ke batch (Reverse FEFO)
        const candidateBatches = await tx
          .select({
            id:         stockBatches.id,
            initialQty: stockBatches.initialQty,
            currentQty: stockBatches.currentQty,
          })
          .from(stockBatches)
          .where(eq(stockBatches.productId, item.productId))
          .orderBy(desc(stockBatches.expiryDate), desc(stockBatches.createdAt))
          .for('update');

        if (candidateBatches.length > 0) {
          let qtyToRestore = item.qty;

          // Isi kembali batch yang berkurang (currentQty < initialQty)
          for (const b of candidateBatches) {
            if (qtyToRestore <= 0) break;
            const spaceAvailable = Math.max(0, b.initialQty - b.currentQty);
            if (spaceAvailable > 0) {
              const restoreAmount = Math.min(spaceAvailable, qtyToRestore);
              await tx
                .update(stockBatches)
                .set({
                  currentQty: sql`${stockBatches.currentQty} + ${restoreAmount}`,
                  updatedAt:  now,
                })
                .where(eq(stockBatches.id, b.id));
              qtyToRestore -= restoreAmount;
            }
          }

          // Fallback: Jika semua batch sudah berstatus initialQty (atau ada sisa),
          // kembalikan ke batch aktif teratas
          if (qtyToRestore > 0 && candidateBatches[0]) {
            await tx
              .update(stockBatches)
              .set({
                currentQty: sql`${stockBatches.currentQty} + ${qtyToRestore}`,
                updatedAt:  now,
              })
              .where(eq(stockBatches.id, candidateBatches[0].id));
          }
        }
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
          voidedByAdminId: activeAdmin.id,
          voidedByRole:    activeAdmin.role,
          voidedByName:    activeAdmin.fullName,
          voidedAt:        now.toISOString(),
        }),
        actorType:  'ADMIN',
        actorId:    session.sub,
      });
    });

    // Step 4: Jika transaksi milik shift yang sudah CLOSED (dengan hitung fisik),
    // hitung ulang shortageAmount & status laci agar audit laci tetap sinkron.
    if (trx.shiftId) {
      const closedShift = await db.query.shifts.findFirst({
        where: eq(shifts.id, trx.shiftId),
        columns: { id: true, status: true, actualCash: true },
      });
      if (closedShift && closedShift.status === 'CLOSED' && closedShift.actualCash !== null) {
        await recalculateGraceShiftShortage(closedShift.id).catch((e) => {
          console.error('[void] Gagal sinkron ulang selisih laci shift:', e);
        });
      }
    }

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
