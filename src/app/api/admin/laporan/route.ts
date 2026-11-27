// =============================================================
// GET /api/admin/laporan — Rekap keuangan per periode
// Query params: period=daily|weekly|monthly|semi_annual|october|november|oct_nov|all
//               dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD (override, WIB, maks 1.100 hari)
//
// Semua angka keuangan berasal dari lib/finance/report.ts (satu sumber kebenaran):
// batas hari WIB, data uji (is_test) dikecualikan, laba hanya dari item ber-HPP,
// Laba Bersih = Laba Kotor − Biaya Operasional.
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { transactions, transactionItems, employees, shifts, transactionPayments, shiftCashMovements } from '@/lib/db/schema';
import { eq, and, gte, lt, inArray, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  classifyShiftDrawerAudit,
  getFinancialReport,
  resolveReportRange,
  summarizeDailyByMonth,
  isPeriodKey,
  InvalidRangeError,
} from '@/lib/finance/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SQL_IN_CHUNK_SIZE = 1_500;

function chunkArray<T>(items: readonly T[], size = SQL_IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Laporan keuangan hanya dapat diakses oleh Manager (Dosen).', 403);
  }

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  if (rawPeriod && !isPeriodKey(rawPeriod)) {
    return apiError(`Parameter period '${rawPeriod}' tidak valid`, 400);
  }
  const period = rawPeriod && isPeriodKey(rawPeriod) ? rawPeriod : null;

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
    const monthly = summarizeDailyByMonth(report.daily);

    // ── Top 15 produk terlaris (COMPLETED, bukan data uji) ──────
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
      .limit(15);

    // ── Transaksi terbaru periode ini (hingga 100 transaksi), bukan data uji ──
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
      .limit(100);

    // ── Pecahan pembayaran (Split Payment) ──
    const txIds = recentTransactions.map((t) => t.id);
    const recentPayments: Array<{
      transactionId: string;
      paymentMethod: string;
      amount: string;
    }> = [];
    for (const idChunk of chunkArray(txIds)) {
      const payChunk = await db
        .select({
          transactionId: transactionPayments.transactionId,
          paymentMethod: transactionPayments.paymentMethod,
          amount:        transactionPayments.amount,
        })
        .from(transactionPayments)
        .where(inArray(transactionPayments.transactionId, idChunk));
      recentPayments.push(...payChunk);
    }

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

    // ── Shift dalam periode (hingga 1.000 shift agar periode Oktober+November/Keseluruhan tercakup penuh) ──
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
      .where(
        and(
          gte(shifts.clockIn, range.start),
          lt(shifts.clockIn, range.endExclusive),
          sql`LOWER(${employees.fullName}) NOT LIKE '%testing%'`,
          sql`LOWER(${employees.fullName}) NOT LIKE '%dede%'`,
          sql`${employees.nim} NOT IN ('02405013', '00000000')`,
        ),
      )
      .orderBy(sql`${shifts.clockIn} DESC`)
      .limit(1000);

    const shiftIds = shiftList.map((s) => s.shiftId);

    // Ambil data petty cash & penjualan tunai jika ada shift
    const shiftCashOutMap = new Map<string, number>();
    const shiftCashInMap  = new Map<string, number>();
    const shiftSalesMap   = new Map<string, number>();

    for (const idChunk of chunkArray(shiftIds)) {
      const [movements, splitCashSales, directCashSales] = await Promise.all([
        db
          .select({
            shiftId: shiftCashMovements.shiftId,
            movementType: shiftCashMovements.movementType,
            total: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
          })
          .from(shiftCashMovements)
          .where(inArray(shiftCashMovements.shiftId, idChunk))
          .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType),
        db
          .select({
            shiftId: transactions.shiftId,
            total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(
            and(
              inArray(transactions.shiftId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactionPayments.paymentMethod, 'CASH'),
              eq(transactions.isTest, false),
            ),
          )
          .groupBy(transactions.shiftId),
        db
          .select({
            shiftId: transactions.shiftId,
            total: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.shiftId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.paymentMethod, 'CASH'),
              eq(transactions.isTest, false),
              sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = transactions.id)`,
            ),
          )
          .groupBy(transactions.shiftId),
      ]);

      for (const m of movements) {
        const val = parseFloat(m.total || '0');
        if (m.movementType === 'CASH_OUT') {
          shiftCashOutMap.set(m.shiftId, (shiftCashOutMap.get(m.shiftId) ?? 0) + val);
        } else if (m.movementType === 'CASH_IN') {
          shiftCashInMap.set(m.shiftId, (shiftCashInMap.get(m.shiftId) ?? 0) + val);
        }
      }
      for (const sc of splitCashSales) {
        shiftSalesMap.set(sc.shiftId, (shiftSalesMap.get(sc.shiftId) ?? 0) + parseFloat(sc.total || '0'));
      }
      for (const dc of directCashSales) {
        shiftSalesMap.set(dc.shiftId, (shiftSalesMap.get(dc.shiftId) ?? 0) + parseFloat(dc.total || '0'));
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
      monthly,
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
        const parsedModal = sh.modalAwal !== null && sh.modalAwal !== undefined && sh.modalAwal !== ''
          ? parseFloat(sh.modalAwal)
          : NaN;
        const modalAwal = Number.isFinite(parsedModal) && parsedModal >= 0 ? parsedModal : 100_000;
        const rawModalWarning = modalAwal < 0 || modalAwal > 5_000_000;

        const parsedActual = sh.actualCash !== null && sh.actualCash !== undefined && sh.actualCash !== ''
          ? parseFloat(sh.actualCash)
          : NaN;
        const actualCash = Number.isFinite(parsedActual) ? parsedActual : null;

        const cashSales = shiftSalesMap.get(sh.shiftId) ?? 0;
        const cashOut = shiftCashOutMap.get(sh.shiftId) ?? 0;
        const cashIn = shiftCashInMap.get(sh.shiftId) ?? 0;
        const expectedCash = modalAwal + cashSales - cashOut + cashIn;
        const { discrepancy, statusLaci, discrepancyTier } = classifyShiftDrawerAudit({
          status: sh.status,
          actualCash,
          expectedCash,
        });

        const parsedSerah = sh.serahTerimaDiff !== null && sh.serahTerimaDiff !== undefined && sh.serahTerimaDiff !== ''
          ? parseFloat(sh.serahTerimaDiff)
          : NaN;
        const serahTerimaDiff = Number.isFinite(parsedSerah) ? parsedSerah : null;

        return {
          shiftId:            sh.shiftId,
          clockIn:            sh.clockIn,
          clockOut:           sh.clockOut,
          status:             sh.status,
          modalAwal,
          rawModalWarning,
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
          serahTerimaDiff,
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
