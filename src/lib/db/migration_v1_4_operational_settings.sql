-- =============================================================
-- Migration v1.4 — Pengaturan Operasional
-- Tambah 2 kolom ke qris_settings (singleton settings table):
--   attendance_tolerance : toleransi clock-in absensi (menit)
--   low_stock_threshold  : threshold stok rendah untuk alert
-- =============================================================

ALTER TABLE qris_settings
  ADD COLUMN IF NOT EXISTS attendance_tolerance INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS low_stock_threshold  INTEGER NOT NULL DEFAULT 5;

-- Update singleton row jika sudah ada
UPDATE qris_settings
  SET attendance_tolerance = 15, low_stock_threshold = 5
  WHERE attendance_tolerance IS NULL OR low_stock_threshold IS NULL;
