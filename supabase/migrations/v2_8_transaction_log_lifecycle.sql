-- =============================================================
-- Wiramart v2.8: Siklus hidup log transaksi (STARTED -> COMMITTED / ROLLED_BACK / REJECTED)
--
-- Tujuan: setiap percobaan checkout meninggalkan SATU baris bukti di database,
-- dari titik mulai (created_at) sampai hasil akhir (finished_at), termasuk
-- penolakan sebelum transaksi DB dimulai.
--
-- Sifat: aditif. Kode lama tetap berjalan tanpa perubahan.
-- Penjalan: scripts/apply-migration.ts (tiap bagian dipisah penanda "-- @@"
-- dan dijalankan sendiri-sendiri, karena nilai enum baru baru boleh dipakai
-- setelah perintah ADD VALUE ter-commit).
-- Pembatalan: v2_8_transaction_log_lifecycle.down.sql
-- =============================================================

ALTER TYPE tx_outcome ADD VALUE IF NOT EXISTS 'STARTED';
ALTER TYPE tx_outcome ADD VALUE IF NOT EXISTS 'REJECTED';

-- @@

-- created_at (sudah ada) = waktu mulai. finished_at = waktu hasil akhir.
-- Baris lama sengaja dibiarkan NULL: waktu selesai aslinya tidak pernah dicatat.
ALTER TABLE transaction_logs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
-- Langkah yang gagal, mis. VALIDASI_STOK, CEK_SHIFT, INSERT_ITEM, KURANGI_STOK.
ALTER TABLE transaction_logs ADD COLUMN IF NOT EXISTS failed_step VARCHAR(50);

-- Penolakan sebelum transaksi belum punya nomor invoice / total / metode bayar.
ALTER TABLE transaction_logs ALTER COLUMN invoice_attempt DROP NOT NULL;
ALTER TABLE transaction_logs ALTER COLUMN gross_amount    DROP NOT NULL;
ALTER TABLE transaction_logs ALTER COLUMN payment_method  DROP NOT NULL;

-- FK ke shifts dan transactions. Staging sudah punya, produksi belum;
-- dicek lewat kolom (bukan nama constraint) supaya aman dijalankan di keduanya.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.transaction_logs'::regclass
      AND c.contype = 'f' AND a.attname = 'shift_id'
  ) THEN
    ALTER TABLE transaction_logs
      ADD CONSTRAINT transaction_logs_shift_id_fkey
      FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.transaction_logs'::regclass
      AND c.contype = 'f' AND a.attname = 'transaction_id'
  ) THEN
    ALTER TABLE transaction_logs
      ADD CONSTRAINT transaction_logs_transaction_id_fkey
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Mencari transaksi yang "menggantung" (STARTED tapi tidak pernah selesai).
CREATE INDEX IF NOT EXISTS transaction_logs_open_idx
  ON transaction_logs (created_at)
  WHERE outcome = 'STARTED';

