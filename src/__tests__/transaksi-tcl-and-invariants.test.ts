/**
 * Comprehensive Test Suite — Smartkasir Perwira (UKM Wiramart UNPERBA)
 * Mencakup:
 *   1. Unit Test (Hash Idempotensi & Klasifikasi Langkah Gagal TCL)
 *   2. Integrasi TCL (STARTED → COMMITTED, REJECTED, ROLLED_BACK, Idempotency Replay/409)
 *   3. Konkurensi / Race Condition (2 transaksi berebut stok terakhir secara paralel)
 *   4. Invarian & Relasi Database (0 stok negatif, 0 orphan FK, konsistensi 3NF/snapshot)
 *
 * KEAMANAN: Wajib berjalan di STAGING (.env.local). Menolak berjalan jika terdeteksi URL produksi.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  products,
  employees,
  shifts,
  transactions,
  transactionItems,
  transactionPayments,
  transactionLogs,
} from '@/lib/db/schema';
import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import { signAccessToken } from '@/lib/utils/auth';
import { POST as postTransaksi } from '@/app/api/kasir/transaksi/route';

// ── Guard Keamanan: Haram menyentuh DB Produksi saat testing ──
const dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.includes('pzppldiswknbihondojq')) {
  throw new Error('FATAL GUARD: Test suite dilarang keras berjalan di database PRODUKSI!');
}

// Helper unit yang diuji (identik dengan logika di route.ts)
function hashRequest(
  items: ReadonlyArray<{ productId: string; qty: number; discountPolicyId?: string }>,
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

function deriveFailedStep(msg: string): string {
  if (msg.startsWith('INSUFFICIENT_STOCK')) return 'KURANGI_STOK';
  if (msg.startsWith('PRODUCT_NOT_FOUND'))  return 'VALIDASI_PRODUK';
  if (msg.includes('transaction_items'))     return 'INSERT_ITEM';
  if (msg.includes('transaction_payments'))  return 'INSERT_PAYMENT';
  if (msg.includes('stock_batches'))         return 'UPDATE_BATCH';
  if (msg.includes('transactions'))          return 'INSERT_TX';
  return 'UNKNOWN';
}

describe('1. Unit Tests — Idempotensi & Klasifikasi TCL', () => {
  it('menghasilkan SHA-256 hash identik meskipun urutan item dibalik', () => {
    const h1 = hashRequest(
      [
        { productId: 'prod-b', qty: 2 },
        { productId: 'prod-a', qty: 1 },
      ],
      [{ paymentMethod: 'CASH', amount: 15000, cashReceived: 20000 }],
    );
    const h2 = hashRequest(
      [
        { productId: 'prod-a', qty: 1 },
        { productId: 'prod-b', qty: 2 },
      ],
      [{ paymentMethod: 'CASH', amount: 15000, cashReceived: 20000 }],
    );
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  it('menghasilkan hash berbeda jika kuantitas atau metode bayar berubah', () => {
    const h1 = hashRequest(
      [{ productId: 'prod-a', qty: 1 }],
      [{ paymentMethod: 'QRIS', amount: 5000 }],
    );
    const h2 = hashRequest(
      [{ productId: 'prod-a', qty: 2 }],
      [{ paymentMethod: 'QRIS', amount: 5000 }],
    );
    assert.notEqual(h1, h2);
  });

  it('memetakan pesan error ke kode failed_step dengan akurat', () => {
    assert.equal(deriveFailedStep('INSUFFICIENT_STOCK:Aqua:0'), 'KURANGI_STOK');
    assert.equal(deriveFailedStep('PRODUCT_NOT_FOUND:123'), 'VALIDASI_PRODUK');
    assert.equal(deriveFailedStep('insert into "transaction_items" failed'), 'INSERT_ITEM');
    assert.equal(deriveFailedStep('something else'), 'UNKNOWN');
  });
});

describe('2. Integrasi TCL (COMMIT, REJECTED, ROLLED_BACK, Idempotency) & 3. Konkurensi', () => {
  let testEmployeeId = '';
  let testShiftId = '';
  let testToken = '';
  let testProductId = '';
  let initialStock = 0;
  let sellingPrice = 0;
  const createdTxIds: string[] = [];
  const createdLogIds: string[] = [];

  before(async () => {
    // Ambil 1 kasir aktif dan 1 produk aktif dengan stok >= 5 dan harga jual >= HPP
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.isActive, true))
      .limit(1);
    assert.ok(emp, 'Harus ada minimal 1 karyawan aktif di staging');
    testEmployeeId = emp.id;

    testToken = await signAccessToken({
      sub: emp.id,
      role: 'employee',
      name: `${emp.fullName} (Testing)`,
    });

    // Buat 1 sandbox shift untuk pengujian
    const [s] = await db
      .insert(shifts)
      .values({
        employeeId: emp.id,
        status: 'ACTIVE',
        modalAwal: '100000.00',
        notes: '[LOCALHOST DEMO SANDBOX] Shift terisolasi khusus pengujian',
        auditFlags: 'NORMAL',
      })
      .returning({ id: shifts.id });
    testShiftId = s.id;

    const [prod] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isActive, true),
          isNull(products.deletedAt),
          gt(products.stockQty, 5),
          sql`${products.sellingPrice} >= ${products.costPrice}`,
        ),
      )
      .limit(1);
    assert.ok(prod, 'Harus ada minimal 1 produk aktif dengan stok > 5 di staging');
    testProductId = prod.id;
    initialStock = prod.stockQty;
    sellingPrice = Number(prod.sellingPrice);
  });

  after(async () => {
    // Bersihkan data uji dan kembalikan stok produk ke nilai semula
    for (const txId of createdTxIds) {
      await db.delete(transactionLogs).where(eq(transactionLogs.transactionId, txId));
      await db.delete(transactionPayments).where(eq(transactionPayments.transactionId, txId));
      await db.delete(transactionItems).where(eq(transactionItems.transactionId, txId));
      await db.delete(transactions).where(eq(transactions.id, txId));
    }
    for (const logId of createdLogIds) {
      await db.delete(transactionLogs).where(eq(transactionLogs.id, logId));
    }
    // Bersihkan log REJECTED/ROLLED_BACK yang dibuat selama test oleh kasir ini dalam 2 menit terakhir
    await db.execute(sql`
      DELETE FROM transaction_logs
      WHERE employee_id = ${testEmployeeId}::uuid
        AND outcome IN ('REJECTED', 'ROLLED_BACK')
        AND created_at > now() - interval '2 minutes'
    `);
    // Bersihkan sandbox shift yang dibuat saat test
    if (testShiftId) {
      await db.delete(shifts).where(eq(shifts.id, testShiftId));
    }
    // Kembalikan stok produk seperti semula
    if (testProductId) {
      await db
        .update(products)
        .set({ stockQty: initialStock })
        .where(eq(products.id, testProductId));
    }
  });

  it('Siklus COMMITTED + Idempotency Replay + 409 Conflict berjalan atomik', async () => {
    const idemKey = `test_idem_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const bodyObj = {
      items: [{ productId: testProductId, qty: 1 }],
      paymentMethod: 'QRIS',
    };

    const req1 = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idemKey,
        cookie: `sk_kasir=${testToken}`,
        host: 'localhost:3000',
      },
      body: JSON.stringify(bodyObj),
    });

    const res1 = await postTransaksi(req1);
    const json1 = (await res1.json()) as {
      success: boolean;
      data?: { transactionId: string; invoiceNumber: string; grossAmount: number; replayed?: boolean };
    };

    assert.equal(res1.status, 201);
    assert.equal(json1.success, true);
    assert.ok(json1.data?.transactionId);
    createdTxIds.push(json1.data.transactionId);

    // Verifikasi bukti COMMITTED di tabel transaction_logs
    const [logRow] = await db
      .select()
      .from(transactionLogs)
      .where(eq(transactionLogs.transactionId, json1.data.transactionId))
      .limit(1);

    assert.ok(logRow, 'Baris transaction_logs harus ada untuk transaksi yang COMMIT');
    assert.equal(logRow.outcome, 'COMMITTED');
    assert.equal(logRow.invoiceAttempt, json1.data.invoiceNumber);
    assert.ok(logRow.finishedAt, 'finished_at harus terisi saat COMMITTED');
    assert.equal(logRow.rollbackReason, null);

    // Verifikasi stok berkurang tepat 1
    const [prodAfter1] = await db
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(eq(products.id, testProductId));
    assert.equal(prodAfter1.stockQty, initialStock - 1);

    // Replay dengan Idempotency-Key yang sama → harus 200 replayed: true & stok TIDAK berkurang lagi
    const reqReplay = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idemKey,
        cookie: `sk_kasir=${testToken}`,
        host: 'localhost:3000',
      },
      body: JSON.stringify(bodyObj),
    });
    const resReplay = await postTransaksi(reqReplay);
    const jsonReplay = (await resReplay.json()) as {
      success: boolean;
      data?: { transactionId: string; replayed?: boolean };
    };
    assert.equal(resReplay.status, 200);
    assert.equal(jsonReplay.data?.replayed, true);
    assert.equal(jsonReplay.data?.transactionId, json1.data.transactionId);

    const [prodAfterReplay] = await db
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(eq(products.id, testProductId));
    assert.equal(prodAfterReplay.stockQty, initialStock - 1, 'Replay tidak boleh mengurangi stok dua kali');

    // Kunci sama tapi isi keranjang berbeda → harus 409 Conflict
    const reqConflict = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idemKey,
        cookie: `sk_kasir=${testToken}`,
        host: 'localhost:3000',
      },
      body: JSON.stringify({
        items: [{ productId: testProductId, qty: 2 }],
        paymentMethod: 'QRIS',
      }),
    });
    const resConflict = await postTransaksi(reqConflict);
    assert.equal(resConflict.status, 409);
  });

  it('Siklus REJECTED (Pra-DB Guard) mencatat log REJECTED saat stok tidak cukup', async () => {
    const reqReject = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `sk_kasir=${testToken}`,
        host: 'localhost:3000',
      },
      body: JSON.stringify({
        items: [{ productId: testProductId, qty: 999999 }],
        paymentMethod: 'QRIS',
      }),
    });

    const res = await postTransaksi(reqReject);
    assert.equal(res.status, 400);

    // Pastikan tercatat di transaction_logs dengan outcome = REJECTED
    const logs = await db
      .select()
      .from(transactionLogs)
      .where(
        and(
          eq(transactionLogs.employeeId, testEmployeeId),
          eq(transactionLogs.outcome, 'REJECTED'),
          eq(transactionLogs.failedStep, 'PRE_CHECK_STOK'),
        ),
      );
    assert.ok(logs.length >= 1, 'Penolakan stok pra-DB wajib tercatat sebagai REJECTED');
  });

  it('Siklus ROLLED_BACK & Konkurensi: 2 transaksi paralel berebut 1 stok terakhir → 1 COMMIT, 1 ROLLBACK', async () => {
    // Set stok produk menjadi tepat 1
    await db.update(products).set({ stockQty: 1 }).where(eq(products.id, testProductId));

    // Simulasikan 2 transaksi DB konkuren yang masing-masing diawali log STARTED
    const runCompetingTx = async (label: string) => {
      const logId = randomUUID();
      createdLogIds.push(logId);

      await db.insert(transactionLogs).values({
        id: logId,
        employeeId: testEmployeeId,
        invoiceAttempt: null,
        attemptNumber: 1,
        itemCount: 1,
        grossAmount: sellingPrice.toString(),
        paymentMethod: 'QRIS',
        outcome: 'STARTED',
      });

      const inv = `INV-RACE-${label}-${Date.now()}`;
      try {
        const txRow = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(transactions)
            .values({
              invoiceNumber: inv,
              shiftId: testShiftId,
              employeeId: testEmployeeId,
              paymentMethod: 'QRIS',
              status: 'COMPLETED',
              grossAmount: sellingPrice.toString(),
              totalHpp: '0',
              grossProfit: sellingPrice.toString(),
              isTest: true,
            })
            .returning({ id: transactions.id });

          const dec = await tx
            .update(products)
            .set({ stockQty: sql`${products.stockQty} - 1` })
            .where(
              and(
                eq(products.id, testProductId),
                sql`${products.stockQty} >= 1`,
              ),
            )
            .returning({ newStock: products.stockQty });

          if (dec.length === 0) {
            throw new Error(`INSUFFICIENT_STOCK:ProdukUji:0`);
          }
          return inserted;
        });

        createdTxIds.push(txRow.id);
        await db
          .update(transactionLogs)
          .set({
            outcome: 'COMMITTED',
            transactionId: txRow.id,
            invoiceAttempt: inv,
            finishedAt: new Date(),
          })
          .where(eq(transactionLogs.id, logId));
        return 'COMMITTED';
      } catch (err) {
        const msg = (err as Error).message;
        await db
          .update(transactionLogs)
          .set({
            outcome: 'ROLLED_BACK',
            invoiceAttempt: inv,
            rollbackReason: msg,
            failedStep: deriveFailedStep(msg),
            finishedAt: new Date(),
          })
          .where(eq(transactionLogs.id, logId));
        return 'ROLLED_BACK';
      }
    };

    const outcomes = await Promise.all([runCompetingTx('A'), runCompetingTx('B')]);
    const committedCount = outcomes.filter((o) => o === 'COMMITTED').length;
    const rolledBackCount = outcomes.filter((o) => o === 'ROLLED_BACK').length;

    assert.equal(committedCount, 1, 'Tepat 1 transaksi yang boleh COMMIT');
    assert.equal(rolledBackCount, 1, 'Tepat 1 transaksi harus ROLLED_BACK');

    // Stok akhir harus tepat 0 (tidak boleh minus -1)
    const [prodAfterRace] = await db
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(eq(products.id, testProductId));
    assert.equal(prodAfterRace.stockQty, 0, 'Stok akhir wajib 0 (anti-overselling)');
  });
});

describe('4. Invarian & Normalisasi Database (Data Integrity Audit)', () => {
  it('tidak ada produk atau batch dengan stok negatif', async () => {
    const res = await db.execute<{ neg_prod: number; neg_batch: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM products WHERE stock_qty < 0) AS neg_prod,
        (SELECT count(*)::int FROM stock_batches WHERE current_qty < 0) AS neg_batch
    `);
    assert.equal(res[0].neg_prod, 0, 'Tidak boleh ada produk dengan stock_qty < 0');
    assert.equal(res[0].neg_batch, 0, 'Tidak boleh ada stock_batches dengan current_qty < 0');
  });

  it('tidak ada orphan foreign key di transaction_items, transaction_payments, dan transaction_logs', async () => {
    const res = await db.execute<{
      orphan_items: number;
      orphan_payments: number;
      orphan_log_tx: number;
      orphan_log_shift: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM transaction_items ti LEFT JOIN transactions t ON t.id = ti.transaction_id WHERE t.id IS NULL) AS orphan_items,
        (SELECT count(*)::int FROM transaction_payments tp LEFT JOIN transactions t ON t.id = tp.transaction_id WHERE t.id IS NULL) AS orphan_payments,
        (SELECT count(*)::int FROM transaction_logs tl LEFT JOIN transactions t ON t.id = tl.transaction_id WHERE tl.transaction_id IS NOT NULL AND t.id IS NULL) AS orphan_log_tx,
        (SELECT count(*)::int FROM transaction_logs tl LEFT JOIN shifts s ON s.id = tl.shift_id WHERE tl.shift_id IS NOT NULL AND s.id IS NULL) AS orphan_log_shift
    `);
    assert.equal(res[0].orphan_items, 0);
    assert.equal(res[0].orphan_payments, 0);
    assert.equal(res[0].orphan_log_tx, 0);
    assert.equal(res[0].orphan_log_shift, 0);
  });

  it('konsistensi 3NF: gross_amount header selalu sama dengan SUM(transaction_items.subtotal_sell)', async () => {
    const res = await db.execute<{ mismatch_count: number }>(sql`
      SELECT count(*)::int AS mismatch_count
      FROM (
        SELECT t.id, t.gross_amount, COALESCE(SUM(ti.subtotal_sell), 0) AS sum_items
        FROM transactions t
        JOIN transaction_items ti ON ti.transaction_id = t.id
        GROUP BY t.id, t.gross_amount
        HAVING ABS(t.gross_amount - COALESCE(SUM(ti.subtotal_sell), 0)) > 1
      ) sub
    `);
    assert.equal(res[0].mismatch_count, 0, 'gross_amount harus selalu konsisten dengan jumlah subtotal item');
  });
});
