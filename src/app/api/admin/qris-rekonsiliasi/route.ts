// =============================================================
// GET  /api/admin/qris-rekonsiliasi — daftar rekonsiliasi per bulan
// POST /api/admin/qris-rekonsiliasi — upsert (submit nominal bank)
//
// Auth: Admin only (sk_admin cookie)
// FinOps: query dibatasi 1 bulan (~31 baris) + limit 100
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { transactions, transactionPayments, qrisReconciliations } from '@/lib/db/schema';
import type { ReconStatus } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { eq, and, gte, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Hitung total QRIS sistem kasir untuk 1 tanggal (WIB) */
async function getSystemQrisForDate(tanggal: string): Promise<number> {
  const startWib  = new Date(`${tanggal}T00:00:00+07:00`);
  const endWib    = new Date(`${tanggal}T23:59:59.999+07:00`);

  // Ambil dari transaction_payments (split payment aware)
  const [row] = await db
    .select({
      totalQris: sql<string>`COALESCE(
        SUM(${transactionPayments.amount})
        FILTER (WHERE ${transactions.status} = 'COMPLETED'
          AND ${transactionPayments.paymentMethod} = 'QRIS'
          AND ${transactions.isTest} = false),
        0
      )`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
    .where(
      and(
        gte(transactions.createdAt, startWib),
        lt(transactions.createdAt, endWib),
      ),
    );

  return Number(row?.totalQris ?? 0);
}

// ── GET: Daftar rekonsiliasi sebulan ────────────────────────────────────────
// Query: ?bulan=2026-10 (YYYY-MM)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Akses ditolak.', 403);
  }

  const { searchParams } = new URL(req.url);
  const bulan = searchParams.get('bulan'); // format: 'YYYY-MM'

  if (!bulan || !/^\d{4}-\d{2}$/.test(bulan)) {
    return apiError("Parameter 'bulan' wajib dengan format YYYY-MM.", 400);
  }

  const [y, m] = bulan.split('-').map(Number);
  const startDate = `${bulan}-01`;
  // Akhir bulan: ambil hari pertama bulan berikutnya − 1 hari
  const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month

  try {
    const rows = await db
      .select({
        id:               qrisReconciliations.id,
        reconDate:        qrisReconciliations.reconDate,
        bankCreditAmount: qrisReconciliations.bankCreditAmount,
        systemQrisAmount: qrisReconciliations.systemQrisAmount,
        status:           qrisReconciliations.status,
        notes:            qrisReconciliations.notes,
        createdAt:        qrisReconciliations.createdAt,
        updatedAt:        qrisReconciliations.updatedAt,
      })
      .from(qrisReconciliations)
      .where(
        and(
          gte(qrisReconciliations.reconDate, startDate),
          lte(qrisReconciliations.reconDate, endDate),
        ),
      )
      .orderBy(qrisReconciliations.reconDate)
      .limit(100);

    // Hitung selisih dan total bulan di application layer
    const rowsWithSelisih = rows.map((r) => {
      const bank    = Number(r.bankCreditAmount);
      const system  = Number(r.systemQrisAmount);
      const selisih = bank - system;
      return { ...r, bankCreditAmount: bank, systemQrisAmount: system, selisih };
    });

    const totalBank   = rowsWithSelisih.reduce((s, r) => s + r.bankCreditAmount, 0);
    const totalSystem = rowsWithSelisih.reduce((s, r) => s + r.systemQrisAmount, 0);
    const totalSelisih = totalBank - totalSystem;

    return apiOk({
      bulan,
      startDate,
      endDate,
      rows: rowsWithSelisih,
      ringkasan: { totalBank, totalSystem, totalSelisih },
    });
  } catch (err) {
    console.error('[qris-rekonsiliasi GET]', err);
    return apiError('Gagal memuat data rekonsiliasi.', 500);
  }
}

// ── POST: Upsert rekonsiliasi (submit / update nominal bank) ─────────────────
const UpsertSchema = z.object({
  reconDate:        z.string().regex(DATE_RE, 'Format tanggal harus YYYY-MM-DD'),
  bankCreditAmount: z.number().nonnegative('Nominal bank tidak boleh negatif'),
  notes:            z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Akses ditolak.', 403);
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Body JSON tidak valid.', 400); }

  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { reconDate, bankCreditAmount, notes } = parsed.data;
  const adminId = payload.sub;

  // Batasi tanggal: tidak boleh > hari ini WIB
  const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  if (reconDate > todayWib) {
    return apiError('Tidak bisa rekonsiliasi tanggal masa depan.', 400);
  }

  try {
    // Hitung system QRIS hari itu
    const systemQrisAmount = await getSystemQrisForDate(reconDate);

    // Tentukan status berdasarkan selisih (toleransi Rp 500)
    const selisih = bankCreditAmount - systemQrisAmount;
    const TOLERANSI = 500;
    const status: ReconStatus =
      Math.abs(selisih) <= TOLERANSI ? 'MATCH' : 'SELISIH';

    // Upsert berdasarkan reconDate (onConflict update)
    const [result] = await db
      .insert(qrisReconciliations)
      .values({
        reconDate,
        bankCreditAmount: String(bankCreditAmount),
        systemQrisAmount: String(systemQrisAmount),
        status,
        notes: notes ?? null,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      })
      .onConflictDoUpdate({
        target: qrisReconciliations.reconDate,
        set: {
          bankCreditAmount: String(bankCreditAmount),
          systemQrisAmount: String(systemQrisAmount),
          status,
          notes: notes ?? null,
          updatedByAdminId: adminId,
          updatedAt: new Date(),
        },
      })
      .returning({
        id:               qrisReconciliations.id,
        reconDate:        qrisReconciliations.reconDate,
        bankCreditAmount: qrisReconciliations.bankCreditAmount,
        systemQrisAmount: qrisReconciliations.systemQrisAmount,
        status:           qrisReconciliations.status,
        selisih:          sql<string>`${qrisReconciliations.bankCreditAmount} - ${qrisReconciliations.systemQrisAmount}`,
      });

    return apiOk({
      ...result,
      bankCreditAmount: Number(result.bankCreditAmount),
      systemQrisAmount: Number(result.systemQrisAmount),
      selisih: bankCreditAmount - systemQrisAmount,
    }, 201);

  } catch (err) {
    console.error('[qris-rekonsiliasi POST]', err);
    return apiError('Gagal menyimpan rekonsiliasi.', 500);
  }
}
