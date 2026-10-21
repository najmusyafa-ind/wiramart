-- =============================================================
-- MIGRATION v3.1: TRANSACTION_LOGS (Audit Trail COMMIT & ROLLBACK)
-- =============================================================

DO $$ BEGIN
  CREATE TYPE tx_outcome AS ENUM ('COMMITTED', 'ROLLED_BACK');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "transaction_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL,
  "shift_id" uuid,
  "invoice_attempt" varchar(30) NOT NULL,
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "item_count" integer NOT NULL,
  "gross_amount" numeric(12, 2) NOT NULL,
  "payment_method" "payment_method" NOT NULL,
  "outcome" "tx_outcome" NOT NULL,
  "transaction_id" uuid,
  "rollback_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "transaction_logs_employee_idx" ON "transaction_logs" ("employee_id");
CREATE INDEX IF NOT EXISTS "transaction_logs_shift_idx" ON "transaction_logs" ("shift_id");
CREATE INDEX IF NOT EXISTS "transaction_logs_outcome_idx" ON "transaction_logs" ("outcome");
CREATE INDEX IF NOT EXISTS "transaction_logs_created_idx" ON "transaction_logs" ("created_at");
