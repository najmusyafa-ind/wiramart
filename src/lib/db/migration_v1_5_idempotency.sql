-- =============================================================
-- Migration v1.5 — Idempotensi checkout (Fase 0.4b, D17)
--
-- Mencegah transaksi ganda saat kasir menekan "Bayar" dua kali atau
-- respons jaringan hilang setelah commit. Klien mengirim Idempotency-Key
-- per percobaan checkout; server mengembalikan hasil yang sama untuk
-- kunci yang sama.
--
-- ADITIF & AMAN DIULANG:
--   • Kolom nullable → kode lama tidak terpengaruh, baris lama tetap NULL.
--   • Unique index PARSIAL → hanya baris yang punya kunci yang dibatasi.
--   • Unik per KARYAWAN → kunci kasir lain tidak bisa bentrok/dibajak.
--   • request_hash → kunci yang sama dengan isi belanja berbeda ditolak.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_trx_employee_idempotency;
--   ALTER TABLE transactions DROP COLUMN IF EXISTS request_hash,
--                            DROP COLUMN IF EXISTS idempotency_key;
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(64),
  ADD COLUMN IF NOT EXISTS request_hash    varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trx_employee_idempotency
  ON transactions (employee_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
