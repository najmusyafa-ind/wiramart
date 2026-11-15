-- =============================================================
-- Migration v3.2 — Partial Unique Index pada shifts (D8 Hardening)
--
-- Menjamin setiap karyawan (employee_id) hanya bisa memiliki MAKSIMAL
-- SATU baris shift dengan status = 'ACTIVE' pada saat bersamaan, tanpa
-- menghalangi karyawan memiliki banyak riwayat shift CLOSED.
--
-- ADITIF & AMAN DIULANG (IDEMPOTEN):
--   • Membersihkan sisa deklarasi keliru lama (`shifts_employee_one_active`)
--     jika masih ada di environment dev/staging.
--   • Menutup duplikat shift ACTIVE lama (jika >1 per employee_id), sambil
--     tetap mempertahankan shift ACTIVE terbaru (clock_in DESC) secara utuh.
--   • Unique index PARSIAL hanya membatasi status = 'ACTIVE'.
--   • Dijalankan atomik dalam transaksi dengan lock_timeout = '5s'.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_shifts_one_active_per_employee;
--   -- Catatan: duplikat shift ACTIVE yang telah ditutup (jika ada) tidak
--   -- dibuka kembali secara otomatis; periksa notes LIKE '%AUTO_CLOSED_DUPLICATE_MIGRATION_V3_2%'.
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Bersihkan constraint/index lama yang keliru jika ada di env non-produksi
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_employee_one_active;
DROP INDEX IF EXISTS shifts_employee_one_active;

-- 2. Jika ada karyawan dengan >1 baris shift ACTIVE historis, tutup baris yang lebih lama
--    secara aman agar pembuatan unique index parsial tidak gagal (SQLSTATE 23505).
WITH ranked_active AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY employee_id
      ORDER BY clock_in DESC, created_at DESC, id DESC
    ) AS rn
  FROM shifts
  WHERE status = 'ACTIVE'
)
UPDATE shifts AS s
SET
  status = 'CLOSED',
  clock_out = COALESCE(s.clock_out, NOW()),
  notes = CASE
    WHEN s.notes IS NULL OR BTRIM(s.notes) = '' THEN 'AUTO_CLOSED_DUPLICATE_MIGRATION_V3_2'
    ELSE s.notes || ' | AUTO_CLOSED_DUPLICATE_MIGRATION_V3_2'
  END
FROM ranked_active AS r
WHERE s.id = r.id
  AND r.rn > 1;

-- 3. Tegakkan aturan D8 di level database via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_active_per_employee
  ON shifts (employee_id)
  WHERE (status = 'ACTIVE');

COMMIT;

