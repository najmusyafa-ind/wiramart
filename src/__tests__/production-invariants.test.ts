/**
 * Read-Only Production Invariants & Schema Verification Suite — Smartkasir Perwira
 *
 * Seluruh query database bersifat READ-ONLY (hanya SELECT) dan aman dijalankan terhadap
 * database Production (.env.local / ref pzppldiswknbihondojq).
 *
 * Pengujian write / rollback / race-condition tetap diisolasi pada script:
 *   `npm run test:staging` -> `src/__tests__/transaksi-tcl-and-invariants.test.ts` (.env.staging)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl) {
  throw new Error('FATAL GUARD: DATABASE_URL kosong — pastikan menjalankan dengan --env-file=.env.local');
}
if (!dbUrl.includes('pzppldiswknbihondojq')) {
  throw new Error(
    'FATAL GUARD: `npm test` harus mengarah ke database PRODUCTION (pzppldiswknbihondojq). Gunakan `npm run test:staging` untuk Staging.',
  );
}

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
  if (msg.startsWith('PRODUCT_NOT_FOUND')) return 'VALIDASI_PRODUK';
  if (msg.includes('transaction_items')) return 'INSERT_ITEM';
  if (msg.includes('transaction_payments')) return 'INSERT_PAYMENT';
  if (msg.includes('stock_batches')) return 'UPDATE_BATCH';
  if (msg.includes('transactions')) return 'INSERT_TX';
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

describe('2. Invarian & Normalisasi Database Production (Read-Only)', () => {
  it('tidak ada produk atau batch dengan stok negatif', async () => {
    const res = await db.execute<{ neg_prod: number; neg_batch: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM public.products WHERE stock_qty < 0) AS neg_prod,
        (SELECT count(*)::int FROM public.stock_batches WHERE current_qty < 0) AS neg_batch
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
        (SELECT count(*)::int FROM public.transaction_items ti LEFT JOIN public.transactions t ON t.id = ti.transaction_id WHERE t.id IS NULL) AS orphan_items,
        (SELECT count(*)::int FROM public.transaction_payments tp LEFT JOIN public.transactions t ON t.id = tp.transaction_id WHERE t.id IS NULL) AS orphan_payments,
        (SELECT count(*)::int FROM public.transaction_logs tl LEFT JOIN public.transactions t ON t.id = tl.transaction_id WHERE tl.transaction_id IS NOT NULL AND t.id IS NULL) AS orphan_log_tx,
        (SELECT count(*)::int FROM public.transaction_logs tl LEFT JOIN public.shifts s ON s.id = tl.shift_id WHERE tl.shift_id IS NOT NULL AND s.id IS NULL) AS orphan_log_shift
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
        FROM public.transactions t
        JOIN public.transaction_items ti ON ti.transaction_id = t.id
        GROUP BY t.id, t.gross_amount
        HAVING ABS(t.gross_amount - COALESCE(SUM(ti.subtotal_sell), 0)) > 1
      ) sub
    `);
    assert.equal(res[0].mismatch_count, 0, 'gross_amount harus selalu konsisten dengan jumlah subtotal item');
  });
});

describe('3. Public Schema v4.3, RLS Security, Index & Delivery Buckets (Read-Only)', () => {
  it('seluruh 34 tabel berada di schema public dan 0 tabel tersisa di schema domain lama', async () => {
    const counts = await db.execute<{ schemaname: string; table_count: number }>(sql`
      SELECT schemaname, count(*)::int AS table_count
      FROM pg_tables
      WHERE schemaname IN ('public', 'core', 'hr', 'gudang', 'pos', 'finance', 'delivery')
      GROUP BY schemaname
      ORDER BY schemaname
    `);
    const map = new Map(counts.map((r) => [r.schemaname, r.table_count]));
    assert.equal(map.get('public') ?? 0, 34, 'Seluruh 34 tabel aplikasi wajib berada di schema public');
    for (const oldSchema of ['core', 'hr', 'gudang', 'pos', 'finance', 'delivery']) {
      assert.equal(map.get(oldSchema) ?? 0, 0, `Schema lama ${oldSchema} harus kosong`);
    }
  });

  it('ke-34 tabel mengaktifkan RLS serta memiliki policy deny anon & authenticated', async () => {
    const weakTables = await db.execute<{ schemaname: string; tablename: string }>(sql`
      SELECT t.schemaname, t.tablename
      FROM pg_tables t
      WHERE t.schemaname = 'public'
        AND (
          t.rowsecurity = false
          OR NOT EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename AND 'anon'::name = ANY(p.roles)
          )
          OR NOT EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename AND 'authenticated'::name = ANY(p.roles)
          )
        )
    `);
    assert.equal(weakTables.length, 0, `Tabel tanpa RLS lengkap: ${JSON.stringify(weakTables)}`);
  });

  it('kolom redundan 3NF telah dibersihkan & FK gudang tidak memiliki orphan', async () => {
    const droppedCols = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'stock_receive_drafts' AND column_name = 'supplier_name')
          OR (table_name = 'stock_receive_items' AND column_name = 'product_name')
          OR (table_name = 'product_condition_reports' AND column_name IN ('product_id', 'expiry_date'))
          OR (table_name = 'discount_barcodes' AND column_name IN ('product_id', 'discounted_price', 'discount_pct', 'valid_until'))
        )
    `);
    assert.equal(droppedCols.length, 0, `Kolom 3NF redundan masih ada: ${JSON.stringify(droppedCols)}`);

    const orphanFks = await db.execute<{
      orphan_batch_supplier: number;
      orphan_batch_receive_item: number;
      orphan_adj_batch: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM public.stock_batches sb LEFT JOIN public.suppliers s ON s.id = sb.supplier_id WHERE sb.supplier_id IS NOT NULL AND s.id IS NULL) AS orphan_batch_supplier,
        (SELECT count(*)::int FROM public.stock_batches sb LEFT JOIN public.stock_receive_items sri ON sri.id = sb.receive_item_id WHERE sb.receive_item_id IS NOT NULL AND sri.id IS NULL) AS orphan_batch_receive_item,
        (SELECT count(*)::int FROM public.stock_adjustments sa LEFT JOIN public.stock_batches sb ON sb.id = sa.batch_id WHERE sa.batch_id IS NOT NULL AND sb.id IS NULL) AS orphan_adj_batch
    `);
    assert.equal(orphanFks[0].orphan_batch_supplier, 0);
    assert.equal(orphanFks[0].orphan_batch_receive_item, 0);
    assert.equal(orphanFks[0].orphan_adj_batch, 0);
  });

  it('unique index shift aktif & seluruh bucket Storage Delivery (v2.5) tersedia', async () => {
    const idx = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'shifts'
        AND indexname = 'idx_shifts_one_active_per_employee'
    `);
    assert.equal(idx.length, 1, 'Index idx_shifts_one_active_per_employee wajib ada di public.shifts');

    const buckets = await db.execute<{ id: string }>(sql`
      SELECT id FROM storage.buckets WHERE id IN ('qris', 'product-images', 'payment-proofs')
    `);
    assert.equal(
      buckets.length,
      3,
      `Bucket storage kurang: ditemukan ${JSON.stringify(buckets.map((b) => b.id))}`,
    );
  });
});
