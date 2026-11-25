// =============================================================
// Smartkasir Perwira — Purchase Receipt Archive Service
// Arsip Nota Belanja, Reseller, Operasional & Buku Historis
//
// Zero-Trust RBAC:
//   - MANAGER     : Full akses (KPI nominal, upload, edit, verifikasi,
//                   sinkronisasi ke operating_expenses, soft-delete)
//   - ADMIN_SHIFT : Upload foto + keterangan & lihat galeri arsip
//                   (tanpa agregat KPI finansial Manager)
//   - GUDANG      : Upload foto + keterangan & lihat galeri arsip
//                   (proteksi HPP: nominal & KPI tidak diekspos)
// =============================================================

import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  auditLogs,
  dailyClosings,
  employees,
  EXPENSE_CATEGORIES,
  operatingExpenses,
  PURCHASE_RECEIPT_CATEGORIES,
  purchaseReceiptArchives,
  type ExpenseCategory,
  type PurchaseReceiptCategory,
  type PurchaseReceiptUploaderRole,
} from '@/lib/db/schema';
import { verifyToken } from '@/lib/utils/auth';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { AppError, getTodayWib } from '@/lib/utils/helpers';

export const RECEIPT_BUCKET = 'purchase-receipts';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB raw -> WebP compressed
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const FINANCIAL_CATEGORIES: readonly PurchaseReceiptCategory[] = [
  'BELANJA_STOK',
  'RESELLER_LUNAS',
  'OPERASIONAL',
  'TITIPAN_MITRA',
  'CAMPURAN',
];

export type NotaPortalScope = 'MANAGER' | 'ADMIN_SHIFT' | 'GUDANG';

export type AuthorizedNotaActor = {
  role: NotaPortalScope;
  viewScope: NotaPortalScope;
  displayName: string;
  adminId: string | null;
  employeeId: string | null;
};

// ── Zod Schemas ───────────────────────────────────────────────

const DateStrSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal wajib YYYY-MM-DD');

export const ListReceiptsQuerySchema = z.object({
  category: z
    .union([
      z.literal('ALL'),
      z.literal('FINANCIAL'),
      z.enum(PURCHASE_RECEIPT_CATEGORIES),
    ])
    .default('FINANCIAL'),
  month: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}|ALL)$/, 'Format bulan wajib YYYY-MM atau ALL')
    .default('ALL'),
  search: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export const CreateReceiptMetaSchema = z.object({
  receiptDate: DateStrSchema.optional(),
  category: z.enum(PURCHASE_RECEIPT_CATEGORIES).default('BELANJA_STOK'),
  merchantName: z
    .string()
    .trim()
    .min(2, 'Nama toko / mitra minimal 2 karakter')
    .max(180, 'Nama toko / mitra maksimal 180 karakter'),
  invoiceNumber: z.string().trim().max(80).nullable().optional(),
  paymentStatus: z
    .enum(['LUNAS', 'BELUM_LUNAS', 'CAMPURAN', 'INFO'])
    .nullable()
    .optional(),
  totalAmount: z.coerce.number().int().min(0).max(500_000_000).default(0),
  stockAmount: z.coerce.number().int().min(0).max(500_000_000).default(0),
  operationalAmount: z.coerce.number().int().min(0).max(500_000_000).default(0),
  consignmentAmount: z.coerce.number().int().min(0).max(500_000_000).default(0),
  operationalItems: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  syncToOpex: z.boolean().default(false),
  expenseCategory: z.enum(EXPENSE_CATEGORIES).default('LAINNYA'),
});

export const PatchReceiptSchema = z.object({
  receiptDate: DateStrSchema.nullable().optional(),
  category: z.enum(PURCHASE_RECEIPT_CATEGORIES).optional(),
  merchantName: z.string().trim().min(2).max(180).optional(),
  invoiceNumber: z.string().trim().max(80).nullable().optional(),
  paymentStatus: z
    .enum(['LUNAS', 'BELUM_LUNAS', 'CAMPURAN', 'INFO'])
    .nullable()
    .optional(),
  totalAmount: z.coerce.number().int().min(0).max(500_000_000).optional(),
  stockAmount: z.coerce.number().int().min(0).max(500_000_000).optional(),
  operationalAmount: z.coerce.number().int().min(0).max(500_000_000).optional(),
  consignmentAmount: z.coerce.number().int().min(0).max(500_000_000).optional(),
  operationalItems: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isVerified: z.boolean().optional(),
  syncToOpex: z.boolean().optional(),
  expenseCategory: z.enum(EXPENSE_CATEGORIES).optional(),
});

export const DeleteReceiptSchema = z.object({
  reason: z.string().trim().min(3, 'Alasan penghapusan minimal 3 karakter').max(200).optional(),
});

export const ReceiptIdSchema = z.string().uuid('ID nota tidak valid');

// ── Role-Isolated Session Resolution ──────────────────────────

async function resolveAdminFromCookie(req: NextRequest): Promise<{
  id: string;
  fullName: string;
  role: 'MANAGER' | 'ADMIN_SHIFT';
} | null> {
  const token = req.cookies.get('sk_admin')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') return null;
  const adm = await db.query.admins.findFirst({
    where: and(eq(admins.id, payload.sub), eq(admins.isActive, true), isNull(admins.deletedAt)),
    columns: { id: true, fullName: true, role: true },
  });
  if (!adm) return null;
  const role: 'MANAGER' | 'ADMIN_SHIFT' = adm.role === 'MANAGER' ? 'MANAGER' : 'ADMIN_SHIFT';
  return { id: adm.id, fullName: adm.fullName, role };
}

async function resolveEmployeeFromCookie(
  req: NextRequest,
  cookieName: 'sk_gudang' | 'sk_kasir',
): Promise<{ id: string; fullName: string; nim: string } | null> {
  const token = req.cookies.get(cookieName)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'employee') return null;
  const emp = await db.query.employees.findFirst({
    where: and(eq(employees.id, payload.sub), eq(employees.isActive, true), isNull(employees.deletedAt)),
    columns: { id: true, fullName: true, nim: true },
  });
  return emp ?? null;
}

export async function resolveNotaActor(req: NextRequest): Promise<AuthorizedNotaActor> {
  const rawScope = req.headers.get('x-portal-scope')?.toLowerCase();

  if (rawScope === 'gudang') {
    const gudangEmp = await resolveEmployeeFromCookie(req, 'sk_gudang');
    if (gudangEmp) {
      return {
        role: 'GUDANG',
        viewScope: 'GUDANG',
        displayName: gudangEmp.fullName,
        adminId: null,
        employeeId: gudangEmp.id,
      };
    }
    const admin = await resolveAdminFromCookie(req);
    if (admin) {
      return {
        role: admin.role,
        viewScope: 'GUDANG',
        displayName: admin.fullName,
        adminId: admin.id,
        employeeId: null,
      };
    }
    const kasirEmp = await resolveEmployeeFromCookie(req, 'sk_kasir');
    if (kasirEmp) {
      return {
        role: 'GUDANG',
        viewScope: 'GUDANG',
        displayName: kasirEmp.fullName,
        adminId: null,
        employeeId: kasirEmp.id,
      };
    }
    throw new AppError('UNAUTHORIZED', 'Sesi Gudang tidak ditemukan. Silakan login kembali.', 401);
  }

  if (rawScope === 'manager') {
    const admin = await resolveAdminFromCookie(req);
    if (!admin) {
      throw new AppError('UNAUTHORIZED', 'Sesi Manager tidak ditemukan. Silakan login kembali.', 401);
    }
    if (admin.role !== 'MANAGER') {
      throw new AppError('FORBIDDEN', 'Akses khusus Manager (Dosen).', 403);
    }
    return {
      role: 'MANAGER',
      viewScope: 'MANAGER',
      displayName: admin.fullName,
      adminId: admin.id,
      employeeId: null,
    };
  }

  if (rawScope === 'admin') {
    const admin = await resolveAdminFromCookie(req);
    if (!admin) {
      throw new AppError('UNAUTHORIZED', 'Sesi Admin Shift tidak ditemukan. Silakan login kembali.', 401);
    }
    return {
      role: admin.role,
      viewScope: admin.role === 'MANAGER' ? 'MANAGER' : 'ADMIN_SHIFT',
      displayName: admin.fullName,
      adminId: admin.id,
      employeeId: null,
    };
  }

  // Fallback tanpa header scope: cek sk_admin dulu, lalu sk_gudang
  const admin = await resolveAdminFromCookie(req);
  if (admin) {
    return {
      role: admin.role,
      viewScope: admin.role,
      displayName: admin.fullName,
      adminId: admin.id,
      employeeId: null,
    };
  }
  const gudangEmp = await resolveEmployeeFromCookie(req, 'sk_gudang');
  if (gudangEmp) {
    return {
      role: 'GUDANG',
      viewScope: 'GUDANG',
      displayName: gudangEmp.fullName,
      adminId: null,
      employeeId: gudangEmp.id,
    };
  }

  throw new AppError('UNAUTHORIZED', 'Sesi tidak ditemukan. Silakan login kembali.', 401);
}

export async function requireManagerNotaActor(req: NextRequest): Promise<AuthorizedNotaActor & { adminId: string }> {
  const admin = await resolveAdminFromCookie(req);
  if (!admin) {
    throw new AppError('UNAUTHORIZED', 'Sesi Manager tidak ditemukan. Silakan login kembali.', 401);
  }
  if (admin.role !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Akses ditolak. Hanya Manager yang dapat mengubah atau menghapus arsip nota.', 403);
  }
  return {
    role: 'MANAGER',
    viewScope: 'MANAGER',
    displayName: admin.fullName,
    adminId: admin.id,
    employeeId: null,
  };
}

// ── Month Boundary Helper ─────────────────────────────────────

function getMonthRange(monthStr: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) return null;
  const [yStr, mStr] = monthStr.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${yStr}-${mStr}-01`,
    end: `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
  };
}

// ── List Receipts (Role-Projected) ────────────────────────────

export type ReceiptListItemDTO = {
  id: string;
  receiptDate: string | null;
  category: PurchaseReceiptCategory;
  merchantName: string;
  invoiceNumber: string | null;
  paymentStatus: string | null;
  totalAmount: number | null;
  stockAmount: number | null;
  operationalAmount: number | null;
  consignmentAmount: number | null;
  operationalItems: string | null;
  description: string | null;
  sourceFolder: string | null;
  sourceFilename: string | null;
  imageUrl: string | null;
  uploadedByRole: PurchaseReceiptUploaderRole;
  uploadedByName: string;
  linkedExpenseId: string | null;
  isVerified: boolean;
  createdAt: string;
};

export type ManagerReceiptSummaryDTO = {
  totalReceipts: number;
  totalBelanjaStok: number;
  totalReseller: number;
  totalOperasional: number;
  totalTitipan: number;
  syncedOpexCount: number;
};

export async function listPurchaseReceipts(
  actor: AuthorizedNotaActor,
  rawQuery: z.infer<typeof ListReceiptsQuerySchema>,
) {
  const isManagerView = actor.role === 'MANAGER' && actor.viewScope === 'MANAGER';
  const showSingleAmount = actor.role === 'MANAGER' || actor.role === 'ADMIN_SHIFT';
  const hideFinancialAmounts = actor.viewScope === 'GUDANG' || !showSingleAmount;

  const baseFilters = [isNull(purchaseReceiptArchives.deletedAt)];

  const monthRange = rawQuery.month !== 'ALL' ? getMonthRange(rawQuery.month) : null;
  if (monthRange) {
    baseFilters.push(
      gte(purchaseReceiptArchives.receiptDate, monthRange.start),
      lte(purchaseReceiptArchives.receiptDate, monthRange.end),
    );
  }

  if (rawQuery.search) {
    const pattern = `%${rawQuery.search}%`;
    const searchCond = or(
      ilike(purchaseReceiptArchives.merchantName, pattern),
      ilike(purchaseReceiptArchives.description, pattern),
      ilike(purchaseReceiptArchives.invoiceNumber, pattern),
      ilike(purchaseReceiptArchives.operationalItems, pattern),
      ilike(purchaseReceiptArchives.uploadedByName, pattern),
    );
    if (searchCond) baseFilters.push(searchCond);
  }

  const pageFilters = [...baseFilters];
  if (rawQuery.category === 'FINANCIAL') {
    pageFilters.push(inArray(purchaseReceiptArchives.category, [...FINANCIAL_CATEGORIES]));
  } else if (rawQuery.category !== 'ALL') {
    pageFilters.push(eq(purchaseReceiptArchives.category, rawQuery.category));
  }

  const offset = (rawQuery.page - 1) * rawQuery.limit;

  const [rows, countRows, catRows, monthRows] = await Promise.all([
    db
      .select()
      .from(purchaseReceiptArchives)
      .where(and(...pageFilters))
      .orderBy(
        sql`${purchaseReceiptArchives.receiptDate} DESC NULLS LAST`,
        desc(purchaseReceiptArchives.createdAt),
      )
      .limit(rawQuery.limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(purchaseReceiptArchives)
      .where(and(...pageFilters)),
    db
      .select({
        category: purchaseReceiptArchives.category,
        cnt: sql<number>`count(*)::int`,
        sumTotal: sql<number>`COALESCE(SUM(${purchaseReceiptArchives.totalAmount}), 0)::bigint`,
        sumStock: sql<number>`COALESCE(SUM(${purchaseReceiptArchives.stockAmount}), 0)::bigint`,
        sumOpex: sql<number>`COALESCE(SUM(${purchaseReceiptArchives.operationalAmount}), 0)::bigint`,
        sumConsign: sql<number>`COALESCE(SUM(${purchaseReceiptArchives.consignmentAmount}), 0)::bigint`,
        syncedCnt: sql<number>`COUNT(${purchaseReceiptArchives.linkedExpenseId})::int`,
      })
      .from(purchaseReceiptArchives)
      .where(and(...baseFilters))
      .groupBy(purchaseReceiptArchives.category),
    db
      .select({
        month: sql<string>`to_char(${purchaseReceiptArchives.receiptDate}, 'YYYY-MM')`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(purchaseReceiptArchives)
      .where(
        and(
          isNull(purchaseReceiptArchives.deletedAt),
          sql`${purchaseReceiptArchives.receiptDate} IS NOT NULL`,
        ),
      )
      .groupBy(sql`to_char(${purchaseReceiptArchives.receiptDate}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${purchaseReceiptArchives.receiptDate}, 'YYYY-MM') DESC`),
  ]);

  const totalCount = countRows[0]?.total ?? 0;

  const categoryCounts: Record<string, number> = {
    ALL: 0,
    FINANCIAL: 0,
  };
  let totalBelanjaStok = 0;
  let totalReseller = 0;
  let totalOperasional = 0;
  let totalTitipan = 0;
  let syncedOpexCount = 0;

  for (const c of catRows) {
    categoryCounts[c.category] = c.cnt;
    categoryCounts.ALL += c.cnt;
    if (FINANCIAL_CATEGORIES.includes(c.category as PurchaseReceiptCategory)) {
      categoryCounts.FINANCIAL += c.cnt;
    }
    syncedOpexCount += c.syncedCnt;
    if (c.category === 'BELANJA_STOK') {
      totalBelanjaStok += Number(c.sumStock) || Number(c.sumTotal);
    } else if (c.category === 'RESELLER_LUNAS') {
      totalReseller += Number(c.sumStock) || Number(c.sumTotal);
    } else if (c.category === 'CAMPURAN') {
      totalBelanjaStok += Number(c.sumStock);
      totalOperasional += Number(c.sumOpex);
      totalTitipan += Number(c.sumConsign);
    } else if (c.category === 'OPERASIONAL') {
      totalOperasional += Number(c.sumOpex) || Number(c.sumTotal);
    } else if (c.category === 'TITIPAN_MITRA') {
      totalTitipan += Number(c.sumConsign) || Number(c.sumTotal);
    }
  }

  const items: ReceiptListItemDTO[] = rows.map((r) => ({
    id: r.id,
    receiptDate: r.receiptDate,
    category: r.category,
    merchantName: r.merchantName,
    invoiceNumber: r.invoiceNumber,
    paymentStatus: r.paymentStatus,
    totalAmount: hideFinancialAmounts ? null : r.totalAmount,
    stockAmount: isManagerView ? r.stockAmount : null,
    operationalAmount: isManagerView ? r.operationalAmount : null,
    consignmentAmount: isManagerView ? r.consignmentAmount : null,
    operationalItems: r.operationalItems,
    description: r.description,
    sourceFolder: isManagerView ? r.sourceFolder : null,
    sourceFilename: isManagerView ? r.sourceFilename : null,
    imageUrl: r.imageUrl,
    uploadedByRole: r.uploadedByRole,
    uploadedByName: r.uploadedByName,
    linkedExpenseId: isManagerView ? r.linkedExpenseId : null,
    isVerified: r.isVerified,
    createdAt: r.createdAt.toISOString(),
  }));

  const summary: ManagerReceiptSummaryDTO | null = isManagerView
    ? {
        totalReceipts: categoryCounts.ALL,
        totalBelanjaStok,
        totalReseller,
        totalOperasional,
        totalTitipan,
        syncedOpexCount,
      }
    : null;

  return {
    viewerRole: actor.viewScope,
    canManage: isManagerView,
    items,
    pagination: {
      page: rawQuery.page,
      limit: rawQuery.limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / rawQuery.limit)),
    },
    categoryCounts,
    availableMonths: monthRows.map((m) => ({ month: m.month, count: m.cnt })),
    summary,
  };
}

// ── Upload & Create Receipt ───────────────────────────────────

export async function createPurchaseReceipt(
  actor: AuthorizedNotaActor,
  fotoFile: File,
  meta: z.infer<typeof CreateReceiptMetaSchema>,
) {
  if (!ALLOWED_MIME.has(fotoFile.type.toLowerCase())) {
    throw new AppError('INVALID_FILE_TYPE', 'Format gambar harus JPEG, PNG, atau WebP.', 400);
  }
  if (fotoFile.size <= 0 || fotoFile.size > MAX_UPLOAD_BYTES) {
    throw new AppError('INVALID_FILE_SIZE', 'Ukuran file foto wajib antara 1 byte hingga 15MB.', 400);
  }

  const rawBuffer = Buffer.from(await fotoFile.arrayBuffer());
  let webpBuffer: Buffer;
  try {
    webpBuffer = await sharp(rawBuffer)
      .rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    throw new AppError('INVALID_IMAGE', 'File gambar rusak atau tidak dapat diproses.', 400);
  }

  const receiptDate = meta.receiptDate || getTodayWib();
  const monthPrefix = receiptDate.slice(0, 7);
  const fileId = randomUUID();
  const storagePath = `uploads/${monthPrefix}/${fileId}.webp`;

  const supabase = getSupabaseAdmin();
  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(storagePath, webpBuffer, {
      contentType: 'image/webp',
      upsert: false,
    });

  if (uploadError) {
    throw new AppError('STORAGE_UPLOAD_FAILED', `Gagal mengunggah gambar nota: ${uploadError.message}`, 500);
  }

  const { data: urlData } = supabase.storage.from(RECEIPT_BUCKET).getPublicUrl(storagePath);
  const imageUrl = urlData.publicUrl;

  const isManager = actor.role === 'MANAGER';
  const effectiveOpexAmount =
    meta.operationalAmount > 0
      ? meta.operationalAmount
      : meta.category === 'OPERASIONAL'
      ? meta.totalAmount
      : 0;
  const effectiveStockAmount =
    meta.stockAmount > 0
      ? meta.stockAmount
      : meta.category === 'BELANJA_STOK' || meta.category === 'RESELLER_LUNAS'
      ? meta.totalAmount
      : 0;
  const effectiveConsignAmount =
    meta.consignmentAmount > 0
      ? meta.consignmentAmount
      : meta.category === 'TITIPAN_MITRA'
      ? meta.totalAmount
      : 0;

  const uploaderRole: PurchaseReceiptUploaderRole =
    actor.viewScope === 'GUDANG' && !actor.adminId
      ? 'GUDANG'
      : actor.role === 'MANAGER'
      ? 'MANAGER'
      : actor.role === 'ADMIN_SHIFT'
      ? 'ADMIN_SHIFT'
      : 'GUDANG';

  const created = await db.transaction(async (tx) => {
    let linkedExpenseId: string | null = null;

    if (isManager && actor.adminId && meta.syncToOpex && effectiveOpexAmount > 0) {
      const closedDay = await tx.query.dailyClosings.findFirst({
        where: eq(dailyClosings.closingDate, receiptDate),
        columns: { status: true },
      });
      if (closedDay && (closedDay.status === 'LOCKED' || closedDay.status === 'AUDITED')) {
        throw new AppError(
          'PERIOD_LOCKED',
          `Tanggal ${receiptDate} sudah dikunci oleh Tutup Buku Harian (${closedDay.status}). Tidak dapat mencatat biaya operasional baru pada tanggal ini.`,
          409,
        );
      }

      const expDesc = (
        meta.operationalItems?.trim() ||
        meta.description?.trim() ||
        `Biaya operasional — ${meta.merchantName}`
      ).slice(0, 200);

      const [exp] = await tx
        .insert(operatingExpenses)
        .values({
          expenseDate: receiptDate,
          category: meta.expenseCategory,
          description: expDesc,
          amount: effectiveOpexAmount,
          createdByAdminId: actor.adminId,
        })
        .returning({ id: operatingExpenses.id });

      linkedExpenseId = exp?.id ?? null;
    }

    const [inserted] = await tx
      .insert(purchaseReceiptArchives)
      .values({
        receiptDate,
        category: meta.category,
        merchantName: meta.merchantName,
        invoiceNumber: meta.invoiceNumber ?? null,
        paymentStatus: meta.paymentStatus ?? 'LUNAS',
        totalAmount: meta.totalAmount,
        stockAmount: effectiveStockAmount,
        operationalAmount: effectiveOpexAmount,
        consignmentAmount: effectiveConsignAmount,
        operationalItems: meta.operationalItems ?? null,
        description: meta.description ?? null,
        imageUrl,
        uploadedByRole: uploaderRole,
        uploadedByName: actor.displayName,
        uploadedByAdminId: actor.adminId,
        uploadedByEmployeeId: actor.employeeId,
        linkedExpenseId,
        isVerified: isManager,
        verifiedByAdminId: isManager ? actor.adminId : null,
        verifiedAt: isManager ? new Date() : null,
      })
      .returning();

    const auditActorId = actor.adminId ?? actor.employeeId;
    if (inserted && auditActorId) {
      await tx.insert(auditLogs).values({
        tableName: 'purchase_receipt_archives',
        recordId: inserted.id,
        action: 'INSERT',
        newValues: JSON.stringify({
          receiptDate,
          category: meta.category,
          merchantName: meta.merchantName,
          totalAmount: meta.totalAmount,
          uploadedByRole: uploaderRole,
          linkedExpenseId,
        }),
        actorType: actor.adminId ? 'ADMIN' : 'EMPLOYEE',
        actorId: auditActorId,
      });
    }

    return inserted;
  });

  return created;
}

// ── Manager-Only Update & Opex Sync ───────────────────────────

export async function updatePurchaseReceipt(
  manager: AuthorizedNotaActor & { adminId: string },
  id: string,
  patch: z.infer<typeof PatchReceiptSchema>,
) {
  return db.transaction(async (tx) => {
    const existing = await tx.query.purchaseReceiptArchives.findFirst({
      where: and(eq(purchaseReceiptArchives.id, id), isNull(purchaseReceiptArchives.deletedAt)),
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Arsip nota tidak ditemukan.', 404);
    }

    const nextReceiptDate = patch.receiptDate !== undefined ? patch.receiptDate : existing.receiptDate;
    const nextCategory = patch.category ?? existing.category;
    const nextMerchant = patch.merchantName ?? existing.merchantName;
    const nextTotal = patch.totalAmount ?? existing.totalAmount;
    const nextOpexAmt = patch.operationalAmount ?? existing.operationalAmount;
    const nextOpexItems = patch.operationalItems !== undefined ? patch.operationalItems : existing.operationalItems;
    const nextDesc = patch.description !== undefined ? patch.description : existing.description;

    let nextLinkedExpenseId = existing.linkedExpenseId;
    if (patch.syncToOpex && !existing.linkedExpenseId) {
      const amountToSync = nextOpexAmt > 0 ? nextOpexAmt : nextTotal;
      if (amountToSync <= 0) {
        throw new AppError('INVALID_AMOUNT', 'Nominal operasional wajib lebih dari Rp 0 untuk disinkronkan ke Biaya Operasional.', 400);
      }
      const targetExpDate = nextReceiptDate ?? getTodayWib();
      const closedDay = await tx.query.dailyClosings.findFirst({
        where: eq(dailyClosings.closingDate, targetExpDate),
        columns: { status: true },
      });
      if (closedDay && (closedDay.status === 'LOCKED' || closedDay.status === 'AUDITED')) {
        throw new AppError(
          'PERIOD_LOCKED',
          `Tanggal ${targetExpDate} sudah dikunci oleh Tutup Buku Harian (${closedDay.status}).`,
          409,
        );
      }
      const expCat: ExpenseCategory = patch.expenseCategory ?? 'LAINNYA';
      const expDesc = (nextOpexItems?.trim() || nextDesc?.trim() || `Nota ${nextMerchant}`).slice(0, 200);
      const [exp] = await tx
        .insert(operatingExpenses)
        .values({
          expenseDate: targetExpDate,
          category: expCat,
          description: expDesc,
          amount: amountToSync,
          createdByAdminId: manager.adminId,
        })
        .returning({ id: operatingExpenses.id });
      nextLinkedExpenseId = exp?.id ?? null;
    }

    const verifiedFields =
      patch.isVerified !== undefined
        ? {
            isVerified: patch.isVerified,
            verifiedByAdminId: patch.isVerified ? manager.adminId : null,
            verifiedAt: patch.isVerified ? new Date() : null,
          }
        : {};

    const [updated] = await tx
      .update(purchaseReceiptArchives)
      .set({
        receiptDate: nextReceiptDate,
        category: nextCategory,
        merchantName: nextMerchant,
        invoiceNumber: patch.invoiceNumber !== undefined ? patch.invoiceNumber : existing.invoiceNumber,
        paymentStatus: patch.paymentStatus !== undefined ? patch.paymentStatus : existing.paymentStatus,
        totalAmount: nextTotal,
        stockAmount: patch.stockAmount ?? existing.stockAmount,
        operationalAmount: nextOpexAmt,
        consignmentAmount: patch.consignmentAmount ?? existing.consignmentAmount,
        operationalItems: nextOpexItems,
        description: nextDesc,
        linkedExpenseId: nextLinkedExpenseId,
        ...verifiedFields,
        updatedAt: new Date(),
      })
      .where(eq(purchaseReceiptArchives.id, id))
      .returning();

    await tx.insert(auditLogs).values({
      tableName: 'purchase_receipt_archives',
      recordId: id,
      action: 'UPDATE',
      oldValues: JSON.stringify({
        category: existing.category,
        merchantName: existing.merchantName,
        totalAmount: existing.totalAmount,
        operationalAmount: existing.operationalAmount,
        linkedExpenseId: existing.linkedExpenseId,
        isVerified: existing.isVerified,
      }),
      newValues: JSON.stringify({
        category: updated?.category,
        merchantName: updated?.merchantName,
        totalAmount: updated?.totalAmount,
        operationalAmount: updated?.operationalAmount,
        linkedExpenseId: updated?.linkedExpenseId,
        isVerified: updated?.isVerified,
      }),
      actorType: 'ADMIN',
      actorId: manager.adminId,
    });

    return updated;
  });
}

// ── Manager-Only Soft-Delete ──────────────────────────────────

export async function softDeletePurchaseReceipt(
  manager: AuthorizedNotaActor & { adminId: string },
  id: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const existing = await tx.query.purchaseReceiptArchives.findFirst({
      where: and(eq(purchaseReceiptArchives.id, id), isNull(purchaseReceiptArchives.deletedAt)),
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Arsip nota tidak ditemukan atau sudah dihapus.', 404);
    }

    const now = new Date();
    const [deleted] = await tx
      .update(purchaseReceiptArchives)
      .set({
        deletedAt: now,
        deletedByAdminId: manager.adminId,
        deleteReason: reason,
        updatedAt: now,
      })
      .where(eq(purchaseReceiptArchives.id, id))
      .returning({ id: purchaseReceiptArchives.id, merchantName: purchaseReceiptArchives.merchantName });

    // Ikut soft-delete operating_expenses tertaut agar tidak meninggalkan biaya orphan
    if (existing.linkedExpenseId) {
      await tx
        .update(operatingExpenses)
        .set({
          deletedAt: now,
          deletedByAdminId: manager.adminId,
          deleteReason: `Arsip nota terkait dihapus: ${reason}`.slice(0, 200),
        })
        .where(and(eq(operatingExpenses.id, existing.linkedExpenseId), isNull(operatingExpenses.deletedAt)));
    }

    await tx.insert(auditLogs).values({
      tableName: 'purchase_receipt_archives',
      recordId: id,
      action: 'SOFT_DELETE',
      oldValues: JSON.stringify({
        merchantName: existing.merchantName,
        receiptDate: existing.receiptDate,
        totalAmount: existing.totalAmount,
      }),
      newValues: JSON.stringify({ deleteReason: reason }),
      actorType: 'ADMIN',
      actorId: manager.adminId,
    });

    return deleted;
  });
}
