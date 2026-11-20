// =============================================================
// src/lib/services/stockReceiveService.ts
// Domain Logic: Penerimaan Barang Masuk & Produk Baru Gudang
// Transaksi ACID, Guard Anti-IDOR, & Validasi Skema
// =============================================================

import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  stockReceiveDrafts,
  stockReceiveItems,
  stockBatches,
  stockAdjustments,
  suppliers,
  products,
  categories,
  employees,
  admins,
  auditLogs,
  type StockReceiveDraft,
  type ExpiryClass,
} from '@/lib/db/schema';
import { eq, and, desc, isNull, inArray, sql, count } from 'drizzle-orm';
import { AppError, getTodayWib } from '@/lib/utils/helpers';
import { ManagerDutyService } from '@/lib/services/managerDutyService';
import { resolveNormalizedSupplierId } from '@/lib/services/supplierResolver';


// ── ZOD SCHEMAS (100% Runtime Validation) ──────────────────────

export const StockReceiveItemInputSchema = z.object({
  productId: z.string().uuid('ID produk tidak valid'),
  productName: z.string().trim().max(200).optional(),
  batchCode: z.string().trim().min(1, 'Kode batch wajib diisi').max(50),
  qty: z.number().int('Jumlah harus bulat').min(1, 'Jumlah minimal 1').max(100_000, 'Jumlah maksimal 100.000'),
  costPrice: z.number().min(0, 'HPP tidak boleh negatif'),
  expiryDate: z
    .string({ message: 'Tanggal kedaluwarsa wajib diisi untuk setiap produk' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal kadaluarsa harus YYYY-MM-DD'),
  conditionNote: z.string().trim().max(500, 'Catatan fisik maksimal 500 karakter').optional().nullable(),
});

export const ProposeNewProductSchema = z.object({
  name: z.string().trim().min(2, 'Nama produk minimal 2 karakter').max(200, 'Nama produk maksimal 200 karakter'),
  categoryId: z.string().uuid('Kategori produk wajib dipilih'),
  barcode: z.string().trim().max(100).optional().nullable(),
  unit: z.string().trim().min(1, 'Satuan wajib diisi').max(20).default('pcs'),
  costPrice: z.number().min(0, 'Harga beli / HPP tidak boleh negatif'),
  sellingPrice: z.number().positive('Usulan harga jual harus lebih dari 0'),
  initialQty: z.number().int('Jumlah awal harus bilangan bulat').min(1, 'Jumlah awal minimal 1').max(100_000),
  bonusQty: z.number().int('Qty bonus harus bilangan bulat').min(0).max(100_000).optional().default(0),
  expiryDate: z
    .string({ message: 'Tanggal kedaluwarsa wajib diisi (termasuk makanan harian)' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal kedaluwarsa harus YYYY-MM-DD'),
  isPerishable: z.boolean().optional().default(false),
  perishableType: z.enum(['KONSINYASI', 'BELI_LEPAS']).optional().default('KONSINYASI'),
  supplierName: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const ApprovePriceOverrideSchema = z.object({
  priceOverrides: z
    .array(
      z.object({
        productId: z.string().uuid(),
        sellingPrice: z.number().positive('Harga jual harus lebih dari 0').optional(),
        costPrice: z.number().min(0, 'HPP tidak boleh negatif').optional(),
      }),
    )
    .optional(),
});

export type ProposeNewProductInput = z.infer<typeof ProposeNewProductSchema>;
export type ApprovePriceOverrideItem = NonNullable<z.infer<typeof ApprovePriceOverrideSchema>['priceOverrides']>[number];

export const CreateStockReceiveDraftSchema = z.object({
  supplierId: z.string().uuid('ID supplier tidak valid').optional().nullable(),
  supplierName: z.string().trim().max(200, 'Nama supplier maksimal 200 karakter').optional().nullable(),
  deliveryNote: z.string().trim().max(500, 'Catatan pengiriman / No. Faktur maksimal 500 karakter').optional().nullable(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal faktur harus YYYY-MM-DD')
    .optional()
    .nullable(),
  invoicePhotoUrl: z
    .string()
    .trim()
    .max(1_500_000, 'Ukuran foto nota terlalu besar (maksimal ~1 MB setelah kompresi)')
    .refine(
      (val) =>
        !val ||
        val.startsWith('data:image/jpeg;base64,') ||
        val.startsWith('data:image/png;base64,') ||
        val.startsWith('data:image/webp;base64,') ||
        val.startsWith('https://') ||
        val.startsWith('/'),
      'Format foto nota harus berupa gambar valid (JPEG, PNG, atau WebP)',
    )
    .optional()
    .nullable(),
  autoSubmit: z.boolean().optional().default(false),
  items: z.array(StockReceiveItemInputSchema).min(1, 'Penerimaan harus memiliki minimal 1 item produk').max(200),
});

export const UpdateStockReceiveDraftSchema = CreateStockReceiveDraftSchema;

export const ManagerRevisiSchema = z.object({
  catatan: z.string().trim().min(5, 'Catatan revisi minimal 5 karakter').max(1000),
});

export const ManagerTolakSchema = z.object({
  alasan: z.string().trim().min(5, 'Alasan penolakan minimal 5 karakter').max(1000),
});

export type StockReceiveItemInput = z.infer<typeof StockReceiveItemInputSchema>;
export type CreateStockReceiveDraftInput = z.infer<typeof CreateStockReceiveDraftSchema>;

// ── HELPER: Menentukan Expiry Class FEFO ────────────────────────

export function computeExpiryClass(expiryDateStr: string | null | undefined): ExpiryClass {
  if (!expiryDateStr) return 'PANJANG';
  const todayStr = getTodayWib();
  const today = new Date(`${todayStr}T00:00:00Z`);
  const exp = new Date(`${expiryDateStr}T00:00:00Z`);
  const diffTime = exp.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 2) return 'HARIAN';
  if (diffDays <= 14) return 'PENDEK';
  return 'PANJANG';
}

// ── HELPER: Generate Nomor Bukti Penerimaan Barang ─────────────

async function generateReceiveNumber(): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `GUD-${yyyy}${mm}${dd}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const randomSuffix = String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `${datePrefix}-${randomSuffix}`;
    const [existing] = await db
      .select({ id: stockReceiveDrafts.id })
      .from(stockReceiveDrafts)
      .where(eq(stockReceiveDrafts.receiveNumber, candidate))
      .limit(1);

    if (!existing) {
      return candidate;
    }
  }

  return `${datePrefix}-${Date.now().toString().slice(-4)}`;
}

// =============================================================
// HELPER: Resolusi Pembuat Draft (Karyawan Gudang ATAU Admin Shift/Manager)
// =============================================================

async function resolveCreatorEmployeeId(
  actorId: string,
  actorRole: 'employee' | 'admin' = 'employee',
): Promise<{ employeeId: string; isAdminActor: boolean }> {
  // 1. Cek langsung di tabel employees
  const [emp] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, actorId), eq(employees.isActive, true), isNull(employees.deletedAt)))
    .limit(1);

  if (emp) {
    return { employeeId: emp.id, isAdminActor: actorRole === 'admin' };
  }

  // 2. Jika berasal dari sesi Admin (sk_admin), cocokkan admins.nidn ke employees.nim
  if (actorRole === 'admin') {
    const [adm] = await db
      .select({ id: admins.id, nidn: admins.nidn })
      .from(admins)
      .where(and(eq(admins.id, actorId), eq(admins.isActive, true), isNull(admins.deletedAt)))
      .limit(1);

    if (adm) {
      const [matchedEmp] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.nim, adm.nidn), isNull(employees.deletedAt)))
        .limit(1);

      if (matchedEmp) {
        return { employeeId: matchedEmp.id, isAdminActor: true };
      }

      // Fallback untuk Manager Dosen yang tidak punya baris di employees:
      // atribusikan ke petugas gudang/admin shift aktif pertama
      const [fallbackEmp] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.isActive, true), isNull(employees.deletedAt)))
        .limit(1);

      if (fallbackEmp) {
        return { employeeId: fallbackEmp.id, isAdminActor: true };
      }
    }
  }

  throw new AppError('FORBIDDEN', 'Akun petugas/admin tidak ditemukan atau nonaktif.', 403);
}

// =============================================================
// 1. GUDANG / ADMIN KASIR: Buat Draft / Simpan Nota Supplier
// =============================================================

export async function createStockReceiveDraft(
  actorId: string,
  rawInput: CreateStockReceiveDraftInput,
  actorRole: 'employee' | 'admin' = 'employee',
) {
  const input = CreateStockReceiveDraftSchema.parse(rawInput);
  const { employeeId, isAdminActor } = await resolveCreatorEmployeeId(actorId, actorRole);

  // Verifikasi Produk-Produk yang Diinput
  const productIds = input.items.map((i) => i.productId);
  const foundProducts = await db
    .select({
      id: products.id,
      name: products.name,
      isActive: products.isActive,
      isPerishable: products.isPerishable,
    })
    .from(products)
    .where(and(inArray(products.id, productIds), isNull(products.deletedAt)));

  if (foundProducts.length !== new Set(productIds).size) {
    throw new AppError('BAD_REQUEST', 'Satu atau lebih produk tidak ditemukan atau sudah dihapus.', 400);
  }

  const inactiveProd = foundProducts.find((p) => !p.isActive);
  if (inactiveProd) {
    throw new AppError('BAD_REQUEST', `Produk "${inactiveProd.name}" sedang nonaktif.`, 400);
  }

  // Validasi Tanggal Expired WAJIB untuk SEMUA produk (termasuk makanan harian) & tidak boleh masa lampau
  const todayStr = getTodayWib();
  for (const item of input.items) {
    const prodMeta = foundProducts.find((p) => p.id === item.productId);
    const prodLabel = prodMeta?.name || item.productName || item.productId;
    if (!item.expiryDate) {
      throw new AppError('BAD_REQUEST', `Produk "${prodLabel}" wajib memiliki tanggal kedaluwarsa.`, 400);
    }
    if (item.expiryDate < todayStr) {
      throw new AppError('BAD_REQUEST', `Tanggal kadaluarsa "${prodLabel}" (${item.expiryDate}) sudah terlewat. Tidak bisa menerima barang expired.`, 400);
    }
  }

  const receiveNumber = await generateReceiveNumber();
  const resolvedInvoiceDate = input.invoiceDate || todayStr;
  const targetStatus = input.autoSubmit ? 'SUBMITTED' : 'DRAFT';

  // Insert Draft Header + Items Atomik
  const createdDraft = await db.transaction(async (tx) => {
    const resolvedSupplierId = await resolveNormalizedSupplierId(tx, {
      supplierId: input.supplierId,
      supplierName: input.supplierName,
    });

    const [draft] = await tx
      .insert(stockReceiveDrafts)
      .values({
        receiveNumber,
        createdByEmployeeId: employeeId,
        supplierId: resolvedSupplierId,
        deliveryNote: input.deliveryNote?.trim() || null,
        invoiceDate: resolvedInvoiceDate,
        invoicePhotoUrl: input.invoicePhotoUrl?.trim() || null,
        status: targetStatus,
        submittedAt: input.autoSubmit ? new Date() : null,
      })
      .returning();

    const itemValues = input.items.map((it) => ({
      draftId: draft.id,
      productId: it.productId,
      batchCode: it.batchCode.trim(),
      qty: it.qty,
      costPrice: it.costPrice.toString(),
      expiryDate: it.expiryDate || null,
      conditionNote: it.conditionNote?.trim() || null,
    }));

    await tx.insert(stockReceiveItems).values(itemValues);

    return draft;
  });

  return getStockReceiveDraftDetail(createdDraft.id, isAdminActor ? undefined : employeeId);
}

// =============================================================
// 1b. GUDANG: Usulan Produk Baru + Stok Awal -> Antrian Approval Manager
// Produk disimpan dengan isActive = false & stockQty = 0 hingga di-ACC Manager
// =============================================================

export async function proposeNewProductByWarehouse(
  actorId: string,
  rawInput: ProposeNewProductInput,
  actorRole: 'employee' | 'admin' = 'employee',
) {
  const input = ProposeNewProductSchema.parse(rawInput);
  const { employeeId, isAdminActor } = await resolveCreatorEmployeeId(actorId, actorRole);

  const todayStr = getTodayWib();
  if (input.expiryDate < todayStr) {
    throw new AppError(
      'BAD_REQUEST',
      `Tanggal kedaluwarsa (${input.expiryDate}) sudah terlewat. Masukkan tanggal hari ini atau mendatang.`,
      400,
    );
  }

  const cleanName = input.name.trim();
  const cleanBarcode = input.barcode?.trim() || null;

  // 1. Validasi kategori aktif
  const [cat] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.isActive, true), isNull(categories.deletedAt)))
    .limit(1);

  if (!cat) {
    throw new AppError('BAD_REQUEST', 'Kategori produk tidak valid atau nonaktif.', 400);
  }

  // 2. Cek duplikat nama produk (case-insensitive)
  const [dupName] = await db
    .select({ id: products.id, name: products.name, isActive: products.isActive })
    .from(products)
    .where(
      and(
        isNull(products.deletedAt),
        sql`LOWER(TRIM(${products.name})) = ${cleanName.toLowerCase()}`,
      ),
    )
    .limit(1);

  if (dupName) {
    throw new AppError(
      'CONFLICT',
      dupName.isActive
        ? `Produk "${dupName.name}" sudah terdaftar di katalog. Gunakan menu Restock pada produk tersebut.`
        : `Usulan produk "${dupName.name}" sudah diajukan dan sedang menunggu persetujuan Manager.`,
      409,
    );
  }

  // 3. Cek duplikat barcode jika diisi
  if (cleanBarcode) {
    const [dupBarcode] = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.barcode, cleanBarcode), isNull(products.deletedAt)))
      .limit(1);

    if (dupBarcode) {
      throw new AppError(
        'CONFLICT',
        `Barcode "${cleanBarcode}" sudah dipakai produk "${dupBarcode.name}". Setiap varian rasa/produk harus memiliki barcode berbeda.`,
        409,
      );
    }
  }

  // 4. Resolusi Admin FK untuk products.createdByAdminId
  const [managerAdmin] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.isActive, true), isNull(admins.deletedAt), eq(admins.role, 'MANAGER')))
    .limit(1);
  const [fallbackAdmin] = !managerAdmin
    ? await db
        .select({ id: admins.id })
        .from(admins)
        .where(and(eq(admins.isActive, true), isNull(admins.deletedAt)))
        .limit(1)
    : [managerAdmin];

  if (!fallbackAdmin) {
    throw new AppError('INTERNAL_ERROR', 'Tidak ada akun Manager aktif di sistem.', 500);
  }

  const safeBonusQty = Math.max(0, Math.floor(input.bonusQty ?? 0));
  const totalInitialQty = input.initialQty + safeBonusQty;
  const effectiveCostPrice =
    safeBonusQty > 0 && totalInitialQty > 0
      ? Math.round((input.initialQty * input.costPrice) / totalInitialQty)
      : input.costPrice;
  const bonusLabel =
    safeBonusQty > 0
      ? ` (${input.initialQty} beli + ${safeBonusQty} bonus gratis; HPP efektif Rp ${effectiveCostPrice.toLocaleString('id-ID')})`
      : '';

  const receiveNumber = await generateReceiveNumber();
  const compactDate = todayStr.replace(/-/g, '');
  const batchCode = `NEW-${compactDate}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  const noteText = input.notes?.trim()
    ? `[PRODUK BARU LANGSUNG] ${input.notes.trim()}`
    : `[PRODUK BARU LANGSUNG] Tambah SKU baru "${cleanName}" (${cat.name})${bonusLabel}`;
  const now = new Date();

  const createdDraft = await db.transaction(async (tx) => {
    const resolvedSupplierId = await resolveNormalizedSupplierId(tx, {
      supplierName: input.supplierName?.trim() || undefined,
    });

    // Produk langsung aktif di POS Kasir & Gudang dengan batch FEFO dan audit trail lengkap
    const [activeProduct] = await tx
      .insert(products)
      .values({
        categoryId: input.categoryId,
        name: cleanName,
        barcode: cleanBarcode,
        costPrice: effectiveCostPrice.toString(),
        sellingPrice: input.sellingPrice.toString(),
        stockQty: totalInitialQty,
        unit: input.unit.trim() || 'pcs',
        isActive: true,
        isPerishable: input.isPerishable,
        perishableType: input.isPerishable ? input.perishableType : null,
        createdByAdminId: fallbackAdmin.id,
      })
      .returning();

    // B. Catat penerimaan berstatus APPROVED di Buku Nota Supplier
    const [draft] = await tx
      .insert(stockReceiveDrafts)
      .values({
        receiveNumber,
        createdByEmployeeId: employeeId,
        supplierId: resolvedSupplierId,
        deliveryNote: noteText,
        invoiceDate: todayStr,
        status: 'APPROVED',
        submittedAt: now,
        approvedAt: now,
        approvedByAdminId: fallbackAdmin.id,
        managerNote: 'Input produk baru langsung aktif oleh Gudang / Admin Shift',
      })
      .returning();

    // C. Insert item penerimaan
    const [receiveItem] = await tx
      .insert(stockReceiveItems)
      .values({
        draftId: draft.id,
        productId: activeProduct.id,
        batchCode,
        qty: totalInitialQty,
        costPrice: effectiveCostPrice.toString(),
        expiryDate: input.expiryDate,
        conditionNote: `[PRODUK BARU] Kategori: ${cat.name} | Harga Jual: Rp ${Math.round(input.sellingPrice).toLocaleString('id-ID')}${bonusLabel}${input.notes?.trim() ? ` | ${input.notes.trim()}` : ''}`,
      })
      .returning();

    // D. Buat batch FEFO awal
    const [batch] = await tx
      .insert(stockBatches)
      .values({
        productId: activeProduct.id,
        receiveItemId: receiveItem.id,
        supplierId: resolvedSupplierId,
        batchCode,
        costPrice: effectiveCostPrice.toString(),
        initialQty: totalInitialQty,
        currentQty: totalInitialQty,
        expiryDate: input.expiryDate,
        expiryClass: computeExpiryClass(input.expiryDate),
        receivedAt: now,
        notes: `Stok awal produk baru (${receiveNumber})${bonusLabel}`,
      })
      .returning();

    // E. Audit Trail stockAdjustments
    await tx.insert(stockAdjustments).values({
      productId: activeProduct.id,
      batchId: batch.id,
      qtyBefore: 0,
      qtyAfter: totalInitialQty,
      qtyDiff: totalInitialQty,
      reason: `[RESTOCK GUDANG • PRODUK BARU] ${cleanName} +${totalInitialQty} ${input.unit}${bonusLabel} (Batch: ${batchCode} Exp: ${input.expiryDate})`,
      adjustedByAdminId: fallbackAdmin.id,
      createdAt: now,
    });

    return draft;
  });

  return getStockReceiveDraftDetail(createdDraft.id, isAdminActor ? undefined : employeeId);
}

// =============================================================
// 2. GUDANG / ADMIN KASIR: Update Draft (Hanya saat status DRAFT / REVISED)
// =============================================================

export async function updateStockReceiveDraft(
  draftId: string,
  actorId: string,
  rawInput: CreateStockReceiveDraftInput,
  actorRole: 'employee' | 'admin' = 'employee',
) {
  const input = UpdateStockReceiveDraftSchema.parse(rawInput);
  const { employeeId, isAdminActor } = await resolveCreatorEmployeeId(actorId, actorRole);

  const [existing] = await db
    .select()
    .from(stockReceiveDrafts)
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
  }

  // IDOR Guard (Admin Shift / Manager diizinkan membantu mengedit draft nota)
  if (!isAdminActor && existing.createdByEmployeeId !== employeeId) {
    throw new AppError('FORBIDDEN', 'Anda tidak memiliki hak akses untuk mengubah draft ini.', 403);
  }

  // Status Guard
  if (existing.status !== 'DRAFT' && existing.status !== 'REVISED') {
    throw new AppError('BAD_REQUEST', `Draft tidak dapat diubah karena berstatus ${existing.status}.`, 400);
  }

  const todayStr = getTodayWib();
  const editProdIds = Array.from(new Set(input.items.map((i) => i.productId)));
  const validEditProds = await db
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, editProdIds), isNull(products.deletedAt)));

  if (validEditProds.length !== editProdIds.length) {
    throw new AppError('BAD_REQUEST', 'Satu atau lebih produk pada draft tidak ditemukan atau telah dihapus.', 400);
  }

  for (const item of input.items) {
    if (!item.expiryDate) {
      throw new AppError('BAD_REQUEST', `Tanggal kedaluwarsa "${item.productName || item.productId}" wajib diisi.`, 400);
    }
    if (item.expiryDate < todayStr) {
      throw new AppError('BAD_REQUEST', `Tanggal kadaluarsa "${item.productName || item.productId}" sudah lewat.`, 400);
    }
  }

  await db.transaction(async (tx) => {
    const resolvedSupplierId =
      input.supplierId !== undefined || input.supplierName !== undefined
        ? await resolveNormalizedSupplierId(tx, {
            supplierId: input.supplierId,
            supplierName: input.supplierName,
          })
        : existing.supplierId;

    await tx
      .update(stockReceiveDrafts)
      .set({
        supplierId: resolvedSupplierId,
        deliveryNote: input.deliveryNote?.trim() || null,
        invoiceDate: input.invoiceDate !== undefined ? (input.invoiceDate || existing.invoiceDate) : existing.invoiceDate,
        invoicePhotoUrl:
          input.invoicePhotoUrl !== undefined
            ? (input.invoicePhotoUrl?.trim() || null)
            : existing.invoicePhotoUrl,
        status: input.autoSubmit ? 'SUBMITTED' : 'DRAFT',
        submittedAt: input.autoSubmit ? new Date() : existing.submittedAt,
        updatedAt: new Date(),
      })
      .where(eq(stockReceiveDrafts.id, draftId));

    // Re-insert items
    await tx.delete(stockReceiveItems).where(eq(stockReceiveItems.draftId, draftId));

    const itemValues = input.items.map((it) => ({
      draftId,
      productId: it.productId,
      batchCode: it.batchCode.trim(),
      qty: it.qty,
      costPrice: it.costPrice.toString(),
      expiryDate: it.expiryDate || null,
      conditionNote: it.conditionNote?.trim() || null,
    }));

    await tx.insert(stockReceiveItems).values(itemValues);
  });

  return getStockReceiveDraftDetail(draftId, isAdminActor ? undefined : employeeId);
}

// =============================================================
// 3. GUDANG / ADMIN KASIR: Submit Draft ke Manager untuk Approval
// =============================================================

export async function submitStockReceiveDraft(
  draftId: string,
  actorId: string,
  actorRole: 'employee' | 'admin' = 'employee',
) {
  const { employeeId, isAdminActor } = await resolveCreatorEmployeeId(actorId, actorRole);

  const [existing] = await db
    .select()
    .from(stockReceiveDrafts)
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
  }

  // IDOR Guard
  if (!isAdminActor && existing.createdByEmployeeId !== employeeId) {
    throw new AppError('FORBIDDEN', 'Hanya pembuat draft atau Admin Shift yang dapat mengajukan ke Manager.', 403);
  }

  if (existing.status !== 'DRAFT' && existing.status !== 'REVISED') {
    throw new AppError('BAD_REQUEST', `Draft tidak dapat disubmit karena berstatus ${existing.status}.`, 400);
  }

  // Cek minimal 1 item & re-validasi wajib tanggal kedaluwarsa tidak boleh kosong/lewat saat submit
  const draftItems = await db
    .select({
      id: stockReceiveItems.id,
      batchCode: stockReceiveItems.batchCode,
      expiryDate: stockReceiveItems.expiryDate,
    })
    .from(stockReceiveItems)
    .where(eq(stockReceiveItems.draftId, draftId));

  if (draftItems.length === 0) {
    throw new AppError('BAD_REQUEST', 'Draft penerimaan barang masih kosong, belum ada produk.', 400);
  }

  const todayStr = getTodayWib();
  for (const it of draftItems) {
    if (!it.expiryDate) {
      throw new AppError(
        'BAD_REQUEST',
        `Batch "${it.batchCode}" belum memiliki tanggal kedaluwarsa. Edit draft dan isi tanggal kedaluwarsa terlebih dahulu sebelum diajukan.`,
        400,
      );
    }
    if (it.expiryDate < todayStr) {
      throw new AppError(
        'BAD_REQUEST',
        `Batch "${it.batchCode}" memiliki tanggal kedaluwarsa yang sudah terlewat (${it.expiryDate}). Perbarui draft terlebih dahulu.`,
        400,
      );
    }
  }

  const [updated] = await db
    .update(stockReceiveDrafts)
    .set({
      status: 'SUBMITTED',
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(stockReceiveDrafts.id, draftId))
    .returning();

  return updated;
}

// =============================================================
// 4. MANAGER ONLY: Approve Penerimaan Barang (ACID 2-Layer Approval)
// =============================================================

export async function approveStockReceiveDraft(
  draftId: string,
  managerAdminId: string,
  priceOverrides?: ApprovePriceOverrideItem[],
) {
  // Verifikasi Manager
  const [manager] = await db
    .select({ id: admins.id, role: admins.role, fullName: admins.fullName })
    .from(admins)
    .where(and(eq(admins.id, managerAdminId), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);

  if (!manager || manager.role !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Hanya Manager (Dosen/Eksekutif) yang berwenang menyetujui penerimaan barang.', 403);
  }

  // 0. Guard Check-In Manager on Duty (MOD)
  // Penerimaan barang wajib disetujui di bawah pengawasan Manager on Duty yang aktif hari ini
  const todayDuty = await ManagerDutyService.getTodayDutyStatus();
  if (!todayDuty.isCheckedIn || todayDuty.isCheckedOut) {
    throw new AppError(
      'FORBIDDEN',
      'ACC belum dapat dilakukan karena belum ada Manager yang memulai Sesi Kerja Hari Ini. Silakan mulai sesi kerja terlebih dahulu melalui tombol di header.',
      403,
    );
  }

  const overrideMap = new Map<string, ApprovePriceOverrideItem>();
  if (priceOverrides) {
    for (const ov of priceOverrides) {
      overrideMap.set(ov.productId, ov);
    }
  }

  // Eksekusi ACID Transaction
  return await db.transaction(async (tx) => {
    // 1. Lock draft row FOR UPDATE
    const [draft] = await tx
      .select()
      .from(stockReceiveDrafts)
      .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
      .for('update')
      .limit(1);

    if (!draft) {
      throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
    }

    if (draft.status !== 'SUBMITTED') {
      throw new AppError(
        'BAD_REQUEST',
        `Penerimaan barang tidak dapat disetujui karena berstatus ${draft.status} (Wajib: SUBMITTED).`,
        400,
      );
    }

    const [creatorEmp] = await tx
      .select({ fullName: employees.fullName, nim: employees.nim })
      .from(employees)
      .where(eq(employees.id, draft.createdByEmployeeId))
      .limit(1);

    // 2. Ambil seluruh item dalam draft
    const items = await tx
      .select()
      .from(stockReceiveItems)
      .where(eq(stockReceiveItems.draftId, draftId));

    if (items.length === 0) {
      throw new AppError('BAD_REQUEST', 'Penerimaan barang tidak memiliki daftar produk.', 400);
    }

    const now = new Date();
    const todayStr = getTodayWib(now);
    let activatedNewProductsCount = 0;

    // 3. Atomik: Lock produk -> aktifkan bila produk baru -> insert stock_batches -> tambah stock_qty -> catat stock_adjustments
    for (const item of items) {
      if (item.expiryDate && item.expiryDate < todayStr) {
        throw new AppError(
          'BAD_REQUEST',
          `Item dengan kode batch ${item.batchCode} memiliki tanggal kedaluwarsa yang sudah terlewat (${item.expiryDate}). Tolak atau minta revisi.`,
          400,
        );
      }

      const [lockedProd] = await tx
        .select({
          id: products.id,
          name: products.name,
          stockQty: products.stockQty,
          unit: products.unit,
          isActive: products.isActive,
          costPrice: products.costPrice,
          sellingPrice: products.sellingPrice,
        })
        .from(products)
        .where(and(eq(products.id, item.productId), isNull(products.deletedAt)))
        .for('update')
        .limit(1);

      if (!lockedProd) {
        throw new AppError('BAD_REQUEST', 'Salah satu produk di draft tidak ditemukan atau telah dihapus.', 400);
      }

      const override = overrideMap.get(item.productId);
      const effectiveCostPrice =
        override?.costPrice !== undefined ? override.costPrice.toString() : item.costPrice;
      const effectiveSellingPrice =
        override?.sellingPrice !== undefined ? override.sellingPrice.toString() : lockedProd.sellingPrice;

      const wasPendingNewProduct = !lockedProd.isActive;
      if (wasPendingNewProduct) {
        activatedNewProductsCount += 1;
      }

      const expClass = computeExpiryClass(item.expiryDate);
      const qtyBefore = lockedProd.stockQty;
      const qtyAfter = qtyBefore + item.qty;

      // Insert baris batch baru terhubung ke receive_item_id & supplier_id (3NF)
      const [insertedBatch] = await tx
        .insert(stockBatches)
        .values({
          productId: item.productId,
          receiveItemId: item.id,
          supplierId: draft.supplierId ?? null,
          batchCode: item.batchCode,
          costPrice: effectiveCostPrice,
          initialQty: item.qty,
          currentQty: item.qty,
          expiryDate: item.expiryDate || todayStr,
          expiryClass: expClass,
          notes: `Penerimaan #${draft.receiveNumber} disetujui oleh ${manager.fullName}`,
        })
        .returning({ id: stockBatches.id });

      // Update total stok produk di tabel master (+ aktifkan jika usulan produk baru & terapkan override harga)
      await tx
        .update(products)
        .set({
          stockQty: sql`${products.stockQty} + ${item.qty}`,
          isActive: true,
          ...(wasPendingNewProduct || override?.costPrice !== undefined
            ? { costPrice: effectiveCostPrice }
            : {}),
          ...(override?.sellingPrice !== undefined
            ? { sellingPrice: effectiveSellingPrice }
            : {}),
          updatedAt: now,
        })
        .where(eq(products.id, item.productId));

      // Catat ke stock_adjustments agar tampil di Riwayat Penambahan Stok Gudang & Laporan Mutasi Stok
      const creatorLabel = creatorEmp
        ? `${creatorEmp.fullName} (NIM ${creatorEmp.nim})`
        : 'Petugas Gudang';
      const expText = item.expiryDate ? ` Exp: ${item.expiryDate}` : '';
      const newProdTag = wasPendingNewProduct ? ' [PRODUK BARU DIAKTIFKAN]' : '';
      await tx.insert(stockAdjustments).values({
        productId: item.productId,
        batchId: insertedBatch?.id ?? null,
        qtyBefore,
        qtyAfter,
        qtyDiff: item.qty,
        reason: `[RESTOCK GUDANG • PENERIMAAN ACC #${draft.receiveNumber}${newProdTag} • Petugas: ${creatorLabel} • Disetujui: ${manager.fullName}] Masuk +${item.qty} ${lockedProd.unit} (Batch: ${item.batchCode}${expText}).`,
        adjustedByAdminId: manager.id,
        createdAt: now,
      });
    }

    // 4. Update status draft ke APPROVED
    const [approvedDraft] = await tx
      .update(stockReceiveDrafts)
      .set({
        status: 'APPROVED',
        approvedByAdminId: manager.id,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(stockReceiveDrafts.id, draftId))
      .returning();

    // 5. Catat Audit Log
    await tx.insert(auditLogs).values({
      tableName: 'stock_receive_drafts',
      recordId: draftId,
      action: 'UPDATE',
      oldValues: JSON.stringify({ status: 'SUBMITTED' }),
      newValues: JSON.stringify({
        status: 'APPROVED',
        approvedByAdminId: manager.id,
        receiveNumber: draft.receiveNumber,
        itemCount: items.length,
        activatedNewProductsCount,
      }),
      actorType: 'ADMIN',
      actorId: manager.id,
    });

    return approvedDraft;
  });
}

// =============================================================
// 5. MANAGER ONLY: Minta Revisi Draft
// =============================================================

export async function reviseStockReceiveDraft(
  draftId: string,
  managerAdminId: string,
  rawCatatan: z.infer<typeof ManagerRevisiSchema>,
) {
  const { catatan } = ManagerRevisiSchema.parse(rawCatatan);

  const [manager] = await db
    .select({ id: admins.id, role: admins.role })
    .from(admins)
    .where(and(eq(admins.id, managerAdminId), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);

  if (!manager || manager.role !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Hanya Manager yang berwenang meminta revisi penerimaan barang.', 403);
  }

  const [draft] = await db
    .select()
    .from(stockReceiveDrafts)
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!draft) {
    throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
  }

  if (draft.status !== 'SUBMITTED') {
    throw new AppError('BAD_REQUEST', `Draft tidak dapat direvisi karena berstatus ${draft.status}.`, 400);
  }

  const [revised] = await db
    .update(stockReceiveDrafts)
    .set({
      status: 'REVISED',
      managerNote: catatan,
      rejectedByAdminId: manager.id,
      updatedAt: new Date(),
    })
    .where(eq(stockReceiveDrafts.id, draftId))
    .returning();

  return revised;
}

// =============================================================
// 6. MANAGER ONLY: Tolak Draft Penerimaan Barang
// =============================================================

export async function rejectStockReceiveDraft(
  draftId: string,
  managerAdminId: string,
  rawAlasan: z.infer<typeof ManagerTolakSchema>,
) {
  const { alasan } = ManagerTolakSchema.parse(rawAlasan);

  const [manager] = await db
    .select({ id: admins.id, role: admins.role })
    .from(admins)
    .where(and(eq(admins.id, managerAdminId), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);

  if (!manager || manager.role !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Hanya Manager yang berwenang menolak penerimaan barang.', 403);
  }

  const [draft] = await db
    .select()
    .from(stockReceiveDrafts)
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!draft) {
    throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
  }

  if (draft.status !== 'SUBMITTED') {
    throw new AppError('BAD_REQUEST', `Draft tidak dapat ditolak karena berstatus ${draft.status}.`, 400);
  }

  const rejected = await db.transaction(async (tx) => {
    const now = new Date();
    const [rejRow] = await tx
      .update(stockReceiveDrafts)
      .set({
        status: 'REJECTED',
        managerNote: alasan,
        rejectedByAdminId: manager.id,
        rejectedAt: now,
        updatedAt: now,
      })
      .where(eq(stockReceiveDrafts.id, draftId))
      .returning();

    // Jika draft yang ditolak memuat usulan produk baru (isActive=false, stockQty=0), soft-delete agar nama & barcode bebas kembali
    const items = await tx
      .select({ productId: stockReceiveItems.productId })
      .from(stockReceiveItems)
      .where(eq(stockReceiveItems.draftId, draftId));

    if (items.length > 0) {
      await tx
        .update(products)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(
              products.id,
              items.map((i) => i.productId),
            ),
            eq(products.isActive, false),
            eq(products.stockQty, 0),
            isNull(products.deletedAt),
          ),
        );
    }

    return rejRow;
  });

  return rejected;
}

// =============================================================
// 7. QUERY: Daftar Draft Penerimaan (Listing & Filter)
// =============================================================

export async function getStockReceiveDrafts(options: {
  employeeId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const { employeeId, status, page = 1, limit = 20 } = options;
  const offset = (Math.max(1, page) - 1) * limit;

  const conditions = [isNull(stockReceiveDrafts.deletedAt)];

  if (employeeId) {
    conditions.push(eq(stockReceiveDrafts.createdByEmployeeId, employeeId));
  }

  if (status) {
    conditions.push(eq(stockReceiveDrafts.status, status as StockReceiveDraft['status']));
  }

  const [totalRow] = await db
    .select({ count: count() })
    .from(stockReceiveDrafts)
    .where(and(...conditions));

  const rows = await db
    .select({
      id: stockReceiveDrafts.id,
      receiveNumber: stockReceiveDrafts.receiveNumber,
      supplierId: stockReceiveDrafts.supplierId,
      supplierName: suppliers.name,
      deliveryNote: stockReceiveDrafts.deliveryNote,
      invoiceDate: stockReceiveDrafts.invoiceDate,
      invoicePhotoUrl: stockReceiveDrafts.invoicePhotoUrl,
      status: stockReceiveDrafts.status,
      submittedAt: stockReceiveDrafts.submittedAt,
      approvedAt: stockReceiveDrafts.approvedAt,
      rejectedAt: stockReceiveDrafts.rejectedAt,
      managerNote: stockReceiveDrafts.managerNote,
      createdAt: stockReceiveDrafts.createdAt,
      creatorName: employees.fullName,
      creatorNim: employees.nim,
      hasNewProductProposal: sql<boolean>`COALESCE(${stockReceiveDrafts.deliveryNote} ILIKE '[USULAN PRODUK BARU]%', false)`,
    })
    .from(stockReceiveDrafts)
    .innerJoin(employees, eq(stockReceiveDrafts.createdByEmployeeId, employees.id))
    .leftJoin(suppliers, eq(stockReceiveDrafts.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(stockReceiveDrafts.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    items: rows,
    total: Number(totalRow?.count ?? 0),
    page,
    limit,
    totalPages: Math.ceil(Number(totalRow?.count ?? 0) / limit),
  };
}

// =============================================================
// 8. QUERY: Detail Draft Beserta Seluruh Items
// =============================================================

export async function getStockReceiveDraftDetail(
  draftId: string,
  requesterEmployeeId?: string,
) {
  const [draft] = await db
    .select({
      id: stockReceiveDrafts.id,
      receiveNumber: stockReceiveDrafts.receiveNumber,
      createdByEmployeeId: stockReceiveDrafts.createdByEmployeeId,
      supplierId: stockReceiveDrafts.supplierId,
      supplierName: suppliers.name,
      deliveryNote: stockReceiveDrafts.deliveryNote,
      invoiceDate: stockReceiveDrafts.invoiceDate,
      invoicePhotoUrl: stockReceiveDrafts.invoicePhotoUrl,
      status: stockReceiveDrafts.status,
      submittedAt: stockReceiveDrafts.submittedAt,
      approvedAt: stockReceiveDrafts.approvedAt,
      rejectedAt: stockReceiveDrafts.rejectedAt,
      approvedByAdminId: stockReceiveDrafts.approvedByAdminId,
      rejectedByAdminId: stockReceiveDrafts.rejectedByAdminId,
      managerNote: stockReceiveDrafts.managerNote,
      createdAt: stockReceiveDrafts.createdAt,
      updatedAt: stockReceiveDrafts.updatedAt,
      creatorName: employees.fullName,
      creatorNim: employees.nim,
    })
    .from(stockReceiveDrafts)
    .innerJoin(employees, eq(stockReceiveDrafts.createdByEmployeeId, employees.id))
    .leftJoin(suppliers, eq(stockReceiveDrafts.supplierId, suppliers.id))
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!draft) {
    throw new AppError('NOT_FOUND', 'Penerimaan barang tidak ditemukan.', 404);
  }

  // IDOR Guard jika diakses dari sisi gudang
  if (requesterEmployeeId && draft.createdByEmployeeId !== requesterEmployeeId) {
    throw new AppError('FORBIDDEN', 'Anda tidak memiliki hak akses melihat data ini.', 403);
  }

  const items = await db
    .select({
      id: stockReceiveItems.id,
      productId: stockReceiveItems.productId,
      productName: products.name,
      productIsActive: products.isActive,
      productSellingPrice: products.sellingPrice,
      productBarcode: products.barcode,
      productUnit: products.unit,
      productIsPerishable: products.isPerishable,
      productCategoryName: categories.name,
      batchCode: stockReceiveItems.batchCode,
      qty: stockReceiveItems.qty,
      costPrice: stockReceiveItems.costPrice,
      expiryDate: stockReceiveItems.expiryDate,
      conditionNote: stockReceiveItems.conditionNote,
      createdAt: stockReceiveItems.createdAt,
    })
    .from(stockReceiveItems)
    .innerJoin(products, eq(stockReceiveItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(stockReceiveItems.draftId, draftId))
    .orderBy(stockReceiveItems.createdAt);

  return {
    ...draft,
    items,
  };
}

// =============================================================
// 9. QUERY: Tabel Buku Nota Supplier Lengkap (Spreadsheet View)
// =============================================================

export type SupplierInvoiceTableRowDTO = {
  itemId: string;
  draftId: string;
  receiveNumber: string;
  invoiceDate: string;
  deliveryNote: string | null;
  invoicePhotoUrl: string | null;
  status: StockReceiveDraft['status'];
  supplierName: string;
  productId: string;
  productName: string;
  batchCode: string;
  qty: number;
  costPrice: number;
  totalPrice: number;
  expiryDate: string | null;
  conditionNote: string | null;
  creatorName: string;
  createdAt: string;
};

export async function getSupplierInvoiceTableRows(options: {
  employeeId?: string;
  status?: string;
  limit?: number;
}): Promise<SupplierInvoiceTableRowDTO[]> {
  const { employeeId, status, limit = 150 } = options;
  const conditions = [isNull(stockReceiveDrafts.deletedAt)];

  if (employeeId) {
    conditions.push(eq(stockReceiveDrafts.createdByEmployeeId, employeeId));
  }
  if (status && status !== 'SEMUA') {
    conditions.push(eq(stockReceiveDrafts.status, status as StockReceiveDraft['status']));
  }

  const rows = await db
    .select({
      itemId: stockReceiveItems.id,
      draftId: stockReceiveDrafts.id,
      receiveNumber: stockReceiveDrafts.receiveNumber,
      invoiceDate: stockReceiveDrafts.invoiceDate,
      deliveryNote: stockReceiveDrafts.deliveryNote,
      invoicePhotoUrl: stockReceiveDrafts.invoicePhotoUrl,
      status: stockReceiveDrafts.status,
      supplierName: suppliers.name,
      productId: stockReceiveItems.productId,
      productName: products.name,
      batchCode: stockReceiveItems.batchCode,
      qty: stockReceiveItems.qty,
      costPrice: stockReceiveItems.costPrice,
      expiryDate: stockReceiveItems.expiryDate,
      conditionNote: stockReceiveItems.conditionNote,
      creatorName: employees.fullName,
      createdAt: stockReceiveDrafts.createdAt,
    })
    .from(stockReceiveItems)
    .innerJoin(stockReceiveDrafts, eq(stockReceiveItems.draftId, stockReceiveDrafts.id))
    .innerJoin(products, eq(stockReceiveItems.productId, products.id))
    .innerJoin(employees, eq(stockReceiveDrafts.createdByEmployeeId, employees.id))
    .leftJoin(suppliers, eq(stockReceiveDrafts.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(stockReceiveDrafts.createdAt), stockReceiveItems.createdAt)
    .limit(Math.min(Math.max(1, limit), 300));

  return rows.map((r) => {
    const costNum = Number(r.costPrice ?? 0);
    const fallbackDate = r.createdAt
      ? new Date(r.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
      : '';
    return {
      itemId: r.itemId,
      draftId: r.draftId,
      receiveNumber: r.receiveNumber,
      invoiceDate: r.invoiceDate || fallbackDate,
      deliveryNote: r.deliveryNote ?? null,
      invoicePhotoUrl: r.invoicePhotoUrl ?? null,
      status: r.status,
      supplierName: r.supplierName || 'Supplier Umum',
      productId: r.productId,
      productName: r.productName,
      batchCode: r.batchCode,
      qty: r.qty,
      costPrice: costNum,
      totalPrice: r.qty * costNum,
      expiryDate: r.expiryDate ?? null,
      conditionNote: r.conditionNote ?? null,
      creatorName: r.creatorName,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
    };
  });
}
