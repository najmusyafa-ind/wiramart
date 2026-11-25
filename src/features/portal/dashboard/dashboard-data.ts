import { db } from '@/lib/db/client';
import {
  transactions,
  shifts,
  employees,
  shiftSwapRequests,
  shiftCashMovements,
  qrisReconciliations,
  productProposals,
  products,
  stockBatches,
  stockReceiveDrafts,
  productConditionReports,
} from '@/lib/db/schema';
import { eq, and, gte, lt, lte, sql, count, isNull } from 'drizzle-orm';
import { getOffsetDateWib } from '@/lib/utils/helpers';
import { resolveReportRange, getFinancialReport, wibToday } from '@/lib/finance/report';
import { getLowStockThreshold } from '@/lib/services/operationalSettingsService';
import type { AutoClosedShiftInfo } from './ApprovalCenterWidget';

/**
 * Mengambil metrik operasional & antrean gudang non-finansial yang dipakai bersama
 * oleh dashboard Manager maupun Admin Shift (tanpa mengekspose omzet/HPP/costPrice).
 */
export async function getSharedOperationalStats(dayStart: Date) {
  const in7DaysWib = getOffsetDateWib(7);

  const [
    [activeShiftsResult],
    [totalEmployeesResult],
    [pendingSwapsResult],
    [criticalBatchesResult],
    [pendingStockReceivesResult],
    [pendingConditionReportsResult],
    [pettyCashResult],
  ] = await Promise.all([
    db
      .select({ count: count(shifts.id) })
      .from(shifts)
      .where(eq(shifts.status, 'ACTIVE')),
    db
      .select({ count: count(employees.id) })
      .from(employees)
      .where(and(eq(employees.isActive, true), isNull(employees.deletedAt))),
    db
      .select({ count: count(shiftSwapRequests.id) })
      .from(shiftSwapRequests)
      .where(eq(shiftSwapRequests.status, 'PENDING')),
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*), 0)::int`,
      })
      .from(stockBatches)
      .innerJoin(products, eq(stockBatches.productId, products.id))
      .where(
        and(
          eq(products.isActive, true),
          isNull(products.deletedAt),
          sql`${stockBatches.expiryDate} IS NOT NULL`,
          lte(stockBatches.expiryDate, in7DaysWib),
          sql`${stockBatches.currentQty} > 0`,
        ),
      ),
    db
      .select({ count: count(stockReceiveDrafts.id) })
      .from(stockReceiveDrafts)
      .where(eq(stockReceiveDrafts.status, 'SUBMITTED')),
    db
      .select({ count: count(productConditionReports.id) })
      .from(productConditionReports)
      .where(eq(productConditionReports.status, 'SUBMITTED')),
    db
      .select({
        cashOut: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_OUT'), 0)`,
        cashIn: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_IN'), 0)`,
      })
      .from(shiftCashMovements)
      .where(gte(shiftCashMovements.createdAt, dayStart)),
  ]);

  return {
    activeShifts: activeShiftsResult?.count ?? 0,
    totalEmployees: totalEmployeesResult?.count ?? 0,
    pendingSwapsCount: pendingSwapsResult?.count ?? 0,
    criticalBatchesCount: criticalBatchesResult?.count ?? 0,
    pendingStockReceivesCount: pendingStockReceivesResult?.count ?? 0,
    pendingConditionReportsCount: pendingConditionReportsResult?.count ?? 0,
    pettyCashOut: Number(pettyCashResult?.cashOut ?? 0),
    pettyCashIn: Number(pettyCashResult?.cashIn ?? 0),
  };
}

export async function getManagerDashboardData() {
  const todayWibStr = wibToday();
  const range = resolveReportRange({ period: 'daily' });

  const [financialReport, sharedStats] = await Promise.all([
    getFinancialReport(range),
    getSharedOperationalStats(range.start),
  ]);
  const { summary } = financialReport;

  const autoClosedShiftsRaw = await db.query.shifts.findMany({
    where: and(
      eq(shifts.status, 'CLOSED'),
      gte(shifts.clockIn, range.start),
      sql`${shifts.notes} ILIKE '%AUTO_CLOSED%'`,
    ),
    with: {
      employee: {
        columns: { fullName: true },
      },
    },
    limit: 5,
  });

  const autoClosedShifts: AutoClosedShiftInfo[] = autoClosedShiftsRaw.map((s) => ({
    id: s.id,
    employeeName: s.employee.fullName,
    clockIn: s.clockIn.toISOString(),
    clockOut: s.clockOut ? s.clockOut.toISOString() : null,
    notes: s.notes,
  }));

  const currentMonthStr = todayWibStr.slice(0, 7);
  const [qrisReconResult] = await db
    .select({
      totalDays: sql<number>`COUNT(*)`,
      selisihCount: sql<number>`COUNT(*) FILTER (WHERE ${qrisReconciliations.status} = 'SELISIH')`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${qrisReconciliations.status} = 'PENDING')`,
    })
    .from(qrisReconciliations)
    .where(sql`${qrisReconciliations.reconDate} >= ${currentMonthStr + '-01'}`);

  const hasQrisIssue =
    (qrisReconResult?.totalDays ?? 0) === 0 ||
    (qrisReconResult?.selisihCount ?? 0) > 0 ||
    (qrisReconResult?.pendingCount ?? 0) > 0;

  let qrisStatusText = 'Sinkron';
  if ((qrisReconResult?.selisihCount ?? 0) > 0) {
    qrisStatusText = `${qrisReconResult.selisihCount} Hari Selisih`;
  } else if ((qrisReconResult?.pendingCount ?? 0) > 0) {
    qrisStatusText = `${qrisReconResult.pendingCount} Belum Rekonsiliasi`;
  } else if ((qrisReconResult?.totalDays ?? 0) === 0) {
    qrisStatusText = 'Belum Rekonsiliasi';
  }

  const [pendingProposalsResult] = await db
    .select({ count: count(productProposals.id) })
    .from(productProposals)
    .where(eq(productProposals.status, 'PENDING'));

  const recentTransactions = await db.query.transactions.findMany({
    where: and(
      eq(transactions.isTest, false),
      gte(transactions.createdAt, range.start),
      lt(transactions.createdAt, range.endExclusive),
    ),
    with: { employee: { columns: { fullName: true } } },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });

  return {
    todayLabel: range.label,
    summary,
    ...sharedStats,
    pendingProposalsCount: pendingProposalsResult?.count ?? 0,
    autoClosedShiftsCount: autoClosedShifts.length,
    autoClosedShifts,
    qrisNeedsAttention: hasQrisIssue,
    qrisStatusText,
    recentTransactions,
  };
}

export async function getShiftDashboardData() {
  const range = resolveReportRange({ period: 'daily' });
  const lowStockThreshold = await getLowStockThreshold();

  const [sharedStats, [stockHealthResult], [txCountResult]] = await Promise.all([
    getSharedOperationalStats(range.start),
    db
      .select({
        outOfStockCount: sql<number>`COUNT(*) FILTER (WHERE ${products.stockQty} <= 0)::int`,
        lowStockCount: sql<number>`COUNT(*) FILTER (WHERE ${products.stockQty} > 0 AND ${products.stockQty} <= ${lowStockThreshold})::int`,
      })
      .from(products)
      .where(and(eq(products.isActive, true), isNull(products.deletedAt))),
    db
      .select({ count: count(transactions.id) })
      .from(transactions)
      .where(
        and(
          eq(transactions.isTest, false),
          gte(transactions.createdAt, range.start),
          lt(transactions.createdAt, range.endExclusive),
          eq(transactions.status, 'COMPLETED'),
        ),
      ),
  ]);

  return {
    todayLabel: range.label,
    activeShifts: sharedStats.activeShifts,
    totalEmployees: sharedStats.totalEmployees,
    pendingSwaps: sharedStats.pendingSwapsCount,
    criticalBatches: sharedStats.criticalBatchesCount,
    pendingStockReceives: sharedStats.pendingStockReceivesCount,
    pendingConditionReports: sharedStats.pendingConditionReportsCount,
    lowStockProducts: stockHealthResult?.lowStockCount ?? 0,
    outOfStockProducts: stockHealthResult?.outOfStockCount ?? 0,
    lowStockThreshold,
    pettyCashOut: sharedStats.pettyCashOut,
    pettyCashIn: sharedStats.pettyCashIn,
    todayTransactions: txCountResult?.count ?? 0,
  };
}

