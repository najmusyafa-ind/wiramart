-- =============================================================
-- Wiramart v2.0 — Migration v2.6: Buyers Table
-- Semua statement IDEMPOTEN (IF NOT EXISTS + EXCEPTION handler)
-- TIDAK menyentuh tabel existing apapun
-- =============================================================

-- Enum: sudah dibuat di schema Drizzle — dibuat juga di SQL untuk safety
DO $$ BEGIN
  CREATE TYPE online_order_status AS ENUM (
    'WAITING_PAYMENT_VERIFICATION',
    'WAITING_CONFIRMATION',
    'CONFIRMED',
    'PREPARING',
    'OUT_FOR_DELIVERY',
    'COMPLETED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'online_order_status already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE online_delivery_type AS ENUM ('PICKUP', 'DELIVERY');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'online_delivery_type already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE TYPE online_payment_method AS ENUM ('QRIS', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'online_payment_method already exists, skipping';
END $$;

-- Tabel buyers
CREATE TABLE IF NOT EXISTS buyers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      VARCHAR(200) NOT NULL,
  nim            VARCHAR(20) NOT NULL,
  whatsapp       VARCHAR(20) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_flagged     BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_reason TEXT,
  flagged_by     UUID REFERENCES admins(id),
  flagged_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyers_nim_active
  ON buyers(nim) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_buyers_whatsapp
  ON buyers(whatsapp) WHERE deleted_at IS NULL;

-- Auto-update updated_at trigger (sama seperti tabel lain)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS buyers_updated_at ON buyers;
CREATE TRIGGER buyers_updated_at
  BEFORE UPDATE ON buyers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;

-- Buyer bisa baca data dirinya sendiri (via JWT sub = buyer.id)
-- Catatan: di app ini RLS tidak dipakai untuk auth utama (JWT di server),
-- tapi dipasang sebagai defense-in-depth jika ada akses langsung Supabase.
DROP POLICY IF EXISTS "buyers_self_read" ON buyers;
CREATE POLICY "buyers_self_read" ON buyers
  FOR SELECT
  USING (auth.uid()::text = id::text);

-- Admin bisa baca semua buyer
DROP POLICY IF EXISTS "buyers_admin_read" ON buyers;
CREATE POLICY "buyers_admin_read" ON buyers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.id::text = auth.uid()::text
        AND admins.deleted_at IS NULL
    )
  );

-- Service role bisa semua (dipakai oleh API routes)
DROP POLICY IF EXISTS "buyers_service_role_all" ON buyers;
CREATE POLICY "buyers_service_role_all" ON buyers
  FOR ALL
  USING (auth.role() = 'service_role');
