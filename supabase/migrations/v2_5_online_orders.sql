-- =============================================================
-- Wiramart v2.0 — Migration v2.5: Online Orders & Items
-- Harus dijalankan SETELAH v2_6_buyers.sql (FK ke buyers)
-- TIDAK menyentuh tabel existing apapun
-- =============================================================

-- Tabel online_orders
CREATE TABLE IF NOT EXISTS online_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number          VARCHAR(25) NOT NULL UNIQUE,
  buyer_id              UUID NOT NULL REFERENCES buyers(id),

  -- Delivery
  delivery_type         online_delivery_type NOT NULL,
  delivery_floor        SMALLINT CHECK (delivery_floor IN (1, 2, 3, 4, 99)),
  delivery_fee          INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_note         VARCHAR(200),
  room_detail           VARCHAR(100),

  -- Runner
  assigned_cs_id        UUID REFERENCES employees(id),
  assigned_at           TIMESTAMPTZ,
  assigned_by           UUID REFERENCES admins(id),

  -- PIN serah terima
  handover_pin          VARCHAR(6),
  handover_confirmed_at TIMESTAMPTZ,
  no_show_count         SMALLINT NOT NULL DEFAULT 0,

  -- Payment
  payment_method        online_payment_method NOT NULL,
  payment_reference     VARCHAR(25),
  payment_proof_url     TEXT,
  payment_verified_at   TIMESTAMPTZ,
  payment_verified_by   UUID REFERENCES admins(id),

  -- Status & lifecycle
  status                online_order_status NOT NULL DEFAULT 'WAITING_CONFIRMATION',
  cancelled_reason      TEXT,
  rejected_reason       TEXT,
  cancelled_by          UUID REFERENCES admins(id),
  confirmed_by          UUID REFERENCES admins(id),
  confirmed_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,

  -- Amounts (IDR integer)
  subtotal              INTEGER NOT NULL CHECK (subtotal > 0),
  total_amount          INTEGER NOT NULL CHECK (total_amount > 0),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- Tabel online_order_items
CREATE TABLE IF NOT EXISTS online_order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  product_name  VARCHAR(200) NOT NULL,
  selling_price INTEGER NOT NULL CHECK (selling_price > 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  subtotal      INTEGER NOT NULL CHECK (subtotal > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes online_orders
CREATE INDEX IF NOT EXISTS idx_online_orders_status
  ON online_orders(status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_online_orders_pending
  ON online_orders(created_at DESC)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION')
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_online_orders_cs
  ON online_orders(assigned_cs_id, status)
  WHERE assigned_cs_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_online_orders_expire
  ON online_orders(expired_at)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION')
    AND deleted_at IS NULL;

-- Indexes online_order_items
CREATE INDEX IF NOT EXISTS idx_online_order_items_order
  ON online_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_online_order_items_product
  ON online_order_items(product_id);

-- Auto-update trigger
DROP TRIGGER IF EXISTS online_orders_updated_at ON online_orders;
CREATE TRIGGER online_orders_updated_at
  BEFORE UPDATE ON online_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;

-- Buyer hanya bisa lihat ordernya sendiri
DROP POLICY IF EXISTS "online_orders_buyer_self" ON online_orders;
CREATE POLICY "online_orders_buyer_self" ON online_orders
  FOR SELECT
  USING (buyer_id::text = auth.uid()::text);

-- Staff (admin dan employee) bisa baca semua
DROP POLICY IF EXISTS "online_orders_staff_read" ON online_orders;
CREATE POLICY "online_orders_staff_read" ON online_orders
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND deleted_at IS NULL)
  );

-- Service role bisa semua (API routes pakai service_role key)
DROP POLICY IF EXISTS "online_orders_service_role" ON online_orders;
CREATE POLICY "online_orders_service_role" ON online_orders
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "online_order_items_service_role" ON online_order_items;
CREATE POLICY "online_order_items_service_role" ON online_order_items
  FOR ALL USING (auth.role() = 'service_role');

-- Buyer bisa baca items milik ordernya
DROP POLICY IF EXISTS "online_order_items_buyer_self" ON online_order_items;
CREATE POLICY "online_order_items_buyer_self" ON online_order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM online_orders
      WHERE online_orders.id = online_order_items.order_id
        AND online_orders.buyer_id::text = auth.uid()::text
    )
  );
