-- =============================================================
-- Migration v2.3: Admin Roles & Manager Separation (Wiramart UNPERBA)
-- Menambahkan kolom role pada tabel admins:
--   'MANAGER'     : Khusus Dosen / Developer Testing Absolut (Full Executive Privileges)
--   'ADMIN_SHIFT' : Mahasiswa Pengelola Toko & Koordinator Shift Harian
-- =============================================================

-- 1. Tambah kolom role jika belum ada
ALTER TABLE admins 
ADD COLUMN IF NOT EXISTS role varchar(50) NOT NULL DEFAULT 'ADMIN_SHIFT';

-- 2. Tambah check constraint untuk validitas role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_admins_role'
  ) THEN
    ALTER TABLE admins 
    ADD CONSTRAINT chk_admins_role 
    CHECK (role IN ('MANAGER', 'ADMIN_SHIFT'));
  END IF;
END $$;

-- 3. Update Akun Developer Testing Absolut 1: NIDN 1234567890 (Password: 123456) -> MANAGER
UPDATE admins 
SET 
  role = 'MANAGER',
  password_hash = '$2b$12$cZA8so2Qi8zsx2U0h/d2geCUhm8LrRWehy9r8bVx9s1.Bew/CHNFi',
  is_activated = true,
  is_active = true,
  updated_at = NOW()
WHERE nidn = '1234567890';

-- 4. Update Akun Developer Testing Absolut 2: NIDN 12345678900 (Password: 111111) -> MANAGER
UPDATE admins 
SET 
  role = 'MANAGER',
  password_hash = '$2b$12$EczQzTpKPCmUdI6.pa9Rm.c4VRdvqDMpf5aHGCXUHtVfxNE9F7hMm',
  is_activated = true,
  is_active = true,
  updated_at = NOW()
WHERE nidn = '12345678900';

-- 5. Pastikan semua akun selain dua di atas berstatus ADMIN_SHIFT
UPDATE admins
SET role = 'ADMIN_SHIFT'
WHERE nidn NOT IN ('1234567890', '12345678900') AND role IS NULL;
