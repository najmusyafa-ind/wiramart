import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

const stagingEnv = dotenv.parse(fs.readFileSync('.env.staging'));
const sql = postgres(stagingEnv.DATABASE_URL);

async function main() {
  console.log('=== MENERAPKAN PENGETATAN NORMALISASI & CONSTRAINTS DI STAGING ===\n');

  await sql.begin(async (tx) => {
    // 1. Tambah kolom supplier_id di stock_receive_drafts jika belum ada
    console.log('1. Memastikan kolom supplier_id di stock_receive_drafts...');
    await tx`
      ALTER TABLE public.stock_receive_drafts 
      ADD COLUMN IF NOT EXISTS supplier_id UUID;
    `;

    // 2. Terapkan Foreign Key Constraints & Check Constraints
    console.log('2. Menambahkan Foreign Keys pada tabel PRD 3.0...');

    // A. suppliers
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_suppliers_admin') THEN
          ALTER TABLE public.suppliers
          ADD CONSTRAINT fk_suppliers_admin
          FOREIGN KEY (created_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // B. stock_receive_drafts
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srd_supplier') THEN
          ALTER TABLE public.stock_receive_drafts
          ADD CONSTRAINT fk_srd_supplier
          FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srd_employee') THEN
          ALTER TABLE public.stock_receive_drafts
          ADD CONSTRAINT fk_srd_employee
          FOREIGN KEY (created_by_employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srd_admin_approved') THEN
          ALTER TABLE public.stock_receive_drafts
          ADD CONSTRAINT fk_srd_admin_approved
          FOREIGN KEY (approved_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srd_admin_rejected') THEN
          ALTER TABLE public.stock_receive_drafts
          ADD CONSTRAINT fk_srd_admin_rejected
          FOREIGN KEY (rejected_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_srd_receive_number') THEN
          ALTER TABLE public.stock_receive_drafts
          ADD CONSTRAINT uq_srd_receive_number UNIQUE (receive_number);
        END IF;
      END $$;
    `;

    // C. stock_receive_items
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sri_draft') THEN
          ALTER TABLE public.stock_receive_items
          ADD CONSTRAINT fk_sri_draft
          FOREIGN KEY (draft_id) REFERENCES public.stock_receive_drafts(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sri_product') THEN
          ALTER TABLE public.stock_receive_items
          ADD CONSTRAINT fk_sri_product
          FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sri_qty') THEN
          ALTER TABLE public.stock_receive_items
          ADD CONSTRAINT chk_sri_qty CHECK (qty > 0);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sri_cost') THEN
          ALTER TABLE public.stock_receive_items
          ADD CONSTRAINT chk_sri_cost CHECK (cost_price >= 0);
        END IF;
      END $$;
    `;

    // D. stock_batches
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_batches_product') THEN
          ALTER TABLE public.stock_batches
          ADD CONSTRAINT fk_batches_product
          FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
        END IF;
      END $$;
    `;

    // E. product_condition_reports
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_batch') THEN
          ALTER TABLE public.product_condition_reports
          ADD CONSTRAINT fk_pcr_batch
          FOREIGN KEY (batch_id) REFERENCES public.stock_batches(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_product') THEN
          ALTER TABLE public.product_condition_reports
          ADD CONSTRAINT fk_pcr_product
          FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_employee_submitted') THEN
          ALTER TABLE public.product_condition_reports
          ADD CONSTRAINT fk_pcr_employee_submitted
          FOREIGN KEY (submitted_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_admin_decided') THEN
          ALTER TABLE public.product_condition_reports
          ADD CONSTRAINT fk_pcr_admin_decided
          FOREIGN KEY (decided_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcr_employee_executed') THEN
          ALTER TABLE public.product_condition_reports
          ADD CONSTRAINT fk_pcr_employee_executed
          FOREIGN KEY (executed_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_pcr_batch') THEN
          ALTER TABLE public.product_condition_reports
          ADD CONSTRAINT uq_pcr_batch UNIQUE (batch_id);
        END IF;
      END $$;
    `;

    // F. discount_policies
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_policy_report') THEN
          ALTER TABLE public.discount_policies
          ADD CONSTRAINT fk_disc_policy_report
          FOREIGN KEY (condition_report_id) REFERENCES public.product_condition_reports(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_policy_product') THEN
          ALTER TABLE public.discount_policies
          ADD CONSTRAINT fk_disc_policy_product
          FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_policy_batch') THEN
          ALTER TABLE public.discount_policies
          ADD CONSTRAINT fk_disc_policy_batch
          FOREIGN KEY (batch_id) REFERENCES public.stock_batches(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_policy_admin') THEN
          ALTER TABLE public.discount_policies
          ADD CONSTRAINT fk_disc_policy_admin
          FOREIGN KEY (created_by_admin_id) REFERENCES public.admins(id) ON DELETE RESTRICT;
        END IF;
      END $$;
    `;

    // G. discount_barcodes
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_barcodes_policy') THEN
          ALTER TABLE public.discount_barcodes
          ADD CONSTRAINT fk_disc_barcodes_policy
          FOREIGN KEY (policy_id) REFERENCES public.discount_policies(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_disc_barcodes_product') THEN
          ALTER TABLE public.discount_barcodes
          ADD CONSTRAINT fk_disc_barcodes_product
          FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_disc_barcodes_barcode') THEN
          ALTER TABLE public.discount_barcodes
          ADD CONSTRAINT uq_disc_barcodes_barcode UNIQUE (barcode);
        END IF;
      END $$;
    `;

    // H. manager_duty_log
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mod_admin') THEN
          ALTER TABLE public.manager_duty_log
          ADD CONSTRAINT fk_mod_admin
          FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mod_duty_date') THEN
          ALTER TABLE public.manager_duty_log
          ADD CONSTRAINT uq_mod_duty_date UNIQUE (duty_date);
        END IF;
      END $$;
    `;

    // I. transaction_logs
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tx_logs_employee') THEN
          ALTER TABLE public.transaction_logs
          ADD CONSTRAINT fk_tx_logs_employee
          FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tx_logs_shift') THEN
          ALTER TABLE public.transaction_logs
          ADD CONSTRAINT fk_tx_logs_shift
          FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tx_logs_tx') THEN
          ALTER TABLE public.transaction_logs
          ADD CONSTRAINT fk_tx_logs_tx
          FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // J. transaction_items & daily_closings
    await tx`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_trx_items_discount_policy') THEN
          ALTER TABLE public.transaction_items
          ADD CONSTRAINT fk_trx_items_discount_policy
          FOREIGN KEY (discount_policy_id) REFERENCES public.discount_policies(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_daily_closings_mod_signed') THEN
          ALTER TABLE public.daily_closings
          ADD CONSTRAINT fk_daily_closings_mod_signed
          FOREIGN KEY (mod_signed_by) REFERENCES public.admins(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `;

    // 3. Tambahkan B-Tree Index untuk Performa Tinggi & Cegah Sequential Scan
    console.log('3. Membuat B-Tree Indexes...');
    await tx`CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_supplier ON public.stock_receive_drafts(supplier_id);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_status ON public.stock_receive_drafts(status, created_at DESC) WHERE deleted_at IS NULL;`;
    await tx`CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_emp ON public.stock_receive_drafts(created_by_employee_id) WHERE deleted_at IS NULL;`;
    
    await tx`CREATE INDEX IF NOT EXISTS idx_stock_receive_items_draft ON public.stock_receive_items(draft_id);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_stock_receive_items_prod ON public.stock_receive_items(product_id);`;

    await tx`CREATE INDEX IF NOT EXISTS idx_stock_batches_prod_exp ON public.stock_batches(product_id, expiry_date);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_stock_batches_current_qty ON public.stock_batches(current_qty) WHERE current_qty > 0;`;

    await tx`CREATE INDEX IF NOT EXISTS idx_cond_reports_status_alert ON public.product_condition_reports(status, alert_level, expiry_date);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_cond_reports_prod ON public.product_condition_reports(product_id, status);`;

    await tx`CREATE INDEX IF NOT EXISTS idx_discount_policies_prod ON public.discount_policies(product_id, is_active);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_discount_policies_batch ON public.discount_policies(batch_id);`;

    await tx`CREATE INDEX IF NOT EXISTS idx_discount_barcodes_lookup ON public.discount_barcodes(barcode);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_discount_barcodes_policy ON public.discount_barcodes(policy_id);`;

    await tx`CREATE INDEX IF NOT EXISTS idx_manager_duty_date ON public.manager_duty_log(duty_date DESC);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_transaction_logs_employee ON public.transaction_logs(employee_id);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_transaction_logs_shift ON public.transaction_logs(shift_id);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_transaction_logs_outcome ON public.transaction_logs(outcome);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_transaction_logs_created ON public.transaction_logs(created_at);`;

    await tx`CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(name);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_suppliers_active ON public.suppliers(is_active);`;
  });

  console.log('\n✅ SEMUA CONSTRAINTS DAN INDEKS BERHASIL DITERAPKAN DI STAGING!');
  await sql.end();
}

main().catch(err => {
  console.error('💥 Error migrasi constraints:', err);
  process.exit(1);
});
