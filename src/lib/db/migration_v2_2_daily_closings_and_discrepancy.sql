-- =============================================================
-- Migration v2.2: Daily Financial Closing (Tutup Buku Harian) & Tiered Discrepancy
-- Smartkasir Perwira (Wiramart UNPERBA)
--
-- FITUR:
--   1. Tabel `daily_closings` untuk ritual Tutup Buku Harian Dosen (Manager):
--      - Mengunci transaksi & keuangan per tanggal bisnis (WIB)
--      - Menyimpan snapshot resmi: Omzet, Cash, QRIS, HPP, Biaya, Laba Kotor,
--        Selisih Kas Laci, Fee QRIS, Laba Bersih
--      - Status: 'LOCKED' | 'AUDITED' | 'OPEN'
--      - Mencegah void transaksi retroaktif pada periode yang sudah ditutup
--   2. Indeks performa tanggal & status closing
--   3. RLS Zero-Trust Aerospace Grade
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Buat tabel daily_closings
CREATE TABLE IF NOT EXISTS public.daily_closings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date        DATE NOT NULL UNIQUE,
  total_omzet         DECIMAL(15, 2) NOT NULL DEFAULT 0,
  omzet_cash          DECIMAL(15, 2) NOT NULL DEFAULT 0,
  omzet_qris          DECIMAL(15, 2) NOT NULL DEFAULT 0,
  total_hpp           DECIMAL(15, 2) NOT NULL DEFAULT 0,
  gross_profit        DECIMAL(15, 2) NOT NULL DEFAULT 0,
  operating_expenses  DECIMAL(15, 2) NOT NULL DEFAULT 0,
  qris_fee            DECIMAL(15, 2) NOT NULL DEFAULT 0,
  cash_discrepancy    DECIMAL(15, 2) NOT NULL DEFAULT 0,
  net_profit          DECIMAL(15, 2) NOT NULL DEFAULT 0,
  status              VARCHAR(20) NOT NULL DEFAULT 'LOCKED',
  notes               TEXT,
  closed_by_admin_id  UUID REFERENCES public.admins(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_daily_closings_status
    CHECK (status IN ('OPEN', 'LOCKED', 'AUDITED'))
);

COMMENT ON TABLE public.daily_closings IS 'Snapshot resmi Tutup Buku Finansial Harian Wiramart oleh Dosen / Manager (Locking Period)';
COMMENT ON COLUMN public.daily_closings.closing_date IS 'Tanggal bisnis yang ditutup buku (YYYY-MM-DD WIB)';
COMMENT ON COLUMN public.daily_closings.status IS 'Status periode: LOCKED (terkunci), AUDITED (sudah diperiksa), OPEN (dibuka kembali)';

-- Indeks performa
CREATE INDEX IF NOT EXISTS idx_daily_closings_date
  ON public.daily_closings(closing_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_closings_status
  ON public.daily_closings(status);

-- 2. RLS Zero-Trust
ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_daily_closings_deny_anon" ON public.daily_closings;
DROP POLICY IF EXISTS "sk_daily_closings_deny_authenticated" ON public.daily_closings;

CREATE POLICY "sk_daily_closings_deny_anon"
  ON public.daily_closings FOR ALL TO anon USING (false);

CREATE POLICY "sk_daily_closings_deny_authenticated"
  ON public.daily_closings FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.daily_closings FROM anon, authenticated;

COMMIT;
