-- =============================================================
-- Migration v1.1 — Smartkasir Perwira (IDEMPOTENT VERSION)
-- Aman dijalankan BERKALI-KALI — tidak akan duplikat atau
-- mengubah data yang sudah ada.
--
-- PENTING — Baca ini sebelum jalankan:
-- ┌─────────────────────────────────────────────────────────┐
-- │  BAGIAN 1 (ALTER/CREATE): Selalu aman, tidak hapus data │
-- │  BAGIAN 2 (INSERT seed):  Aman dijalankan berkali-kali  │
-- │    → Jika slot sudah ada → SKIP (tidak duplikat)        │
-- │    → Jika karyawan belum ada di DB → employee_id = NULL │
-- │    → Karyawan isi slot nanti lewat /daftar mandiri      │
-- └─────────────────────────────────────────────────────────┘
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- BAGIAN 1A: Tambah kolom barcode ke table products
-- IF NOT EXISTS → tidak merusak data yang sudah ada
-- ─────────────────────────────────────────────────────────────
ALTER TABLE products
ADD COLUMN IF NOT EXISTS barcode VARCHAR(50);

-- Unique index nullable — hanya enforce jika barcode tidak NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON products (barcode)
  WHERE barcode IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- BAGIAN 1B: Buat ENUM day_of_week (skip jika sudah ada)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE day_of_week AS ENUM (
    'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL; -- aman, skip
END $$;

-- ─────────────────────────────────────────────────────────────
-- BAGIAN 1C: Buat table shift_schedules (skip jika sudah ada)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week      day_of_week NOT NULL,
  slot_start       VARCHAR(5)  NOT NULL,
  slot_end         VARCHAR(5)  NOT NULL,
  employee_id      UUID REFERENCES employees(id),
  coordinator_name VARCHAR(200),
  order_in_slot    INTEGER NOT NULL DEFAULT 1,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index (IF NOT EXISTS → aman)
CREATE INDEX IF NOT EXISTS idx_schedule_day_slot
  ON shift_schedules (day_of_week, slot_start, slot_end);

CREATE INDEX IF NOT EXISTS idx_schedule_employee
  ON shift_schedules (employee_id);

-- ─────────────────────────────────────────────────────────────
-- BAGIAN 1D: Tambah UNIQUE constraint agar INSERT idempotent
-- Ini yang mencegah duplikat jika migration dijalankan 2x
-- (day_of_week + slot_start + slot_end + order_in_slot = unik)
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE shift_schedules
    ADD CONSTRAINT uq_schedule_slot_order
    UNIQUE (day_of_week, slot_start, slot_end, order_in_slot);
EXCEPTION
  WHEN duplicate_table THEN NULL;  -- constraint sudah ada, skip
  WHEN others THEN NULL;           -- error lain, skip
END $$;

-- ─────────────────────────────────────────────────────────────
-- BAGIAN 2: SEED DATA — Struktur slot jadwal mingguan
--
-- PENTING — Cara baca ini:
--   employee_id = NULL → slot KOSONG, belum ada karyawan
--   Karyawan TIDAK perlu dimasukkan manual di sini.
--   Setelah jalankan migration ini:
--     → Mahasiswa buka /daftar → pilih slot kosong → klaim sendiri
--     → Slot otomatis terisi dengan data mereka
--
--   ON CONFLICT DO NOTHING → jika slot sudah ada, SKIP (tidak ubah)
--   Jadi aman dijalankan ulang, data existing tidak berubah.
-- ─────────────────────────────────────────────────────────────

INSERT INTO shift_schedules
  (day_of_week, slot_start, slot_end, employee_id, coordinator_name, order_in_slot)
VALUES

-- ═══ SENIN ════════════════════════════════════════════════════
-- Slot pagi 08:00 - 11:30 (3 slot kosong)
('SENIN', '08:00', '11:30', NULL, NULL, 1),
('SENIN', '08:00', '11:30', NULL, NULL, 2),
('SENIN', '08:00', '11:30', NULL, NULL, 3),
-- Slot siang 11:30 - 15:00 (3 slot kosong)
('SENIN', '11:30', '15:00', NULL, NULL, 1),
('SENIN', '11:30', '15:00', NULL, NULL, 2),
('SENIN', '11:30', '15:00', NULL, NULL, 3),
-- Koordinator Senin (baris khusus, order 99 = tidak tampil sebagai slot karyawan)
('SENIN', '08:00', '15:00', NULL, 'Bu Hana / Bu Ayusita', 99),

-- ═══ SELASA ═══════════════════════════════════════════════════
-- Slot pagi 08:00 - 11:30 (4 slot kosong)
('SELASA', '08:00', '11:30', NULL, NULL, 1),
('SELASA', '08:00', '11:30', NULL, NULL, 2),
('SELASA', '08:00', '11:30', NULL, NULL, 3),
('SELASA', '08:00', '11:30', NULL, NULL, 4),
-- Slot siang 11:30 - 15:00 (4 slot kosong)
('SELASA', '11:30', '15:00', NULL, NULL, 1),
('SELASA', '11:30', '15:00', NULL, NULL, 2),
('SELASA', '11:30', '15:00', NULL, NULL, 3),
('SELASA', '11:30', '15:00', NULL, NULL, 4),
-- Koordinator Selasa
('SELASA', '08:00', '15:00', NULL, 'Bu Dyah', 99),

-- ═══ RABU ═════════════════════════════════════════════════════
-- Slot pagi 08:00 - 11:30 (3 slot kosong)
('RABU', '08:00', '11:30', NULL, NULL, 1),
('RABU', '08:00', '11:30', NULL, NULL, 2),
('RABU', '08:00', '11:30', NULL, NULL, 3),
-- Slot siang 11:30 - 15:00 (3 slot kosong)
('RABU', '11:30', '15:00', NULL, NULL, 1),
('RABU', '11:30', '15:00', NULL, NULL, 2),
('RABU', '11:30', '15:00', NULL, NULL, 3),
-- Koordinator Rabu
('RABU', '08:00', '15:00', NULL, 'Pak Afif', 99),

-- ═══ KAMIS ════════════════════════════════════════════════════
-- Slot pagi 08:00 - 11:30 (3 slot kosong)
('KAMIS', '08:00', '11:30', NULL, NULL, 1),
('KAMIS', '08:00', '11:30', NULL, NULL, 2),
('KAMIS', '08:00', '11:30', NULL, NULL, 3),
-- Slot siang 11:30 - 15:00 (3 slot kosong)
('KAMIS', '11:30', '15:00', NULL, NULL, 1),
('KAMIS', '11:30', '15:00', NULL, NULL, 2),
('KAMIS', '11:30', '15:00', NULL, NULL, 3),
-- Koordinator Kamis
('KAMIS', '08:00', '15:00', NULL, 'Bu Siska', 99),

-- ═══ JUMAT ════════════════════════════════════════════════════
-- Slot pagi 08:00 - 11:30 (3 slot kosong)
('JUMAT', '08:00', '11:30', NULL, NULL, 1),
('JUMAT', '08:00', '11:30', NULL, NULL, 2),
('JUMAT', '08:00', '11:30', NULL, NULL, 3),
-- Slot siang 11:30 - 15:00 (3 slot kosong)
('JUMAT', '11:30', '15:00', NULL, NULL, 1),
('JUMAT', '11:30', '15:00', NULL, NULL, 2),
('JUMAT', '11:30', '15:00', NULL, NULL, 3),
-- Koordinator Jumat
('JUMAT', '08:00', '15:00', NULL, 'Bu Hana / Bu Ayusita', 99)

-- KUNCI KEAMANAN: jika (hari + jam + urutan) sudah ada → SKIP
ON CONFLICT (day_of_week, slot_start, slot_end, order_in_slot)
DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- VERIFIKASI — Jalankan ini setelah INSERT untuk konfirmasi
-- ─────────────────────────────────────────────────────────────
SELECT
  day_of_week AS hari,
  slot_start  AS mulai,
  slot_end    AS selesai,
  order_in_slot AS urutan,
  COALESCE(e.full_name, '[ kosong — belum ada karyawan ]') AS karyawan,
  COALESCE(ss.coordinator_name, '-') AS koordinator
FROM shift_schedules ss
LEFT JOIN employees e ON ss.employee_id = e.id
WHERE ss.is_active = TRUE
ORDER BY
  CASE day_of_week
    WHEN 'SENIN'   THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
    WHEN 'KAMIS'   THEN 4 WHEN 'JUMAT'  THEN 5 ELSE 6
  END,
  slot_start,
  order_in_slot;
