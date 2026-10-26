CREATE TYPE "public"."alert_level" AS ENUM('H1_KRITIS', 'H3_URGENT', 'H5_WARNING', 'H7_WATCH');--> statement-breakpoint
CREATE TYPE "public"."condition_report_status" AS ENUM('ALERT_ONLY', 'SUBMITTED', 'MANAGER_REVIEW', 'APPROVED', 'REJECTED', 'EXECUTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."manager_decision" AS ENUM('DISCOUNT', 'DISPLAY_FRONT', 'DESTROY', 'RETURN_SUPPLIER', 'HOLD');--> statement-breakpoint
CREATE TYPE "public"."online_delivery_type" AS ENUM('PICKUP', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."online_order_status" AS ENUM('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."online_payment_method" AS ENUM('QRIS', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."stock_receive_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REVISED');--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"nim" varchar(20) NOT NULL,
	"whatsapp" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_flagged" boolean DEFAULT false NOT NULL,
	"flagged_reason" text,
	"flagged_by" uuid,
	"flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "discount_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"barcode" varchar(40) NOT NULL,
	"discounted_price" integer NOT NULL,
	"discount_pct" numeric(5, 2) NOT NULL,
	"remaining_qty" integer NOT NULL,
	"valid_until" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_barcodes_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "discount_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_report_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"discount_pct" numeric(5, 2) NOT NULL,
	"original_price" integer NOT NULL,
	"discounted_price" integer NOT NULL,
	"allowed_qty" integer NOT NULL,
	"sold_qty" integer DEFAULT 0 NOT NULL,
	"valid_from" date DEFAULT now() NOT NULL,
	"valid_until" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_duty_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"duty_date" date NOT NULL,
	"admin_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_out_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manager_duty_log_duty_date_unique" UNIQUE("duty_date")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"recipient_wa" varchar(20) NOT NULL,
	"recipient_name" varchar(200),
	"message" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_response" jsonb,
	"error_message" text,
	"order_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(200) NOT NULL,
	"selling_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(25) NOT NULL,
	"buyer_id" uuid NOT NULL,
	"delivery_type" "online_delivery_type" NOT NULL,
	"delivery_floor" smallint,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"delivery_note" varchar(200),
	"room_detail" varchar(100),
	"assigned_cs_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by" uuid,
	"handover_pin" varchar(6),
	"handover_confirmed_at" timestamp with time zone,
	"no_show_count" smallint DEFAULT 0 NOT NULL,
	"payment_method" "online_payment_method" NOT NULL,
	"payment_reference" varchar(25),
	"payment_proof_url" text,
	"payment_verified_at" timestamp with time zone,
	"payment_verified_by" uuid,
	"status" "online_order_status" DEFAULT 'WAITING_CONFIRMATION' NOT NULL,
	"cancelled_reason" text,
	"rejected_reason" text,
	"cancelled_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"subtotal" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "online_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "product_condition_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"alert_level" "alert_level" NOT NULL,
	"qty_at_alert" integer NOT NULL,
	"expiry_date" date,
	"days_remaining_at_alert" integer,
	"status" "condition_report_status" DEFAULT 'ALERT_ONLY' NOT NULL,
	"physical_condition" text,
	"gudang_suggestion" text,
	"suggested_discount_pct" numeric(5, 2),
	"submitted_by_employee_id" uuid,
	"submitted_at" timestamp with time zone,
	"manager_decision" "manager_decision",
	"approved_discount_pct" numeric(5, 2),
	"manager_note" text,
	"decided_by_admin_id" uuid,
	"decided_at" timestamp with time zone,
	"executed_by_employee_id" uuid,
	"executed_at" timestamp with time zone,
	"execution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_condition_report_batch" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "stock_receive_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receive_number" varchar(35) NOT NULL,
	"created_by_employee_id" uuid NOT NULL,
	"supplier_id" uuid,
	"supplier_name" varchar(200),
	"delivery_note" text,
	"status" "stock_receive_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"approved_by_admin_id" uuid,
	"rejected_by_admin_id" uuid,
	"manager_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stock_receive_drafts_receive_number_unique" UNIQUE("receive_number")
);
--> statement-breakpoint
CREATE TABLE "stock_receive_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" varchar(200) NOT NULL,
	"batch_code" varchar(50) NOT NULL,
	"qty" integer NOT NULL,
	"cost_price" numeric(15, 2) NOT NULL,
	"expiry_date" date,
	"condition_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact_person" varchar(200),
	"phone" varchar(30),
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daily_closings" ADD COLUMN "mod_signed_by" uuid;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD COLUMN "mod_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD COLUMN "mod_sign_note" text;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD COLUMN "stock_mutation_summary" jsonb;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD COLUMN "discount_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_flagged_by_admins_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_barcodes" ADD CONSTRAINT "discount_barcodes_policy_id_discount_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."discount_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_barcodes" ADD CONSTRAINT "discount_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_policies" ADD CONSTRAINT "discount_policies_condition_report_id_product_condition_reports_id_fk" FOREIGN KEY ("condition_report_id") REFERENCES "public"."product_condition_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_policies" ADD CONSTRAINT "discount_policies_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_policies" ADD CONSTRAINT "discount_policies_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_policies" ADD CONSTRAINT "discount_policies_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_duty_log" ADD CONSTRAINT "manager_duty_log_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_order_id_online_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."online_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_order_id_online_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."online_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_items" ADD CONSTRAINT "online_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_assigned_cs_id_employees_id_fk" FOREIGN KEY ("assigned_cs_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_assigned_by_admins_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_payment_verified_by_admins_id_fk" FOREIGN KEY ("payment_verified_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_cancelled_by_admins_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_confirmed_by_admins_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_condition_reports" ADD CONSTRAINT "product_condition_reports_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_condition_reports" ADD CONSTRAINT "product_condition_reports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_condition_reports" ADD CONSTRAINT "product_condition_reports_submitted_by_employee_id_employees_id_fk" FOREIGN KEY ("submitted_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_condition_reports" ADD CONSTRAINT "product_condition_reports_decided_by_admin_id_admins_id_fk" FOREIGN KEY ("decided_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_condition_reports" ADD CONSTRAINT "product_condition_reports_executed_by_employee_id_employees_id_fk" FOREIGN KEY ("executed_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_drafts" ADD CONSTRAINT "stock_receive_drafts_created_by_employee_id_employees_id_fk" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_drafts" ADD CONSTRAINT "stock_receive_drafts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_drafts" ADD CONSTRAINT "stock_receive_drafts_approved_by_admin_id_admins_id_fk" FOREIGN KEY ("approved_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_drafts" ADD CONSTRAINT "stock_receive_drafts_rejected_by_admin_id_admins_id_fk" FOREIGN KEY ("rejected_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_items" ADD CONSTRAINT "stock_receive_items_draft_id_stock_receive_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."stock_receive_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_items" ADD CONSTRAINT "stock_receive_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_buyers_nim_active" ON "buyers" USING btree ("nim") WHERE "buyers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_buyers_whatsapp" ON "buyers" USING btree ("whatsapp") WHERE "buyers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_discount_barcodes_lookup" ON "discount_barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_discount_policies_prod" ON "discount_policies" USING btree ("product_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_discount_policies_batch" ON "discount_policies" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_manager_duty_date" ON "manager_duty_log" USING btree ("duty_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notification_logs_order" ON "notification_logs" USING btree ("order_id") WHERE "notification_logs"."order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_notification_logs_status" ON "notification_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_online_order_items_order" ON "online_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_online_order_items_product" ON "online_order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_online_orders_status" ON "online_orders" USING btree ("status","created_at") WHERE "online_orders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_online_orders_pending" ON "online_orders" USING btree ("created_at") WHERE "online_orders"."status" IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION') AND "online_orders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_online_orders_cs" ON "online_orders" USING btree ("assigned_cs_id","status") WHERE "online_orders"."assigned_cs_id" IS NOT NULL AND "online_orders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_online_orders_expire" ON "online_orders" USING btree ("expired_at") WHERE "online_orders"."status" IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION') AND "online_orders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_cond_reports_status_alert" ON "product_condition_reports" USING btree ("status","alert_level","expiry_date");--> statement-breakpoint
CREATE INDEX "idx_cond_reports_prod" ON "product_condition_reports" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "idx_stock_receive_drafts_status" ON "stock_receive_drafts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_stock_receive_drafts_emp" ON "stock_receive_drafts" USING btree ("created_by_employee_id");--> statement-breakpoint
CREATE INDEX "idx_stock_receive_drafts_supplier" ON "stock_receive_drafts" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_stock_receive_items_draft" ON "stock_receive_items" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "idx_stock_receive_items_prod" ON "stock_receive_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_name" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_suppliers_active" ON "suppliers" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_mod_signed_by_admins_id_fk" FOREIGN KEY ("mod_signed_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;