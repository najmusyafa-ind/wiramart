-- =============================================================
-- Smartkasir Perwira — Supabase Row Level Security (RLS) v1.1
-- 
-- CARA PAKAI:
--   1. Buka Supabase Dashboard → SQL Editor
--   2. Copy seluruh isi file ini → Paste → Run (Ctrl+Enter)
--   3. Verifikasi di Table Editor → setiap tabel ada ikon 🔒 RLS Enabled
--
-- TABEL YANG DILINDUNGI (sesuai schema.ts aktual):
--   admins, employees, shifts, categories, products,
--   stock_adjustments, transactions, transaction_items, audit_logs
--
-- ARSITEKTUR:
--   DATABASE_URL menggunakan service_role → BYPASS RLS otomatis
--   anon / authenticated role → DENY semua akses langsung ke tabel
--   Hasil: hanya API route Next.js yg bisa baca/tulis DB
-- =============================================================

-- ── STEP 1: Aktifkan RLS (hanya tabel yang ada) ───────────────

ALTER TABLE public.admins            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ── STEP 2: Hapus policy lama (idempotent — aman dijalankan ulang) ──

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE 'sk_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END;
$$;

-- ── STEP 3: Buat policy deny-by-default ───────────────────────
-- Pola: anon dan authenticated TIDAK BISA akses langsung.
-- service_role (dipakai DATABASE_URL) bypass RLS secara otomatis.

-- admins (PALING SENSITIF — ada password_hash)
CREATE POLICY "sk_admins_deny_anon"          ON public.admins FOR ALL TO anon          USING (false);
CREATE POLICY "sk_admins_deny_authenticated" ON public.admins FOR ALL TO authenticated USING (false);

-- employees
CREATE POLICY "sk_employees_deny_anon"          ON public.employees FOR ALL TO anon          USING (false);
CREATE POLICY "sk_employees_deny_authenticated" ON public.employees FOR ALL TO authenticated USING (false);

-- shifts
CREATE POLICY "sk_shifts_deny_anon"          ON public.shifts FOR ALL TO anon          USING (false);
CREATE POLICY "sk_shifts_deny_authenticated" ON public.shifts FOR ALL TO authenticated USING (false);

-- categories
CREATE POLICY "sk_categories_deny_anon"          ON public.categories FOR ALL TO anon          USING (false);
CREATE POLICY "sk_categories_deny_authenticated" ON public.categories FOR ALL TO authenticated USING (false);

-- products (SENSITIF — ada cost_price / HPP)
CREATE POLICY "sk_products_deny_anon"          ON public.products FOR ALL TO anon          USING (false);
CREATE POLICY "sk_products_deny_authenticated" ON public.products FOR ALL TO authenticated USING (false);

-- stock_adjustments
CREATE POLICY "sk_stock_adj_deny_anon"          ON public.stock_adjustments FOR ALL TO anon          USING (false);
CREATE POLICY "sk_stock_adj_deny_authenticated" ON public.stock_adjustments FOR ALL TO authenticated USING (false);

-- transactions
CREATE POLICY "sk_transactions_deny_anon"          ON public.transactions FOR ALL TO anon          USING (false);
CREATE POLICY "sk_transactions_deny_authenticated" ON public.transactions FOR ALL TO authenticated USING (false);

-- transaction_items
CREATE POLICY "sk_txitems_deny_anon"          ON public.transaction_items FOR ALL TO anon          USING (false);
CREATE POLICY "sk_txitems_deny_authenticated" ON public.transaction_items FOR ALL TO authenticated USING (false);

-- audit_logs
CREATE POLICY "sk_audit_deny_anon"          ON public.audit_logs FOR ALL TO anon          USING (false);
CREATE POLICY "sk_audit_deny_authenticated" ON public.audit_logs FOR ALL TO authenticated USING (false);

-- ── STEP 4: Verifikasi — jalankan ini setelah step 1-3 ────────

SELECT
  tablename,
  rowsecurity  AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'admins','employees','shifts','categories','products',
    'stock_adjustments','transactions','transaction_items','audit_logs'
  )
ORDER BY tablename;

-- Hasil yang benar: semua baris kolom rls_enabled = TRUE (t)
