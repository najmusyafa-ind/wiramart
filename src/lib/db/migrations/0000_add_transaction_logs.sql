CREATE TYPE "public"."actor_type" AS ENUM('ADMIN', 'EMPLOYEE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('HADIR', 'TELAT', 'IJIN', 'TIDAK_HADIR', 'PENGGANTI');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'QRIS');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'SEMI_ANNUAL');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."stock_action" AS ENUM('INSERT', 'UPDATE', 'SOFT_DELETE');--> statement-breakpoint
CREATE TYPE "public"."swap_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('COMPLETED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."tx_outcome" AS ENUM('COMMITTED', 'ROLLED_BACK');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nidn" varchar(100) NOT NULL,
	"nidk" varchar(20),
	"password_hash" text,
	"full_name" varchar(200) NOT NULL,
	"role" varchar(50) DEFAULT 'ADMIN_SHIFT' NOT NULL,
	"is_activated" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "admins_username_unique" UNIQUE("nidn")
);
--> statement-breakpoint
CREATE TABLE "attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"shift_id" uuid,
	"clock_in_actual" timestamp with time zone,
	"clock_out_actual" timestamp with time zone,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"recorded_by_admin_id" uuid,
	"from_swap_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"record_id" uuid NOT NULL,
	"action" "stock_action" NOT NULL,
	"old_values" text,
	"new_values" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "daily_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closing_date" date NOT NULL,
	"total_omzet" numeric(15, 2) DEFAULT '0' NOT NULL,
	"omzet_cash" numeric(15, 2) DEFAULT '0' NOT NULL,
	"omzet_qris" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_hpp" numeric(15, 2) DEFAULT '0' NOT NULL,
	"gross_profit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"operating_expenses" numeric(15, 2) DEFAULT '0' NOT NULL,
	"qris_fee" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cash_discrepancy" numeric(15, 2) DEFAULT '0' NOT NULL,
	"net_profit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'LOCKED' NOT NULL,
	"notes" text,
	"closed_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_closings_closing_date_unique" UNIQUE("closing_date")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"nim" varchar(20) NOT NULL,
	"program_studi" varchar(100) NOT NULL,
	"jabatan" varchar(100) DEFAULT 'Kasir' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid,
	"is_self_registered" boolean DEFAULT false NOT NULL,
	"is_ketua_shift" boolean DEFAULT false NOT NULL,
	"pin_hash" text,
	"pin_failed_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_maintenance" boolean DEFAULT false NOT NULL,
	"maintenance_message" text,
	"toggled_by_admin_id" uuid,
	"toggled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_date" date NOT NULL,
	"category" varchar(30) NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount" integer NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_admin_id" uuid,
	"delete_reason" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "product_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"category_id" uuid NOT NULL,
	"barcode" varchar(50),
	"unit" varchar(20) DEFAULT 'pcs' NOT NULL,
	"photo_url" text,
	"proposed_by_employee_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"admin_note" text,
	"approved_product_id" uuid,
	"reviewed_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"barcode" varchar(50),
	"cost_price" numeric(15, 2) NOT NULL,
	"selling_price" numeric(15, 2) NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"unit" varchar(20) DEFAULT 'pcs' NOT NULL,
	"photo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_perishable" boolean DEFAULT false NOT NULL,
	"perishable_type" varchar(20) DEFAULT 'KONSINYASI',
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "qris_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recon_date" date NOT NULL,
	"bank_credit_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"system_qris_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_by_admin_id" uuid NOT NULL,
	"updated_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qris_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qr_image_url" text,
	"bank_name" varchar(100),
	"account_name" varchar(200),
	"is_active" boolean DEFAULT false NOT NULL,
	"uploaded_by_admin_id" uuid,
	"uploaded_at" timestamp with time zone,
	"store_name" varchar(200),
	"store_address" text,
	"store_phone" varchar(30),
	"attendance_tolerance" integer DEFAULT 15 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"global_margin_percentage" numeric(5, 2) DEFAULT '20.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"movement_type" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"slot_start" varchar(5) NOT NULL,
	"slot_end" varchar(5) NOT NULL,
	"employee_id" uuid,
	"coordinator_name" varchar(200),
	"order_in_slot" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_schedule_slot_order" UNIQUE("day_of_week","slot_start","slot_end","order_in_slot")
);
--> statement-breakpoint
CREATE TABLE "shift_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"from_schedule_id" uuid NOT NULL,
	"to_schedule_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"peer_employee_id" uuid,
	"peer_approved_at" timestamp with time zone,
	"peer_rejected_at" timestamp with time zone,
	"status" "swap_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_admin_id" uuid,
	"reviewed_at" timestamp with time zone,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"clock_in" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_out" timestamp with time zone,
	"status" "shift_status" DEFAULT 'ACTIVE' NOT NULL,
	"modal_awal" numeric(15, 2),
	"actual_cash" numeric(15, 2),
	"cash_breakdown_open" jsonb,
	"cash_breakdown_close" jsonb,
	"handover_note" text,
	"serah_terima_diff" numeric(15, 2),
	"audit_flags" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_before" integer NOT NULL,
	"qty_after" integer NOT NULL,
	"qty_diff" integer NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_code" varchar(50) NOT NULL,
	"cost_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"initial_qty" integer DEFAULT 0 NOT NULL,
	"current_qty" integer DEFAULT 0 NOT NULL,
	"expiry_date" date,
	"expiry_class" varchar(20) DEFAULT 'PANJANG' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" varchar(200) NOT NULL,
	"cost_price_snapshot" numeric(15, 2) NOT NULL,
	"selling_price_snapshot" numeric(15, 2) NOT NULL,
	"qty" integer NOT NULL,
	"subtotal_cost" numeric(15, 2) NOT NULL,
	"subtotal_sell" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_logs" (
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
--> statement-breakpoint
CREATE TABLE "transaction_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"cash_received" numeric(15, 2),
	"change_amount" numeric(15, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"shift_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "transaction_status" DEFAULT 'COMPLETED' NOT NULL,
	"gross_amount" numeric(15, 2) NOT NULL,
	"total_hpp" numeric(15, 2) NOT NULL,
	"gross_profit" numeric(15, 2) NOT NULL,
	"cash_received" numeric(15, 2),
	"change_amount" numeric(15, 2),
	"void_reason" text,
	"voided_by_admin_id" uuid,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"idempotency_key" varchar(64),
	"request_hash" varchar(64),
	CONSTRAINT "transactions_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_schedule_id_shift_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."shift_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_recorded_by_admin_id_admins_id_fk" FOREIGN KEY ("recorded_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_from_swap_request_id_shift_swap_requests_id_fk" FOREIGN KEY ("from_swap_request_id") REFERENCES "public"."shift_swap_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_closed_by_admin_id_admins_id_fk" FOREIGN KEY ("closed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_settings" ADD CONSTRAINT "maintenance_settings_toggled_by_admin_id_admins_id_fk" FOREIGN KEY ("toggled_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_deleted_by_admin_id_admins_id_fk" FOREIGN KEY ("deleted_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_proposed_by_employee_id_employees_id_fk" FOREIGN KEY ("proposed_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_approved_product_id_products_id_fk" FOREIGN KEY ("approved_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_reviewed_by_admin_id_admins_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qris_reconciliations" ADD CONSTRAINT "qris_reconciliations_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qris_reconciliations" ADD CONSTRAINT "qris_reconciliations_updated_by_admin_id_admins_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qris_settings" ADD CONSTRAINT "qris_settings_uploaded_by_admin_id_admins_id_fk" FOREIGN KEY ("uploaded_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_cash_movements" ADD CONSTRAINT "shift_cash_movements_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_cash_movements" ADD CONSTRAINT "shift_cash_movements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_schedules" ADD CONSTRAINT "shift_schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_id_employees_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_from_schedule_id_shift_schedules_id_fk" FOREIGN KEY ("from_schedule_id") REFERENCES "public"."shift_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_to_schedule_id_shift_schedules_id_fk" FOREIGN KEY ("to_schedule_id") REFERENCES "public"."shift_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_peer_employee_id_employees_id_fk" FOREIGN KEY ("peer_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_reviewed_by_admin_id_admins_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_adjusted_by_admin_id_admins_id_fk" FOREIGN KEY ("adjusted_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_payments" ADD CONSTRAINT "transaction_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voided_by_admin_id_admins_id_fk" FOREIGN KEY ("voided_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_admins_nidn_unique" ON "admins" USING btree ("nidn") WHERE "admins"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_admins_nidk_unique" ON "admins" USING btree ("nidk") WHERE "admins"."nidk" IS NOT NULL AND "admins"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_attendance_unique" ON "attendances" USING btree ("employee_id","schedule_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_date" ON "attendances" USING btree ("attendance_date","status");--> statement-breakpoint
CREATE INDEX "idx_attendance_employee" ON "attendances" USING btree ("employee_id","attendance_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_table_record" ON "audit_logs" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_daily_closings_date" ON "daily_closings" USING btree ("closing_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_daily_closings_status" ON "daily_closings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employees_nim_unique" ON "employees" USING btree ("nim") WHERE "employees"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_opex_date_active" ON "operating_expenses" USING btree ("expense_date") WHERE "operating_expenses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_product_proposals_status" ON "product_proposals" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_product_proposals_employee" ON "product_proposals" USING btree ("proposed_by_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_products_barcode_active_unique" ON "products" USING btree ("barcode") WHERE "products"."barcode" IS NOT NULL AND "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qris_recon_date_unique" ON "qris_reconciliations" USING btree ("recon_date");--> statement-breakpoint
CREATE INDEX "idx_qris_recon_date_status" ON "qris_reconciliations" USING btree ("recon_date","status");--> statement-breakpoint
CREATE INDEX "idx_shift_cash_movements_shift" ON "shift_cash_movements" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_shift_cash_movements_type_created" ON "shift_cash_movements" USING btree ("movement_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_schedule_day_slot" ON "shift_schedules" USING btree ("day_of_week","slot_start","slot_end");--> statement-breakpoint
CREATE INDEX "idx_schedule_employee" ON "shift_schedules" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_swap_status_created" ON "shift_swap_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_swap_requester" ON "shift_swap_requests" USING btree ("requester_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_shifts_employee" ON "shifts" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_shifts_clock_in" ON "shifts" USING btree ("clock_in" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_stock_adj_product" ON "stock_adjustments" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_batches_fefo" ON "stock_batches" USING btree ("product_id","expiry_date","current_qty");--> statement-breakpoint
CREATE INDEX "idx_stock_batches_expiry_alert" ON "stock_batches" USING btree ("expiry_date","current_qty");--> statement-breakpoint
CREATE INDEX "idx_trx_items_txn" ON "transaction_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_trx_items_product" ON "transaction_items" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_logs_employee_idx" ON "transaction_logs" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "transaction_logs_shift_idx" ON "transaction_logs" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "transaction_logs_outcome_idx" ON "transaction_logs" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "transaction_logs_created_idx" ON "transaction_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_trx_payments_trx" ON "transaction_payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_trx_payments_method" ON "transaction_payments" USING btree ("payment_method","created_at");--> statement-breakpoint
CREATE INDEX "idx_trx_created_status" ON "transactions" USING btree ("created_at","status");--> statement-breakpoint
CREATE INDEX "idx_trx_employee" ON "transactions" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trx_shift" ON "transactions" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_trx_payment" ON "transactions" USING btree ("payment_method","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trx_employee_idempotency" ON "transactions" USING btree ("employee_id","idempotency_key") WHERE "transactions"."idempotency_key" IS NOT NULL;