-- =============================================================
-- Migration v1.9: Rekonsiliasi Harian Mutasi Bank QRIS
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Dijalankan pada: Supabase PostgreSQL Main Production
--
-- Tujuan:
--   Manajer/Dosen Pembina mencatat total mutasi kredit rekening
--   bank Mandiri/Livin' per tanggal dan membandingkannya dengan
--   total QRIS yang tercatat di sistem kasir. Selisih ditandai
--   sebagai potensi nota QRIS palsu / transaksi pending bank.
-- =============================================================

BEGIN;

-- 1. Buat tabel qris_reconciliations
CREATE TABLE IF NOT EXISTS public.qris_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tanggal bisnis rekonsiliasi (WIB, format YYYY-MM-DD)
  recon_date DATE NOT NULL,

  -- Nominal yang masuk ke rekening bank Mandiri/Livin' hari itu
  -- (admin input manual dari mutasi rekening)
  bank_credit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,

  -- Total QRIS yang tercatat di sistem kasir hari itu
  -- (dihitung otomatis dari transactions + transaction_payments)
  system_qris_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,

  -- Selisih: bank_credit_amount - system_qris_amount
  -- Positif = ada uang bank lebih dari kasir (jarang, mungkin reversal)
  -- Negatif = ada QRIS di kasir yang belum masuk bank (pending/palsu)
  selisih NUMERIC(15, 2) GENERATED ALWAYS AS (bank_credit_amount - system_qris_amount) STORED,

  -- Status rekonsiliasi
  -- 'MATCH'   = selisih 0 atau dalam batas toleransi (< Rp 500)
  -- 'SELISIH' = selisih > toleransi, perlu investigasi
  -- 'PENDING' = admin belum input nominal bank
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',

  -- Catatan investigasi / keterangan dari manajer
  notes TEXT,

  -- Admin yang membuat rekonsiliasi ini
  created_by_admin_id UUID NOT NULL REFERENCES public.admins(id),

  -- Admin yang terakhir update (jika ada koreksi)
  updated_by_admin_id UUID REFERENCES public.admins(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Constraint unik: 1 rekonsiliasi per tanggal (idempotent upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_qris_recon_date_unique
  ON public.qris_reconciliations(recon_date);

-- 3. Indeks performa query laporan bulanan
CREATE INDEX IF NOT EXISTS idx_qris_recon_date_status
  ON public.qris_reconciliations(recon_date DESC, status);

-- 4. Comment tabel
COMMENT ON TABLE public.qris_reconciliations
  IS 'Rekonsiliasi harian antara total QRIS kasir dan mutasi kredit rekening bank Mandiri/Livin. Dikelola Manajer/Dosen Pembina.';

-- 5. Kebijakan Keamanan Zero-Trust RLS
ALTER TABLE public.qris_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_qris_recon_deny_anon" ON public.qris_reconciliations;
DROP POLICY IF EXISTS "sk_qris_recon_deny_authenticated" ON public.qris_reconciliations;

CREATE POLICY "sk_qris_recon_deny_anon"
  ON public.qris_reconciliations FOR ALL TO anon USING (false);

CREATE POLICY "sk_qris_recon_deny_authenticated"
  ON public.qris_reconciliations FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.qris_reconciliations FROM anon, authenticated;

COMMIT;
