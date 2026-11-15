-- =============================================================
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Migration v4.1: Kembalikan Seluruh 33 Tabel & 17 ENUM ke Schema `public`
--
-- TUJUAN:
--   1. Mengembalikan 33 tabel & 17 enum dari 6 schema domain (`core`, `hr`,
--      `gudang`, `pos`, `finance`, `delivery`) ke schema `public` agar
--      Supabase Schema Visualizer & Table Editor langsung menampilkan
--      seluruh tabel beserta relasi FK dalam 1 kanvas default `public`.
--   2. Mempertahankan 100% perbaikan 3NF & Foreign Key dari v4.0
--      (FK `stock_batches.receive_item_id`, `stock_batches.supplier_id`,
--       `stock_adjustments.batch_id`, `transaction_items.discount_policy_id`).
--   3. Memastikan RLS aktif & kebijakan Zero-Trust (`anon` / `authenticated`
--      deny-all) tetap lengkap di seluruh 33 tabel pada schema `public`.
--   4. Atomic & Idempotent (`BEGIN ... COMMIT` + verification gate).
-- =============================================================

BEGIN;

-- ── STEP 1: Pindahkan Seluruh 17 ENUM Types Kembali ke Schema `public` ──
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
    ) AS m(type_name, source_schema)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = rec.source_schema AND t.typname = rec.type_name AND t.typtype = 'e'
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = rec.type_name AND t.typtype = 'e'
      ) THEN
        RAISE EXCEPTION 'Migrasi v4.1 dibatalkan: ENUM %.% bentrok dengan public.%',
          rec.source_schema, rec.type_name, rec.type_name;
      END IF;
      EXECUTE format('ALTER TYPE %I.%I SET SCHEMA public', rec.source_schema, rec.type_name);
    END IF;
  END LOOP;
END;
$$;

-- ── STEP 2: Pindahkan Seluruh 33 Tabel Kembali ke Schema `public` ──
-- PostgreSQL memindahkan data, PK/FK/CHECK constraints, indexes, sequences, & RLS policies secara otomatis.
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
    ) AS t(table_name, source_schema)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = rec.source_schema AND tablename = rec.table_name
    ) THEN
      IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = rec.table_name
      ) THEN
        RAISE EXCEPTION 'Migrasi v4.1 dibatalkan: Tabel %.% bentrok dengan public.%',
          rec.source_schema, rec.table_name, rec.table_name;
      END IF;
      EXECUTE format('ALTER TABLE %I.%I SET SCHEMA public', rec.source_schema, rec.table_name);
    END IF;
  END LOOP;
END;
$$;

-- ── STEP 3: Pastikan RLS Aktif & Zero-Trust Policy Lengkap di Schema `public` ──
DO $$
DECLARE
  rec RECORD;
  pol_anon TEXT;
  pol_auth TEXT;
  target_tables TEXT[] := ARRAY[
    'admins','employees','qris_settings','maintenance_settings','audit_logs','manager_duty_log',
    'shift_schedules','shifts','shift_cash_movements','attendances','shift_swap_requests',
    'categories','products','suppliers','product_proposals','stock_receive_drafts',
    'stock_receive_items','stock_batches','stock_adjustments','product_condition_reports',
    'discount_policies','discount_barcodes',
    'transactions','transaction_items','transaction_payments','transaction_logs',
    'operating_expenses','qris_reconciliations','daily_closings',
    'buyers','online_orders','online_order_items','notification_logs'
  ];
BEGIN
  FOR rec IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY(target_tables)
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.tablename);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = rec.tablename
        AND 'anon'::name = ANY(roles)
    ) THEN
      pol_anon := format('sk_%s_deny_anon', rec.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon USING (false)',
        pol_anon, rec.tablename
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = rec.tablename
        AND 'authenticated'::name = ANY(roles)
    ) THEN
      pol_auth := format('sk_%s_deny_authenticated', rec.tablename);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (false)',
        pol_auth, rec.tablename
      );
    END IF;
  END LOOP;
END;
$$;

-- ── STEP 4: Safety Gate — Pastikan 33 Tabel & 17 ENUM Utuh di `public` ──
DO $$
DECLARE
  pub_tables INTEGER;
  pub_enums INTEGER;
  leftover_tables INTEGER;
  leftover_enums INTEGER;
  target_tables TEXT[] := ARRAY[
    'admins','employees','qris_settings','maintenance_settings','audit_logs','manager_duty_log',
    'shift_schedules','shifts','shift_cash_movements','attendances','shift_swap_requests',
    'categories','products','suppliers','product_proposals','stock_receive_drafts',
    'stock_receive_items','stock_batches','stock_adjustments','product_condition_reports',
    'discount_policies','discount_barcodes',
    'transactions','transaction_items','transaction_payments','transaction_logs',
    'operating_expenses','qris_reconciliations','daily_closings',
    'buyers','online_orders','online_order_items','notification_logs'
  ];
  target_enums TEXT[] := ARRAY[
    'stock_action','actor_type','day_of_week','shift_status','swap_status','attendance_status',
    'stock_receive_status','alert_level','condition_report_status','manager_decision',
    'payment_method','transaction_status','tx_outcome','period_type',
    'online_order_status','online_delivery_type','online_payment_method'
  ];
BEGIN
  SELECT count(*)::int INTO pub_tables
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = ANY(target_tables);

  SELECT count(*)::int INTO pub_enums
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname = ANY(target_enums);

  SELECT count(*)::int INTO leftover_tables
  FROM pg_tables
  WHERE schemaname IN ('core', 'hr', 'gudang', 'pos', 'finance', 'delivery');

  SELECT count(*)::int INTO leftover_enums
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname IN ('core', 'hr', 'gudang', 'pos', 'finance', 'delivery') AND t.typtype = 'e';

  IF pub_tables <> 33 OR leftover_tables > 0 THEN
    RAISE EXCEPTION 'Migrasi v4.1 gagal verifikasi tabel (public=%, sisa_schema_lama=%)',
      pub_tables, leftover_tables;
  END IF;

  IF pub_enums <> 17 OR leftover_enums > 0 THEN
    RAISE EXCEPTION 'Migrasi v4.1 gagal verifikasi ENUM (public=%, sisa_schema_lama=%)',
      pub_enums, leftover_enums;
  END IF;
END;
$$;

-- Hapus ke-6 schema domain yang sudah benar-benar kosong (RESTRICT gagal jika masih ada dependensi)
DROP SCHEMA IF EXISTS core, hr, gudang, pos, finance, delivery RESTRICT;

COMMIT;
