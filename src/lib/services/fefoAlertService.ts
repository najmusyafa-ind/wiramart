// =============================================================
// src/lib/services/fefoAlertService.ts
// Domain Logic: FEFO Early Warning System & To-Do List Gudang
// Transaksi ACID & Validasi FEFO
// =============================================================

import { z } from 'zod';
import { db } from '@/lib/db/client';
import {
  stockBatches,
  products,
  productConditionReports,
  discountPolicies,
  discountBarcodes,
  stockAdjustments,
  admins,
  employees,
  auditLogs,
} from '@/lib/db/schema';
import { eq, and, gt, lt, lte, isNull, desc, asc, count, or, ilike, inArray, notInArray } from 'drizzle-orm';
import {
  AppError,
  getTodayWib,
  getOffsetDateWib,
  computeFefoDiscountedPrice,
} from '@/lib/utils/helpers';

// ── TIPE DOMAIN STATUS & ENUMS ─────────────────────────────────

export type AlertLevel = 'H1_KRITIS' | 'H3_URGENT' | 'H5_WARNING' | 'H7_WATCH';
export type ConditionReportStatus =
  | 'ALERT_ONLY'
  | 'SUBMITTED'
  | 'MANAGER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'CLOSED';
export type ManagerDecision = 'DISCOUNT' | 'DISPLAY_FRONT' | 'DESTROY' | 'RETURN_SUPPLIER' | 'HOLD';

// ── ZOD SCHEMAS (100% Runtime Validation) ──────────────────────

export const SubmitConditionReportSchema = z.object({
  physicalCondition: z
    .string()
    .trim()
    .min(5, 'Deskripsi kondisi fisik minimal 5 karakter')
    .max(500, 'Deskripsi kondisi fisik maksimal 500 karakter'),
  gudangSuggestion: z.string().trim().max(500, 'Saran gudang maksimal 500 karakter').optional().nullable(),
  suggestedDiscountPct: z
    .number()
    .min(1, 'Diskon minimal 1%')
    .max(100, 'Diskon maksimal 100%')
    .optional()
    .nullable(),
});

export const ManagerDecisionSchema = z
  .object({
    decision: z.enum(['DISCOUNT', 'DISPLAY_FRONT', 'DESTROY', 'RETURN_SUPPLIER', 'HOLD']),
    approvedDiscountPct: z.number().min(1, 'Diskon minimal 1%').max(100, 'Diskon maksimal 100%').optional(),
    managerNote: z.string().trim().max(500, 'Catatan manager maksimal 500 karakter').optional().nullable(),
  })
  .refine(
    (data) => data.decision !== 'DISCOUNT' || (data.approvedDiscountPct !== undefined && data.approvedDiscountPct > 0),
    {
      message: 'Persentase diskon wajib diisi jika keputusan adalah DISCOUNT (Obral Darurat)',
      path: ['approvedDiscountPct'],
    },
  );

export const ExecuteConditionReportSchema = z.object({
  executionNote: z
    .string()
    .trim()
    .min(5, 'Catatan pelaksanaan di lapangan minimal 5 karakter')
    .max(500, 'Catatan pelaksanaan maksimal 500 karakter'),
});

export type SubmitConditionReportInput = z.infer<typeof SubmitConditionReportSchema>;
export type ManagerDecisionInput = z.infer<typeof ManagerDecisionSchema>;
export type ExecuteConditionReportInput = z.infer<typeof ExecuteConditionReportSchema>;

// ── HELPER: Hitung Hari & Klasifikasi Alert FEFO ───────────────

export function classifyAlertLevel(daysRemaining: number): AlertLevel {
  if (daysRemaining <= 1) return 'H1_KRITIS';
  if (daysRemaining <= 3) return 'H3_URGENT';
  if (daysRemaining <= 5) return 'H5_WARNING';
  return 'H7_WATCH';
}

function calculateDaysDifference(expiryDateStr: string, todayStr: string): number {
  const exp = new Date(expiryDateStr);
  const now = new Date(todayStr);
  const diffTime = exp.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// =============================================================
// 1. ENGINE: Scan & Generate FEFO Alerts (On-Demand / Cron)
// =============================================================

export async function scanAndGenerateFEFOAlerts(): Promise<{
  scannedBatches: number;
  newAlerts: number;
  updatedAlerts: number;
}> {
  const todayStr = getTodayWib();
  const in7Days = getOffsetDateWib(7);
  const now = new Date();

  // 0A. Auto-nonaktifkan seluruh kebijakan & barcode diskon yang sudah melewati masa berlaku (validUntil < todayStr)
  const expiredPolicies = await db
    .update(discountPolicies)
    .set({ isActive: false, updatedAt: now })
    .where(and(eq(discountPolicies.isActive, true), lt(discountPolicies.validUntil, todayStr)))
    .returning({ id: discountPolicies.id });

  if (expiredPolicies.length > 0) {
    await db
      .update(discountBarcodes)
      .set({ isActive: false, remainingQty: 0 })
      .where(
        and(
          inArray(
            discountBarcodes.policyId,
            expiredPolicies.map((p) => p.id),
          ),
          eq(discountBarcodes.isActive, true),
        ),
      );
  }

  // 0B. Tutup otomatis (CLOSED) alert terbuka yang batch-nya sudah berstok 0 (hapus alert hantu)
  const zeroQtyReports = await db
    .select({ id: productConditionReports.id })
    .from(productConditionReports)
    .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
    .where(
      and(
        lte(stockBatches.currentQty, 0),
        inArray(productConditionReports.status, ['ALERT_ONLY', 'SUBMITTED', 'MANAGER_REVIEW', 'APPROVED']),
      ),
    );

  if (zeroQtyReports.length > 0) {
    await db
      .update(productConditionReports)
      .set({ status: 'CLOSED', updatedAt: now })
      .where(
        inArray(
          productConditionReports.id,
          zeroQtyReports.map((r) => r.id),
        ),
      );
  }

  // 0C. Tutup otomatis (CLOSED) alert ALERT_ONLY yang tanggal expired-nya diperpanjang > 7 hari / dikosongkan
  const outOfWindowReports = await db
    .select({ id: productConditionReports.id })
    .from(productConditionReports)
    .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
    .where(
      and(
        eq(productConditionReports.status, 'ALERT_ONLY'),
        or(isNull(stockBatches.expiryDate), gt(stockBatches.expiryDate, in7Days)),
      ),
    );

  if (outOfWindowReports.length > 0) {
    await db
      .update(productConditionReports)
      .set({ status: 'CLOSED', updatedAt: now })
      .where(
        inArray(
          productConditionReports.id,
          outOfWindowReports.map((r) => r.id),
        ),
      );
  }

  // Cari seluruh batch aktif dengan sisa stok > 0 yang expired dalam <= 7 hari (atau sudah lewat)
  const expiringBatches = await db
    .select({
      batchId: stockBatches.id,
      productId: stockBatches.productId,
      currentQty: stockBatches.currentQty,
      expiryDate: stockBatches.expiryDate,
      productName: products.name,
    })
    .from(stockBatches)
    .innerJoin(products, eq(stockBatches.productId, products.id))
    .where(
      and(
        gt(stockBatches.currentQty, 0),
        lte(stockBatches.expiryDate, in7Days),
        isNull(products.deletedAt),
        eq(products.isActive, true),
      ),
    )
    .orderBy(asc(stockBatches.expiryDate));

  let newAlerts = 0;
  let updatedAlerts = 0;

  for (const b of expiringBatches) {
    if (!b.expiryDate) continue;

    const daysRemaining = calculateDaysDifference(b.expiryDate, todayStr);
    const alertLevel = classifyAlertLevel(daysRemaining);
    const isAlreadyExpired = b.expiryDate < todayStr;

    // Cek apakah batch sudah memiliki condition report
    const [existingReport] = await db
      .select({
        id: productConditionReports.id,
        status: productConditionReports.status,
        managerDecision: productConditionReports.managerDecision,
      })
      .from(productConditionReports)
      .where(eq(productConditionReports.batchId, b.batchId))
      .limit(1);

    if (!existingReport) {
      // Buat alert baru status ALERT_ONLY
      await db.insert(productConditionReports).values({
        batchId: b.batchId,
        alertLevel,
        qtyAtAlert: b.currentQty,
        daysRemainingAtAlert: daysRemaining,
        status: 'ALERT_ONLY',
      });
      newAlerts++;
    } else if (existingReport.status === 'ALERT_ONLY' || existingReport.status === 'CLOSED') {
      // Update / buka kembali alert jika hari berkurang atau batch masuk jendela FEFO kembali
      await db
        .update(productConditionReports)
        .set({
          status: 'ALERT_ONLY',
          alertLevel,
          qtyAtAlert: b.currentQty,
          daysRemainingAtAlert: daysRemaining,
          updatedAt: now,
        })
        .where(eq(productConditionReports.id, existingReport.id));
      updatedAlerts++;
    } else if (
      isAlreadyExpired &&
      existingReport.status === 'APPROVED' &&
      (existingReport.managerDecision === 'DISCOUNT' || existingReport.managerDecision === 'DISPLAY_FRONT')
    ) {
      // Jika sebelumnya disetujui DISKON/DISPLAY_FRONT tetapi kini SUDAH EXPIRED dan masih ada stok -> cabut diskon & wajib tarik/musnahkan
      await db
        .update(productConditionReports)
        .set({
          status: 'ALERT_ONLY',
          alertLevel: 'H1_KRITIS',
          qtyAtAlert: b.currentQty,
          daysRemainingAtAlert: daysRemaining,
          managerDecision: null,
          approvedDiscountPct: null,
          managerNote: '[AUTO-BLOKIR EXPIRED] Batch melewati tanggal kedaluwarsa. Diskon dinonaktifkan otomatis; wajib tarik & musnahkan/retur.',
          updatedAt: now,
        })
        .where(eq(productConditionReports.id, existingReport.id));
      updatedAlerts++;
    }
  }

  return {
    scannedBatches: expiringBatches.length,
    newAlerts,
    updatedAlerts,
  };
}

// =============================================================
// ── BIDIRECTIONAL ALERT LEVEL MAPPING ─────────────────────────
export function mapToDbAlertLevel(level?: string): AlertLevel | undefined {
  if (!level || level === 'semua') return undefined;
  const upper = level.toUpperCase().trim();
  if (upper === 'H1' || upper === 'H1_KRITIS') return 'H1_KRITIS';
  if (upper === 'H3' || upper === 'H3_URGENT') return 'H3_URGENT';
  if (upper === 'H5' || upper === 'H5_WARNING') return 'H5_WARNING';
  if (upper === 'H7' || upper === 'H7_WATCH') return 'H7_WATCH';
  return undefined;
}

export function mapToClientAlertLevel(dbLevel: string): 'H1' | 'H3' | 'H5' | 'H7' {
  if (dbLevel.startsWith('H1')) return 'H1';
  if (dbLevel.startsWith('H3')) return 'H3';
  if (dbLevel.startsWith('H5')) return 'H5';
  if (dbLevel.startsWith('H7')) return 'H7';
  return 'H7';
}

// 2. QUERY: To-Do List Gudang & Antrian Laporan Kondisi
// =============================================================

export async function getConditionReports(options: {
  status?: string;
  alertLevel?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { status, alertLevel, search, page = 1, limit = 20 } = options;
  const offset = (Math.max(1, page) - 1) * limit;
  const todayStr = getTodayWib();

  const conditions = [isNull(products.deletedAt), eq(products.isActive, true)];

  if (status && status !== 'semua') {
    conditions.push(eq(productConditionReports.status, status as ConditionReportStatus));
    if (status !== 'EXECUTED' && status !== 'CLOSED') {
      conditions.push(gt(stockBatches.currentQty, 0));
    }
  } else {
    // Default "semua" hanya tampilkan alert aktif berstok > 0 dan non-CLOSED (hilangkan alert hantu 0 pcs)
    conditions.push(notInArray(productConditionReports.status, ['CLOSED']));
    conditions.push(
      or(
        gt(stockBatches.currentQty, 0),
        eq(productConditionReports.status, 'EXECUTED'),
      )!,
    );
  }

  const dbAlertLevel = mapToDbAlertLevel(alertLevel);
  if (dbAlertLevel) {
    conditions.push(eq(productConditionReports.alertLevel, dbAlertLevel));
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    const searchCond = or(ilike(products.name, q), ilike(stockBatches.batchCode, q));
    if (searchCond) conditions.push(searchCond);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(productConditionReports)
    .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
    .innerJoin(products, eq(stockBatches.productId, products.id))
    .where(whereClause);

  const rows = await db
    .select({
      id: productConditionReports.id,
      batchId: productConditionReports.batchId,
      productId: stockBatches.productId,
      productName: products.name,
      productUnit: products.unit,
      sellingPrice: products.sellingPrice,
      batchCode: stockBatches.batchCode,
      currentBatchQty: stockBatches.currentQty,
      alertLevel: productConditionReports.alertLevel,
      qtyAtAlert: productConditionReports.qtyAtAlert,
      expiryDate: stockBatches.expiryDate,
      daysRemainingAtAlert: productConditionReports.daysRemainingAtAlert,
      status: productConditionReports.status,
      physicalCondition: productConditionReports.physicalCondition,
      gudangSuggestion: productConditionReports.gudangSuggestion,
      suggestedDiscountPct: productConditionReports.suggestedDiscountPct,
      submittedAt: productConditionReports.submittedAt,
      managerDecision: productConditionReports.managerDecision,
      approvedDiscountPct: productConditionReports.approvedDiscountPct,
      managerNote: productConditionReports.managerNote,
      decidedAt: productConditionReports.decidedAt,
      executedAt: productConditionReports.executedAt,
      executionNote: productConditionReports.executionNote,
      createdAt: productConditionReports.createdAt,
    })
    .from(productConditionReports)
    .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
    .innerJoin(products, eq(stockBatches.productId, products.id))
    .where(whereClause)
    .orderBy(
      // Prioritaskan alert terparah H1 -> H3 -> H5 -> H7
      asc(stockBatches.expiryDate),
      desc(productConditionReports.createdAt),
    )
    .limit(limit)
    .offset(offset);

  const reportIds = rows.map((r) => r.id);
  const barcodeRows =
    reportIds.length > 0
      ? await db
          .select({
            conditionReportId: discountPolicies.conditionReportId,
            barcode: discountBarcodes.barcode,
          })
          .from(discountPolicies)
          .innerJoin(discountBarcodes, eq(discountBarcodes.policyId, discountPolicies.id))
          .where(inArray(discountPolicies.conditionReportId, reportIds))
          .orderBy(desc(discountBarcodes.createdAt))
      : [];

  const barcodeByReportId = new Map<string, string>();
  for (const b of barcodeRows) {
    if (!barcodeByReportId.has(b.conditionReportId)) {
      barcodeByReportId.set(b.conditionReportId, b.barcode);
    }
  }

  const formattedRows = rows.map((r) => {
    const liveDaysRemaining = r.expiryDate
      ? calculateDaysDifference(r.expiryDate, todayStr)
      : r.daysRemainingAtAlert;
    const isExpired = Boolean(r.expiryDate && r.expiryDate < todayStr);
    const effectiveLevel = isExpired ? 'H1' : mapToClientAlertLevel(r.alertLevel);
    return {
      ...r,
      alertLevel: effectiveLevel,
      daysRemainingAtAlert: liveDaysRemaining,
      isExpired,
      discountBarcode: barcodeByReportId.get(r.id) ?? null,
    };
  });

  return {
    items: formattedRows,
    total: Number(totalRow?.count ?? 0),
    page,
    limit,
    totalPages: Math.ceil(Number(totalRow?.count ?? 0) / limit),
  };
}

// =============================================================
// 3. GUDANG: Submit Laporan Kondisi Fisik & Usulan Tindakan
// =============================================================

export async function submitConditionReport(
  reportId: string,
  employeeId: string,
  rawInput: SubmitConditionReportInput,
) {
  const input = SubmitConditionReportSchema.parse(rawInput);

  const [emp] = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.isActive, true), isNull(employees.deletedAt)))
    .limit(1);

  if (!emp) {
    throw new AppError('FORBIDDEN', 'Akun petugas gudang tidak aktif.', 403);
  }

  const [report] = await db
    .select()
    .from(productConditionReports)
    .where(eq(productConditionReports.id, reportId))
    .limit(1);

  if (!report) {
    throw new AppError('NOT_FOUND', 'Laporan kondisi FEFO tidak ditemukan.', 404);
  }

  if (report.status !== 'ALERT_ONLY' && report.status !== 'REJECTED') {
    throw new AppError(
      'BAD_REQUEST',
      `Laporan tidak dapat diajukan kembali karena berstatus ${report.status}.`,
      400,
    );
  }

  // Guard Expired: Blokir usulan DISKON / DISPLAY untuk batch yang sudah kedaluwarsa
  const [batch] = await db
    .select({ id: stockBatches.id, currentQty: stockBatches.currentQty, expiryDate: stockBatches.expiryDate })
    .from(stockBatches)
    .where(eq(stockBatches.id, report.batchId))
    .limit(1);

  if (!batch || batch.currentQty <= 0) {
    throw new AppError('BAD_REQUEST', 'Stok batch ini sudah 0 unit sehingga tidak memerlukan pelaporan lagi.', 400);
  }

  const todayStr = getTodayWib();
  const isAlreadyExpired = Boolean(batch.expiryDate && batch.expiryDate < todayStr);
  const suggestionUpper = (input.gudangSuggestion || '').trim().toUpperCase();

  if (isAlreadyExpired) {
    if (
      suggestionUpper === 'DISCOUNT' ||
      suggestionUpper === 'RELOCATE' ||
      suggestionUpper === 'DISPLAY_FRONT' ||
      suggestionUpper.includes('DISKON') ||
      suggestionUpper.includes('DISPLAY') ||
      suggestionUpper.includes('RAK DEPAN') ||
      (input.suggestedDiscountPct !== null && input.suggestedDiscountPct !== undefined && input.suggestedDiscountPct > 0)
    ) {
      throw new AppError(
        'BAD_REQUEST',
        'Batch ini SUDAH KEDALUWARSA. Barang kedaluwarsa DILARANG diusulkan diskon atau dipajang; pilih Musnahkan (DISPOSE) atau Retur Supplier (RETURN).',
        400,
      );
    }
  }

  const [updated] = await db
    .update(productConditionReports)
    .set({
      status: 'SUBMITTED',
      physicalCondition: input.physicalCondition.trim(),
      gudangSuggestion: input.gudangSuggestion?.trim() || null,
      suggestedDiscountPct:
        !isAlreadyExpired && input.suggestedDiscountPct
          ? input.suggestedDiscountPct.toString()
          : null,
      submittedByEmployeeId: emp.id,
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(productConditionReports.id, reportId))
    .returning();

  return updated;
}

// =============================================================
// 4. MANAGER ONLY: Tetapkan Keputusan & Generate Barcode Diskon
// =============================================================

export async function decideConditionReport(
  reportId: string,
  managerAdminId: string,
  rawInput: ManagerDecisionInput,
) {
  const input = ManagerDecisionSchema.parse(rawInput);

  const [manager] = await db
    .select({ id: admins.id, role: admins.role, fullName: admins.fullName })
    .from(admins)
    .where(and(eq(admins.id, managerAdminId), eq(admins.isActive, true), isNull(admins.deletedAt)))
    .limit(1);

  if (!manager || (manager.role !== 'MANAGER' && manager.role !== 'ADMIN_SHIFT')) {
    throw new AppError('FORBIDDEN', 'Hanya Admin Shift atau Manager yang berwenang menetapkan keputusan FEFO.', 403);
  }

  return await db.transaction(async (tx) => {
    const [report] = await tx
      .select()
      .from(productConditionReports)
      .where(eq(productConditionReports.id, reportId))
      .for('update')
      .limit(1);

    if (!report) {
      throw new AppError('NOT_FOUND', 'Laporan kondisi FEFO tidak ditemukan.', 404);
    }

    if (report.status !== 'SUBMITTED' && report.status !== 'ALERT_ONLY') {
      throw new AppError(
        'BAD_REQUEST',
        `Keputusan tidak dapat ditetapkan karena laporan berstatus ${report.status}.`,
        400,
      );
    }

    // Ambil data batch dulu lalu produk (3NF: productId & expiryDate berasal dari stock_batches)
    const [batch] = await tx.select().from(stockBatches).where(eq(stockBatches.id, report.batchId)).limit(1);
    if (!batch) {
      throw new AppError('NOT_FOUND', 'Batch terkait tidak ditemukan.', 404);
    }

    const [prod] = await tx.select().from(products).where(eq(products.id, batch.productId)).limit(1);
    if (!prod) {
      throw new AppError('NOT_FOUND', 'Produk terkait tidak ditemukan.', 404);
    }

    let createdPolicyId: string | undefined;
    let createdDiscountBarcode: string | undefined;
    const todayStr = getTodayWib();

    // Blokir keputusan DISPLAY_FRONT / DISCOUNT jika batch SUDAH KEDALUWARSA
    if (
      (input.decision === 'DISCOUNT' || input.decision === 'DISPLAY_FRONT') &&
      batch.expiryDate &&
      batch.expiryDate < todayStr
    ) {
      throw new AppError(
        'BAD_REQUEST',
        'Batch sudah melewati tanggal kedaluwarsa dan diblokir untuk didiskon atau dipajang. Pilih DESTROY (Musnahkan) atau RETURN_SUPPLIER (Retur).',
        400,
      );
    }

    // JIKA KEPUTUSAN ADALAH DISCOUNT (Obral Darurat FEFO)
    if (input.decision === 'DISCOUNT' && input.approvedDiscountPct) {
      if (batch.currentQty <= 0) {
        throw new AppError(
          'BAD_REQUEST',
          'Stok batch sudah habis (0 unit) sehingga tidak dapat dibuat kebijakan diskon.',
          400,
        );
      }

      const discountPct = input.approvedDiscountPct;
      const originalPrice = Math.round(Number(prod.sellingPrice));
      const discountedPrice = computeFefoDiscountedPrice(originalPrice, discountPct);
      const validUntil = batch.expiryDate || todayStr;

      // 1. Buat Kebijakan Diskon
      const [policy] = await tx
        .insert(discountPolicies)
        .values({
          conditionReportId: report.id,
          productId: prod.id,
          batchId: batch.id,
          discountPct: discountPct.toString(),
          originalPrice,
          discountedPrice,
          allowedQty: batch.currentQty,
          soldQty: 0,
          validFrom: todayStr,
          validUntil,
          isActive: true,
          createdByAdminId: manager.id,
        })
        .returning();

      createdPolicyId = policy.id;

      // 2. Buat Barcode Diskon Unik (Format: DISC-{PROD6}-{RANDOM4})
      const prodCode = prod.id.replace(/-/g, '').slice(0, 6).toUpperCase();
      const randSuffix = String(Math.floor(1000 + Math.random() * 9000));
      const discountBarcodeStr = `DISC-${prodCode}-${randSuffix}`;

      await tx.insert(discountBarcodes).values({
        policyId: policy.id,
        barcode: discountBarcodeStr,
        remainingQty: batch.currentQty,
        isActive: true,
      });

      createdDiscountBarcode = discountBarcodeStr;
    }

    // Update Status Report ke APPROVED
    const [updatedReport] = await tx
      .update(productConditionReports)
      .set({
        status: 'APPROVED',
        managerDecision: input.decision,
        approvedDiscountPct: input.approvedDiscountPct ? input.approvedDiscountPct.toString() : null,
        managerNote: input.managerNote?.trim() || null,
        decidedByAdminId: manager.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productConditionReports.id, reportId))
      .returning();

    // Catat ke Audit Log
    await tx.insert(auditLogs).values({
      tableName: 'product_condition_reports',
      recordId: reportId,
      action: 'UPDATE',
      oldValues: JSON.stringify({ status: report.status }),
      newValues: JSON.stringify({
        status: 'APPROVED',
        decision: input.decision,
        approvedDiscountPct: input.approvedDiscountPct,
        discountBarcode: createdDiscountBarcode,
      }),
      actorType: 'ADMIN',
      actorId: manager.id,
    });

    return {
      report: updatedReport,
      discountPolicyId: createdPolicyId,
      discountBarcode: createdDiscountBarcode,
    };
  });
}

// =============================================================
// 5. GUDANG: Eksekusi Keputusan Manager di Lapangan
// =============================================================

export async function executeConditionReport(
  reportId: string,
  employeeId: string,
  rawInput: ExecuteConditionReportInput,
) {
  const input = ExecuteConditionReportSchema.parse(rawInput);

  const [emp] = await db
    .select({ id: employees.id, fullName: employees.fullName })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.isActive, true), isNull(employees.deletedAt)))
    .limit(1);

  if (!emp) {
    throw new AppError('FORBIDDEN', 'Petugas gudang tidak aktif.', 403);
  }

  return await db.transaction(async (tx) => {
    const [report] = await tx
      .select()
      .from(productConditionReports)
      .where(eq(productConditionReports.id, reportId))
      .for('update')
      .limit(1);

    if (!report) {
      throw new AppError('NOT_FOUND', 'Laporan kondisi FEFO tidak ditemukan.', 404);
    }

    if (report.status !== 'APPROVED') {
      throw new AppError(
        'BAD_REQUEST',
        `Tindakan hanya dapat dieksekusi jika keputusan Manager telah berstatus APPROVED.`,
        400,
      );
    }

    // Guard Expired saat Eksekusi Lapangan:
    // Jika keputusan Manager adalah DISCOUNT / DISPLAY_FRONT namun batch SUDAH EXPIRED saat hendak dieksekusi, blokir keras!
    if (report.managerDecision === 'DISCOUNT' || report.managerDecision === 'DISPLAY_FRONT') {
      const [checkBatch] = await tx
        .select({ id: stockBatches.id, expiryDate: stockBatches.expiryDate })
        .from(stockBatches)
        .where(eq(stockBatches.id, report.batchId))
        .limit(1);

      const todayStrExec = getTodayWib();
      if (checkBatch?.expiryDate && checkBatch.expiryDate < todayStrExec) {
        throw new AppError(
          'BAD_REQUEST',
          `Batch ini telah melewati tanggal kedaluwarsa (${checkBatch.expiryDate}) sejak disetujui. Eksekusi diskon/pajang diblokir — klik Scan Radar FEFO lalu ajukan pemusnahan/retur.`,
          400,
        );
      }
    }

    // JIKA KEPUTUSAN ADALAH DESTROY (Pemusnahan) ATAU RETURN_SUPPLIER (Retur ke Supplier)
    if (report.managerDecision === 'DESTROY' || report.managerDecision === 'RETURN_SUPPLIER') {
      const [batchMeta] = await tx
        .select({ productId: stockBatches.productId })
        .from(stockBatches)
        .where(eq(stockBatches.id, report.batchId))
        .limit(1);

      if (batchMeta) {
        // Kunci urut deterministik: products -> stock_batches (anti-deadlock)
        const [prod] = await tx
          .select({ stockQty: products.stockQty })
          .from(products)
          .where(eq(products.id, batchMeta.productId))
          .for('update')
          .limit(1);

        const [batch] = await tx
          .select()
          .from(stockBatches)
          .where(eq(stockBatches.id, report.batchId))
          .for('update')
          .limit(1);

        if (batch && batch.currentQty > 0 && prod) {
          const now = new Date();
          const qtyToRemove = batch.currentQty;
          const qtyBefore = prod.stockQty;
          const actualDeducted = Math.min(qtyBefore, qtyToRemove);
          const qtyAfter = qtyBefore - actualDeducted;

          // Nolkan batch di stock_batches
          await tx
            .update(stockBatches)
            .set({ currentQty: 0, updatedAt: now })
            .where(eq(stockBatches.id, batch.id));

          // Nonaktifkan seluruh kebijakan diskon & barcode diskon yang menempel pada batch ini
          const deactivatedPolicies = await tx
            .update(discountPolicies)
            .set({ isActive: false, updatedAt: now })
            .where(and(eq(discountPolicies.batchId, batch.id), eq(discountPolicies.isActive, true)))
            .returning({ id: discountPolicies.id });

          if (deactivatedPolicies.length > 0) {
            await tx
              .update(discountBarcodes)
              .set({ isActive: false, remainingQty: 0 })
              .where(
                and(
                  inArray(
                    discountBarcodes.policyId,
                    deactivatedPolicies.map((p) => p.id),
                  ),
                  eq(discountBarcodes.isActive, true),
                ),
              );
          }

          // Kurangi total stok produk di products
          await tx
            .update(products)
            .set({
              stockQty: qtyAfter,
              updatedAt: now,
            })
            .where(eq(products.id, batch.productId));

          if (!report.decidedByAdminId) {
            throw new AppError('BAD_REQUEST', 'Admin pemberi keputusan tidak tercatat pada laporan ini.', 400);
          }

          const actionLabel =
            report.managerDecision === 'DESTROY' ? 'PEMUSNAHAN FEFO' : 'RETUR SUPPLIER FEFO';

          // Catat ke stock_adjustments lengkap dengan batchId FK, pelaksana gudang & alasan
          await tx.insert(stockAdjustments).values({
            productId: batch.productId,
            batchId: batch.id,
            qtyBefore,
            qtyAfter,
            qtyDiff: -actualDeducted,
            reason: `${actionLabel} (${report.alertLevel}) [Pelaksana Gudang: ${emp.fullName}]: ${input.executionNote.trim()}`,
            adjustedByAdminId: report.decidedByAdminId,
          });
        }
      }
    }

    // Update Status Report ke EXECUTED
    const [executedReport] = await tx
      .update(productConditionReports)
      .set({
        status: 'EXECUTED',
        executedByEmployeeId: emp.id,
        executedAt: new Date(),
        executionNote: input.executionNote.trim(),
        updatedAt: new Date(),
      })
      .where(eq(productConditionReports.id, reportId))
      .returning();

    return executedReport;
  });
}
