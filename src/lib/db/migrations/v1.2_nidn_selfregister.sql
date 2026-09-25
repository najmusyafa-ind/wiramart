-- =============================================================
-- Migration v1.2 — Smartkasir Perwira (IDEMPOTENT VERSION)
-- Aman dijalankan meskipun kolom sudah ada / sudah diganti
-- Semua perubahan wrapped dalam DO block agar skip jika sudah done
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Rename username → nidn (HANYA jika kolom masih bernama username)
--    Jika DB dibuat dari schema.ts terbaru → kolom sudah nidn → skip
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admins' AND column_name = 'username'
  ) THEN
    ALTER TABLE admins RENAME COLUMN username TO nidn;
    RAISE NOTICE 'Kolom username berhasil direname ke nidn';
  ELSE
    RAISE NOTICE 'Kolom nidn sudah ada (skip rename)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Tambah kolom nidk (skip jika sudah ada)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE admins
ADD COLUMN IF NOT EXISTS nidk VARCHAR(20);

-- ─────────────────────────────────────────────────────────────
-- 3. Tambah kolom is_activated (skip jika sudah ada)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE admins
ADD COLUMN IF NOT EXISTS is_activated BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────
-- 4. Buat password_hash nullable (dosen baru belum set password)
--    Aman dijalankan ulang — DROP NOT NULL idempotent di PostgreSQL
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE admins ALTER COLUMN password_hash DROP NOT NULL;
  RAISE NOTICE 'password_hash sekarang nullable';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'password_hash sudah nullable (skip)';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Index unik untuk nidn dan nidk
-- ─────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS admins_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_nidn_unique
  ON admins (nidn) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_nidk_unique
  ON admins (nidk) WHERE nidk IS NOT NULL AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. employees: created_by_admin_id boleh NULL (self-register)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE employees ALTER COLUMN created_by_admin_id DROP NOT NULL;
  RAISE NOTICE 'created_by_admin_id sekarang nullable';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'created_by_admin_id sudah nullable (skip)';
END $$;

-- ─────────────────────────────────────────────────────────────
-- 7. Tambah kolom is_self_registered di employees (skip jika sudah ada)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS is_self_registered BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────
-- VERIFIKASI — Jalankan ini setelah selesai untuk konfirmasi
-- ─────────────────────────────────────────────────────────────
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name IN ('admins', 'employees')
  AND column_name IN (
    'nidn', 'nidk', 'username', 'password_hash',
    'is_activated', 'created_by_admin_id', 'is_self_registered'
  )
ORDER BY table_name, column_name;
