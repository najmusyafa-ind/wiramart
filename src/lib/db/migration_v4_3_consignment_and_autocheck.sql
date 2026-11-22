-- =============================================================
-- Smartkasir Perwira (Wiramart UNPERBA) — Migration v4.3
-- Cakupan:
--   1. Tabel baru public.consignment_entries (Buku Titipan Harian) + RLS deny-all
--   2. Kolom additive pada public.shifts (Auto-Checklist Selisih Laci & Jeda 5 Menit)
--   3. Kolom additive pada public.attendances (Peran harian, sumber verifikasi, badal)
--   4. Kolom additive pada public.shift_cash_movements (Penanda koreksi jeda 5m & relasi titipan)
--   5. Perbaikan jadwal Shift Siang (11:00 -> 11:30) dan buka blokir 4 akun Gudang
-- =============================================================

BEGIN;

-- 1. Tabel Buku Titipan Harian (Konsinyasi)
CREATE TABLE IF NOT EXISTS public.consignment_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  mitra_name varchar(200) NOT NULL,
  qty_initial integer NOT NULL CHECK (qty_initial > 0),
  harga_setor decimal(15, 2) NOT NULL CHECK (harga_setor >= 0),
  selling_price decimal(15, 2) NOT NULL CHECK (selling_price >= 0),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CARRYOVER', 'SETTLED')),
  qty_sold_pos integer,
  qty_remaining integer,
  qty_sold_physical integer,
  qty_discrepancy integer NOT NULL DEFAULT 0,
  total_payout decimal(15, 2),
  payout_source varchar(30) CHECK (payout_source IS NULL OR payout_source IN ('CASH_LACI', 'TRANSFER_PENGELOLA', 'NONE')),
  cash_movement_id uuid REFERENCES public.shift_cash_movements(id) ON DELETE SET NULL,
  created_by_employee_id uuid NOT NULL REFERENCES public.employees(id),
  settled_by_employee_id uuid REFERENCES public.employees(id),
  settled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consignment_date_status
  ON public.consignment_entries (entry_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_consignment_product_date
  ON public.consignment_entries (product_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_consignment_status_open
  ON public.consignment_entries (status)
  WHERE status IN ('OPEN', 'CARRYOVER');

-- RLS Deny-All (Konsisten dengan seluruh 33 tabel lain)
ALTER TABLE public.consignment_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sk_consignment_deny_anon" ON public.consignment_entries;
DROP POLICY IF EXISTS "sk_consignment_deny_authenticated" ON public.consignment_entries;
CREATE POLICY "sk_consignment_deny_anon"
  ON public.consignment_entries FOR ALL TO anon USING (false);
CREATE POLICY "sk_consignment_deny_authenticated"
  ON public.consignment_entries FOR ALL TO authenticated USING (false);

-- 2. Kolom additive pada public.shifts (Auto-Checklist Jeda 5 Menit)
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS shortage_status varchar(30) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS shortage_grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS shortage_amount decimal(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shortage_recount_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shortage_override_reason text,
  ADD COLUMN IF NOT EXISTS shortage_override_by_admin_id uuid REFERENCES public.admins(id),
  ADD COLUMN IF NOT EXISTS shortage_override_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_shifts_shortage_status
  ON public.shifts (shortage_status)
  WHERE shortage_status IN ('PENDING_GRACE', 'AUTO_LOCKED');

-- 3. Kolom additive pada public.attendances
ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS role_task varchar(50),
  ADD COLUMN IF NOT EXISTS verification_source varchar(30) NOT NULL DEFAULT 'KIOSK',
  ADD COLUMN IF NOT EXISTS is_substitute boolean NOT NULL DEFAULT false;

-- Backfill role_task dari prefix notes 'Peran: ...' untuk data yang sudah ada
UPDATE public.attendances
SET role_task = TRIM(SUBSTRING(notes FROM '^Peran:\s*([^|]+)'))
WHERE role_task IS NULL
  AND notes IS NOT NULL
  AND notes LIKE 'Peran: %';

-- 4. Kolom additive pada public.shift_cash_movements
ALTER TABLE public.shift_cash_movements
  ADD COLUMN IF NOT EXISTS is_grace_correction boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consignment_entry_id uuid REFERENCES public.consignment_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shift_cash_movements_consignment
  ON public.shift_cash_movements (consignment_entry_id)
  WHERE consignment_entry_id IS NOT NULL;

-- 5. Sinkronisasi jadwal Shift Siang (11:00 -> 11:30 WIB)
UPDATE public.shift_schedules
SET slot_start = '11:30',
    updated_at = now()
WHERE slot_start = '11:00'
  AND slot_end = '15:00'
  AND is_active = true;

-- 6. Buka blokir 4 akun aktif yang terjebak jabatan = 'Gudang'
UPDATE public.employees
SET jabatan = 'Kasir',
    updated_at = now()
WHERE is_active = true
  AND deleted_at IS NULL
  AND LOWER(jabatan) LIKE '%gudang%';

COMMIT;
