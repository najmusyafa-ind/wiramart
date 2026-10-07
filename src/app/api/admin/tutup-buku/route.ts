// =============================================================
// /api/admin/tutup-buku — Ritual Tutup Buku Harian Dosen (Manager)
// Locking Period Finansial Wiramart UNPERBA (Fase 3 & Bagian 13 I1/I2)
//
// GET:  Status & Preview Tutup Buku untuk tanggal tertentu (?date=YYYY-MM-DD)
// POST: Eksekusi Tutup Buku & Kunci Finansial Harian (Status: LOCKED)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  dailyClosings,
  shifts,
  auditLogs,
  transactionPayments,
  transactions,
} from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { getFinancialReport, resolveReportRange } from '@/lib/finance/report';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── GET: Preview / Status Tutup Buku ──────────────────────────
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');

    const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const targetDate = dateParam && DATE_RE.test(dateParam) ? dateParam : todayWib;

    // 1. Cek apakah tanggal ini sudah pernah ditutup buku
    const existingClosing = await db.query.dailyClosings.findFirst({
      where: eq(dailyClosings.closingDate, targetDate),
    });

    // 2. Hitung angka finansial resmi untuk tanggal ini (WIB)
    const range = resolveReportRange({ period: 'daily', dateFrom: targetDate, dateTo: targetDate });
    const report = await getFinancialReport(range);
    const s = report.summary;

    // 3. Ambil shifts pada tanggal ini untuk menghitung total selisih fisik laci
    const dayShifts = await db
      .select({
        id: shifts.id,
        status: shifts.status,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
      })
      .from(shifts)
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)));

    const activeShiftsCount = dayShifts.filter((sh) => sh.status === 'ACTIVE').length;

    // Hitung total selisih kas dari shift yang sudah CLOSED
    // (Actual Cash - Expected Cash)
    let totalCashDiscrepancy = 0;
    for (const sh of dayShifts) {
      if (sh.status === 'CLOSED' && sh.actualCash !== null && sh.modalAwal !== null) {
        // Ambil penjualan tunai untuk shift ini
        const [sales] = await db
          .select({
            total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(
            and(
              eq(transactions.shiftId, sh.id),
              eq(transactions.status, 'COMPLETED'),
              eq(transactionPayments.paymentMethod, 'CASH'),
              eq(transactions.isTest, false),
            ),
          );

        const modal = Number(sh.modalAwal);
        const actual = Number(sh.actualCash);
        const cashSales = Number(sales?.total ?? 0);
        const expected = modal + cashSales;
        totalCashDiscrepancy += actual - expected;
      }
    }

    // Evaluasi tingkat keparahan selisih kas (Bagian 18 K7)
    let selisihSeverity: 'HIJAU' | 'KUNING' | 'MERAH' = 'HIJAU';
    if (totalCashDiscrepancy < -20000) {
      selisihSeverity = 'MERAH'; // Tekor berat
    } else if (totalCashDiscrepancy < -2000) {
      selisihSeverity = 'KUNING'; // Tekor sedang
    }

    return apiOk({
      targetDate,
      isLocked: existingClosing?.status === 'LOCKED' || existingClosing?.status === 'AUDITED',
      closing: existingClosing ?? null,
      preview: {
        omzet: s.omzet,
        omzetCash: s.omzetCash,
        omzetQris: s.omzetQris,
        hppTerjual: s.hppTerjual,
        labaKotor: s.labaKotor,
        biayaOperasional: s.biayaOperasional,
        labaBersih: s.labaBersih,
        totalCashDiscrepancy,
        selisihSeverity,
        activeShiftsCount,
        txCount: s.txCount,
      },
    });
  } catch (err) {
    console.error('[tutup-buku GET]', err);
    return apiError('Gagal memuat status tutup buku', 'SERVER_ERROR', 500);
  }
}

// ── POST: Eksekusi Tutup Buku & Kunci Harian ──────────────────
const tutupBukuSchema = z.object({
  closingDate: z.string().regex(DATE_RE, 'Format tanggal harus YYYY-MM-DD'),
  notes: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const admin = await requireAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Format request tidak valid', 'INVALID_JSON', 400);
    }

    const parsed = tutupBukuSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 'VALIDATION_ERROR', 422);
    }

    const { closingDate, notes } = parsed.data;

    // 1. Cek apakah ada shift yang masih AKTIF di tanggal ini
    const range = resolveReportRange({ period: 'daily', dateFrom: closingDate, dateTo: closingDate });
    const activeShifts = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          gte(shifts.clockIn, range.start),
          lt(shifts.clockIn, range.endExclusive),
          eq(shifts.status, 'ACTIVE'),
        ),
      );

    if (activeShifts.length > 0) {
      return apiError(
        `Masih ada ${activeShifts.length} shift kasir yang AKTIF pada tanggal ${closingDate}. Pastikan semua kasir sudah tutup shift terlebih dahulu sebelum Tutup Buku.`,
        'ACTIVE_SHIFTS_REMAIN',
        400,
      );
    }

    // 2. Hitung angka finansial baku resmi
    const report = await getFinancialReport(range);
    const s = report.summary;

    // 3. Hitung selisih kas fisik
    const dayShifts = await db
      .select({
        id: shifts.id,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
      })
      .from(shifts)
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)));

    let totalCashDiscrepancy = 0;
    for (const sh of dayShifts) {
      if (sh.actualCash !== null && sh.modalAwal !== null) {
        const [sales] = await db
          .select({
            total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(
            and(
              eq(transactions.shiftId, sh.id),
              eq(transactions.status, 'COMPLETED'),
              eq(transactionPayments.paymentMethod, 'CASH'),
              eq(transactions.isTest, false),
            ),
          );

        const modal = Number(sh.modalAwal);
        const actual = Number(sh.actualCash);
        const cashSales = Number(sales?.total ?? 0);
        totalCashDiscrepancy += actual - (modal + cashSales);
      }
    }

    // 4. Upsert ke daily_closings
    const [result] = await db
      .insert(dailyClosings)
      .values({
        closingDate,
        totalOmzet: s.omzet.toString(),
        omzetCash: s.omzetCash.toString(),
        omzetQris: s.omzetQris.toString(),
        totalHpp: s.hppTerjual.toString(),
        grossProfit: s.labaKotor.toString(),
        operatingExpenses: s.biayaOperasional.toString(),
        qrisFee: '0',
        cashDiscrepancy: totalCashDiscrepancy.toString(),
        netProfit: s.labaBersih.toString(),
        status: 'LOCKED',
        notes: notes || null,
        closedByAdminId: admin.sub,
      })
      .onConflictDoUpdate({
        target: dailyClosings.closingDate,
        set: {
          totalOmzet: s.omzet.toString(),
          omzetCash: s.omzetCash.toString(),
          omzetQris: s.omzetQris.toString(),
          totalHpp: s.hppTerjual.toString(),
          grossProfit: s.labaKotor.toString(),
          operatingExpenses: s.biayaOperasional.toString(),
          cashDiscrepancy: totalCashDiscrepancy.toString(),
          netProfit: s.labaBersih.toString(),
          status: 'LOCKED',
          notes: notes || null,
          closedByAdminId: admin.sub,
          updatedAt: new Date(),
        },
      })
      .returning();

    // 5. Audit Log resmi
    if (result) {
      await db.insert(auditLogs).values({
        tableName: 'daily_closings',
        recordId: result.id,
        action: 'UPDATE',
        newValues: JSON.stringify({
          closingDate,
          totalOmzet: s.omzet,
          netProfit: s.labaBersih,
          status: 'LOCKED',
          notes: notes || null,
        }),
        actorType: 'ADMIN',
        actorId: admin.sub,
      });
    }

    return apiOk({
      message: `Tutup Buku Harian tanggal ${closingDate} berhasil dikunci.`,
      closing: result,
    });
  } catch (err) {
    console.error('[tutup-buku POST]', err);
    return apiError('Gagal melakukan tutup buku harian', 'SERVER_ERROR', 500);
  }
}
