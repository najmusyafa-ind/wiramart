-- =============================================================
-- Migration v1.2 — Tambah Info Toko ke qris_settings
-- Tanggal: 2026-09-29
-- Tujuan: Menyimpan nama toko, alamat, telepon untuk struk
-- Zero-downtime: hanya ADD COLUMN nullable — aman untuk production
-- Rollback: DROP COLUMN store_name, store_address, store_phone
-- =============================================================

-- Jalankan di Supabase SQL Editor atau psql

ALTER TABLE public.qris_settings
  ADD COLUMN IF NOT EXISTS store_name    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS store_address TEXT,
  ADD COLUMN IF NOT EXISTS store_phone   VARCHAR(30);

-- Set default awal (opsional — bisa diisi lewat UI Pengaturan)
-- UPDATE public.qris_settings
--   SET store_name    = 'WIRAMART UNPERBA',
--       store_address = 'Jl. Letjend. Suprapto No. 73, Purbalingga, Jawa Tengah',
--       store_phone   = '0281-XXXXXX'
--   WHERE id = '00000000-0000-0000-0000-000000000002';

-- Verifikasi
-- SELECT id, store_name, store_address, store_phone FROM public.qris_settings;
