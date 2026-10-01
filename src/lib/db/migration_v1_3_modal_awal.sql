-- =============================================================
-- Migration v1.3 — Tambah Modal Awal ke shifts + kasir_sessions view
-- Tanggal: 2026-09-29
-- Tujuan: Wajibkan input modal awal saat buka shift
-- Zero-downtime: hanya ADD COLUMN nullable — aman untuk production
-- =============================================================

-- 1. Tambah kolom modal_awal ke tabel shifts
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS modal_awal   NUMERIC(15, 2),    -- Modal awal yang disetorkan saat buka shift
  ADD COLUMN IF NOT EXISTS handover_note TEXT;              -- Catatan serah terima laci ke shift berikutnya

-- 2. Tambah kolom notes ke shifts untuk keterangan umum
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Index untuk query laporan per tanggal
CREATE INDEX IF NOT EXISTS idx_shifts_clock_in
  ON public.shifts (clock_in DESC);

-- 4. Verifikasi
-- SELECT id, employee_id, clock_in, clock_out, status, modal_awal, handover_note
-- FROM public.shifts
-- ORDER BY clock_in DESC
-- LIMIT 10;
