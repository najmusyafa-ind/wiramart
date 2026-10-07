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
import { transactions, transactionItems, employees, shifts, transactionPayments, shiftCashMovements } from '@/lib/db/schema';
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

    // ── Shift dalam periode (dengan modal awal & rekap laci) ────────────────
    const shiftList = await db
      .select({
        shiftId:            shifts.id,
        clockIn:            shifts.clockIn,
        clockOut:           shifts.clockOut,
        status:             shifts.status,
        modalAwal:          shifts.modalAwal,
        actualCash:         shifts.actualCash,
        notes:              shifts.notes,
        cashBreakdownOpen:  shifts.cashBreakdownOpen,
        cashBreakdownClose: shifts.cashBreakdownClose,
        serahTerimaDiff:    shifts.serahTerimaDiff,
        auditFlags:         shifts.auditFlags,
        kasirName:          employees.fullName,
        kasirNim:           employees.nim,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)))
      .orderBy(sql`${shifts.clockIn} DESC`)
      .limit(100);

    const shiftIds = shiftList.map((s) => s.shiftId);

    // Ambil data petty cash & penjualan tunai jika ada shift
    const shiftCashOutMap = new Map<string, number>();
    const shiftCashInMap  = new Map<string, number>();
    const shiftSalesMap   = new Map<string, number>();

    if (shiftIds.length > 0) {
      // 1) Petty cash movements
      const movements = await db
        .select({
          shiftId: shiftCashMovements.shiftId,
          movementType: shiftCashMovements.movementType,
          total: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
        })
        .from(shiftCashMovements)
        .where(inArray(shiftCashMovements.shiftId, shiftIds))
        .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType);

      for (const m of movements) {
        const val = parseFloat(m.total || '0');
        if (m.movementType === 'CASH_OUT') {
          shiftCashOutMap.set(m.shiftId, val);
        } else if (m.movementType === 'CASH_IN') {
          shiftCashInMap.set(m.shiftId, val);
        }
      }

      // 2) Penjualan tunai dari pecahan split payment
      const splitCashSales = await db
        .select({
          shiftId: transactions.shiftId,
          total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
        })
        .from(transactionPayments)
        .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
        .where(and(
          inArray(transactions.shiftId, shiftIds),
          eq(transactions.status, 'COMPLETED'),
          eq(transactionPayments.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
        ))
        .groupBy(transactions.shiftId);

      for (const s of splitCashSales) {
        shiftSalesMap.set(s.shiftId, (shiftSalesMap.get(s.shiftId) ?? 0) + parseFloat(s.total || '0'));
      }

      // 3) Transaksi langsung tunai lama yang belum tercatat di transaction_payments
      const directCashSales = await db
        .select({
          shiftId: transactions.shiftId,
          total: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
        })
        .from(transactions)
        .where(and(
          inArray(transactions.shiftId, shiftIds),
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
          sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
        ))
        .groupBy(transactions.shiftId);

      for (const d of directCashSales) {
        shiftSalesMap.set(d.shiftId, (shiftSalesMap.get(d.shiftId) ?? 0) + parseFloat(d.total || '0'));
      }
    }

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
      shifts: shiftList.map((sh) => {
        const modalAwal = sh.modalAwal ? parseFloat(sh.modalAwal) : 0;
        const actualCash = sh.actualCash ? parseFloat(sh.actualCash) : null;
        const cashSales = shiftSalesMap.get(sh.shiftId) ?? 0;
        const cashOut = shiftCashOutMap.get(sh.shiftId) ?? 0;
        const cashIn = shiftCashInMap.get(sh.shiftId) ?? 0;
        const expectedCash = modalAwal + cashSales - cashOut + cashIn;
        const discrepancy = actualCash !== null ? actualCash - expectedCash : null;

        let statusLaci: 'RUNNING' | 'BALANCED' | 'SHORTAGE' | 'OVERAGE' = 'RUNNING';
        let discrepancyTier: 'HIJAU' | 'KUNING' | 'MERAH' | 'OVERAGE' = 'HIJAU';

        if (sh.status === 'CLOSED') {
          if (discrepancy === null) {
            statusLaci = 'BALANCED';
            discrepancyTier = 'HIJAU';
          } else if (Math.abs(discrepancy) <= 2000) {
            // Toleransi K7: <= Rp 2.000 dianggap HIJAU (PAS / Wajar)
            statusLaci = 'BALANCED';
            discrepancyTier = 'HIJAU';
          } else if (discrepancy < 0) {
            statusLaci = 'SHORTAGE';
            // Kuning: tekor antara Rp 2.001 s/d Rp 20.000
            // Merah: tekor > Rp 20.000
            discrepancyTier = discrepancy < -20000 ? 'MERAH' : 'KUNING';
          } else {
            statusLaci = 'OVERAGE';
            discrepancyTier = 'OVERAGE';
          }
        }

        return {
          shiftId:            sh.shiftId,
          clockIn:            sh.clockIn,
          clockOut:           sh.clockOut,
          status:             sh.status,
          modalAwal:          sh.modalAwal ? parseFloat(sh.modalAwal) : null,
          cashSales,
          cashOut,
          cashIn,
          expectedCash,
          actualCash,
          discrepancy,
          statusLaci,
          discrepancyTier,
          notes:              sh.notes,
          cashBreakdownOpen:  sh.cashBreakdownOpen,
          cashBreakdownClose: sh.cashBreakdownClose,
          serahTerimaDiff:    sh.serahTerimaDiff ? parseFloat(sh.serahTerimaDiff) : null,
          auditFlags:         sh.auditFlags ?? [],
          kasirName:          sh.kasirName,
          kasirNim:           sh.kasirNim,
        };
      }),
    });
  } catch {
    return apiError('Gagal mengambil data laporan', 500);
  }
}
