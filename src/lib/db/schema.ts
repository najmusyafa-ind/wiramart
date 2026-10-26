// =============================================================
// Smartkasir Perwira — Drizzle ORM Schema v1.1
// Database: PostgreSQL (Supabase)
// Tables: 13 (ditambah shift_swap_requests, attendances)
// =============================================================

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  decimal,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// =============================================================
// ENUM TYPES
// =============================================================

export const paymentMethodEnum    = pgEnum('payment_method',    ['CASH', 'QRIS']);
export const transactionStatusEnum = pgEnum('transaction_status', ['COMPLETED', 'VOID']);
export const shiftStatusEnum       = pgEnum('shift_status',       ['ACTIVE', 'CLOSED']);
export const stockActionEnum       = pgEnum('stock_action',       ['INSERT', 'UPDATE', 'SOFT_DELETE']);
export const actorTypeEnum         = pgEnum('actor_type',         ['ADMIN', 'EMPLOYEE', 'SYSTEM']);
export const periodTypeEnum        = pgEnum('period_type',        ['DAILY', 'WEEKLY', 'MONTHLY', 'SEMI_ANNUAL']);

// Status hasil akhir percobaan transaksi database (untuk audit trail)
export const txOutcomeEnum = pgEnum('tx_outcome', ['COMMITTED', 'ROLLED_BACK']);

// Status pengajuan pindah shift oleh mahasiswa
export const swapStatusEnum = pgEnum('swap_status', [
  'PENDING',    // Baru diajukan, menunggu review dosen
  'APPROVED',   // Dosen approve — jadwal dipertukarkan
  'REJECTED',   // Dosen tolak — jadwal tetap
  'CANCELLED',  // Mahasiswa batalkan sebelum di-review
]);

// Status kehadiran per slot jadwal
export const attendanceStatusEnum = pgEnum('attendance_status', [
  'HADIR',        // Login tepat waktu (dalam window toleransi)
  'TELAT',        // Login terlambat > toleransi (default 15 menit)
  'IJIN',         // Ijin resmi disetujui dosen
  'TIDAK_HADIR',  // Tidak masuk tanpa keterangan (bolos)
  'PENGGANTI',    // Masuk sebagai pengganti slot swap yang disetujui
]);

// ── V3.0 ENUMS (Gudang & Logistik) ────────────────────────────
export const stockReceiveStatusEnum = pgEnum('stock_receive_status', [
  'DRAFT',      // Petugas gudang sedang menyusun draft input
  'SUBMITTED',  // Diserahkan ke Manager, menunggu approval
  'APPROVED',   // Disetujui Manager, stok masuk atomik
  'REJECTED',   // Ditolak Manager
  'REVISED',    // Diminta revisi oleh Manager
]);

export const alertLevelEnum = pgEnum('alert_level', [
  'H1_KRITIS',  // <= 1 hari menuju kadaluarsa
  'H3_URGENT',  // 2-3 hari menuju kadaluarsa
  'H5_WARNING', // 4-5 hari menuju kadaluarsa
  'H7_WATCH',   // 6-7 hari menuju kadaluarsa
]);

export const conditionReportStatusEnum = pgEnum('condition_report_status', [
  'ALERT_ONLY',     // Terdeteksi otomatis oleh FEFO engine
  'SUBMITTED',      // Dilaporkan petugas gudang dengan saran
  'MANAGER_REVIEW', // Sedang ditinjau Manager
  'APPROVED',       // Keputusan Manager disetujui
  'REJECTED',       // Pengajuan ditolak
  'EXECUTED',       // Tindakan dieksekusi di lapangan
  'CLOSED',         // Selesai
]);

export const managerDecisionEnum = pgEnum('manager_decision', [
  'DISCOUNT',       // Diskon darurat (program obral FEFO)
  'DISPLAY_FRONT',  // Pindahkan display ke rak kasir utama
  'DESTROY',        // Musnahkan dari gudang & catat kerugian
  'RETURN_SUPPLIER',// Retur ke supplier
  'HOLD',           // Tahan & monitor
]);

// =============================================================
// 1. ADMINS
// =============================================================

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NIDN = Nomor Induk Dosen Nasional (login utama)
    // Produksi: varchar(100) (selaras Fase 0.3). Constraint produksi bernama admins_username_unique.
    nidn: varchar('nidn', { length: 100 }).notNull().unique('admins_username_unique'),
    // NIDK = Nomor Induk Dosen Khusus (alternatif, opsional)
    nidk: varchar('nidk', { length: 20 }),
    // NULL = belum aktivasi akun (belum set password)
    passwordHash: text('password_hash'),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    // Role: MANAGER (Dosen/Owner/Developer Testing) | ADMIN_SHIFT (Mahasiswa Koordinator Shift)
    role: varchar('role', { length: 50 }).notNull().default('ADMIN_SHIFT'),
    // TRUE setelah dosen aktivasi akun (set password sendiri)
    isActivated: boolean('is_activated').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Produksi: unik hanya di antara admin yang belum dihapus (partial)
    uniqueIndex('idx_admins_nidn_unique').on(table.nidn).where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('idx_admins_nidk_unique')
      .on(table.nidk)
      .where(sql`${table.nidk} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    // Catatan Fase 0.3: idx_admins_active ada di deklarasi lama tetapi TIDAK ada di produksi.
  ],
);

export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;

// =============================================================
// 2. EMPLOYEES (Karyawan Kasir)
// Login via: full_name + nim + program_studi
// =============================================================

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    nim: varchar('nim', { length: 20 }).notNull(),
    programStudi: varchar('program_studi', { length: 100 }).notNull(),
    jabatan: varchar('jabatan', { length: 100 }).notNull().default('Kasir'),
    isActive: boolean('is_active').notNull().default(true),
    // NULL = self-register (tidak dibuat oleh admin)
    createdByAdminId: uuid('created_by_admin_id')
      .references(() => admins.id),
    // TRUE jika mahasiswa daftar mandiri (bukan diinput developer)
    isSelfRegistered: boolean('is_self_registered').notNull().default(false),
    // Peran Ketua Shift / Admin Kasir (Pemegang PIN Laci)
    isKetuaShift: boolean('is_ketua_shift').notNull().default(false),
    pinHash: text('pin_hash'),
    pinFailedAttempts: integer('pin_failed_attempts').notNull().default(0),
    pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_employees_nim_unique')
      .on(table.nim)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;

// =============================================================
// 3. SHIFTS (Sesi Kerja per Karyawan)
// Clock-in: saat login. Clock-out: saat logout.
// =============================================================

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    clockIn: timestamp('clock_in', { withTimezone: true }).notNull().defaultNow(),
    clockOut: timestamp('clock_out', { withTimezone: true }),
    status: shiftStatusEnum('status').notNull().default('ACTIVE'),
    // Modal awal — jumlah uang di laci saat kasir buka shift (wajib diisi)
    modalAwal: decimal('modal_awal', { precision: 15, scale: 2 }),
    // Saldo kas fisik hasil blind count kasir saat tutup shift (nullable hingga shift ditutup)
    actualCash: decimal('actual_cash', { precision: 15, scale: 2 }),
    // Rincian lembar & koin saat buka shift { "100k": 1, "50k": 2, ... }
    cashBreakdownOpen: jsonb('cash_breakdown_open'),
    // Rincian lembar & koin saat tutup shift
    cashBreakdownClose: jsonb('cash_breakdown_close'),
    // Catatan serah terima laci ke shift berikutnya
    handoverNote: text('handover_note'),
    // Selisih serah terima: modalAwal saat buka vs actualCash shift sebelumnya
    serahTerimaDiff: decimal('serah_terima_diff', { precision: 15, scale: 2 }),
    // Flag audit sistem: SERAH_TERIMA_SELISIH, FRAUD_CASH_SUSPICIOUS, NORMAL
    auditFlags: varchar('audit_flags', { length: 100 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // KOREKSI Fase 0.3: deklarasi lama `shifts_employee_one_active` UNIQUE(employee_id, status)
    // TIDAK ada di produksi dan akan salah bila dibuat (menolak lebih dari satu shift CLOSED
    // per karyawan). Aturan "satu shift ACTIVE" ditegakkan di application layer; index parsial
    // yang benar akan ditambahkan lewat migrasi di Fase 2 setelah data dirapikan.
    index('idx_shifts_employee').on(table.employeeId, table.createdAt),
    index('idx_shifts_clock_in').on(table.clockIn.desc()),
  ],
);

export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;

// =============================================================
// 4. CATEGORIES (Kategori Produk)
// =============================================================

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

// =============================================================
// 5. PRODUCTS (Produk / Menu)
// cost_price = HPP; selling_price = harga jual
// Hanya Admin yang bisa CRUD — karyawan READ ONLY (hanya nama + harga jual + stok)
// =============================================================

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    // Barcode produk fisik (EAN-13, EAN-8, Code128, UPC, dll)
    // Nullable — tidak semua produk punya barcode
    // Unique — satu barcode hanya bisa milik satu produk
    barcode: varchar('barcode', { length: 50 }),
    // SECURITY: costPrice visible ONLY to admin — never sent to employee API
    costPrice: decimal('cost_price', { precision: 15, scale: 2 }).notNull(),
    sellingPrice: decimal('selling_price', { precision: 15, scale: 2 }).notNull(),
    stockQty: integer('stock_qty').notNull().default(0),
    unit: varchar('unit', { length: 20 }).notNull().default('pcs'),
    photoUrl: text('photo_url'),
    isActive: boolean('is_active').notNull().default(true),
    // Penanganan Makanan Basah / Perishable Harian (Same-day expiration)
    // isPerishable = true untuk makanan yang wajib habis hari itu juga
    // perishableType = 'KONSINYASI' (titip jual mitra/ibu kantin) atau 'BELI_LEPAS' (modal toko)
    isPerishable: boolean('is_perishable').notNull().default(false),
    perishableType: varchar('perishable_type', { length: 20 }).default('KONSINYASI'),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Produksi (setelah P3, 4 Okt 2026): barcode unik di antara produk yang belum dihapus.
    // Mengganti idx_products_barcode_unique yang tidak mengecualikan produk terhapus.
    uniqueIndex('idx_products_barcode_active_unique')
      .on(table.barcode)
      .where(sql`${table.barcode} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    // Catatan Fase 0.3: idx_products_category dan idx_products_active ada di deklarasi lama
    // tetapi TIDAK ada di produksi.
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

// Product as visible to employee (NO cost_price)
export type ProductPublic = Omit<Product, 'costPrice'>;

// =============================================================
// 6. STOCK_ADJUSTMENTS (Koreksi Stok / Stock Opname)
// =============================================================

export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    qtyBefore: integer('qty_before').notNull(),
    qtyAfter: integer('qty_after').notNull(),
    // qtyDiff = qtyAfter - qtyBefore (computed in application layer)
    qtyDiff: integer('qty_diff').notNull(),
    reason: text('reason').notNull(),
    adjustedByAdminId: uuid('adjusted_by_admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stock_adj_product').on(table.productId, table.createdAt),
  ],
);

export type StockAdjustment = typeof stockAdjustments.$inferSelect;
export type NewStockAdjustment = typeof stockAdjustments.$inferInsert;

// =============================================================
// 7. TRANSACTIONS (Transaksi Penjualan)
// TIDAK BOLEH di-hard-delete. Void only (soft cancel).
// =============================================================

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull().unique(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    status: transactionStatusEnum('status').notNull().default('COMPLETED'),
    grossAmount: decimal('gross_amount', { precision: 15, scale: 2 }).notNull(),
    totalHpp: decimal('total_hpp', { precision: 15, scale: 2 }).notNull(),
    // grossProfit = grossAmount - totalHpp (computed in app layer for flexibility)
    grossProfit: decimal('gross_profit', { precision: 15, scale: 2 }).notNull(),
    cashReceived: decimal('cash_received', { precision: 15, scale: 2 }),
    changeAmount: decimal('change_amount', { precision: 15, scale: 2 }),
    voidReason: text('void_reason'),
    voidedByAdminId: uuid('voided_by_admin_id').references(() => admins.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Penanda data uji coba (P3, 4 Okt 2026). Laporan keuangan akan mengecualikan is_test = true.
    isTest: boolean('is_test').notNull().default(false),
    // Idempotensi checkout (migration v1.5, Fase 0.4b). NULL untuk transaksi lama.
    // Unik per karyawan; request_hash = sidik jari isi belanja agar kunci yang sama
    // tidak bisa dipakai ulang untuk belanja berbeda.
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    requestHash: varchar('request_hash', { length: 64 }),
  },
  (table) => [
    // Critical for reports — most queries filter by date + status
    index('idx_trx_created_status').on(table.createdAt, table.status),
    index('idx_trx_employee').on(table.employeeId, table.createdAt),
    index('idx_trx_shift').on(table.shiftId),
    index('idx_trx_payment').on(table.paymentMethod, table.createdAt),
    uniqueIndex('idx_trx_employee_idempotency')
      .on(table.employeeId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// =============================================================
// 8. TRANSACTION_ITEMS (Detail Item per Transaksi)
// Snapshot harga — histori tidak berubah meski harga produk diupdate
// =============================================================

export const transactionItems = pgTable(
  'transaction_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    // SNAPSHOT: harga saat transaksi terjadi, bukan harga terkini
    productNameSnapshot: varchar('product_name_snapshot', { length: 200 }).notNull(),
    costPriceSnapshot: decimal('cost_price_snapshot', { precision: 15, scale: 2 }).notNull(),
    sellingPriceSnapshot: decimal('selling_price_snapshot', { precision: 15, scale: 2 }).notNull(),
    qty: integer('qty').notNull(),
    // Subtotals computed in app layer (qty × snapshot price)
    subtotalCost: decimal('subtotal_cost', { precision: 15, scale: 2 }).notNull(),
    subtotalSell: decimal('subtotal_sell', { precision: 15, scale: 2 }).notNull(),
    // V3.0: Kolom audit tracking diskon darurat di kasir (nullable)
    discountPolicyId: uuid('discount_policy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_trx_items_txn').on(table.transactionId),
    // For top-selling products report
    index('idx_trx_items_product').on(table.productId, table.createdAt),
  ],
);

export type TransactionItem = typeof transactionItems.$inferSelect;
export type NewTransactionItem = typeof transactionItems.$inferInsert;

// =============================================================
// 8b. TRANSACTION_PAYMENTS (Pecahan Pembayaran per Transaksi)
// Mendukung Split Payment (Campuran CASH + QRIS dalam 1 transaksi)
// =============================================================

export const transactionPayments = pgTable(
  'transaction_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    // 'CASH' | 'QRIS'
    paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    cashReceived: decimal('cash_received', { precision: 15, scale: 2 }),
    changeAmount: decimal('change_amount', { precision: 15, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_trx_payments_trx').on(table.transactionId),
    index('idx_trx_payments_method').on(table.paymentMethod, table.createdAt),
  ],
);

export type TransactionPayment = typeof transactionPayments.$inferSelect;
export type NewTransactionPayment = typeof transactionPayments.$inferInsert;

// =============================================================
// 9. QRIS_SETTINGS (Static QR Code dari Bank Dosen)
// Singleton — satu baris, Admin upload gambar QR
// =============================================================

export const qrisSettings = pgTable('qris_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  qrImageUrl: text('qr_image_url'), // URL gambar QR yang diupload admin
  bankName: varchar('bank_name', { length: 100 }),
  accountName: varchar('account_name', { length: 200 }),
  isActive: boolean('is_active').notNull().default(false),
  uploadedByAdminId: uuid('uploaded_by_admin_id').references(() => admins.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  // ── Info Toko (untuk struk gaya Indomaret/Alfamart) ──────────
  storeName:    varchar('store_name',    { length: 200 }),  // Contoh: WIRAMART UNPERBA
  storeAddress: text('store_address'),                      // Jl. Letjend. Suprapto No. 73...
  storePhone:   varchar('store_phone',   { length: 30 }),   // 0281-XXXXXX
  // ── Pengaturan Operasional ───────────────────────────────────
  attendanceTolerance: integer('attendance_tolerance').notNull().default(15), // menit toleransi clock-in
  lowStockThreshold:   integer('low_stock_threshold').notNull().default(5),   // batas stok rendah
  globalMarginPercentage: decimal('global_margin_percentage', { precision: 5, scale: 2 }).notNull().default('20.00'), // default 20%
  // ────────────────────────────────────────────────────────────
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type QrisSettings = typeof qrisSettings.$inferSelect;

// =============================================================
// 10. MAINTENANCE_SETTINGS (Singleton — toggle maintenance mode)
// =============================================================

export const maintenanceSettings = pgTable('maintenance_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  isMaintenance: boolean('is_maintenance').notNull().default(false),
  maintenanceMessage: text('maintenance_message'),
  toggledByAdminId: uuid('toggled_by_admin_id').references(() => admins.id),
  toggledAt: timestamp('toggled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MaintenanceSettings = typeof maintenanceSettings.$inferSelect;

// =============================================================
// 12. SHIFT_SCHEDULES (Jadwal shift mingguan tetap)
// Template jadwal — bukan sesi aktual (itu di table shifts)
// =============================================================

export const dayOfWeekEnum = pgEnum('day_of_week', [
  'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU',
]);

export const shiftSchedules = pgTable(
  'shift_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dayOfWeek: dayOfWeekEnum('day_of_week').notNull(),
    // Format HH:MM, contoh: '08:00', '11:30', '15:00'
    slotStart: varchar('slot_start', { length: 5 }).notNull(),
    slotEnd:   varchar('slot_end',   { length: 5 }).notNull(),
    // employeeId nullable — slot yang belum diassign karyawan
    employeeId: uuid('employee_id').references(() => employees.id),
    // Nama dosen koordinator piket (tidak wajib ada di DB employees)
    coordinatorName: varchar('coordinator_name', { length: 200 }),
    // Urutan tampilan dalam satu slot (1, 2, 3, dst)
    orderInSlot: integer('order_in_slot').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_schedule_day_slot').on(table.dayOfWeek, table.slotStart, table.slotEnd),
    index('idx_schedule_employee').on(table.employeeId),
    // Produksi: satu urutan per slot (constraint uq_schedule_slot_order)
    unique('uq_schedule_slot_order').on(
      table.dayOfWeek,
      table.slotStart,
      table.slotEnd,
      table.orderInSlot,
    ),
  ],
);

export type ShiftSchedule = typeof shiftSchedules.$inferSelect;
export type NewShiftSchedule = typeof shiftSchedules.$inferInsert;

// =============================================================
// 11. AUDIT_LOGS (Trail semua perubahan data kritis)
// Populated from application layer — never deleted
// =============================================================

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    recordId: uuid('record_id').notNull(),
    action: stockActionEnum('action').notNull(),
    oldValues: text('old_values'), // JSON string
    newValues: text('new_values'), // JSON string
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_table_record').on(table.tableName, table.recordId),
    index('idx_audit_actor').on(table.actorId, table.createdAt),
    index('idx_audit_created').on(table.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// =============================================================
// 12. OPERATING_EXPENSES (Biaya operasional — pengurang Laba Bersih)
// migration_v1_6_operating_expenses.sql
// amount = bilangan bulat rupiah. Soft-delete (deleted_at) — tidak di-hard-delete.
// CHECK constraint (amount, kategori, kelengkapan soft-delete) & RLS ada di SQL.
// =============================================================

export const EXPENSE_CATEGORIES = [
  'LISTRIK',
  'PLASTIK_KEMASAN',
  'HONOR',
  'SEWA',
  'TRANSPORT',
  'KERUGIAN_BARANG',
  'FEE_QRIS_BANK',
  'LAINNYA',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const operatingExpenses = pgTable(
  'operating_expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tanggal bisnis (WIB) 'YYYY-MM-DD'
    expenseDate: date('expense_date', { mode: 'string' }).notNull(),
    category: varchar('category', { length: 30 }).$type<ExpenseCategory>().notNull(),
    description: varchar('description', { length: 200 }).notNull(),
    amount: integer('amount').notNull(),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByAdminId: uuid('deleted_by_admin_id').references(() => admins.id),
    deleteReason: varchar('delete_reason', { length: 200 }),
  },
  (table) => [
    index('idx_opex_date_active')
      .on(table.expenseDate)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type OperatingExpense = typeof operatingExpenses.$inferSelect;
export type NewOperatingExpense = typeof operatingExpenses.$inferInsert;

// =============================================================
// 14. SHIFT_CASH_MOVEMENTS (Petty Cash: Kas Keluar & Masuk Laci per Shift)
// =============================================================

export const shiftCashMovements = pgTable(
  'shift_cash_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    // 'CASH_OUT' | 'CASH_IN'
    movementType: varchar('movement_type', { length: 20 }).notNull(),
    // 'KONSUMSI_GALON' | 'BENSIN' | 'ATK_KRESEK' | 'PARKIR_KEBERSIHAN' | 'TAMBAH_MODAL' | 'OPERASIONAL' | 'LAINNYA'
    category: varchar('category', { length: 50 }).notNull(),
    amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
    notes: text('notes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_shift_cash_movements_shift').on(table.shiftId),
    index('idx_shift_cash_movements_type_created').on(table.movementType, table.createdAt),
  ],
);

export type ShiftCashMovement = typeof shiftCashMovements.$inferSelect;
export type NewShiftCashMovement = typeof shiftCashMovements.$inferInsert;

// =============================================================
// 15. QRIS_RECONCILIATIONS (Rekonsiliasi Harian QRIS vs Bank)
// =============================================================
// FILOSOFI:
//   - Manajer/Dosen input nominal kredit bank Mandiri/Livin' per tanggal
//   - Sistem otomatis hitung total QRIS kasir dari tabel transactions
//   - Selisih = bank_credit - system_qris (dihitung di application layer)
//   - Status: PENDING → admin belum input | MATCH → ok | SELISIH → investigasi
// =============================================================

export const RECON_STATUS = ['PENDING', 'MATCH', 'SELISIH'] as const;
export type ReconStatus = (typeof RECON_STATUS)[number];

export const qrisReconciliations = pgTable(
  'qris_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tanggal bisnis rekonsiliasi (WIB, format YYYY-MM-DD)
    reconDate: date('recon_date', { mode: 'string' }).notNull(),
    // Nominal kredit rekening bank hari itu (input manual manajer)
    bankCreditAmount: decimal('bank_credit_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    // Total QRIS sistem kasir hari itu (dihitung saat admin submit)
    systemQrisAmount: decimal('system_qris_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    // Status rekonsiliasi: PENDING | MATCH | SELISIH
    status: varchar('status', { length: 20 }).$type<ReconStatus>().notNull().default('PENDING'),
    // Catatan investigasi dari manajer
    notes: text('notes'),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => admins.id),
    updatedByAdminId: uuid('updated_by_admin_id')
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1 rekonsiliasi per tanggal (upsert-safe)
    uniqueIndex('idx_qris_recon_date_unique').on(table.reconDate),
    // Query laporan bulanan
    index('idx_qris_recon_date_status').on(table.reconDate, table.status),
  ],
);

export type QrisReconciliation = typeof qrisReconciliations.$inferSelect;
export type NewQrisReconciliation = typeof qrisReconciliations.$inferInsert;

// =============================================================
// 16. PRODUCT_PROPOSALS (Usulan Produk Baru oleh Kasir / Karyawan)
// =============================================================
// K8 & K2: Kasir hanya mengusulkan (nama, barcode, foto, kategori).
// HPP dan harga jual diisi oleh Gudang / Admin / Manajer.
// =============================================================

export const PROPOSAL_STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const productProposals = pgTable(
  'product_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    barcode: varchar('barcode', { length: 50 }),
    unit: varchar('unit', { length: 20 }).notNull().default('pcs'),
    photoUrl: text('photo_url'),
    proposedByEmployeeId: uuid('proposed_by_employee_id')
      .notNull()
      .references(() => employees.id),
    status: varchar('status', { length: 20 }).$type<ProposalStatus>().notNull().default('PENDING'),
    adminNote: text('admin_note'),
    approvedProductId: uuid('approved_product_id').references(() => products.id),
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_product_proposals_status').on(table.status, table.createdAt.desc()),
    index('idx_product_proposals_employee').on(table.proposedByEmployeeId),
  ],
);

export type ProductProposal = typeof productProposals.$inferSelect;
export type NewProductProposal = typeof productProposals.$inferInsert;

// =============================================================
// 17. STOCK_BATCHES (Batch Stok & Expired Date FEFO)
// =============================================================

export const EXPIRY_CLASSES = ['HARIAN', 'PENDEK', 'PANJANG'] as const;
export type ExpiryClass = (typeof EXPIRY_CLASSES)[number];

export const stockBatches = pgTable(
  'stock_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    batchCode: varchar('batch_code', { length: 50 }).notNull(),
    costPrice: decimal('cost_price', { precision: 15, scale: 2 }).notNull().default('0'),
    initialQty: integer('initial_qty').notNull().default(0),
    currentQty: integer('current_qty').notNull().default(0),
    expiryDate: date('expiry_date', { mode: 'string' }),
    expiryClass: varchar('expiry_class', { length: 20 }).$type<ExpiryClass>().notNull().default('PANJANG'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stock_batches_fefo').on(table.productId, table.expiryDate, table.currentQty),
    index('idx_stock_batches_expiry_alert').on(table.expiryDate, table.currentQty),
  ],
);

export type StockBatch = typeof stockBatches.$inferSelect;
export type NewStockBatch = typeof stockBatches.$inferInsert;

// =============================================================
// RELATIONS (for Drizzle query builder)
// =============================================================

import { relations } from 'drizzle-orm';

export const adminsRelations = relations(admins, ({ many }) => ({
  createdEmployees: many(employees),
  createdCategories: many(categories),
  createdProducts: many(products),
  stockAdjustments: many(stockAdjustments),
  voidedTransactions: many(transactions),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  createdByAdmin: one(admins, {
    fields: [employees.createdByAdminId],
    references: [admins.id],
  }),
  shifts: many(shifts),
  transactions: many(transactions),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  employee: one(employees, {
    fields: [shifts.employeeId],
    references: [employees.id],
  }),
  transactions: many(transactions),
  cashMovements: many(shiftCashMovements),
}));

export const shiftCashMovementsRelations = relations(shiftCashMovements, ({ one }) => ({
  shift: one(shifts, {
    fields: [shiftCashMovements.shiftId],
    references: [shifts.id],
  }),
  employee: one(employees, {
    fields: [shiftCashMovements.employeeId],
    references: [employees.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  createdByAdmin: one(admins, {
    fields: [categories.createdByAdminId],
    references: [admins.id],
  }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  createdByAdmin: one(admins, {
    fields: [products.createdByAdminId],
    references: [admins.id],
  }),
  transactionItems: many(transactionItems),
  stockAdjustments: many(stockAdjustments),
  stockBatches: many(stockBatches),
}));

export const stockBatchesRelations = relations(stockBatches, ({ one }) => ({
  product: one(products, {
    fields: [stockBatches.productId],
    references: [products.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  shift: one(shifts, {
    fields: [transactions.shiftId],
    references: [shifts.id],
  }),
  employee: one(employees, {
    fields: [transactions.employeeId],
    references: [employees.id],
  }),
  voidedByAdmin: one(admins, {
    fields: [transactions.voidedByAdminId],
    references: [admins.id],
  }),
  items: many(transactionItems),
  payments: many(transactionPayments),
}));

export const transactionPaymentsRelations = relations(transactionPayments, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionPayments.transactionId],
    references: [transactions.id],
  }),
}));

export const transactionItemsRelations = relations(transactionItems, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionItems.transactionId],
    references: [transactions.id],
  }),
  product: one(products, {
    fields: [transactionItems.productId],
    references: [products.id],
  }),
}));

// =============================================================
// 13. SHIFT_SWAP_REQUESTS (Pengajuan Pindah Shift oleh Mahasiswa)
// =============================================================
// ALUR:
//   1. Mahasiswa ajukan swap: from_schedule (slot miliknya) → to_schedule (slot lain)
//   2. Dosen review: APPROVE atau REJECT
//   3. Jika APPROVE → employeeId di kedua schedule dipertukarkan
//   4. Attendance record diupdate: requester dapat PENGGANTI di slot baru
// RATE LIMIT: max 3 pengajuan per 7 hari per mahasiswa (lihat rate-limit.ts)
// =============================================================

export const shiftSwapRequests = pgTable(
  'shift_swap_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Mahasiswa yang mengajukan pindah
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => employees.id),
    // Slot jadwal asal milik requester (misal: Senin 08:00)
    fromScheduleId: uuid('from_schedule_id')
      .notNull()
      .references(() => shiftSchedules.id),
    // Slot jadwal tujuan yang ingin diambil (misal: Selasa 08:00)
    toScheduleId: uuid('to_schedule_id')
      .notNull()
      .references(() => shiftSchedules.id),
    // Alasan wajib diisi — memudahkan dosen evaluasi
    reason: text('reason').notNull(),
    // Rekan yang diajak tukar (2-arah)
    peerEmployeeId: uuid('peer_employee_id').references(() => employees.id),
    peerApprovedAt: timestamp('peer_approved_at', { withTimezone: true }),
    peerRejectedAt: timestamp('peer_rejected_at', { withTimezone: true }),
    status: swapStatusEnum('status').notNull().default('PENDING'),
    // Dosen yang review (nullable sampai ada keputusan)
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => admins.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // Catatan dosen (opsional, bisa berisi alasan tolak)
    adminNote: text('admin_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Query pending requests untuk dashboard admin
    index('idx_swap_status_created').on(table.status, table.createdAt.desc()),
    // History swap per mahasiswa
    index('idx_swap_requester').on(table.requesterId, table.createdAt.desc()),
  ],
);

export type ShiftSwapRequest    = typeof shiftSwapRequests.$inferSelect;
export type NewShiftSwapRequest = typeof shiftSwapRequests.$inferInsert;

export const shiftSwapRequestsRelations = relations(shiftSwapRequests, ({ one }) => ({
  requester:     one(employees,      { fields: [shiftSwapRequests.requesterId],       references: [employees.id] }),
  peer:          one(employees,      { fields: [shiftSwapRequests.peerEmployeeId],    references: [employees.id] }),
  fromSchedule:  one(shiftSchedules, { fields: [shiftSwapRequests.fromScheduleId],    references: [shiftSchedules.id] }),
  toSchedule:    one(shiftSchedules, { fields: [shiftSwapRequests.toScheduleId],      references: [shiftSchedules.id] }),
  reviewedByAdmin: one(admins,       { fields: [shiftSwapRequests.reviewedByAdminId], references: [admins.id] }),
}));

export const productProposalsRelations = relations(productProposals, ({ one }) => ({
  category:         one(categories, { fields: [productProposals.categoryId],           references: [categories.id] }),
  proposedByEmployee: one(employees, { fields: [productProposals.proposedByEmployeeId], references: [employees.id] }),
  reviewedByAdmin:   one(admins,    { fields: [productProposals.reviewedByAdminId],   references: [admins.id] }),
  approvedProduct:   one(products,  { fields: [productProposals.approvedProductId],   references: [products.id] }),
}));

// =============================================================
// 14. ATTENDANCES (Rekap Kehadiran per Slot Jadwal per Tanggal)
// Dikelola DOSEN — mahasiswa tidak bisa edit sendiri
// =============================================================
// FILOSOFI:
//   - 1 row = 1 mahasiswa × 1 slot jadwal × 1 tanggal spesifik
//   - HADIR: auto-created saat mahasiswa berhasil login (clock-in)
//   - TELAT: auto-detected saat clock-in > slotStart + toleransiMenit
//   - TIDAK_HADIR/IJIN: dosen input manual
//   - PENGGANTI: otomatis saat swap disetujui
// =============================================================

export const attendances = pgTable(
  'attendances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    // Referensi ke template jadwal (Senin 08:00-11:00)
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => shiftSchedules.id),
    // Tanggal SPESIFIK — bukan hanya hari. Krusial untuk laporan bulanan.
    // Contoh: 2026-09-29 (Senin minggu ke-4 September)
    attendanceDate: date('attendance_date').notNull(),
    status: attendanceStatusEnum('status').notNull(),
    // Terhubung ke sesi login aktual (nullable untuk TIDAK_HADIR/IJIN)
    shiftId: uuid('shift_id').references(() => shifts.id),
    // Snapshot waktu aktual dari sesi login
    clockInActual:  timestamp('clock_in_actual',  { withTimezone: true }),
    clockOutActual: timestamp('clock_out_actual', { withTimezone: true }),
    // Keterlambatan dalam menit (0 jika tepat waktu / HADIR)
    lateMinutes: integer('late_minutes').notNull().default(0),
    // Catatan dosen: alasan ijin, keterangan khusus
    notes: text('notes'),
    // Dosen yang mencatat (nullable jika auto-generated saat login)
    recordedByAdminId: uuid('recorded_by_admin_id').references(() => admins.id),
    // Jika status = PENGGANTI, ini referensi swap yang menyebabkannya
    fromSwapRequestId: uuid('from_swap_request_id').references(() => shiftSwapRequests.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1 mahasiswa hanya bisa punya 1 record per jadwal per tanggal
    // (mencegah duplikat absensi)
    uniqueIndex('idx_attendance_unique').on(
      table.employeeId,
      table.scheduleId,
      table.attendanceDate,
    ),
    // Query laporan per tanggal — paling sering dipakai dosen
    index('idx_attendance_date').on(table.attendanceDate, table.status),
    // Query riwayat per mahasiswa
    index('idx_attendance_employee').on(table.employeeId, table.attendanceDate.desc()),
  ],
);

export type Attendance    = typeof attendances.$inferSelect;
export type NewAttendance = typeof attendances.$inferInsert;

export const attendancesRelations = relations(attendances, ({ one }) => ({
  employee:        one(employees,        { fields: [attendances.employeeId],         references: [employees.id] }),
  schedule:        one(shiftSchedules,   { fields: [attendances.scheduleId],         references: [shiftSchedules.id] }),
  shift:           one(shifts,           { fields: [attendances.shiftId],            references: [shifts.id] }),
  recordedByAdmin: one(admins,           { fields: [attendances.recordedByAdminId],  references: [admins.id] }),
  fromSwapRequest: one(shiftSwapRequests,{ fields: [attendances.fromSwapRequestId],  references: [shiftSwapRequests.id] }),
}));

// =============================================================
// 19. DAILY_CLOSINGS (Tutup Buku Finansial Harian - Locking Period)
// =============================================================

export const dailyClosings = pgTable(
  'daily_closings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    closingDate: date('closing_date').notNull().unique(),
    totalOmzet: decimal('total_omzet', { precision: 15, scale: 2 }).notNull().default('0'),
    omzetCash: decimal('omzet_cash', { precision: 15, scale: 2 }).notNull().default('0'),
    omzetQris: decimal('omzet_qris', { precision: 15, scale: 2 }).notNull().default('0'),
    totalHpp: decimal('total_hpp', { precision: 15, scale: 2 }).notNull().default('0'),
    grossProfit: decimal('gross_profit', { precision: 15, scale: 2 }).notNull().default('0'),
    operatingExpenses: decimal('operating_expenses', { precision: 15, scale: 2 }).notNull().default('0'),
    qrisFee: decimal('qris_fee', { precision: 15, scale: 2 }).notNull().default('0'),
    cashDiscrepancy: decimal('cash_discrepancy', { precision: 15, scale: 2 }).notNull().default('0'),
    netProfit: decimal('net_profit', { precision: 15, scale: 2 }).notNull().default('0'),
    status: varchar('status', { length: 20 }).notNull().default('LOCKED'), // 'OPEN' | 'LOCKED' | 'AUDITED'
    notes: text('notes'),
    closedByAdminId: uuid('closed_by_admin_id').references(() => admins.id),
    // V3.0: Kolom pengesahan Manager on Duty (MOD) pada Daily Closing
    modSignedBy: uuid('mod_signed_by').references(() => admins.id),
    modSignedAt: timestamp('mod_signed_at', { withTimezone: true }),
    modSignNote: text('mod_sign_note'),
    stockMutationSummary: jsonb('stock_mutation_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_daily_closings_date').on(table.closingDate.desc()),
    index('idx_daily_closings_status').on(table.status),
  ],
);

export type DailyClosing = typeof dailyClosings.$inferSelect;
export type NewDailyClosing = typeof dailyClosings.$inferInsert;

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one }) => ({
  product: one(products, {
    fields: [stockAdjustments.productId],
    references: [products.id],
  }),
  adjustedByAdmin: one(admins, {
    fields: [stockAdjustments.adjustedByAdminId],
    references: [admins.id],
  }),
}));

export const shiftSchedulesRelations = relations(shiftSchedules, ({ one, many }) => ({
  employee: one(employees, {
    fields: [shiftSchedules.employeeId],
    references: [employees.id],
  }),
  attendances: many(attendances),
  swapRequestsFrom: many(shiftSwapRequests, { relationName: 'fromSchedule' }),
  swapRequestsTo: many(shiftSwapRequests, { relationName: 'toSchedule' }),
}));

export const operatingExpensesRelations = relations(operatingExpenses, ({ one }) => ({
  createdByAdmin: one(admins, {
    fields: [operatingExpenses.createdByAdminId],
    references: [admins.id],
  }),
  deletedByAdmin: one(admins, {
    fields: [operatingExpenses.deletedByAdminId],
    references: [admins.id],
  }),
}));

export const qrisReconciliationsRelations = relations(qrisReconciliations, ({ one }) => ({
  createdByAdmin: one(admins, {
    fields: [qrisReconciliations.createdByAdminId],
    references: [admins.id],
  }),
  updatedByAdmin: one(admins, {
    fields: [qrisReconciliations.updatedByAdminId],
    references: [admins.id],
  }),
}));

export const dailyClosingsRelations = relations(dailyClosings, ({ one }) => ({
  closedByAdmin: one(admins, {
    fields: [dailyClosings.closedByAdminId],
    references: [admins.id],
  }),
}));

// =============================================================
// TRANSACTION_LOGS — Audit Trail COMMIT & ROLLBACK
// Tabel ini mencatat SETIAP percobaan transaksi kasir:
//   • Jika berhasil  → outcome = 'COMMITTED', transaction_id diisi
//   • Jika gagal     → outcome = 'ROLLED_BACK', rollback_reason diisi
// Sengaja ditulis DI LUAR db.transaction() agar log tetap tersimpan
// bahkan ketika transaksi utama di-rollback oleh PostgreSQL.
// =============================================================

export const transactionLogs = pgTable(
  'transaction_logs',
  {
    id:               uuid('id').primaryKey().defaultRandom(),

    // Siapa yang mencoba transaksi
    employeeId:       uuid('employee_id').notNull(),
    shiftId:          uuid('shift_id'),

    // Detail percobaan
    invoiceAttempt:   varchar('invoice_attempt', { length: 30 }).notNull(),
    attemptNumber:    integer('attempt_number').notNull().default(1),
    itemCount:        integer('item_count').notNull(),
    grossAmount:      decimal('gross_amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod:    paymentMethodEnum('payment_method').notNull(),

    // Hasil akhir
    outcome:          txOutcomeEnum('outcome').notNull(), // 'COMMITTED' | 'ROLLED_BACK'

    // Jika COMMITTED: ID transaksi yang berhasil masuk DB
    transactionId:    uuid('transaction_id'),

    // Jika ROLLED_BACK: alasan kegagalan
    rollbackReason:   text('rollback_reason'),

    // Metadata waktu (WIB server time)
    createdAt:        timestamp('created_at', { withTimezone: true })
                        .notNull()
                        .defaultNow(),
  },
  (t) => ({
    // Index untuk query cepat per karyawan & per shift
    idxEmployee: index('transaction_logs_employee_idx').on(t.employeeId),
    idxShift:    index('transaction_logs_shift_idx').on(t.shiftId),
    idxOutcome:  index('transaction_logs_outcome_idx').on(t.outcome),
    idxCreated:  index('transaction_logs_created_idx').on(t.createdAt),
  }),
);

export type TransactionLog = typeof transactionLogs.$inferSelect;
export type NewTransactionLog = typeof transactionLogs.$inferInsert;

// =============================================================
// 21. STOCK_RECEIVE_DRAFTS (Penerimaan Barang Masuk Gudang)
// =============================================================

export const stockReceiveDrafts = pgTable(
  'stock_receive_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiveNumber: varchar('receive_number', { length: 35 }).notNull().unique(),
    createdByEmployeeId: uuid('created_by_employee_id')
      .notNull()
      .references(() => employees.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    supplierName: varchar('supplier_name', { length: 200 }),
    deliveryNote: text('delivery_note'),
    status: stockReceiveStatusEnum('status').notNull().default('DRAFT'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    approvedByAdminId: uuid('approved_by_admin_id').references(() => admins.id),
    rejectedByAdminId: uuid('rejected_by_admin_id').references(() => admins.id),
    managerNote: text('manager_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_stock_receive_drafts_status').on(table.status, table.createdAt.desc()),
    index('idx_stock_receive_drafts_emp').on(table.createdByEmployeeId),
    index('idx_stock_receive_drafts_supplier').on(table.supplierId),
  ],
);

export type StockReceiveDraft = typeof stockReceiveDrafts.$inferSelect;
export type NewStockReceiveDraft = typeof stockReceiveDrafts.$inferInsert;

// =============================================================
// 22. STOCK_RECEIVE_ITEMS (Detail Barang Masuk)
// =============================================================

export const stockReceiveItems = pgTable(
  'stock_receive_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id')
      .notNull()
      .references(() => stockReceiveDrafts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productName: varchar('product_name', { length: 200 }).notNull(),
    batchCode: varchar('batch_code', { length: 50 }).notNull(),
    qty: integer('qty').notNull(),
    costPrice: decimal('cost_price', { precision: 15, scale: 2 }).notNull(),
    expiryDate: date('expiry_date'),
    conditionNote: text('condition_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stock_receive_items_draft').on(table.draftId),
    index('idx_stock_receive_items_prod').on(table.productId),
  ],
);

export type StockReceiveItem = typeof stockReceiveItems.$inferSelect;
export type NewStockReceiveItem = typeof stockReceiveItems.$inferInsert;

// =============================================================
// 23. PRODUCT_CONDITION_REPORTS (FEFO Action Radar)
// =============================================================

export const productConditionReports = pgTable(
  'product_condition_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => stockBatches.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    alertLevel: alertLevelEnum('alert_level').notNull(),
    qtyAtAlert: integer('qty_at_alert').notNull(),
    expiryDate: date('expiry_date'),
    daysRemainingAtAlert: integer('days_remaining_at_alert'),
    status: conditionReportStatusEnum('status').notNull().default('ALERT_ONLY'),

    physicalCondition: text('physical_condition'),
    gudangSuggestion: text('gudang_suggestion'),
    suggestedDiscountPct: decimal('suggested_discount_pct', { precision: 5, scale: 2 }),
    submittedByEmployeeId: uuid('submitted_by_employee_id').references(() => employees.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    managerDecision: managerDecisionEnum('manager_decision'),
    approvedDiscountPct: decimal('approved_discount_pct', { precision: 5, scale: 2 }),
    managerNote: text('manager_note'),
    decidedByAdminId: uuid('decided_by_admin_id').references(() => admins.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    executedByEmployeeId: uuid('executed_by_employee_id').references(() => employees.id),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    executionNote: text('execution_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_condition_report_batch').on(table.batchId),
    index('idx_cond_reports_status_alert').on(table.status, table.alertLevel, table.expiryDate),
    index('idx_cond_reports_prod').on(table.productId, table.status),
  ],
);

export type ProductConditionReport = typeof productConditionReports.$inferSelect;
export type NewProductConditionReport = typeof productConditionReports.$inferInsert;

// =============================================================
// 24. DISCOUNT_POLICIES (Kebijakan Diskon Darurat FEFO)
// =============================================================

export const discountPolicies = pgTable(
  'discount_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conditionReportId: uuid('condition_report_id')
      .notNull()
      .references(() => productConditionReports.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => stockBatches.id),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 }).notNull(),
    originalPrice: integer('original_price').notNull(),
    discountedPrice: integer('discounted_price').notNull(),
    allowedQty: integer('allowed_qty').notNull(),
    soldQty: integer('sold_qty').notNull().default(0),
    validFrom: date('valid_from').notNull().defaultNow(),
    validUntil: date('valid_until').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_discount_policies_prod').on(table.productId, table.isActive),
    index('idx_discount_policies_batch').on(table.batchId),
  ],
);

export type DiscountPolicy = typeof discountPolicies.$inferSelect;
export type NewDiscountPolicy = typeof discountPolicies.$inferInsert;

// =============================================================
// 25. DISCOUNT_BARCODES (Barcode Override Khusus Diskon)
// =============================================================

export const discountBarcodes = pgTable(
  'discount_barcodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => discountPolicies.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    barcode: varchar('barcode', { length: 40 }).notNull().unique(),
    discountedPrice: integer('discounted_price').notNull(),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 }).notNull(),
    remainingQty: integer('remaining_qty').notNull(),
    validUntil: date('valid_until').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_discount_barcodes_lookup').on(table.barcode),
  ],
);

export type DiscountBarcode = typeof discountBarcodes.$inferSelect;
export type NewDiscountBarcode = typeof discountBarcodes.$inferInsert;

// =============================================================
// 26. MANAGER_DUTY_LOG (Manager on Duty Check-in)
// =============================================================

export const managerDutyLog = pgTable(
  'manager_duty_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dutyDate: date('duty_date').notNull().unique(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_manager_duty_date').on(table.dutyDate.desc()),
  ],
);

export type ManagerDutyLog = typeof managerDutyLog.$inferSelect;
export type NewManagerDutyLog = typeof managerDutyLog.$inferInsert;

// =============================================================
// RELATIONS: MODUL GUDANG V3.0
// =============================================================

export const stockReceiveDraftsRelations = relations(stockReceiveDrafts, ({ one, many }) => ({
  createdByEmployee: one(employees, {
    fields: [stockReceiveDrafts.createdByEmployeeId],
    references: [employees.id],
  }),
  approvedByAdmin: one(admins, {
    fields: [stockReceiveDrafts.approvedByAdminId],
    references: [admins.id],
    relationName: 'approvedDrafts',
  }),
  rejectedByAdmin: one(admins, {
    fields: [stockReceiveDrafts.rejectedByAdminId],
    references: [admins.id],
    relationName: 'rejectedDrafts',
  }),
  supplier: one(suppliers, {
    fields: [stockReceiveDrafts.supplierId],
    references: [suppliers.id],
  }),
  items: many(stockReceiveItems),
}));

export const stockReceiveItemsRelations = relations(stockReceiveItems, ({ one }) => ({
  draft: one(stockReceiveDrafts, {
    fields: [stockReceiveItems.draftId],
    references: [stockReceiveDrafts.id],
  }),
  product: one(products, {
    fields: [stockReceiveItems.productId],
    references: [products.id],
  }),
}));

export const productConditionReportsRelations = relations(productConditionReports, ({ one, many }) => ({
  batch: one(stockBatches, {
    fields: [productConditionReports.batchId],
    references: [stockBatches.id],
  }),
  product: one(products, {
    fields: [productConditionReports.productId],
    references: [products.id],
  }),
  submittedByEmployee: one(employees, {
    fields: [productConditionReports.submittedByEmployeeId],
    references: [employees.id],
    relationName: 'submittedConditionReports',
  }),
  decidedByAdmin: one(admins, {
    fields: [productConditionReports.decidedByAdminId],
    references: [admins.id],
    relationName: 'decidedConditionReports',
  }),
  executedByEmployee: one(employees, {
    fields: [productConditionReports.executedByEmployeeId],
    references: [employees.id],
    relationName: 'executedConditionReports',
  }),
  discountPolicies: many(discountPolicies),
}));

export const discountPoliciesRelations = relations(discountPolicies, ({ one, many }) => ({
  conditionReport: one(productConditionReports, {
    fields: [discountPolicies.conditionReportId],
    references: [productConditionReports.id],
  }),
  product: one(products, {
    fields: [discountPolicies.productId],
    references: [products.id],
  }),
  batch: one(stockBatches, {
    fields: [discountPolicies.batchId],
    references: [stockBatches.id],
  }),
  createdByAdmin: one(admins, {
    fields: [discountPolicies.createdByAdminId],
    references: [admins.id],
  }),
  barcodes: many(discountBarcodes),
}));

export const discountBarcodesRelations = relations(discountBarcodes, ({ one }) => ({
  policy: one(discountPolicies, {
    fields: [discountBarcodes.policyId],
    references: [discountPolicies.id],
  }),
  product: one(products, {
    fields: [discountBarcodes.productId],
    references: [products.id],
  }),
}));

export const managerDutyLogRelations = relations(managerDutyLog, ({ one }) => ({
  admin: one(admins, {
    fields: [managerDutyLog.adminId],
    references: [admins.id],
  }),
}));

// =============================================================
// 27. SUPPLIERS (Manajemen Data Pemasok / Distributor Gudang)
// PRD Wiramart v3.0 — Fase 5.2 & 5.4
// =============================================================

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    contactPerson: varchar('contact_person', { length: 200 }),
    phone: varchar('phone', { length: 30 }),
    address: text('address'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdByAdminId: uuid('created_by_admin_id').references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_suppliers_name').on(table.name),
    index('idx_suppliers_active').on(table.isActive),
  ],
);

export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  createdByAdmin: one(admins, {
    fields: [suppliers.createdByAdminId],
    references: [admins.id],
  }),
  receiveDrafts: many(stockReceiveDrafts),
}));

// =============================================================
// ██╗   ██╗██████╗      ██████╗      ██████╗
// ██║   ██║╚════██╗    ██╔═████╗    ██╔═████╗
// ██║   ██║ █████╔╝    ██║██╔██║    ██║██╔██║
// ╚██╗ ██╔╝██╔═══╝     ████╔╝██║    ████╔╝██║
//  ╚████╔╝ ███████╗    ╚██████╔╝    ╚██████╔╝
//   ╚═══╝  ╚══════╝     ╚═════╝      ╚═════╝
//
// WIRAMART DELIVERY v2.0 — ADDITIVE EXTENSION
// Tabel baru: buyers, online_orders, online_order_items, notification_logs
// Tidak menyentuh satu pun tabel existing di atas.
// =============================================================

// ── Import tambahan (smallint belum dipakai di schema existing) ──
import { smallint } from 'drizzle-orm/pg-core';

// =============================================================
// WIRAMART ENUMS
// =============================================================

export const onlineOrderStatusEnum = pgEnum('online_order_status', [
  'WAITING_PAYMENT_VERIFICATION',
  'WAITING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
]);

export const onlineDeliveryTypeEnum = pgEnum('online_delivery_type', [
  'PICKUP',
  'DELIVERY',
]);

export const onlinePaymentMethodEnum = pgEnum('online_payment_method', [
  'QRIS',
  'TRANSFER',
]);

// =============================================================
// 28. BUYERS (Pembeli Online — Mahasiswa / Dosen)
// =============================================================

export const buyers = pgTable(
  'buyers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    nim: varchar('nim', { length: 20 }).notNull(),
    // Format internasional: 628xxxxxxxxxx
    whatsapp: varchar('whatsapp', { length: 20 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isFlagged: boolean('is_flagged').notNull().default(false),
    flaggedReason: text('flagged_reason'),
    flaggedBy: uuid('flagged_by').references(() => admins.id),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_buyers_nim_active').on(table.nim).where(sql`${table.deletedAt} IS NULL`),
    index('idx_buyers_whatsapp').on(table.whatsapp).where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type Buyer = typeof buyers.$inferSelect;
export type NewBuyer = typeof buyers.$inferInsert;

// =============================================================
// 29. ONLINE_ORDERS (Pesanan Online)
// =============================================================

export const onlineOrders = pgTable(
  'online_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: varchar('order_number', { length: 25 }).notNull().unique(),
    buyerId: uuid('buyer_id').notNull().references(() => buyers.id),

    deliveryType: onlineDeliveryTypeEnum('delivery_type').notNull(),
    // 1=Lt1, 2=Lt2, 3=Lt3, 4=Lt4, 99=Auditorium, NULL jika PICKUP
    deliveryFloor: smallint('delivery_floor'),
    // IDR — server-side only. L1/PICKUP=0, L2=1000, L3/L4/Aud=2000
    deliveryFee: integer('delivery_fee').notNull().default(0),
    deliveryNote: varchar('delivery_note', { length: 200 }),
    // Wajib diisi untuk DELIVERY (misal: "R.301", "Lab Komputer B")
    roomDetail: varchar('room_detail', { length: 100 }),

    assignedCsId: uuid('assigned_cs_id').references(() => employees.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    assignedBy: uuid('assigned_by').references(() => admins.id),

    // PIN 6-digit anti-fraud, di-generate saat CONFIRMED
    handoverPin: varchar('handover_pin', { length: 6 }),
    handoverConfirmedAt: timestamp('handover_confirmed_at', { withTimezone: true }),
    // Counter no-show buyer. Jika >= 2: admin dinotif untuk cancel
    noShowCount: smallint('no_show_count').notNull().default(0),

    paymentMethod: onlinePaymentMethodEnum('payment_method').notNull(),
    paymentReference: varchar('payment_reference', { length: 25 }),
    paymentProofUrl: text('payment_proof_url'),
    paymentVerifiedAt: timestamp('payment_verified_at', { withTimezone: true }),
    paymentVerifiedBy: uuid('payment_verified_by').references(() => admins.id),

    status: onlineOrderStatusEnum('status').notNull().default('WAITING_CONFIRMATION'),
    cancelledReason: text('cancelled_reason'),
    rejectedReason: text('rejected_reason'),
    cancelledBy: uuid('cancelled_by').references(() => admins.id),
    confirmedBy: uuid('confirmed_by').references(() => admins.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),

    // IDR integer (tidak decimal — hindari floating point)
    subtotal: integer('subtotal').notNull(),
    totalAmount: integer('total_amount').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_online_orders_status').on(table.status, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
    index('idx_online_orders_pending').on(table.createdAt).where(
      sql`${table.status} IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION') AND ${table.deletedAt} IS NULL`,
    ),
    index('idx_online_orders_cs').on(table.assignedCsId, table.status).where(
      sql`${table.assignedCsId} IS NOT NULL AND ${table.deletedAt} IS NULL`,
    ),
    index('idx_online_orders_expire').on(table.expiredAt).where(
      sql`${table.status} IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION') AND ${table.deletedAt} IS NULL`,
    ),
  ],
);

export type OnlineOrder = typeof onlineOrders.$inferSelect;
export type NewOnlineOrder = typeof onlineOrders.$inferInsert;

// =============================================================
// 30. ONLINE_ORDER_ITEMS (Item dalam Pesanan Online)
// SNAPSHOT harga saat order — tidak berubah meski produk diedit
// =============================================================

export const onlineOrderItems = pgTable(
  'online_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => onlineOrders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull().references(() => products.id),
    productName: varchar('product_name', { length: 200 }).notNull(), // snapshot
    sellingPrice: integer('selling_price').notNull(),                 // snapshot IDR
    quantity: integer('quantity').notNull(),
    subtotal: integer('subtotal').notNull(),                          // sellingPrice × quantity
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_online_order_items_order').on(table.orderId),
    index('idx_online_order_items_product').on(table.productId),
  ],
);

export type OnlineOrderItem = typeof onlineOrderItems.$inferSelect;
export type NewOnlineOrderItem = typeof onlineOrderItems.$inferInsert;

// =============================================================
// 31. NOTIFICATION_LOGS (Audit Trail WA via Fonnte)
// Fire-and-forget — tidak blocking alur order utama
// =============================================================

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    recipientWa: varchar('recipient_wa', { length: 20 }).notNull(),
    recipientName: varchar('recipient_name', { length: 200 }),
    message: text('message').notNull(),
    // PENDING | SENT | FAILED
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    providerResponse: jsonb('provider_response'),
    errorMessage: text('error_message'),
    orderId: uuid('order_id').references(() => onlineOrders.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_notification_logs_order').on(table.orderId).where(sql`${table.orderId} IS NOT NULL`),
    index('idx_notification_logs_status').on(table.status, table.createdAt),
  ],
);

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
