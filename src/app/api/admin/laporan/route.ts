// =============================================================
// GET /api/admin/laporan — Rekap keuangan per periode
// Query params: period=daily|weekly|monthly|semi_annual
//               dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD (override, WIB, maks 400 hari)
//
// Semua angka keuangan berasal dari lib/finance/report.ts (satu sumber kebenaran):
// batas hari WIB, data uji (is_test) dikecualikan, laba hanya dari item ber-HPP,
// Laba Bersih = Laba Kotor − Biaya Operasional.
// Nama field lama (grossAmount, grossProfit, amountCash, …) dipertahankan
// untuk kompatibilitas dengan widget dashboard.
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { transactions, transactionItems, employees, shifts, transactionPayments } from '@/lib/db/schema';
import { eq, and, gte, lt, inArray, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  getFinancialReport,
  resolveReportRange,
  InvalidRangeError,
  type PeriodKey,
} from '@/lib/finance/report';

export const runtime = 'nodejs';

const PERIODS: readonly PeriodKey[] = ['daily', 'weekly', 'monthly', 'semi_annual'];

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  const period = PERIODS.find((p) => p === rawPeriod) ?? null;

  let range;
  try {
    range = resolveReportRange({
      period,
      dateFrom: sp.get('dateFrom'),
      dateTo: sp.get('dateTo'),
    });
  } catch (err) {
    if (err instanceof InvalidRangeError) return apiError(err.message, 400);
    throw err;
  }

  try {
    const report = await getFinancialReport(range);
    const s = report.summary;

    // ── Top 5 produk terlaris (COMPLETED, bukan data uji) ──────
    const topProducts = await db
      .select({
        productName:  transactionItems.productNameSnapshot,
        totalQty:     sql<number>`SUM(${transactionItems.qty})`,
        totalRevenue: sql<string>`SUM(${transactionItems.subtotalSell})`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.isTest, false),
          gte(transactions.createdAt, range.start),
          lt(transactions.createdAt, range.endExclusive),
        ),
      )
      .groupBy(transactionItems.productNameSnapshot)
      .orderBy(sql`SUM(${transactionItems.qty}) DESC`)
      .limit(5);

    // ── 20 transaksi terbaru (tabel + tombol Void), bukan data uji ──
    const recentTransactions = await db
      .select({
        id:            transactions.id,
        invoiceNumber: transactions.invoiceNumber,
        paymentMethod: transactions.paymentMethod,
        status:        transactions.status,
        grossAmount:   transactions.grossAmount,
        cashReceived:  transactions.cashReceived,
        changeAmount:  transactions.changeAmount,
        voidReason:    transactions.voidReason,
        voidedAt:      transactions.voidedAt,
        createdAt:     transactions.createdAt,
        employeeName:  employees.fullName,
        employeeId:    employees.id,
      })
      .from(transactions)
      .innerJoin(employees, eq(transactions.employeeId, employees.id))
      .where(
        and(
          eq(transactions.isTest, false),
          gte(transactions.createdAt, range.start),
          lt(transactions.createdAt, range.endExclusive),
        ),
      )
      .orderBy(sql`${transactions.createdAt} DESC`)
      .limit(20);

    // ── Pecahan pembayaran untuk 20 transaksi terbaru (Split Payment) ──
    const txIds = recentTransactions.map((t) => t.id);
    const recentPayments = txIds.length > 0
      ? await db
          .select({
            transactionId: transactionPayments.transactionId,
            paymentMethod: transactionPayments.paymentMethod,
            amount:        transactionPayments.amount,
          })
          .from(transactionPayments)
          .where(inArray(transactionPayments.transactionId, txIds))
      : [];

    const paymentsByTx = new Map<string, typeof recentPayments>();
    for (const p of recentPayments) {
      const list = paymentsByTx.get(p.transactionId) ?? [];
      list.push(p);
      paymentsByTx.set(p.transactionId, list);
    }

    const enhancedRecentTransactions = recentTransactions.map((t) => {
      const pays = paymentsByTx.get(t.id) ?? [];
      const isSplit = pays.length > 1;
      return {
        ...t,
        paymentMethod: isSplit ? ('SPLIT' as const) : t.paymentMethod,
        payments: pays,
      };
    });

    // ── Shift dalam periode (dengan modal awal) ────────────────
    const shiftList = await db
      .select({
        shiftId:   shifts.id,
        clockIn:   shifts.clockIn,
        clockOut:  shifts.clockOut,
        status:    shifts.status,
        modalAwal: shifts.modalAwal,
        kasirName: employees.fullName,
        kasirNim:  employees.nim,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)))
      .orderBy(sql`${shifts.clockIn} DESC`)
      .limit(100);

    return apiOk({
      period: period ?? 'custom',
      label: range.label,
      dateFrom: range.start.toISOString(),
      dateTo:   range.endExclusive.toISOString(),
      rangeStartDate: range.startDate,
      rangeEndDate:   range.endDate,
      summary: {
        // — nama lama (kompatibel) —
        grossAmount: s.omzet,
        grossProfit: s.labaKotor,
        totalHpp:    s.hppTerjual,
        totalCount:  s.txCount,
        countCash:   s.txCountCash,
        countQris:   s.txCountQris,
        countVoid:   s.voidCount,
        amountCash:  s.omzetCash,
        amountQris:  s.omzetQris,
        voidAmount:          s.voidAmount,
        alokasiGajiKaryawan: s.alokasiGajiKaryawan,
        persenBagiHasil:     s.persenBagiHasil,
        omzetTanpaHpp:       s.omzetTanpaHpp,
        unitTanpaHpp:        s.unitTanpaHpp,
        labaLengkap:         s.labaLengkap,
        biayaOperasional:    s.biayaOperasional,
        labaBersih:          s.labaBersih,
        biayaPerKategori:    s.biayaPerKategori,
      },
      daily: report.daily,
      checks: report.checks,
      // Kompatibilitas grafik lama
      dailyChart: report.daily.map((d) => ({
        day:        d.date,
        revenue:    String(d.omzet),
        amountCash: String(d.omzetCash),
        amountQris: String(d.omzetQris),
        profit:     String(d.labaKotor),
        txCount:    d.txCount,
      })),
      topProducts,
      recentTransactions: enhancedRecentTransactions,
      shifts: shiftList.map((sh) => ({
        shiftId:   sh.shiftId,
        clockIn:   sh.clockIn,
        clockOut:  sh.clockOut,
        status:    sh.status,
        modalAwal: sh.modalAwal ? parseFloat(sh.modalAwal) : null,
        kasirName: sh.kasirName,
        kasirNim:  sh.kasirNim,
      })),
    });
  } catch {
    return apiError('Gagal mengambil data laporan', 500);
  }
}
