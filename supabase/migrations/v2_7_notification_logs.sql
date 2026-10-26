-- =============================================================
-- Wiramart v2.0 — Migration v2.7: Notification Logs
-- Harus dijalankan SETELAH v2_5_online_orders.sql (FK ke online_orders)
-- =============================================================

CREATE TABLE IF NOT EXISTS notification_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Event yang memicu: ORDER_CREATED, ORDER_CONFIRMED, OUT_FOR_DELIVERY, dll
  event_type        VARCHAR(50) NOT NULL,
  -- Nomor WA format internasional (628xxx)
  recipient_wa      VARCHAR(20) NOT NULL,
  recipient_name    VARCHAR(200),
  message           TEXT NOT NULL,
  -- PENDING | SENT | FAILED
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  -- Raw response dari Fonnte API
  provider_response JSONB,
  error_message     TEXT,
  order_id          UUID REFERENCES online_orders(id),
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_order
  ON notification_logs(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs(status, created_at DESC);

-- RLS: hanya service_role yang bisa akses (log internal sistem)
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_logs_service_role" ON notification_logs;
CREATE POLICY "notification_logs_service_role" ON notification_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Admin bisa baca log (untuk monitoring dan debugging)
DROP POLICY IF EXISTS "notification_logs_admin_read" ON notification_logs;
CREATE POLICY "notification_logs_admin_read" ON notification_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE admins.id::text = auth.uid()::text
        AND admins.deleted_at IS NULL
    )
  );
