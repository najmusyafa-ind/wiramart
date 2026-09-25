// =============================================================
// GET /api/admin/laporan — Rekap transaksi per periode
// Query params: period=daily|weekly|monthly|semi_annual
//               dateFrom=YYYY-MM-DD (opsional override)
//               dateTo=YYYY-MM-DD
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { transactions, transactionItems, employees } from '@/lib/db/schema';
import { eq, and, gte, lte, sql, count } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { getPeriodRange } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') as 'daily' | 'weekly' | 'monthly' | 'semi_annual' | null;
  const dateFrom = searchParams.get('dateFrom');
  const dateTo   = searchParams.get('dateTo');

  let start: Date, end: Date, label: string;

  if (dateFrom && dateTo) {
    start = new Date(dateFrom + 'T00:00:00+07:00');
    end   = new Date(dateTo + 'T23:59:59+07:00');
    label = `${dateFrom} s/d ${dateTo}`;
  } else {
    const range = getPeriodRange(period ?? 'daily');
    start = range.start;
    end   = range.end;
    label = range.label;
  }

  try {
    // ── Summary (omzet, laba, jumlah transaksi, breakdown Cash/QRIS) ──
    const [summary] = await db
      .select({
        // Total omzet dan profit (COMPLETED only)
        grossAmount:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
        grossProfit:  sql<string>`COALESCE(SUM(${transactions.grossProfit}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
        totalHpp:     sql<string>`COALESCE(SUM(${transactions.totalHpp}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
        // Jumlah transaksi per status
        totalCount:   count(transactions.id),
        countCash:    sql<number>`COUNT(*) FILTER (WHERE ${transactions.paymentMethod} = 'CASH' AND ${transactions.status} = 'COMPLETED')`,
        countQris:    sql<number>`COUNT(*) FILTER (WHERE ${transactions.paymentMethod} = 'QRIS' AND ${transactions.status} = 'COMPLETED')`,
        countVoid:    sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
        // ── BARU: Nominal Cash vs QRIS (breakdown per metode pembayaran) ──
        amountCash:   sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.paymentMethod} = 'CASH' AND ${transactions.status} = 'COMPLETED'), 0)`,
        amountQris:   sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.paymentMethod} = 'QRIS' AND ${transactions.status} = 'COMPLETED'), 0)`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.createdAt, start),
          lte(transactions.createdAt, end),
        ),
      );

    // ── Top 5 produk terlaris ────────────────────────────────────
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
          gte(transactions.createdAt, start),
          lte(transactions.createdAt, end),
        ),
      )
      .groupBy(transactionItems.productNameSnapshot)
      .orderBy(sql`SUM(${transactionItems.qty}) DESC`)
      .limit(5);

    // ── Transaksi per hari (untuk chart) ────────────────────────
    const dailyChart = await db
      .select({
        day:         sql<string>`DATE(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta')`,
        revenue:     sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
        amountCash:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.paymentMethod} = 'CASH' AND ${transactions.status} = 'COMPLETED'), 0)`,
        amountQris:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.paymentMethod} = 'QRIS' AND ${transactions.status} = 'COMPLETED'), 0)`,
        profit:      sql<string>`COALESCE(SUM(${transactions.grossProfit}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
        txCount:     count(transactions.id),
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.createdAt, start),
          lte(transactions.createdAt, end),
        ),
      )
      .groupBy(sql`DATE(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta')`)
      .orderBy(sql`DATE(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta')`);

    // ── 20 Transaksi terbaru (untuk tabel + tombol Void) ─────────
    const recentTransactions = await db
      .select({
        id:              transactions.id,
        invoiceNumber:   transactions.invoiceNumber,
        paymentMethod:   transactions.paymentMethod,
        status:          transactions.status,
        grossAmount:     transactions.grossAmount,
        cashReceived:    transactions.cashReceived,
        changeAmount:    transactions.changeAmount,
        voidReason:      transactions.voidReason,
        voidedAt:        transactions.voidedAt,
        createdAt:       transactions.createdAt,
        // Nama kasir dari tabel employees
        employeeName:    employees.fullName,
        employeeId:      employees.id,
      })
      .from(transactions)
      .innerJoin(employees, eq(transactions.employeeId, employees.id))
      .where(
        and(
          gte(transactions.createdAt, start),
          lte(transactions.createdAt, end),
        ),
      )
      .orderBy(sql`${transactions.createdAt} DESC`)
      .limit(20);

    return apiOk({
      period: period ?? 'custom',
      label,
      dateFrom: start.toISOString(),
      dateTo:   end.toISOString(),
      summary: {
        grossAmount:  parseFloat(summary?.grossAmount ?? '0'),
        grossProfit:  parseFloat(summary?.grossProfit ?? '0'),
        totalHpp:     parseFloat(summary?.totalHpp ?? '0'),
        totalCount:   summary?.totalCount ?? 0,
        countCash:    Number(summary?.countCash ?? 0),
        countQris:    Number(summary?.countQris ?? 0),
        countVoid:    Number(summary?.countVoid ?? 0),
        // ── BARU: Breakdown nominal per metode ──
        amountCash:   parseFloat(summary?.amountCash ?? '0'),
        amountQris:   parseFloat(summary?.amountQris ?? '0'),
      },
      topProducts,
      dailyChart,
      recentTransactions,
    });
  } catch {
    return apiError('Gagal mengambil data laporan', 500);
  }
}
