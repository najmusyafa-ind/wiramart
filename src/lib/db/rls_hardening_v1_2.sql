-- =============================================================
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Supabase Row Level Security (RLS) Hardening v1.2
-- 
-- STATUS: PRODUCTION SECURITY HARDENING (Aerospace Zero-Trust)
-- CAKUPAN: 100% dari 14 Tabel Sistem
--
-- PANDUAN EKSEKUSI:
--   1. Buka Supabase Dashboard -> Project Smartkasir -> SQL Editor
--   2. Salin seluruh script ini -> Paste -> Tekan Run (Ctrl+Enter)
--   3. Cek hasil query verifikasi di STEP 4: Semua tabel WAJIB rls_enabled = true
--
-- ARSITEKTUR KEAMANAN:
--   - Deny-by-default: Peran anonim (anon) dan authenticated (user login publik)
--     DIBLOKIR TOTAL (0 akses baca/tulis langsung via PostgREST/Supabase client).
--   - Serverless Backend Only: Hanya backend Next.js (menggunakan DATABASE_URL
--     dengan service_role / direct connection pooler) yang memiliki wewenang
--     membaca dan memutasi data melalui API terotentikasi dan tervalidasi Zod.
-- =============================================================

-- ── STEP 1: Aktifkan RLS pada seluruh 14 Tabel ─────────────────

ALTER TABLE public.admins              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qris_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances         ENABLE ROW LEVEL SECURITY;

-- ── STEP 2: Pembersihan Kebijakan Lama (Idempotent Safe) ────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname LIKE 'sk_%' OR policyname LIKE 'deny_%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END;
$$;

-- ── STEP 3: Terapkan Kebijakan Zero-Trust (Deny-All untuk Public) ──
-- service_role secara otomatis membypass RLS di level PostgreSQL engine.
-- Kebijakan eksplisit di bawah ini mencegah akses tidak sah jika anon key bocor.

-- 1. admins (Kredensial dosen & admin — password_hash)
CREATE POLICY "sk_admins_deny_anon"          ON public.admins FOR ALL TO anon          USING (false);
CREATE POLICY "sk_admins_deny_authenticated" ON public.admins FOR ALL TO authenticated USING (false);

-- 2. employees (Data mahasiswa & kasir — NIM & nama)
CREATE POLICY "sk_employees_deny_anon"          ON public.employees FOR ALL TO anon          USING (false);
CREATE POLICY "sk_employees_deny_authenticated" ON public.employees FOR ALL TO authenticated USING (false);

-- 3. shifts (Sesi kasir & uang laci kas)
CREATE POLICY "sk_shifts_deny_anon"          ON public.shifts FOR ALL TO anon          USING (false);
CREATE POLICY "sk_shifts_deny_authenticated" ON public.shifts FOR ALL TO authenticated USING (false);

-- 4. categories (Master kategori produk)
CREATE POLICY "sk_categories_deny_anon"          ON public.categories FOR ALL TO anon          USING (false);
CREATE POLICY "sk_categories_deny_authenticated" ON public.categories FOR ALL TO authenticated USING (false);

-- 5. products (Master produk, barcode & HPP/cost_price rahasia)
CREATE POLICY "sk_products_deny_anon"          ON public.products FOR ALL TO anon          USING (false);
CREATE POLICY "sk_products_deny_authenticated" ON public.products FOR ALL TO authenticated USING (false);

-- 6. stock_adjustments (Penyesuaian stok opname)
CREATE POLICY "sk_stock_adj_deny_anon"          ON public.stock_adjustments FOR ALL TO anon          USING (false);
CREATE POLICY "sk_stock_adj_deny_authenticated" ON public.stock_adjustments FOR ALL TO authenticated USING (false);

-- 7. transactions (Transaksi finansial penjualan)
CREATE POLICY "sk_transactions_deny_anon"          ON public.transactions FOR ALL TO anon          USING (false);
CREATE POLICY "sk_transactions_deny_authenticated" ON public.transactions FOR ALL TO authenticated USING (false);

-- 8. transaction_items (Rincian item belanja)
CREATE POLICY "sk_txitems_deny_anon"          ON public.transaction_items FOR ALL TO anon          USING (false);
CREATE POLICY "sk_txitems_deny_authenticated" ON public.transaction_items FOR ALL TO authenticated USING (false);

-- 9. qris_settings (Kredensial pembayaran & QRIS merchant)
CREATE POLICY "sk_qris_deny_anon"          ON public.qris_settings FOR ALL TO anon          USING (false);
CREATE POLICY "sk_qris_deny_authenticated" ON public.qris_settings FOR ALL TO authenticated USING (false);

-- 10. maintenance_settings (Status maintenance sistem kasir)
CREATE POLICY "sk_maint_deny_anon"          ON public.maintenance_settings FOR ALL TO anon          USING (false);
CREATE POLICY "sk_maint_deny_authenticated" ON public.maintenance_settings FOR ALL TO authenticated USING (false);

-- 11. shift_schedules (Jadwal shift perkuliahan / jaga kasir)
CREATE POLICY "sk_schedules_deny_anon"          ON public.shift_schedules FOR ALL TO anon          USING (false);
CREATE POLICY "sk_schedules_deny_authenticated" ON public.shift_schedules FOR ALL TO authenticated USING (false);

-- 12. audit_logs (Jejak forensik seluruh aktivitas sistem)
CREATE POLICY "sk_audit_deny_anon"          ON public.audit_logs FOR ALL TO anon          USING (false);
CREATE POLICY "sk_audit_deny_authenticated" ON public.audit_logs FOR ALL TO authenticated USING (false);

-- 13. shift_swap_requests (Pengajuan tukar shift antar mahasiswa)
CREATE POLICY "sk_swap_deny_anon"          ON public.shift_swap_requests FOR ALL TO anon          USING (false);
CREATE POLICY "sk_swap_deny_authenticated" ON public.shift_swap_requests FOR ALL TO authenticated USING (false);

-- 14. attendances (Presensi & status absensi kasir)
CREATE POLICY "sk_attendances_deny_anon"          ON public.attendances FOR ALL TO anon          USING (false);
CREATE POLICY "sk_attendances_deny_authenticated" ON public.attendances FOR ALL TO authenticated USING (false);

-- ── STEP 4: Verifikasi Status Keamanan (Audit Verification) ────
-- Jalankan query ini untuk memastikan semua 14 tabel berstatus rls_enabled = true

SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'admins', 'employees', 'shifts', 'categories', 'products',
    'stock_adjustments', 'transactions', 'transaction_items',
    'qris_settings', 'maintenance_settings', 'shift_schedules',
    'audit_logs', 'shift_swap_requests', 'attendances'
  )
ORDER BY tablename ASC;
