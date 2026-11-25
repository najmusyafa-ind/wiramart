// =============================================================
// GET /api/admin/qris-rekonsiliasi/[date]
// Ambil detail rekonsiliasi 1 tanggal + preview system QRIS real-time
//
// Param: date = 'YYYY-MM-DD'
// Auth: Admin only
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { transactions, transactionPayments, qrisReconciliations } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { addDays } from '@/lib/finance/report';
import { eq, and, gte, lt, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RouteContext {
  params: Promise<{ date: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Akses ditolak.', 403);
  }
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Rekonsiliasi QRIS bank khusus untuk Manager.', 403);
  }

  const { date } = await ctx.params;

  if (!DATE_RE.test(date)) {
    return apiError("Format tanggal tidak valid. Gunakan YYYY-MM-DD.", 400);
  }

  try {
    const startWib = new Date(`${date}T00:00:00+07:00`);
    const endExclusive = new Date(`${addDays(date, 1)}T00:00:00+07:00`);
    const HOUR_EXPR = sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'HH24:00')`;

    // Ambil rekap transaksi QRIS hari itu per jam (split-payment + legacy tanpa baris transaction_payments)
    const [payBreakdown, legacyBreakdown] = await Promise.all([
      db
        .select({
          jam:       HOUR_EXPR,
          jumlahTx:  sql<number>`COUNT(DISTINCT ${transactions.id})::int`,
          totalQris: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
        })
        .from(transactionPayments)
        .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
        .where(
          and(
            gte(transactions.createdAt, startWib),
            lt(transactions.createdAt, endExclusive),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.isTest, false),
            eq(transactionPayments.paymentMethod, 'QRIS'),
          ),
        )
        .groupBy(HOUR_EXPR),
      db
        .select({
          jam:       HOUR_EXPR,
          jumlahTx:  sql<number>`COUNT(*)::int`,
          totalQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            gte(transactions.createdAt, startWib),
            lt(transactions.createdAt, endExclusive),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.isTest, false),
            eq(transactions.paymentMethod, 'QRIS'),
            sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = ${transactions.id})`,
          ),
        )
        .groupBy(HOUR_EXPR),
    ]);

    const hourMap = new Map<string, { jam: string; jumlahTx: number; totalQris: number }>();
    for (const r of payBreakdown) {
      hourMap.set(r.jam, { jam: r.jam, jumlahTx: Number(r.jumlahTx), totalQris: Number(r.totalQris) });
    }
    for (const r of legacyBreakdown) {
      const cur = hourMap.get(r.jam) ?? { jam: r.jam, jumlahTx: 0, totalQris: 0 };
      cur.jumlahTx += Number(r.jumlahTx);
      cur.totalQris += Number(r.totalQris);
      hourMap.set(r.jam, cur);
    }
    const breakdown = [...hourMap.values()].sort((a, b) => a.jam.localeCompare(b.jam));

    // Total QRIS sistem
    const systemQrisAmount = breakdown.reduce((s, r) => s + r.totalQris, 0);

    // Cari record rekonsiliasi yang sudah tersimpan (jika ada)
    const existing = await db.query.qrisReconciliations.findFirst({
      where: eq(qrisReconciliations.reconDate, date),
      columns: {
        id:               true,
        bankCreditAmount: true,
        status:           true,
        notes:            true,
        updatedAt:        true,
      },
    });

    const bankCreditAmount = existing ? Number(existing.bankCreditAmount) : 0;
    const selisih          = bankCreditAmount - systemQrisAmount;

    return apiOk({
      tanggal:           date,
      systemQrisAmount,
      bankCreditAmount,
      selisih,
      statusExisting:    existing?.status ?? 'BELUM_DIREKONSILIASI',
      notes:             existing?.notes ?? null,
      lastUpdated:       existing?.updatedAt ?? null,
      breakdownPerJam:   breakdown.map(r => ({
        jam:       r.jam,
        jumlahTx:  r.jumlahTx,
        totalQris: Number(r.totalQris),
      })),
    });

  } catch (err) {
    console.error('[qris-rekonsiliasi/[date] GET]', err);
    return apiError('Gagal memuat detail rekonsiliasi.', 500);
  }
}
