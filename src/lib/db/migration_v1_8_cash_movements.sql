-- =============================================================
-- Migration v1.8: Shift Cash Movements (Petty Cash) & Cash Denominations
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Dijalankan pada: Supabase PostgreSQL Main Production
-- =============================================================

BEGIN;

-- 1. Tambah kolom pencatatan fisik & pecahan pada tabel shifts
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS actual_cash NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS cash_breakdown_open JSONB,
  ADD COLUMN IF NOT EXISTS cash_breakdown_close JSONB;

COMMENT ON COLUMN public.shifts.actual_cash IS 'Saldo kas fisik hasil blind count kasir saat tutup shift';
COMMENT ON COLUMN public.shifts.cash_breakdown_open IS 'Rincian lembar & koin saat buka shift { "100k": 1, "50k": 2, ... }';
COMMENT ON COLUMN public.shifts.cash_breakdown_close IS 'Rincian lembar & koin saat tutup shift';

-- 2. Buat tabel shift_cash_movements (Kas Keluar & Kas Masuk Laci / Petty Cash)
CREATE TABLE IF NOT EXISTS public.shift_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  movement_type VARCHAR(20) NOT NULL, -- 'CASH_OUT' | 'CASH_IN'
  category VARCHAR(50) NOT NULL,      -- 'KONSUMSI_GALON', 'BENSIN', 'ATK_KRESEK', 'PARKIR_KEBERSIHAN', 'TAMBAH_MODAL', 'OPERASIONAL', 'LAINNYA'
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indeks performa pencarian kas gerak per shift & tanggal
CREATE INDEX IF NOT EXISTS idx_shift_cash_movements_shift
  ON public.shift_cash_movements(shift_id);

CREATE INDEX IF NOT EXISTS idx_shift_cash_movements_type_created
  ON public.shift_cash_movements(movement_type, created_at);

-- 3. Kebijakan Keamanan Zero-Trust RLS
ALTER TABLE public.shift_cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_shift_cash_movements_deny_anon" ON public.shift_cash_movements;
DROP POLICY IF EXISTS "sk_shift_cash_movements_deny_authenticated" ON public.shift_cash_movements;

CREATE POLICY "sk_shift_cash_movements_deny_anon"
  ON public.shift_cash_movements FOR ALL TO anon USING (false);

CREATE POLICY "sk_shift_cash_movements_deny_authenticated"
  ON public.shift_cash_movements FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.shift_cash_movements FROM anon, authenticated;

COMMIT;
