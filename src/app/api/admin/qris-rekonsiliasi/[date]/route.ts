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

  const { date } = await ctx.params;

  if (!DATE_RE.test(date)) {
    return apiError("Format tanggal tidak valid. Gunakan YYYY-MM-DD.", 400);
  }

  try {
    const startWib = new Date(`${date}T00:00:00+07:00`);
    const endWib   = new Date(`${date}T23:59:59.999+07:00`);

    // Ambil rekap transaksi QRIS hari itu (per jam, untuk breakdown)
    const breakdown = await db
      .select({
        jam:          sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'HH24:00')`,
        jumlahTx:     sql<number>`COUNT(DISTINCT ${transactions.id}) FILTER (WHERE ${transactions.status} = 'COMPLETED')`,
        totalQris:    sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'QRIS' AND ${transactions.isTest} = false), 0)`,
      })
      .from(transactionPayments)
      .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
      .where(
        and(
          gte(transactions.createdAt, startWib),
          lt(transactions.createdAt, endWib),
        ),
      )
      .groupBy(sql`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'HH24:00')`)
      .orderBy(sql`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'HH24:00')`);

    // Total QRIS sistem
    const systemQrisAmount = breakdown.reduce((s, r) => s + Number(r.totalQris), 0);

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
