// =============================================================
// /api/admin/tutup-buku — Ritual Tutup Buku Harian Dosen (Manager)
// Locking Period Finansial Wiramart UNPERBA (Fase 3 & Bagian 13 I1/I2)
//
// GET:  Status & Preview Tutup Buku:
//       - Rincian per shift (Shift 1 Pagi vs Shift 2 Siang)
//       - Rekap konsolidasi harian toko jam 15:00
// POST: Eksekusi Tutup Buku & Kunci Finansial Harian (Status: LOCKED)
// Auth: Manager (Dosen) Only — requireManager()
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, gte, lt, sql, asc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  dailyClosings,
  shifts,
  employees,
  auditLogs,
  transactionPayments,
  transactions,
  shiftCashMovements,
} from '@/lib/db/schema';
import { requireManager } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { getFinancialReport, resolveReportRange } from '@/lib/finance/report';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ShiftDetailReport = {
  shiftId: string;
  shiftName: string; // 'Shift 1 (Pagi)' | 'Shift 2 (Siang)'
  employeeId: string;
  employeeName: string;
  employeeNim: string;
  status: 'ACTIVE' | 'CLOSED';
  clockIn: string;
  clockOut: string | null;
  modalAwal: number;
  cashSales: number;
  qrisSales: number;
  totalOmzet: number;
  txCount: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number | null;
  selisih: number | null;
  auditFlags: string | null;
  notes: string | null;
};

// ── GET: Preview / Status Tutup Buku ──────────────────────────
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireManager();

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

    // 3. Ambil shifts pada tanggal ini beserta identitas karyawan
    const dayShifts = await db
      .select({
        id: shifts.id,
        status: shifts.status,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
        auditFlags: shifts.auditFlags,
        notes: shifts.notes,
        employeeId: shifts.employeeId,
        employeeName: employees.fullName,
        employeeNim: employees.nim,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)))
      .orderBy(asc(shifts.clockIn));

    const activeShiftsCount = dayShifts.filter((sh) => sh.status === 'ACTIVE').length;

    // 4. Hitung rincian per-shift dan total selisih kas fisik
    const shiftDetailsList: ShiftDetailReport[] = [];
    let totalCashDiscrepancy = 0;

    for (const sh of dayShifts) {
      // Penjualan per shift (Cash vs QRIS)
      const [payRow] = await db
        .select({
          cash: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactionPayments.paymentMethod} = 'CASH'), 0)`,
          qris: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactionPayments.paymentMethod} = 'QRIS'), 0)`,
          txCount: sql<number>`COUNT(DISTINCT ${transactions.id})`,
        })
        .from(transactionPayments)
        .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
        .where(
          and(
            eq(transactions.shiftId, sh.id),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.isTest, false),
          ),
        );

      // Gerakan Kas / Petty Cash (CASH_IN vs CASH_OUT)
      const [movements] = await db
        .select({
          cashIn: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_IN'), 0)`,
          cashOut: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_OUT'), 0)`,
        })
        .from(shiftCashMovements)
        .where(eq(shiftCashMovements.shiftId, sh.id));

      const modal = Number(sh.modalAwal ?? 100_000);
      const cashSales = Number(payRow?.cash ?? 0);
      const qrisSales = Number(payRow?.qris ?? 0);
      const txCount = Number(payRow?.txCount ?? 0);
      const cashIn = Number(movements?.cashIn ?? 0);
      const cashOut = Number(movements?.cashOut ?? 0);

      // Expected Cash di laci = Modal + Cash Sales + Kas Masuk - Kas Keluar
      const expectedCash = modal + cashSales + cashIn - cashOut;
      const actualCash = sh.actualCash !== null ? Number(sh.actualCash) : null;
      const selisih = actualCash !== null ? actualCash - expectedCash : null;

      if (sh.status === 'CLOSED' && selisih !== null) {
        totalCashDiscrepancy += selisih;
      }

      // Deteksi penamaan Shift berdasarkan jam clockIn (WIB)
      // Pagi: < 11:30 WIB | Siang: >= 11:30 WIB
      const clockInDate = new Date(sh.clockIn);
      const hourWib = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(clockInDate),
        10,
      );
      const minuteWib = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', minute: 'numeric' }).format(clockInDate),
        10,
      );
      const isPagi = hourWib < 11 || (hourWib === 11 && minuteWib < 30);
      const shiftName = isPagi ? 'Shift 1 (Pagi)' : 'Shift 2 (Siang)';

      shiftDetailsList.push({
        shiftId: sh.id,
        shiftName,
        employeeId: sh.employeeId,
        employeeName: sh.employeeName,
        employeeNim: sh.employeeNim,
        status: sh.status,
        clockIn: sh.clockIn.toISOString(),
        clockOut: sh.clockOut ? sh.clockOut.toISOString() : null,
        modalAwal: modal,
        cashSales,
        qrisSales,
        totalOmzet: cashSales + qrisSales,
        txCount,
        cashIn,
        cashOut,
        expectedCash,
        actualCash,
        selisih,
        auditFlags: sh.auditFlags,
        notes: sh.notes,
      });
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
      shifts: shiftDetailsList,
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
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
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
    const admin = await requireManager();

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

    // 3. Hitung selisih kas fisik akumulasi (memperhitungkan petty cash)
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
      if (sh.actualCash !== null) {
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

        const [movements] = await db
          .select({
            cashIn: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_IN'), 0)`,
            cashOut: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_OUT'), 0)`,
          })
          .from(shiftCashMovements)
          .where(eq(shiftCashMovements.shiftId, sh.id));

        const modal = Number(sh.modalAwal ?? 100_000);
        const actual = Number(sh.actualCash);
        const cashSales = Number(sales?.total ?? 0);
        const cashIn = Number(movements?.cashIn ?? 0);
        const cashOut = Number(movements?.cashOut ?? 0);
        const expected = modal + cashSales + cashIn - cashOut;

        totalCashDiscrepancy += actual - expected;
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
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[tutup-buku POST]', err);
    return apiError('Gagal melakukan tutup buku harian', 'SERVER_ERROR', 500);
  }
}
