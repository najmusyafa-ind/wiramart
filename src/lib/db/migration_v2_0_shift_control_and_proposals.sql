-- =============================================================
-- Migration v2.0: Shift Drawer Control, Ketua Shift PIN, Global Margin, & Product Proposals
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Dijalankan pada: Supabase PostgreSQL Main Production
--
-- Cakupan:
--   1. K3 & K10: Audit Serah Terima Laci (serah_terima_diff, audit_flags) pada tabel shifts
--   2. K17: Kolom Ketua Shift / Admin Kasir & PIN 6-digit pada tabel employees
--   3. K2: Pengaturan Margin Global % pada tabel qris_settings
--   4. K8: Tabel product_proposals (Usulan Produk baru oleh kasir, HPP diisi Admin/Gudang)
--   5. K4: Dukungan rekan target (peer_employee_id) pada shift_swap_requests
-- =============================================================

BEGIN;

-- 1. Tambah kolom audit serah-terima dan deteksi fraud pada tabel shifts
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS serah_terima_diff NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS audit_flags VARCHAR(100);

COMMENT ON COLUMN public.shifts.serah_terima_diff IS 'Selisih antara modal awal yang diinput kasir pembuka vs fisik actual_cash shift penutup sebelumnya';
COMMENT ON COLUMN public.shifts.audit_flags IS 'Flag audit sistem, contoh: SERAH_TERIMA_SELISIH, FRAUD_CASH_SUSPICIOUS, NORMAL';

-- 2. Tambah kolom peran Ketua Shift (Admin Kasir) & PIN 6 digit pada tabel employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS is_ketua_shift BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

COMMENT ON COLUMN public.employees.is_ketua_shift IS 'Menandakan karyawan adalah Ketua Shift / Admin Kasir yang memegang PIN otorisasi laci';
COMMENT ON COLUMN public.employees.pin_hash IS 'Bcrypt hash dari 6 digit PIN otorisasi laci Ketua Shift';

-- 3. Tambah margin global % pada tabel qris_settings
ALTER TABLE public.qris_settings
  ADD COLUMN IF NOT EXISTS global_margin_percentage NUMERIC(5, 2) NOT NULL DEFAULT 20.00;

COMMENT ON COLUMN public.qris_settings.global_margin_percentage IS 'Persentase margin keuntungan global baku (contoh: 20.00 = 20%). Harga jual = HPP * (1 + margin%)';

-- 4. Tambah peer_employee_id pada tabel shift_swap_requests untuk persetujuan 2 pihak
ALTER TABLE public.shift_swap_requests
  ADD COLUMN IF NOT EXISTS peer_employee_id UUID REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS peer_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS peer_rejected_at TIMESTAMPTZ;

COMMENT ON COLUMN public.shift_swap_requests.peer_employee_id IS 'Karyawan rekan yang diajak bertukar shift (wajib menyetujui sebelum review dosen)';

-- 5. Buat tabel product_proposals (K8: Kasir hanya mengusulkan produk, HPP diisi Gudang/Admin)
CREATE TABLE IF NOT EXISTS public.product_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  category_id UUID NOT NULL REFERENCES public.categories(id),
  barcode VARCHAR(50),
  unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
  photo_url TEXT,
  proposed_by_employee_id UUID NOT NULL REFERENCES public.employees(id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
  admin_note TEXT,
  approved_product_id UUID REFERENCES public.products(id),
  reviewed_by_admin_id UUID REFERENCES public.admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_proposals_status
  ON public.product_proposals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_proposals_employee
  ON public.product_proposals(proposed_by_employee_id);

-- 6. Kebijakan Keamanan Zero-Trust RLS untuk product_proposals
ALTER TABLE public.product_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_product_proposals_deny_anon" ON public.product_proposals;
DROP POLICY IF EXISTS "sk_product_proposals_deny_authenticated" ON public.product_proposals;

CREATE POLICY "sk_product_proposals_deny_anon"
  ON public.product_proposals FOR ALL TO anon USING (false);

CREATE POLICY "sk_product_proposals_deny_authenticated"
  ON public.product_proposals FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.product_proposals FROM anon, authenticated;

COMMIT;
