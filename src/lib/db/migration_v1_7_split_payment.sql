-- =============================================================
-- Migration v1.7 — Pembayaran Campuran / Split Payment (CASH + QRIS)
--
-- Memungkinkan 1 transaksi dibayar dengan kombinasi multi-metode
-- (misal sebagian QRIS, sisa tunai dengan kembalian).
--
-- ATURAN BISNIS FINANSIAL (Bagian 4.1):
--   1. Uang masuk laci kasir = CASH diterima − Kembalian.
--   2. Porsi QRIS langsung masuk rekening bank (tidak menyentuh laci kasir).
--   3. Kembalian hanya dihitung dari porsi CASH. QRIS tidak punya kembalian.
--   4. Total (amount CASH + amount QRIS) = gross_amount transaksi.
--
-- ADITIF & BACKWARD COMPATIBLE:
--   • Tabel baru `transaction_payments`; transaksi lama di-backfill otomatis.
--   • Kolom `transactions.payment_method` tetap dipertahankan untuk kompatibilitas.
--   • RLS aktif + policy deny anon/authenticated + revoke hak publik (Standar N10).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.transaction_payments;
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.transaction_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  -- 'CASH' | 'QRIS'
  payment_method        varchar(20) NOT NULL,
  -- Nilai yang dibayarkan untuk metode ini (bagian dari gross_amount)
  amount                decimal(15, 2) NOT NULL,
  -- Khusus CASH: uang fisik yang diserahkan pembeli
  cash_received         decimal(15, 2),
  -- Khusus CASH: uang kembalian yang diberikan kasir
  change_amount         decimal(15, 2),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_trx_payments_method
    CHECK (payment_method IN ('CASH', 'QRIS')),
  CONSTRAINT chk_trx_payments_amount
    CHECK (amount > 0)
);

-- Indeks performa query laporan & lookup transaksi
CREATE INDEX IF NOT EXISTS idx_trx_payments_trx
  ON public.transaction_payments(transaction_id);

CREATE INDEX IF NOT EXISTS idx_trx_payments_method
  ON public.transaction_payments(payment_method, created_at);

-- ── Backfill Transaksi Historis ──────────────────────────────
-- Salin semua transaksi yang ada ke tabel baru agar laporan masa lalu tetap utuh
INSERT INTO public.transaction_payments (
  transaction_id,
  payment_method,
  amount,
  cash_received,
  change_amount,
  created_at
)
SELECT
  t.id,
  t.payment_method::text,
  t.gross_amount,
  t.cash_received,
  t.change_amount,
  t.created_at
FROM public.transactions t
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_payments tp WHERE tp.transaction_id = t.id
);

-- ── Keamanan RLS (N10 Aerospace Zero-Trust) ──────────────────
ALTER TABLE public.transaction_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_trx_payments_deny_anon"          ON public.transaction_payments;
DROP POLICY IF EXISTS "sk_trx_payments_deny_authenticated" ON public.transaction_payments;

CREATE POLICY "sk_trx_payments_deny_anon"          ON public.transaction_payments FOR ALL TO anon          USING (false);
CREATE POLICY "sk_trx_payments_deny_authenticated" ON public.transaction_payments FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.transaction_payments FROM anon, authenticated;

COMMIT;
