-- ==============================================================================
-- WIRAMART v2.0: CAMPUS DELIVERY SYSTEM
-- Migration: v2.5 — Purely Additive Extension
--
-- Target Database: Supabase PostgreSQL
-- Tabel Baru:
--   1. buyers
--   2. online_orders
--   3. online_order_items
--   4. notification_logs
--
-- PRINSIP ABSOLUT:
-- - Tidak menyentuh / mengubah / menghapus satu pun tabel existing v1.x
-- - Idempotent: aman dijalankan berulang kali (IF NOT EXISTS)
-- ==============================================================================

-- ── 1. CUSTOM ENUMS ──────────────────────────────────────────────────────────

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
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE online_delivery_type AS ENUM (
    'PICKUP',
    'DELIVERY'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE online_payment_method AS ENUM (
    'QRIS',
    'TRANSFER'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;


-- ── 2. TABLE: buyers ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buyers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      VARCHAR(200) NOT NULL,
  nim            VARCHAR(20) NOT NULL,
  whatsapp       VARCHAR(20) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_flagged     BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_reason TEXT,
  flagged_by     UUID REFERENCES admins(id) ON DELETE SET NULL,
  flagged_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- Partial Unique Index NIM (hanya untuk akun aktif / non-soft-deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyers_nim_active
  ON buyers(nim)
  WHERE deleted_at IS NULL;

-- Index WhatsApp untuk pencarian & notifikasi
CREATE INDEX IF NOT EXISTS idx_buyers_whatsapp
  ON buyers(whatsapp)
  WHERE deleted_at IS NULL;


-- ── 3. TABLE: online_orders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS online_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number          VARCHAR(25) NOT NULL UNIQUE,
  buyer_id              UUID NOT NULL REFERENCES buyers(id) ON DELETE RESTRICT,

  -- Pengiriman
  delivery_type         online_delivery_type NOT NULL,
  delivery_floor        SMALLINT CHECK (delivery_floor IN (1, 2, 3, 4, 99)),
  delivery_fee          INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_note         VARCHAR(200),
  room_detail           VARCHAR(100),

  -- CS / Pelayan Runner
  assigned_cs_id        UUID REFERENCES employees(id) ON DELETE SET NULL,
  assigned_at           TIMESTAMPTZ,
  assigned_by           UUID REFERENCES admins(id) ON DELETE SET NULL,

  -- PIN Handover & No-Show Guard
  handover_pin          VARCHAR(6),
  handover_confirmed_at TIMESTAMPTZ,
  no_show_count         SMALLINT NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),

  -- Pembayaran
  payment_method        online_payment_method NOT NULL,
  payment_reference     VARCHAR(25),
  payment_proof_url     TEXT,
  payment_verified_at   TIMESTAMPTZ,
  payment_verified_by   UUID REFERENCES admins(id) ON DELETE SET NULL,

  -- Status & Lifecycle
  status                online_order_status NOT NULL DEFAULT 'WAITING_CONFIRMATION',
  cancelled_reason      TEXT,
  rejected_reason       TEXT,
  cancelled_by          UUID REFERENCES admins(id) ON DELETE SET NULL,
  confirmed_by          UUID REFERENCES admins(id) ON DELETE SET NULL,
  confirmed_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,

  -- FinOps Integer IDR (Anti-Floating Point)
  subtotal              INTEGER NOT NULL CHECK (subtotal > 0),
  total_amount          INTEGER NOT NULL CHECK (total_amount > 0),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- Index query dashboard status
CREATE INDEX IF NOT EXISTS idx_online_orders_status
  ON online_orders(status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Index query badge kasir (pesanan masuk yang butuh perhatian)
CREATE INDEX IF NOT EXISTS idx_online_orders_pending
  ON online_orders(created_at DESC)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION')
    AND deleted_at IS NULL;

-- Index query tab CS / Runner
CREATE INDEX IF NOT EXISTS idx_online_orders_cs
  ON online_orders(assigned_cs_id, status)
  WHERE assigned_cs_id IS NOT NULL AND deleted_at IS NULL;

-- Index query pesanan per buyer
CREATE INDEX IF NOT EXISTS idx_online_orders_buyer
  ON online_orders(buyer_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Index cron auto-expire
CREATE INDEX IF NOT EXISTS idx_online_orders_expire
  ON online_orders(expired_at)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION')
    AND deleted_at IS NULL;


-- ── 4. TABLE: online_order_items ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS online_order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name  VARCHAR(200) NOT NULL, -- Snapshot saat pemesanan
  selling_price INTEGER NOT NULL CHECK (selling_price > 0), -- Snapshot IDR
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  subtotal      INTEGER NOT NULL CHECK (subtotal > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_order_items_order
  ON online_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_online_order_items_product
  ON online_order_items(product_id);


-- ── 5. TABLE: notification_logs ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        VARCHAR(50) NOT NULL,
  recipient_wa      VARCHAR(20) NOT NULL,
  recipient_name    VARCHAR(200),
  message           TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  provider_response JSONB,
  error_message     TEXT,
  order_id          UUID REFERENCES online_orders(id) ON DELETE CASCADE,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_order
  ON notification_logs(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs(status, created_at DESC);


-- ── 6. ROW LEVEL SECURITY (RLS) ──────────────────────────────────────────────

ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- Service Role Full Access (Next.js backend)
DROP POLICY IF EXISTS "buyers_service_role" ON buyers;
CREATE POLICY "buyers_service_role" ON buyers FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "online_orders_service_role" ON online_orders;
CREATE POLICY "online_orders_service_role" ON online_orders FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "online_order_items_service_role" ON online_order_items;
CREATE POLICY "online_order_items_service_role" ON online_order_items FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "notification_logs_service_role" ON notification_logs;
CREATE POLICY "notification_logs_service_role" ON notification_logs FOR ALL USING (auth.role() = 'service_role');

-- Staff Access via Supabase Client (jika digunakan langsung)
DROP POLICY IF EXISTS "online_orders_staff_read" ON online_orders;
CREATE POLICY "online_orders_staff_read" ON online_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND admins.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND employees.deleted_at IS NULL)
);


-- ── 7. SUPABASE STORAGE BUCKETS (Optional / Idempotent) ───────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;
