-- =============================================================
-- Migration v2.1: Gudang, Stock Batches & FEFO Expired Date
-- Smartkasir Perwira (Wiramart UNPERBA)
--
-- FITUR:
--   1. Tabel `stock_batches` untuk pencatatan per-batch masuk:
--      - expired_date untuk produk makanan harian (Kelas H) & kemasan (Kelas T)
--      - HPP batch spesifik (cost_price)
--      - Sisa kuantitas batch (current_qty) untuk konsumsi FEFO (First Expired First Out)
--   2. Saldo awal batch di-backfill dari produk aktif yang sudah ada.
--   3. Indeks performa FEFO & alert kedaluwarsa H-30, H-14, H-7.
--   4. RLS Zero-Trust Aerospace Grade.
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Buat tabel stock_batches
CREATE TABLE IF NOT EXISTS public.stock_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  batch_code          VARCHAR(50) NOT NULL,
  cost_price          DECIMAL(15, 2) NOT NULL DEFAULT 0,
  initial_qty         INTEGER NOT NULL CHECK (initial_qty >= 0),
  current_qty         INTEGER NOT NULL CHECK (current_qty >= 0),
  expiry_date         DATE,
  -- Kelas umur simpan: 'HARIAN' (siap saji/basi hari itu), 'PENDEK' (susu/roti), 'PANJANG' (snack kering)
  expiry_class        VARCHAR(20) NOT NULL DEFAULT 'PANJANG',
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_stock_batches_expiry_class
    CHECK (expiry_class IN ('HARIAN', 'PENDEK', 'PANJANG'))
);

-- Indeks performa query FEFO (ambil batch terdekat expired dulu yang masih punya stok)
CREATE INDEX IF NOT EXISTS idx_stock_batches_fefo
  ON public.stock_batches(product_id, expiry_date ASC, current_qty DESC);

CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry_alert
  ON public.stock_batches(expiry_date, current_qty)
  WHERE current_qty > 0;

-- 2. Backfill 1 batch "LEGACY / Saldo Awal" untuk setiap produk yang saat ini punya stok > 0
INSERT INTO public.stock_batches (
  product_id,
  batch_code,
  cost_price,
  initial_qty,
  current_qty,
  expiry_date,
  expiry_class,
  notes
)
SELECT
  p.id,
  'INIT-' || to_char(NOW(), 'YYYYMMDD'),
  COALESCE(p.cost_price, 0),
  p.stock_qty,
  p.stock_qty,
  NULL,
  'PANJANG',
  'Batch saldo awal migrasi FEFO'
FROM public.products p
WHERE p.deleted_at IS NULL
  AND p.stock_qty > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_batches sb WHERE sb.product_id = p.id
  );

-- 3. Kebijakan Keamanan Zero-Trust RLS
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_stock_batches_deny_anon"          ON public.stock_batches;
DROP POLICY IF EXISTS "sk_stock_batches_deny_authenticated" ON public.stock_batches;

CREATE POLICY "sk_stock_batches_deny_anon"          ON public.stock_batches FOR ALL TO anon          USING (false);
CREATE POLICY "sk_stock_batches_deny_authenticated" ON public.stock_batches FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.stock_batches FROM anon, authenticated;

COMMIT;
