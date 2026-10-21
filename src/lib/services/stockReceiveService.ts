// =============================================================
// src/lib/services/stockReceiveService.ts
// Domain Logic: Penerimaan Barang Masuk & 2-Layer Approval (Fase 1 Wiramart v3.0)
// STANDAR: NASA-Grade Decoupling, ACID Transaction, Zero-Trust IDOR Guard, Zero any
// =============================================================

import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  stockReceiveDrafts,
  stockReceiveItems,
  stockBatches,
  products,
  employees,
  admins,
  auditLogs,
  type StockReceiveDraft,
  type StockReceiveItem,
  type ExpiryClass,
} from '@/lib/db/schema';
import { eq, and, desc, isNull, inArray, sql, count } from 'drizzle-orm';
import { AppError } from '@/lib/utils/helpers';
import { ManagerDutyService } from '@/lib/services/managerDutyService';


// ── ZOD SCHEMAS (100% Runtime Validation) ──────────────────────

export const StockReceiveItemInputSchema = z.object({
  productId: z.string().uuid('ID produk tidak valid'),
  productName: z.string().trim().min(1, 'Nama produk wajib diisi').max(200),
  batchCode: z.string().trim().min(1, 'Kode batch wajib diisi').max(50),
  qty: z.number().int('Jumlah harus bulat').min(1, 'Jumlah minimal 1').max(100_000, 'Jumlah maksimal 100.000'),
  costPrice: z.number().min(0, 'HPP tidak boleh negatif'),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal kadaluarsa harus YYYY-MM-DD')
    .optional()
    .nullable(),
  conditionNote: z.string().trim().max(500, 'Catatan fisik maksimal 500 karakter').optional().nullable(),
});

export const CreateStockReceiveDraftSchema = z.object({
  supplierId: z.string().uuid('ID supplier tidak valid').optional().nullable(),
  supplierName: z.string().trim().max(200, 'Nama supplier maksimal 200 karakter').optional().nullable(),
  deliveryNote: z.string().trim().max(500, 'Catatan pengiriman maksimal 500 karakter').optional().nullable(),
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDateStr);
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
// 1. GUDANG: Buat Draft Penerimaan Barang
// =============================================================

export async function createStockReceiveDraft(
  employeeId: string,
  rawInput: CreateStockReceiveDraftInput,
) {
  const input = CreateStockReceiveDraftSchema.parse(rawInput);

  // Verifikasi Karyawan Aktif
  const [emp] = await db
    .select({ id: employees.id, fullName: employees.fullName, jabatan: employees.jabatan })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.isActive, true), isNull(employees.deletedAt)))
    .limit(1);

  if (!emp) {
    throw new AppError('FORBIDDEN', 'Karyawan tidak ditemukan atau nonaktif.', 403);
  }

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

  // Validasi Tanggal Expired: Produk perishable wajib ada tanggal kadaluarsa & tidak boleh masa lampau
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  for (const item of input.items) {
    const prodMeta = foundProducts.find((p) => p.id === item.productId);
    if (prodMeta?.isPerishable && !item.expiryDate) {
      throw new AppError('BAD_REQUEST', `Produk basah/perishable "${item.productName}" wajib memiliki tanggal kadaluarsa.`, 400);
    }
    if (item.expiryDate && item.expiryDate < todayStr) {
      throw new AppError('BAD_REQUEST', `Tanggal kadaluarsa "${item.productName}" (${item.expiryDate}) sudah terlewat. Tidak bisa menerima barang expired.`, 400);
    }
  }

  const receiveNumber = await generateReceiveNumber();

  // Insert Draft Header + Items Atomik
  const createdDraft = await db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(stockReceiveDrafts)
      .values({
        receiveNumber,
        createdByEmployeeId: employeeId,
        supplierId: input.supplierId || null,
        supplierName: input.supplierName?.trim() || null,
        deliveryNote: input.deliveryNote?.trim() || null,
        status: 'DRAFT',
      })
      .returning();

    const itemValues = input.items.map((it) => ({
      draftId: draft.id,
      productId: it.productId,
      productName: it.productName.trim(),
      batchCode: it.batchCode.trim(),
      qty: it.qty,
      costPrice: it.costPrice.toString(),
      expiryDate: it.expiryDate || null,
      conditionNote: it.conditionNote?.trim() || null,
    }));

    await tx.insert(stockReceiveItems).values(itemValues);

    return draft;
  });

  return getStockReceiveDraftDetail(createdDraft.id, employeeId);
}

// =============================================================
// 2. GUDANG: Update Draft (Hanya saat status DRAFT / REVISED)
// =============================================================

export async function updateStockReceiveDraft(
  draftId: string,
  employeeId: string,
  rawInput: CreateStockReceiveDraftInput,
) {
  const input = UpdateStockReceiveDraftSchema.parse(rawInput);

  const [existing] = await db
    .select()
    .from(stockReceiveDrafts)
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
  }

  // IDOR Guard
  if (existing.createdByEmployeeId !== employeeId) {
    throw new AppError('FORBIDDEN', 'Anda tidak memiliki hak akses untuk mengubah draft ini.', 403);
  }

  // Status Guard
  if (existing.status !== 'DRAFT' && existing.status !== 'REVISED') {
    throw new AppError('BAD_REQUEST', `Draft tidak dapat diubah karena berstatus ${existing.status}.`, 400);
  }

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  for (const item of input.items) {
    if (item.expiryDate && item.expiryDate < todayStr) {
      throw new AppError('BAD_REQUEST', `Tanggal kadaluarsa "${item.productName}" sudah lewat.`, 400);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(stockReceiveDrafts)
      .set({
        supplierId: input.supplierId !== undefined ? input.supplierId : undefined,
        supplierName: input.supplierName?.trim() || null,
        deliveryNote: input.deliveryNote?.trim() || null,
        status: 'DRAFT', // Reset ke DRAFT jika sebelumnya REVISED
        updatedAt: new Date(),
      })
      .where(eq(stockReceiveDrafts.id, draftId));

    // Re-insert items
    await tx.delete(stockReceiveItems).where(eq(stockReceiveItems.draftId, draftId));

    const itemValues = input.items.map((it) => ({
      draftId,
      productId: it.productId,
      productName: it.productName.trim(),
      batchCode: it.batchCode.trim(),
      qty: it.qty,
      costPrice: it.costPrice.toString(),
      expiryDate: it.expiryDate || null,
      conditionNote: it.conditionNote?.trim() || null,
    }));

    await tx.insert(stockReceiveItems).values(itemValues);
  });

  return getStockReceiveDraftDetail(draftId, employeeId);
}

// =============================================================
// 3. GUDANG: Submit Draft ke Manager untuk Approval
// =============================================================

export async function submitStockReceiveDraft(draftId: string, employeeId: string) {
  const [existing] = await db
    .select()
    .from(stockReceiveDrafts)
    .where(and(eq(stockReceiveDrafts.id, draftId), isNull(stockReceiveDrafts.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new AppError('NOT_FOUND', 'Draft penerimaan barang tidak ditemukan.', 404);
  }

  // IDOR Guard
  if (existing.createdByEmployeeId !== employeeId) {
    throw new AppError('FORBIDDEN', 'Hanya pembuat draft yang dapat mengajukan ke Manager.', 403);
  }

  if (existing.status !== 'DRAFT' && existing.status !== 'REVISED') {
    throw new AppError('BAD_REQUEST', `Draft tidak dapat disubmit karena berstatus ${existing.status}.`, 400);
  }

  // Cek minimal 1 item
  const [itemCountRow] = await db
    .select({ total: count() })
    .from(stockReceiveItems)
    .where(eq(stockReceiveItems.draftId, draftId));

  if (!itemCountRow || Number(itemCountRow.total) === 0) {
    throw new AppError('BAD_REQUEST', 'Draft penerimaan barang masih kosong, belum ada produk.', 400);
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

export async function approveStockReceiveDraft(draftId: string, managerAdminId: string) {
  // Verifikasi Manager
  const [manager] = await db
    .select({ id: admins.id, role: admins.role, fullName: admins.fullName })
    .from(admins)
    .where(and(eq(admins.id, managerAdminId), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);

  if (!manager || manager.role !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Hanya Manager (Dosen/Eksekutif) yang berwenang menyetujui penerimaan barang.', 403);
  }

  // 0. MOD Check-in Guard (PRD Wiramart v3.0 — Fase 4.1)
  // Penerimaan barang wajib disetujui di bawah pengawasan Manager on Duty yang aktif hari ini
  const todayDuty = await ManagerDutyService.getTodayDutyStatus();
  if (!todayDuty.isCheckedIn || todayDuty.isCheckedOut) {
    throw new AppError(
      'FORBIDDEN',
      'ACC belum dapat dilakukan karena belum ada Manager yang memulai Sesi Kerja Hari Ini. Silakan mulai sesi kerja terlebih dahulu melalui tombol di header.',
      403,
    );
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

    // 2. Ambil seluruh item dalam draft
    const items = await tx
      .select()
      .from(stockReceiveItems)
      .where(eq(stockReceiveItems.draftId, draftId));

    if (items.length === 0) {
      throw new AppError('BAD_REQUEST', 'Penerimaan barang tidak memiliki daftar produk.', 400);
    }

    // 3. Atomik: Masukkan tiap item ke stock_batches & tambahkan stock_qty produk
    for (const item of items) {
      const expClass = computeExpiryClass(item.expiryDate);

      // Insert baris batch baru
      await tx.insert(stockBatches).values({
        productId: item.productId,
        batchCode: item.batchCode,
        costPrice: item.costPrice,
        initialQty: item.qty,
        currentQty: item.qty,
        expiryDate: item.expiryDate || null,
        expiryClass: expClass,
        notes: `Penerimaan #${draft.receiveNumber} disetujui oleh ${manager.fullName}`,
      });

      // Update total stok produk di tabel master
      await tx
        .update(products)
        .set({
          stockQty: sql`${products.stockQty} + ${item.qty}`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, item.productId));
    }

    // 4. Update status draft ke APPROVED
    const [approvedDraft] = await tx
      .update(stockReceiveDrafts)
      .set({
        status: 'APPROVED',
        approvedByAdminId: manager.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
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

  const [rejected] = await db
    .update(stockReceiveDrafts)
    .set({
      status: 'REJECTED',
      managerNote: alasan,
      rejectedByAdminId: manager.id,
      rejectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(stockReceiveDrafts.id, draftId))
    .returning();

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
      supplierName: stockReceiveDrafts.supplierName,
      deliveryNote: stockReceiveDrafts.deliveryNote,
      status: stockReceiveDrafts.status,
      submittedAt: stockReceiveDrafts.submittedAt,
      approvedAt: stockReceiveDrafts.approvedAt,
      rejectedAt: stockReceiveDrafts.rejectedAt,
      managerNote: stockReceiveDrafts.managerNote,
      createdAt: stockReceiveDrafts.createdAt,
      creatorName: employees.fullName,
      creatorNim: employees.nim,
    })
    .from(stockReceiveDrafts)
    .innerJoin(employees, eq(stockReceiveDrafts.createdByEmployeeId, employees.id))
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
      supplierName: stockReceiveDrafts.supplierName,
      deliveryNote: stockReceiveDrafts.deliveryNote,
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
      productName: stockReceiveItems.productName,
      batchCode: stockReceiveItems.batchCode,
      qty: stockReceiveItems.qty,
      costPrice: stockReceiveItems.costPrice,
      expiryDate: stockReceiveItems.expiryDate,
      conditionNote: stockReceiveItems.conditionNote,
      createdAt: stockReceiveItems.createdAt,
    })
    .from(stockReceiveItems)
    .where(eq(stockReceiveItems.draftId, draftId))
    .orderBy(stockReceiveItems.createdAt);

  return {
    ...draft,
    items,
  };
}
