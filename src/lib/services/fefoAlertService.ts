// =============================================================
// src/lib/services/fefoAlertService.ts
// Domain Logic: FEFO Early Warning System & To-Do List Gudang (Fase 2 & 3 Wiramart v3.0)
// STANDAR: NASA-Grade Decoupling, ACID Transaction, Zero any, Mathematical Precision
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
import { eq, and, gt, lte, isNull, sql, desc, asc, count, or, ilike } from 'drizzle-orm';
import { AppError } from '@/lib/utils/helpers';

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

function getTodayWIB(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
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
  const todayStr = getTodayWIB();
  const todayDate = new Date(todayStr);
  const in7Days = new Date(todayDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

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

    // Cek apakah batch sudah memiliki condition report
    const [existingReport] = await db
      .select({ id: productConditionReports.id, status: productConditionReports.status })
      .from(productConditionReports)
      .where(eq(productConditionReports.batchId, b.batchId))
      .limit(1);

    if (!existingReport) {
      // Buat alert baru status ALERT_ONLY
      await db.insert(productConditionReports).values({
        batchId: b.batchId,
        productId: b.productId,
        alertLevel,
        qtyAtAlert: b.currentQty,
        expiryDate: b.expiryDate,
        daysRemainingAtAlert: daysRemaining,
        status: 'ALERT_ONLY',
      });
      newAlerts++;
    } else if (existingReport.status === 'ALERT_ONLY') {
      // Update level alert jika hari berkurang (misal dari H-5 turun ke H-3 atau H-1)
      await db
        .update(productConditionReports)
        .set({
          alertLevel,
          qtyAtAlert: b.currentQty,
          daysRemainingAtAlert: daysRemaining,
          updatedAt: new Date(),
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

  const conditions = [];

  if (status && status !== 'semua') {
    conditions.push(eq(productConditionReports.status, status as ConditionReportStatus));
  }

  const dbAlertLevel = mapToDbAlertLevel(alertLevel);
  if (dbAlertLevel) {
    conditions.push(eq(productConditionReports.alertLevel, dbAlertLevel));
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push(or(ilike(products.name, q), ilike(stockBatches.batchCode, q)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ count: count() })
    .from(productConditionReports)
    .innerJoin(products, eq(productConditionReports.productId, products.id))
    .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
    .where(whereClause);

  const rows = await db
    .select({
      id: productConditionReports.id,
      batchId: productConditionReports.batchId,
      productId: productConditionReports.productId,
      productName: products.name,
      productUnit: products.unit,
      sellingPrice: products.sellingPrice,
      batchCode: stockBatches.batchCode,
      currentBatchQty: stockBatches.currentQty,
      alertLevel: productConditionReports.alertLevel,
      qtyAtAlert: productConditionReports.qtyAtAlert,
      expiryDate: productConditionReports.expiryDate,
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
    .innerJoin(products, eq(productConditionReports.productId, products.id))
    .innerJoin(stockBatches, eq(productConditionReports.batchId, stockBatches.id))
    .where(whereClause)
    .orderBy(
      // Prioritaskan alert terparah H1 -> H3 -> H5 -> H7
      asc(productConditionReports.expiryDate),
      desc(productConditionReports.createdAt),
    )
    .limit(limit)
    .offset(offset);

  const formattedRows = rows.map((r) => ({
    ...r,
    alertLevel: mapToClientAlertLevel(r.alertLevel),
  }));

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

  const [updated] = await db
    .update(productConditionReports)
    .set({
      status: 'SUBMITTED',
      physicalCondition: input.physicalCondition.trim(),
      gudangSuggestion: input.gudangSuggestion?.trim() || null,
      suggestedDiscountPct: input.suggestedDiscountPct ? input.suggestedDiscountPct.toString() : null,
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

  if (!manager || manager.role !== 'MANAGER') {
    throw new AppError('FORBIDDEN', 'Hanya Manager yang berwenang menetapkan keputusan FEFO.', 403);
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

    // Ambil data produk & batch
    const [prod] = await tx.select().from(products).where(eq(products.id, report.productId)).limit(1);
    const [batch] = await tx.select().from(stockBatches).where(eq(stockBatches.id, report.batchId)).limit(1);

    if (!prod || !batch) {
      throw new AppError('NOT_FOUND', 'Produk atau batch terkait tidak ditemukan.', 404);
    }

    let createdPolicyId: string | undefined;
    let createdDiscountBarcode: string | undefined;

    // JIKA KEPUTUSAN ADALAH DISCOUNT (Obral Darurat FEFO)
    if (input.decision === 'DISCOUNT' && input.approvedDiscountPct) {
      const discountPct = input.approvedDiscountPct;
      const originalPrice = Math.round(Number(prod.sellingPrice));
      const discountedPrice = Math.round(Math.floor(originalPrice * (1 - discountPct / 100)));

      const todayStr = getTodayWIB();
      const validUntil = report.expiryDate || todayStr;

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
        productId: prod.id,
        barcode: discountBarcodeStr,
        discountedPrice,
        discountPct: discountPct.toString(),
        remainingQty: batch.currentQty,
        validUntil,
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

    // JIKA KEPUTUSAN ADALAH DESTROY (Pemusnahan Barang Kedaluwarsa)
    if (report.managerDecision === 'DESTROY') {
      const [batch] = await tx
        .select()
        .from(stockBatches)
        .where(eq(stockBatches.id, report.batchId))
        .limit(1);

      const [prod] = await tx
        .select({ stockQty: products.stockQty })
        .from(products)
        .where(eq(products.id, report.productId))
        .limit(1);

      if (batch && batch.currentQty > 0 && prod) {
        const qtyToDestroy = batch.currentQty;
        const qtyBefore = prod.stockQty;
        const qtyAfter = Math.max(0, qtyBefore - qtyToDestroy);

        // Nolkan batch di stock_batches
        await tx
          .update(stockBatches)
          .set({ currentQty: 0, updatedAt: new Date() })
          .where(eq(stockBatches.id, batch.id));

        // Kurangi total stok produk di products
        await tx
          .update(products)
          .set({
            stockQty: qtyAfter,
            updatedAt: new Date(),
          })
          .where(eq(products.id, report.productId));

        // Catat ke stock_adjustments (audit kerugian)
        await tx.insert(stockAdjustments).values({
          productId: report.productId,
          qtyBefore,
          qtyAfter,
          qtyDiff: -qtyToDestroy,
          reason: `PEMUSNAHAN FEFO (${report.alertLevel}): ${input.executionNote}`,
          adjustedByAdminId: report.decidedByAdminId!,
        });
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
