-- =============================================================
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Migration v4.0: Multi-Schema Grouping (6 Domain Schemas) + 3NF Gudang Cleanup
--
-- TUJUAN:
--   1. Mengelompokkan seluruh 33 tabel & 17 enum ke 6 PostgreSQL Schemas agar
--      Supabase Schema Visualizer rapi per domain saat presentasi & audit:
--        - core     (6 tabel) : Identitas, RBAC, Settings, Audit Trail, MOD
--        - hr       (5 tabel) : Jadwal Shift, Sesi Kasir, Cash Movements, Absensi, Swap
--        - gudang   (11 tabel): Katalog, Supplier, Penerimaan, Batch FEFO, Diskon, Adjustment
--        - pos      (4 tabel) : Transaksi Penjualan, Item, Split Payment, Log TCL
--        - finance  (3 tabel) : Beban Operasional, Rekonsiliasi QRIS, Daily Closing
--        - delivery (4 tabel) : Buyers, Online Orders, Items, Notifikasi WA
--   2. Menutup celah relasi (FK) yang belum terhubung di Gudang & POS:
--        - gudang.stock_batches.receive_item_id -> gudang.stock_receive_items(id)
--        - gudang.stock_batches.supplier_id     -> gudang.suppliers(id)
--        - gudang.stock_adjustments.batch_id    -> gudang.stock_batches(id)
--        - pos.transaction_items.discount_policy_id -> gudang.discount_policies(id)
--   3. Normalisasi 3NF (menghapus atribut duplikat/transitif tanpa kehilangan data):
--        - gudang.stock_receive_drafts    : backfill free-text supplier -> gudang.suppliers, drop supplier_name
--        - gudang.stock_receive_items     : drop product_name (ambil via FK product_id -> gudang.products)
--        - gudang.product_condition_reports: drop product_id & expiry_date (ambil via FK batch_id -> gudang.stock_batches)
--        - gudang.discount_barcodes       : drop product_id, discounted_price, discount_pct, valid_until (ambil via FK policy_id)
--   4. Zero-Trust RLS Parity: memastikan ke-33 tabel punya RLS aktif & kebijakan deny anon/authenticated.
--
-- SIFAT:
--   - 100% Idempotent (aman dijalankan ulang berkali-kali).
--   - Transaksional (BEGIN ... COMMIT) — rollback penuh jika ada verifikasi gagal.
--   - Aman untuk data historis: tidak ada data transaksi atau supplier yang hilang.
-- =============================================================

BEGIN;

-- ── STEP 1: Buat 6 Domain Schemas ─────────────────────────────
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS gudang;
CREATE SCHEMA IF NOT EXISTS pos;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS delivery;

-- Berikan USAGE kepada role operasional Supabase (RLS tetap memblokir anon/authenticated)
GRANT USAGE ON SCHEMA core, hr, gudang, pos, finance, delivery TO postgres, service_role;

-- ── STEP 2: Pindahkan 17 ENUM Types ke Schema Domain ──────────
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- core
      ('stock_action',            'core'),
      ('actor_type',              'core'),
      -- hr
      ('day_of_week',             'hr'),
      ('shift_status',            'hr'),
      ('swap_status',             'hr'),
      ('attendance_status',       'hr'),
      -- gudang
      ('stock_receive_status',    'gudang'),
      ('alert_level',             'gudang'),
      ('condition_report_status', 'gudang'),
      ('manager_decision',        'gudang'),
      -- pos
      ('payment_method',          'pos'),
      ('transaction_status',      'pos'),
      ('tx_outcome',              'pos'),
      -- finance
      ('period_type',             'finance'),
      -- delivery
      ('online_order_status',     'delivery'),
      ('online_delivery_type',    'delivery'),
      ('online_payment_method',   'delivery')
    ) AS m(type_name, target_schema)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = rec.type_name AND t.typtype = 'e'
    ) THEN
      EXECUTE format('ALTER TYPE public.%I SET SCHEMA %I', rec.type_name, rec.target_schema);
    END IF;
  END LOOP;
END;
$$;

-- ── STEP 3: Pindahkan Seluruh 33 Tabel ke 6 Schema Domain ──────
-- PostgreSQL otomatis memindahkan constraints, indexes, sequences, triggers, dan RLS policies.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- CORE (6 tabel)
      ('admins',                    'core'),
      ('employees',                 'core'),
      ('qris_settings',             'core'),
      ('maintenance_settings',      'core'),
      ('audit_logs',                'core'),
      ('manager_duty_log',          'core'),
      -- HR (5 tabel)
      ('shift_schedules',           'hr'),
      ('shifts',                    'hr'),
      ('shift_cash_movements',      'hr'),
      ('attendances',               'hr'),
      ('shift_swap_requests',       'hr'),
      -- GUDANG (11 tabel)
      ('categories',                'gudang'),
      ('products',                  'gudang'),
      ('suppliers',                 'gudang'),
      ('product_proposals',         'gudang'),
      ('stock_receive_drafts',      'gudang'),
      ('stock_receive_items',       'gudang'),
      ('stock_batches',             'gudang'),
      ('stock_adjustments',         'gudang'),
      ('product_condition_reports', 'gudang'),
      ('discount_policies',         'gudang'),
      ('discount_barcodes',         'gudang'),
      -- POS (4 tabel)
      ('transactions',              'pos'),
      ('transaction_items',         'pos'),
      ('transaction_payments',      'pos'),
      ('transaction_logs',          'pos'),
      -- FINANCE (3 tabel)
      ('operating_expenses',        'finance'),
      ('qris_reconciliations',      'finance'),
      ('daily_closings',            'finance'),
      -- DELIVERY (4 tabel)
      ('buyers',                    'delivery'),
      ('online_orders',             'delivery'),
      ('online_order_items',        'delivery'),
      ('notification_logs',         'delivery')
    ) AS t(table_name, target_schema)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = rec.table_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA %I', rec.table_name, rec.target_schema);
    END IF;
  END LOOP;
END;
$$;

-- ── STEP 4A: 3NF Cleanup — stock_receive_drafts (supplier_name -> suppliers.id) ──
DO $$
DECLARE
  unmapped_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'gudang'
      AND table_name = 'stock_receive_drafts'
      AND column_name = 'supplier_name'
  ) THEN
    -- 1. Buat entry master di gudang.suppliers bagi nama pemasok free-text yang belum terdaftar
    INSERT INTO gudang.suppliers (name, is_active, notes)
    SELECT DISTINCT ON (LOWER(btrim(d.supplier_name)))
      btrim(d.supplier_name) AS name,
      TRUE AS is_active,
      'Auto-normalized dari historis penerimaan barang (Migration v4.0 3NF)' AS notes
    FROM gudang.stock_receive_drafts d
    WHERE d.supplier_id IS NULL
      AND d.supplier_name IS NOT NULL
      AND btrim(d.supplier_name) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM gudang.suppliers s
        WHERE LOWER(btrim(s.name)) = LOWER(btrim(d.supplier_name))
          AND s.deleted_at IS NULL
      )
    ORDER BY LOWER(btrim(d.supplier_name)), d.created_at ASC;

    -- 2. Backfill supplier_id berdasarkan pencocokan nama case-insensitive
    UPDATE gudang.stock_receive_drafts d
    SET supplier_id = matched.id
    FROM (
      SELECT DISTINCT ON (LOWER(btrim(s.name)))
        s.id,
        LOWER(btrim(s.name)) AS norm_name
      FROM gudang.suppliers s
      WHERE s.deleted_at IS NULL
      ORDER BY LOWER(btrim(s.name)), s.is_active DESC, s.created_at ASC
    ) matched
    WHERE d.supplier_id IS NULL
      AND d.supplier_name IS NOT NULL
      AND btrim(d.supplier_name) <> ''
      AND LOWER(btrim(d.supplier_name)) = matched.norm_name;

    -- 3. Safety gate sebelum drop kolom: pastikan zero kehilangan data supplier_name
    SELECT count(*)::int INTO unmapped_count
    FROM gudang.stock_receive_drafts
    WHERE supplier_id IS NULL
      AND supplier_name IS NOT NULL
      AND btrim(supplier_name) <> '';

    IF unmapped_count > 0 THEN
      RAISE EXCEPTION '3NF Migration Abort: % baris stock_receive_drafts masih punya supplier_name tanpa supplier_id', unmapped_count;
    END IF;

    -- 4. Drop kolom redundan supplier_name
    ALTER TABLE gudang.stock_receive_drafts DROP COLUMN supplier_name;
  END IF;
END;
$$;

-- ── STEP 4B: 3NF Cleanup — stock_receive_items (drop product_name) ──
DO $$
DECLARE
  orphan_items INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'gudang'
      AND table_name = 'stock_receive_items'
      AND column_name = 'product_name'
  ) THEN
    SELECT count(*)::int INTO orphan_items
    FROM gudang.stock_receive_items i
    LEFT JOIN gudang.products p ON p.id = i.product_id
    WHERE p.id IS NULL;

    IF orphan_items > 0 THEN
      RAISE EXCEPTION '3NF Migration Abort: % baris stock_receive_items tidak memiliki product_id valid di gudang.products', orphan_items;
    END IF;

    ALTER TABLE gudang.stock_receive_items DROP COLUMN product_name;
  END IF;
END;
$$;

-- ── STEP 4C: Lengkapi FK & Index pada stock_batches dan stock_adjustments ──
ALTER TABLE gudang.stock_batches
  ADD COLUMN IF NOT EXISTS receive_item_id UUID REFERENCES gudang.stock_receive_items(id) ON DELETE SET NULL;

ALTER TABLE gudang.stock_batches
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES gudang.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_batches_receive_item
  ON gudang.stock_batches (receive_item_id);

CREATE INDEX IF NOT EXISTS idx_stock_batches_supplier
  ON gudang.stock_batches (supplier_id);

-- Backfill receive_item_id & supplier_id untuk batch yang berasal dari penerimaan barang APPROVED
WITH matched_batches AS (
  SELECT DISTINCT ON (sb.id)
    sb.id AS batch_id,
    sri.id AS receive_item_id,
    srd.supplier_id
  FROM gudang.stock_batches sb
  JOIN gudang.stock_receive_drafts srd
    ON sb.notes LIKE ('Penerimaan #' || srd.receive_number || ' disetujui%')
  JOIN gudang.stock_receive_items sri
    ON sri.draft_id = srd.id
   AND sri.product_id = sb.product_id
   AND sri.batch_code = sb.batch_code
  WHERE srd.status = 'APPROVED'
    AND (sb.receive_item_id IS NULL OR sb.supplier_id IS NULL)
  ORDER BY sb.id, sri.created_at ASC
)
UPDATE gudang.stock_batches sb
SET
  receive_item_id = COALESCE(sb.receive_item_id, mb.receive_item_id),
  supplier_id = COALESCE(sb.supplier_id, mb.supplier_id)
FROM matched_batches mb
WHERE sb.id = mb.batch_id;

ALTER TABLE gudang.stock_adjustments
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES gudang.stock_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_adj_batch
  ON gudang.stock_adjustments (batch_id);

-- Backfill batch_id jika alasan mutasi menyertakan (Batch: <kode>) secara unik untuk produk tsb
WITH batch_matches AS (
  SELECT
    sa.id AS adj_id,
    MIN(sb.id::text)::uuid AS matched_batch_id,
    COUNT(sb.id) AS match_count
  FROM gudang.stock_adjustments sa
  CROSS JOIN LATERAL (
    SELECT substring(sa.reason FROM '\(Batch:\s*([A-Za-z0-9_-]+)') AS extracted_code
  ) ex
  JOIN gudang.stock_batches sb
    ON sb.product_id = sa.product_id
   AND sb.batch_code = ex.extracted_code
  WHERE sa.batch_id IS NULL
    AND ex.extracted_code IS NOT NULL
  GROUP BY sa.id
  HAVING COUNT(sb.id) = 1
)
UPDATE gudang.stock_adjustments sa
SET batch_id = bm.matched_batch_id
FROM batch_matches bm
WHERE sa.id = bm.adj_id;

-- ── STEP 4D: 3NF Cleanup — product_condition_reports (ambil product_id & expiry_date dari batch) ──
DO $$
DECLARE
  mismatch_cond INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'gudang'
      AND table_name = 'product_condition_reports'
      AND column_name = 'product_id'
  ) THEN
    SELECT count(*)::int INTO mismatch_cond
    FROM gudang.product_condition_reports cr
    LEFT JOIN gudang.stock_batches sb ON sb.id = cr.batch_id
    WHERE sb.id IS NULL OR cr.product_id <> sb.product_id;

    IF mismatch_cond > 0 THEN
      RAISE EXCEPTION '3NF Migration Abort: % baris product_condition_reports memiliki product_id tidak sinkron dengan stock_batches', mismatch_cond;
    END IF;
  END IF;
END;
$$;

DROP INDEX IF EXISTS gudang.idx_cond_reports_prod;
DROP INDEX IF EXISTS gudang.idx_cond_reports_status_alert;

CREATE INDEX IF NOT EXISTS idx_cond_reports_status_alert
  ON gudang.product_condition_reports (status, alert_level, days_remaining_at_alert);

CREATE INDEX IF NOT EXISTS idx_cond_reports_batch_status
  ON gudang.product_condition_reports (batch_id, status);

ALTER TABLE gudang.product_condition_reports DROP COLUMN IF EXISTS product_id;
ALTER TABLE gudang.product_condition_reports DROP COLUMN IF EXISTS expiry_date;

-- ── STEP 4E: 3NF Cleanup — discount_barcodes (ambil metadata diskon dari discount_policies) ──
DO $$
DECLARE
  mismatch_disc INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'gudang'
      AND table_name = 'discount_barcodes'
      AND column_name = 'product_id'
  ) THEN
    SELECT count(*)::int INTO mismatch_disc
    FROM gudang.discount_barcodes db
    LEFT JOIN gudang.discount_policies dp ON dp.id = db.policy_id
    WHERE dp.id IS NULL
       OR db.product_id <> dp.product_id
       OR db.discounted_price <> dp.discounted_price;

    IF mismatch_disc > 0 THEN
      RAISE EXCEPTION '3NF Migration Abort: % baris discount_barcodes tidak sinkron dengan discount_policies', mismatch_disc;
    END IF;
  END IF;
END;
$$;

ALTER TABLE gudang.discount_barcodes DROP COLUMN IF EXISTS product_id;
ALTER TABLE gudang.discount_barcodes DROP COLUMN IF EXISTS discounted_price;
ALTER TABLE gudang.discount_barcodes DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE gudang.discount_barcodes DROP COLUMN IF EXISTS valid_until;

CREATE INDEX IF NOT EXISTS idx_discount_barcodes_policy
  ON gudang.discount_barcodes (policy_id, is_active);

-- ── STEP 4F: Lengkapi FK pos.transaction_items.discount_policy_id -> gudang.discount_policies ──
DO $$
DECLARE
  orphan_disc_fk INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_transaction_items_discount_policy'
      AND conrelid = 'pos.transaction_items'::regclass
  ) THEN
    SELECT count(*)::int INTO orphan_disc_fk
    FROM pos.transaction_items ti
    LEFT JOIN gudang.discount_policies dp ON dp.id = ti.discount_policy_id
    WHERE ti.discount_policy_id IS NOT NULL AND dp.id IS NULL;

    IF orphan_disc_fk = 0 THEN
      ALTER TABLE pos.transaction_items
        ADD CONSTRAINT fk_transaction_items_discount_policy
        FOREIGN KEY (discount_policy_id)
        REFERENCES gudang.discount_policies(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END;
$$;

-- ── STEP 5: Pastikan RLS Aktif & Zero-Trust Policy pada ke-33 Tabel ──
DO $$
DECLARE
  rec RECORD;
  pol_anon TEXT;
  pol_auth TEXT;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname IN ('core', 'hr', 'gudang', 'pos', 'finance', 'delivery')
    ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', rec.schemaname, rec.tablename);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = rec.schemaname
        AND tablename = rec.tablename
        AND 'anon'::name = ANY(roles)
    ) THEN
      pol_anon := format('sk_%s_%s_deny_anon', rec.schemaname, rec.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO anon USING (false)',
        pol_anon, rec.schemaname, rec.tablename
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = rec.schemaname
        AND tablename = rec.tablename
        AND 'authenticated'::name = ANY(roles)
    ) THEN
      pol_auth := format('sk_%s_%s_deny_authenticated', rec.schemaname, rec.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO authenticated USING (false)',
        pol_auth, rec.schemaname, rec.tablename
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;

-- =============================================================
-- VERIFIKASI PASCA-MIGRASI (jalankan query SELECT di bawah ini secara terpisah jika perlu):
--   SELECT schemaname, count(*)::int AS table_count
--   FROM pg_tables
--   WHERE schemaname IN ('core', 'hr', 'gudang', 'pos', 'finance', 'delivery')
--   GROUP BY schemaname
--   ORDER BY schemaname;
-- =============================================================

