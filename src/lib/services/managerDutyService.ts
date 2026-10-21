// =============================================================
// src/lib/services/managerDutyService.ts
// Service Layer: Manager on Duty (MOD) & Daily Closing Sign-Off
// Wiramart v3.0: Sistem Manajemen Terintegrasi
// STANDAR: Zero-Trust Layer Decoupling, ACID Audit, Idempotent Operations
// =============================================================

import { eq, and, gte, lt, sql, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  managerDutyLog,
  admins,
  dailyClosings,
  stockReceiveDrafts,
  stockReceiveItems,
  transactions,
  transactionItems,
  productConditionReports,
  discountPolicies,
  auditLogs,
  type ManagerDutyLog,
  type DailyClosing,
} from '@/lib/db/schema';
import { AppError } from '@/lib/utils/helpers';

// Helper: Format tanggal bisnis WIB 'YYYY-MM-DD'
export function getWibDate(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

// Helper: Rentang waktu satu hari penuh di zona waktu Asia/Jakarta (WIB = UTC+7)
export function getWibDayRange(dateStr: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${dateStr}T00:00:00+07:00`);
  const nextDate = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const nextDateStr = nextDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const endExclusive = new Date(`${nextDateStr}T00:00:00+07:00`);
  return { start, endExclusive };
}

// Tipe DTO Status MOD Hari Ini
export type ManagerDutyStatus = {
  id: string | null;
  dutyDate: string;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  managerId: string | null;
  managerName: string | null;
  managerNidn: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  notes: string | null;
};

// Tipe DTO Ringkasan Rekonsiliasi Mutasi Stok Harian
export type StockMutationSummary = {
  date: string;
  itemsReceived: {
    totalQty: number;
    totalHpp: number;
    draftCount: number;
  };
  itemsSold: {
    totalQty: number;
    totalGrossAmount: number;
    discountedItemsQty: number;
  };
  fefoActions: {
    activeDiscountsCount: number;
    destroyedQty: number;
    returnedQty: number;
  };
  generatedAt: string;
};

export class ManagerDutyService {
  // ── 1. Ambil Status MOD Hari Ini ───────────────────────────
  static async getTodayDutyStatus(targetDate = getWibDate()): Promise<ManagerDutyStatus> {
    const log = await db.query.managerDutyLog.findFirst({
      where: eq(managerDutyLog.dutyDate, targetDate),
      with: {
        admin: true,
      },
    });

    if (!log) {
      return {
        id: null,
        dutyDate: targetDate,
        isCheckedIn: false,
        isCheckedOut: false,
        managerId: null,
        managerName: null,
        managerNidn: null,
        checkedInAt: null,
        checkedOutAt: null,
        notes: null,
      };
    }

    return {
      id: log.id,
      dutyDate: log.dutyDate,
      isCheckedIn: true,
      isCheckedOut: Boolean(log.checkedOutAt),
      managerId: log.adminId,
      managerName: log.admin?.fullName ?? 'Manager',
      managerNidn: log.admin?.nidn ?? null,
      checkedInAt: log.checkedInAt.toISOString(),
      checkedOutAt: log.checkedOutAt ? log.checkedOutAt.toISOString() : null,
      notes: log.notes,
    };
  }

  // ── 2. Ambil Riwayat MOD ───────────────────────────────────
  static async getDutyHistory(limit = 14): Promise<Array<ManagerDutyStatus & { createdAt: string }>> {
    const list = await db.query.managerDutyLog.findMany({
      orderBy: [desc(managerDutyLog.dutyDate)],
      limit,
      with: {
        admin: true,
      },
    });

    return list.map((item) => ({
      id: item.id,
      dutyDate: item.dutyDate,
      isCheckedIn: true,
      isCheckedOut: Boolean(item.checkedOutAt),
      managerId: item.adminId,
      managerName: item.admin?.fullName ?? 'Manager',
      managerNidn: item.admin?.nidn ?? null,
      checkedInAt: item.checkedInAt.toISOString(),
      checkedOutAt: item.checkedOutAt ? item.checkedOutAt.toISOString() : null,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
    }));
  }

  // ── 3. Check-In Manager on Duty ────────────────────────────
  static async checkIn(adminId: string, notes?: string, targetDate = getWibDate()): Promise<ManagerDutyLog> {
    // Validasi keberadaan admin
    const admin = await db.query.admins.findFirst({
      where: and(eq(admins.id, adminId), eq(admins.isActive, true)),
    });

    if (!admin) {
      throw new AppError('Admin / Manager tidak valid atau nonaktif.', 'ADMIN_NOT_FOUND', 404);
    }

    const existing = await db.query.managerDutyLog.findFirst({
      where: eq(managerDutyLog.dutyDate, targetDate),
    });

    let savedLog: ManagerDutyLog;

    if (existing) {
      // Jika sudah ada duty log untuk hari ini, update penginput dan reset checkOut jika perlu
      const [updated] = await db
        .update(managerDutyLog)
        .set({
          adminId,
          checkedInAt: new Date(),
          checkedOutAt: null,
          notes: notes !== undefined ? notes : existing.notes,
        })
        .where(eq(managerDutyLog.id, existing.id))
        .returning();

      savedLog = updated;
    } else {
      const [inserted] = await db
        .insert(managerDutyLog)
        .values({
          dutyDate: targetDate,
          adminId,
          checkedInAt: new Date(),
          notes: notes || null,
        })
        .returning();

      savedLog = inserted;
    }

    // Audit Log
    await db.insert(auditLogs).values({
      tableName: 'manager_duty_log',
      recordId: savedLog.id,
      action: existing ? 'UPDATE' : 'INSERT',
      newValues: JSON.stringify({
        dutyDate: targetDate,
        adminId,
        action: 'CHECK_IN',
        notes: notes || null,
      }),
      actorType: 'ADMIN',
      actorId: adminId,
    });

    return savedLog;
  }

  // ── 4. Check-Out Manager on Duty ───────────────────────────
  static async checkOut(adminId: string, notes?: string, targetDate = getWibDate()): Promise<ManagerDutyLog> {
    const existing = await db.query.managerDutyLog.findFirst({
      where: eq(managerDutyLog.dutyDate, targetDate),
    });

    if (!existing) {
      throw new AppError(
        `Belum ada sesi Manager on Duty pada tanggal ${targetDate}. Lakukan check-in terlebih dahulu.`,
        'NO_ACTIVE_DUTY',
        400,
      );
    }

    const [updated] = await db
      .update(managerDutyLog)
      .set({
        checkedOutAt: new Date(),
        notes: notes !== undefined ? notes : existing.notes,
      })
      .where(eq(managerDutyLog.id, existing.id))
      .returning();

    // Audit Log
    await db.insert(auditLogs).values({
      tableName: 'manager_duty_log',
      recordId: updated.id,
      action: 'UPDATE',
      newValues: JSON.stringify({
        dutyDate: targetDate,
        adminId,
        action: 'CHECK_OUT',
        checkedOutAt: updated.checkedOutAt,
        notes: notes || null,
      }),
      actorType: 'ADMIN',
      actorId: adminId,
    });

    return updated;
  }

  // ── 5. Kalkulasi Rekonsiliasi Mutasi Stok Harian ────────────
  static async calculateStockMutationSummary(dateStr: string): Promise<StockMutationSummary> {
    const { start, endExclusive } = getWibDayRange(dateStr);

    // 1. Barang masuk dari supplier yang disetujui (APPROVED) pada tanggal ini
    const approvedDrafts = await db
      .select({
        draftId: stockReceiveDrafts.id,
        itemQty: stockReceiveItems.qty,
        costPrice: stockReceiveItems.costPrice,
      })
      .from(stockReceiveDrafts)
      .innerJoin(stockReceiveItems, eq(stockReceiveDrafts.id, stockReceiveItems.draftId))
      .where(
        and(
          eq(stockReceiveDrafts.status, 'APPROVED'),
          gte(stockReceiveDrafts.approvedAt, start),
          lt(stockReceiveDrafts.approvedAt, endExclusive),
        ),
      );

    const draftSet = new Set<string>();
    let totalReceivedQty = 0;
    let totalReceivedHpp = 0;

    for (const d of approvedDrafts) {
      draftSet.add(d.draftId);
      totalReceivedQty += d.itemQty;
      totalReceivedHpp += Number(d.costPrice) * d.itemQty;
    }

    // 2. Barang keluar dari kasir (Penjualan)
    const soldItems = await db
      .select({
        qty: transactionItems.qty,
        subtotalSell: transactionItems.subtotalSell,
        discountPolicyId: transactionItems.discountPolicyId,
      })
      .from(transactions)
      .innerJoin(transactionItems, eq(transactions.id, transactionItems.transactionId))
      .where(
        and(
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.isTest, false),
          gte(transactions.createdAt, start),
          lt(transactions.createdAt, endExclusive),
        ),
      );

    let totalSoldQty = 0;
    let totalSoldGross = 0;
    let discountedItemsQty = 0;

    for (const item of soldItems) {
      totalSoldQty += item.qty;
      totalSoldGross += Number(item.subtotalSell);
      if (item.discountPolicyId) {
        discountedItemsQty += item.qty;
      }
    }

    // 3. Kebijakan FEFO: Diskon aktif & Barang Write-off / Retur
    const activeDiscounts = await db
      .select({ id: discountPolicies.id })
      .from(discountPolicies)
      .where(eq(discountPolicies.isActive, true));

    const fefoDecisions = await db
      .select({
        decision: productConditionReports.managerDecision,
        qty: productConditionReports.qtyAtAlert,
      })
      .from(productConditionReports)
      .where(
        and(
          gte(productConditionReports.decidedAt, start),
          lt(productConditionReports.decidedAt, endExclusive),
        ),
      );

    let destroyedQty = 0;
    let returnedQty = 0;

    for (const f of fefoDecisions) {
      if (f.decision === 'DESTROY') {
        destroyedQty += f.qty;
      } else if (f.decision === 'RETURN_SUPPLIER') {
        returnedQty += f.qty;
      }
    }

    return {
      date: dateStr,
      itemsReceived: {
        totalQty: totalReceivedQty,
        totalHpp: Math.round(totalReceivedHpp),
        draftCount: draftSet.size,
      },
      itemsSold: {
        totalQty: totalSoldQty,
        totalGrossAmount: Math.round(totalSoldGross),
        discountedItemsQty,
      },
      fefoActions: {
        activeDiscountsCount: activeDiscounts.length,
        destroyedQty,
        returnedQty,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 6. Pengesahan (Sign-Off) Daily Closing oleh MOD ─────────
  static async signOffDailyClosing(
    adminId: string,
    closingDate: string,
    signNote?: string,
  ): Promise<DailyClosing> {
    // 1. Verifikasi admin
    const admin = await db.query.admins.findFirst({
      where: and(eq(admins.id, adminId), eq(admins.isActive, true)),
    });

    if (!admin) {
      throw new AppError('Manager tidak valid atau akun nonaktif.', 'UNAUTHORIZED_MANAGER', 403);
    }

    // 2. Ambil record daily_closings pada tanggal tersebut
    const closing = await db.query.dailyClosings.findFirst({
      where: eq(dailyClosings.closingDate, closingDate),
    });

    if (!closing) {
      throw new AppError(
        `Daily Closing tanggal ${closingDate} belum pernah dieksekusi. Lakukan Tutup Buku terlebih dahulu sebelum pengesahan MOD.`,
        'CLOSING_NOT_FOUND',
        404,
      );
    }

    // 3. Hitung rekonsiliasi mutasi stok harian secara deterministik
    const mutationSummary = await this.calculateStockMutationSummary(closingDate);

    // 4. Update Daily Closing dengan stempel pengesahan MOD & ubah status ke 'AUDITED'
    const [updatedClosing] = await db
      .update(dailyClosings)
      .set({
        status: 'AUDITED',
        modSignedBy: adminId,
        modSignedAt: new Date(),
        modSignNote: signNote?.trim() || null,
        stockMutationSummary: mutationSummary,
        updatedAt: new Date(),
      })
      .where(eq(dailyClosings.id, closing.id))
      .returning();

    // 5. Audit Trail resmi
    await db.insert(auditLogs).values({
      tableName: 'daily_closings',
      recordId: updatedClosing.id,
      action: 'UPDATE',
      newValues: JSON.stringify({
        closingDate,
        modSignedBy: adminId,
        modSignedAt: updatedClosing.modSignedAt,
        status: 'AUDITED',
        modSignNote: signNote?.trim() || null,
        stockMutationSummary: mutationSummary,
      }),
      actorType: 'ADMIN',
      actorId: adminId,
    });

    return updatedClosing;
  }
}
