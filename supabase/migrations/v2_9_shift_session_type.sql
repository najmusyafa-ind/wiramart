-- =============================================================
-- Wiramart v2.9: Kolom eksplisit shifts.session_type ('PAGI' | 'SIANG')
--
-- Tujuan: Menjadikan sesi shift (Shift Pagi vs Shift Siang) sebagai
-- Single Source of Truth (SSOT) eksplisit di database sehingga shift
-- siang yang dibuka lebih awal (< 11:15 WIB) tetap tercatat sebagai
-- Shift Siang secara konsisten di seluruh laporan & pantauan.
--
-- Sifat: aditif (nullable untuk keamanan backward compatibility).
-- =============================================================

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS session_type VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.shifts'::regclass
      AND conname = 'chk_shifts_session_type'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT chk_shifts_session_type
      CHECK (session_type IS NULL OR session_type IN ('PAGI', 'SIANG'));
  END IF;
END $$;
