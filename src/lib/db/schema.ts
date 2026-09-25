// =============================================================
// Smartkasir Perwira — Drizzle ORM Schema v1.0
// Database: PostgreSQL (Supabase)
// Matches ERD v1.0 exactly — 11 tables
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
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// =============================================================
// ENUM TYPES
// =============================================================

export const paymentMethodEnum = pgEnum('payment_method', ['CASH', 'QRIS']);
export const transactionStatusEnum = pgEnum('transaction_status', ['COMPLETED', 'VOID']);
export const shiftStatusEnum = pgEnum('shift_status', ['ACTIVE', 'CLOSED']);
export const stockActionEnum = pgEnum('stock_action', ['INSERT', 'UPDATE', 'SOFT_DELETE']);
export const actorTypeEnum = pgEnum('actor_type', ['ADMIN', 'EMPLOYEE', 'SYSTEM']);
export const periodTypeEnum = pgEnum('period_type', ['DAILY', 'WEEKLY', 'MONTHLY', 'SEMI_ANNUAL']);

// =============================================================
// 1. ADMINS
// =============================================================

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NIDN = Nomor Induk Dosen Nasional (login utama)
    nidn: varchar('nidn', { length: 20 }).notNull().unique(),
    // NIDK = Nomor Induk Dosen Khusus (alternatif, opsional)
    nidk: varchar('nidk', { length: 20 }),
    // NULL = belum aktivasi akun (belum set password)
    passwordHash: text('password_hash'),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    // TRUE setelah dosen aktivasi akun (set password sendiri)
    isActivated: boolean('is_activated').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_admins_nidn_unique').on(table.nidn),
    index('idx_admins_active').on(table.isActive, table.deletedAt),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('employees_nim_prodi_unique').on(table.nim, table.programStudi),
    index('idx_employees_login').on(table.nim, table.isActive, table.deletedAt),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // CRITICAL: Satu karyawan hanya bisa punya 1 shift ACTIVE sekaligus
    // (enforced di application layer via check sebelum insert)
    uniqueIndex('shifts_employee_one_active').on(table.employeeId, table.status),
    index('idx_shifts_employee').on(table.employeeId, table.createdAt),
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
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_products_category').on(table.categoryId, table.deletedAt),
    index('idx_products_active').on(table.isActive, table.stockQty, table.deletedAt),
    // Partial unique index: barcode unik di antara produk yang belum dihapus
    uniqueIndex('idx_products_barcode_unique').on(table.barcode),
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
  },
  (table) => [
    // Critical for reports — most queries filter by date + status
    index('idx_trx_created_status').on(table.createdAt, table.status),
    index('idx_trx_employee').on(table.employeeId, table.createdAt),
    index('idx_trx_shift').on(table.shiftId),
    index('idx_trx_payment').on(table.paymentMethod, table.createdAt),
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
