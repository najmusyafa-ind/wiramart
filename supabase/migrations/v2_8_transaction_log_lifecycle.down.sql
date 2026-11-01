-- Pembatalan v2_8. Jalankan hanya bila perlu.
-- Nilai enum 'STARTED' dan 'REJECTED' tidak bisa dihapus di PostgreSQL; dibiarkan, tidak berbahaya.
-- Baris ber-outcome STARTED / REJECTED harus dibersihkan lebih dulu jika kolom mau dikembalikan NOT NULL.

DROP INDEX IF EXISTS transaction_logs_open_idx;

ALTER TABLE transaction_logs DROP COLUMN IF EXISTS finished_at;
ALTER TABLE transaction_logs DROP COLUMN IF EXISTS failed_step;

-- Kembalikan NOT NULL hanya jika tidak ada baris yang melanggar:
-- DELETE FROM transaction_logs WHERE outcome IN ('STARTED','REJECTED');
-- ALTER TABLE transaction_logs ALTER COLUMN invoice_attempt SET NOT NULL;
-- ALTER TABLE transaction_logs ALTER COLUMN gross_amount    SET NOT NULL;
-- ALTER TABLE transaction_logs ALTER COLUMN payment_method  SET NOT NULL;

-- FK shift_id / transaction_id sengaja TIDAK dihapus: staging sudah memilikinya sejak awal.

