-- =============================================================
-- Migration v3.0: Sistem Manajemen Gudang Terintegrasi (Wiramart UNPERBA)
-- PRD: PRD_Wiramart_v3.0_Gudang.md
--
-- STANDAR: Zero-Trust Aerospace Grade, Idempotent, Additive-Only, 3NF Normalized
-- 
-- CAKUPAN:
--   1. Master Data Suppliers (suppliers)
--   2. Penerimaan Barang & Approval 2-Layer (stock_receive_drafts, stock_receive_items)
--   3. FEFO Early Warning & Actionable To-Do List (product_condition_reports)
--   4. Barcode Override & Emergency Discount Policy (discount_policies, discount_barcodes)
--   5. Manager on Duty (MOD) & Daily Closing Sign-Off (manager_duty_log, extend daily_closings)
--   6. Audit Transaksi Kasir (transaction_logs, extend transaction_items)
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '10s';

-- =============================================================
-- 1. ENUMS (Safe creation with DO $$ block)
-- =============================================================

DO $$ BEGIN
  CREATE TYPE stock_receive_status AS ENUM (
    'DRAFT',      -- Petugas gudang sedang menyusun draft input
    'SUBMITTED',  -- Diserahkan ke Manager, menunggu persetujuan (ACC)
    'APPROVED',   -- Disetujui Manager, stok masuk secara atomik
    'REJECTED',   -- Ditolak oleh Manager (stok dibatalkan)
    'REVISED'     -- Diminta revisi oleh Manager
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE alert_level AS ENUM (
    'H1_KRITIS',  -- <= 1 hari menuju kadaluarsa
    'H3_URGENT',  -- 2-3 hari menuju kadaluarsa
    'H5_WARNING', -- 4-5 hari menuju kadaluarsa
    'H7_WATCH'    -- 6-7 hari menuju kadaluarsa
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE condition_report_status AS ENUM (
    'ALERT_ONLY',     -- Terdeteksi otomatis oleh FEFO engine
    'SUBMITTED',      -- Dilaporkan petugas gudang dengan rekomendasi
    'MANAGER_REVIEW', -- Sedang ditinjau oleh Manager on Duty
    'APPROVED',       -- Keputusan Manager disetujui
    'REJECTED',       -- Pengajuan ditolak
    'EXECUTED',       -- Tindakan telah dieksekusi di lapangan oleh Gudang
    'CLOSED'          -- Selesai (stok habis/selesai dimusnahkan)
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE manager_decision AS ENUM (
    'DISCOUNT',       -- Diskon darurat (program obral FEFO)
    'DISPLAY_FRONT',  -- Pindahkan display ke rak kasir utama
    'DESTROY',        -- Musnahkan dari gudang & catat kerugian
    'RETURN_SUPPLIER',-- Retur ke supplier
    'HOLD'            -- Tahan & monitor
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE tx_outcome AS ENUM (
    'COMMITTED',
    'ROLLED_BACK'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- =============================================================
-- 2. TABEL: suppliers (Master Supplier / Distributor)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(200) NOT NULL,
  contact_person      VARCHAR(200),
  phone               VARCHAR(30),
  address             TEXT,
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name
  ON public.suppliers(name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_active
  ON public.suppliers(is_active)
  WHERE deleted_at IS NULL;

-- =============================================================
-- 3. TABEL: stock_receive_drafts (Header Penerimaan Barang)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.stock_receive_drafts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receive_number         VARCHAR(35) NOT NULL UNIQUE, -- GUD-YYYYMMDD-XXXX
  created_by_employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  supplier_id            UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name          VARCHAR(200),
  delivery_note          TEXT,
  status                 stock_receive_status NOT NULL DEFAULT 'DRAFT',
  submitted_at           TIMESTAMPTZ,
  approved_at            TIMESTAMPTZ,
  rejected_at            TIMESTAMPTZ,
  approved_by_admin_id   UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  rejected_by_admin_id   UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  manager_note           TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

-- Pastikan kolom supplier_id ada jika tabel stock_receive_drafts sudah terlanjur dibuat di skema lama
ALTER TABLE public.stock_receive_drafts 
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_supplier
  ON public.stock_receive_drafts(supplier_id);

CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_status
  ON public.stock_receive_drafts(status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_emp
  ON public.stock_receive_drafts(created_by_employee_id)
  WHERE deleted_at IS NULL;

-- =============================================================
-- 4. TABEL: stock_receive_items (Detail Item Per Penerimaan)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.stock_receive_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id        UUID NOT NULL REFERENCES public.stock_receive_drafts(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name    VARCHAR(200) NOT NULL,
  batch_code      VARCHAR(50) NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  cost_price      DECIMAL(15,2) NOT NULL CHECK (cost_price >= 0),
  expiry_date     DATE,
  condition_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_receive_items_draft
  ON public.stock_receive_items(draft_id);

CREATE INDEX IF NOT EXISTS idx_stock_receive_items_prod
  ON public.stock_receive_items(product_id);

-- =============================================================
-- 5. TABEL: product_condition_reports (FEFO Action Radar)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.product_condition_reports (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                UUID NOT NULL REFERENCES public.stock_batches(id) ON DELETE CASCADE,
  product_id              UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  alert_level             alert_level NOT NULL,
  qty_at_alert            INTEGER NOT NULL,
  expiry_date             DATE,
  days_remaining_at_alert INTEGER,
  status                  condition_report_status NOT NULL DEFAULT 'ALERT_ONLY',
  
  -- Rekomendasi Petugas Gudang
  physical_condition      TEXT,
  gudang_suggestion       TEXT,
  suggested_discount_pct  DECIMAL(5,2) CHECK (suggested_discount_pct IS NULL OR (suggested_discount_pct >= 1 AND suggested_discount_pct <= 100)),
  submitted_by_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  submitted_at            TIMESTAMPTZ,
  
  -- Keputusan & Otorisasi Manager
  manager_decision        manager_decision,
  approved_discount_pct   DECIMAL(5,2) CHECK (approved_discount_pct IS NULL OR (approved_discount_pct >= 1 AND approved_discount_pct <= 100)),
  manager_note            TEXT,
  decided_by_admin_id     UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  decided_at              TIMESTAMPTZ,
  
  -- Eksekusi Lapangan Petugas Gudang
  executed_by_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  executed_at             TIMESTAMPTZ,
  execution_note          TEXT,
  
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT uq_condition_report_batch UNIQUE (batch_id)
);

CREATE INDEX IF NOT EXISTS idx_cond_reports_status_alert
  ON public.product_condition_reports(status, alert_level, expiry_date);

CREATE INDEX IF NOT EXISTS idx_cond_reports_prod
  ON public.product_condition_reports(product_id, status);

-- =============================================================
-- 6. TABEL: discount_policies & discount_barcodes (Diskon Darurat)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.discount_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_report_id UUID NOT NULL REFERENCES public.product_condition_reports(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  batch_id            UUID NOT NULL REFERENCES public.stock_batches(id) ON DELETE RESTRICT,
  discount_pct        DECIMAL(5,2) NOT NULL CHECK (discount_pct >= 1 AND discount_pct <= 100),
  original_price      INTEGER NOT NULL CHECK (original_price >= 0),
  discounted_price    INTEGER NOT NULL CHECK (discounted_price >= 0),
  allowed_qty         INTEGER NOT NULL CHECK (allowed_qty > 0),
  sold_qty            INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  valid_from          DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until         DATE NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id UUID NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_policies_prod
  ON public.discount_policies(product_id, is_active);

CREATE INDEX IF NOT EXISTS idx_discount_policies_batch
  ON public.discount_policies(batch_id);

CREATE TABLE IF NOT EXISTS public.discount_barcodes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        UUID NOT NULL REFERENCES public.discount_policies(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  barcode          VARCHAR(40) NOT NULL UNIQUE,
  discounted_price INTEGER NOT NULL CHECK (discounted_price >= 0),
  discount_pct     DECIMAL(5,2) NOT NULL,
  remaining_qty    INTEGER NOT NULL CHECK (remaining_qty >= 0),
  valid_until      DATE NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_barcodes_lookup
  ON public.discount_barcodes(barcode)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_discount_barcodes_policy
  ON public.discount_barcodes(policy_id);

-- =============================================================
-- 7. TABEL: manager_duty_log (Manager On Duty)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.manager_duty_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_date      DATE NOT NULL UNIQUE, -- Satu MOD resmi per hari
  admin_id       UUID NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out_at TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_duty_date
  ON public.manager_duty_log(duty_date DESC);

-- =============================================================
-- 8. TABEL: transaction_logs (Audit Trail Transaksi Kasir)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.transaction_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  shift_id        UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  invoice_attempt VARCHAR(30) NOT NULL,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  item_count      INTEGER NOT NULL,
  gross_amount    NUMERIC(12,2) NOT NULL,
  payment_method  payment_method NOT NULL,
  outcome         tx_outcome NOT NULL,
  transaction_id  UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  rollback_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_employee ON public.transaction_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_shift ON public.transaction_logs(shift_id);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_outcome ON public.transaction_logs(outcome);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_created ON public.transaction_logs(created_at);

-- =============================================================
-- 9. ADDITIVE COLUMNS (Non-Breaking)
-- =============================================================

-- Kolom audit tracking diskon darurat di transaksi kasir
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS discount_policy_id UUID REFERENCES public.discount_policies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trx_items_discount_policy ON public.transaction_items(discount_policy_id);

-- Kolom pengesahan Manager on Duty pada Daily Closing
ALTER TABLE public.daily_closings
  ADD COLUMN IF NOT EXISTS mod_signed_by UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mod_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mod_sign_note TEXT,
  ADD COLUMN IF NOT EXISTS stock_mutation_summary JSONB;

CREATE INDEX IF NOT EXISTS idx_daily_closings_mod_signed ON public.daily_closings(mod_signed_by);

-- =============================================================
-- 10. IDEMPOTENT CONSTRAINTS ENFORCEMENT
-- =============================================================

DO $$ BEGIN
  -- Foreign Keys & Unique Constraints untuk tabel yang sudah sempat terbuat sebelumnya
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srd_supplier') THEN
    ALTER TABLE public.stock_receive_drafts ADD CONSTRAINT fk_srd_supplier FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srd_employee') THEN
    ALTER TABLE public.stock_receive_drafts ADD CONSTRAINT fk_srd_employee FOREIGN KEY (created_by_employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sri_draft') THEN
    ALTER TABLE public.stock_receive_items ADD CONSTRAINT fk_sri_draft FOREIGN KEY (draft_id) REFERENCES public.stock_receive_drafts(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sri_product') THEN
    ALTER TABLE public.stock_receive_items ADD CONSTRAINT fk_sri_product FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_batches_product') THEN
    ALTER TABLE public.stock_batches ADD CONSTRAINT fk_batches_product FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_batch') THEN
    ALTER TABLE public.product_condition_reports ADD CONSTRAINT fk_pcr_batch FOREIGN KEY (batch_id) REFERENCES public.stock_batches(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_product') THEN
    ALTER TABLE public.product_condition_reports ADD CONSTRAINT fk_pcr_product FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_policy_report') THEN
    ALTER TABLE public.discount_policies ADD CONSTRAINT fk_disc_policy_report FOREIGN KEY (condition_report_id) REFERENCES public.product_condition_reports(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_barcodes_policy') THEN
    ALTER TABLE public.discount_barcodes ADD CONSTRAINT fk_disc_barcodes_policy FOREIGN KEY (policy_id) REFERENCES public.discount_policies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mod_admin') THEN
    ALTER TABLE public.manager_duty_log ADD CONSTRAINT fk_mod_admin FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tx_logs_employee') THEN
    ALTER TABLE public.transaction_logs ADD CONSTRAINT fk_tx_logs_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- =============================================================
-- 11. ZERO-TRUST RLS SECURITY POLICIES
-- =============================================================

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receive_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_condition_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_duty_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_logs ENABLE ROW LEVEL SECURITY;

-- Deny public anon direct access (Strict API Service-Role Proxy)
DROP POLICY IF EXISTS "sk_suppliers_deny_anon" ON public.suppliers;
CREATE POLICY "sk_suppliers_deny_anon" ON public.suppliers FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_stock_receive_drafts_deny_anon" ON public.stock_receive_drafts;
CREATE POLICY "sk_stock_receive_drafts_deny_anon" ON public.stock_receive_drafts FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_stock_receive_items_deny_anon" ON public.stock_receive_items;
CREATE POLICY "sk_stock_receive_items_deny_anon" ON public.stock_receive_items FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_cond_reports_deny_anon" ON public.product_condition_reports;
CREATE POLICY "sk_cond_reports_deny_anon" ON public.product_condition_reports FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_discount_policies_deny_anon" ON public.discount_policies;
CREATE POLICY "sk_discount_policies_deny_anon" ON public.discount_policies FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_discount_barcodes_deny_anon" ON public.discount_barcodes;
CREATE POLICY "sk_discount_barcodes_deny_anon" ON public.discount_barcodes FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_manager_duty_deny_anon" ON public.manager_duty_log;
CREATE POLICY "sk_manager_duty_deny_anon" ON public.manager_duty_log FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "sk_tx_logs_deny_anon" ON public.transaction_logs;
CREATE POLICY "sk_tx_logs_deny_anon" ON public.transaction_logs FOR ALL TO anon USING (false);

REVOKE ALL ON TABLE public.suppliers FROM anon;
REVOKE ALL ON TABLE public.stock_receive_drafts FROM anon;
REVOKE ALL ON TABLE public.stock_receive_items FROM anon;
REVOKE ALL ON TABLE public.product_condition_reports FROM anon;
REVOKE ALL ON TABLE public.discount_policies FROM anon;
REVOKE ALL ON TABLE public.discount_barcodes FROM anon;
REVOKE ALL ON TABLE public.manager_duty_log FROM anon;
REVOKE ALL ON TABLE public.transaction_logs FROM anon;

COMMIT;
