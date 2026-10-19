// =============================================================
// GET /api/admin/laporan/rekap-kasir
// Rekap kinerja per kasir (karyawan) per rentang tanggal.
//
// Query params:
//   dateFrom=YYYY-MM-DD  (default: 7 hari lalu, WIB)
//   dateTo=YYYY-MM-DD    (default: hari ini, WIB)
//   kasirId=<uuid>       (opsional — filter per kasir tertentu)
//
// Response:
//   summary[]  — agregasi per kasir
//   shifts[]   — detail shift per kasir (jika kasirId diisi)
//
// Akses: MANAGER only
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  employees,
  shifts,
  transactions,
  transactionItems,
  transactionPayments,
  shiftCashMovements,
} from '@/lib/db/schema';
import { eq, and, gte, lt, inArray, sql, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ── Helpers: WIB Date boundary ────────────────────────────────
function wibStartOfDay(dateStr: string): Date {
  // dateStr: YYYY-MM-DD dalam WIB (UTC+7)
  // WIB start-of-day = 00:00 WIB = 17:00 UTC hari sebelumnya
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1, 17, 0, 0));
}

function wibEndOfDay(dateStr: string): Date {
  // end-of-day WIB = start-of-day + 24h
  const start = wibStartOfDay(dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Nama/NIM yang dikecualikan dari rekap (akun testing & dummy) */
function isExcludedAccount(name: string, nim: string): boolean {
  const lname = name.toLowerCase();
  const lnim  = nim.toLowerCase();
  return (
    lname.includes('testing') ||
    lname.includes('dede')    ||
    lnim  === '02405013'      ||
    lnim  === '00000000'
  );
}

function todayWib(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysAgoWib(n: number): string {
  const ms = Date.now() + 7 * 60 * 60 * 1000 - n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function validateDate(s: string | null): string | null {
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ── Main Handler ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Auth: MANAGER only
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Rekap Kasir hanya dapat diakses oleh Manager (Dosen).', 403);
  }

  const sp = new URL(req.url).searchParams;

  // Parse params
  const rawFrom    = validateDate(sp.get('dateFrom'));
  const rawTo      = validateDate(sp.get('dateTo'));
  const kasirId    = sp.get('kasirId') ?? null;

  const dateFrom = rawFrom ?? daysAgoWib(6); // 7 hari terakhir (inklusif)
  const dateTo   = rawTo   ?? todayWib();

  // Validasi range max 400 hari
  const diffDays = (wibStartOfDay(dateTo).getTime() - wibStartOfDay(dateFrom).getTime()) / (86400 * 1000);
  if (diffDays < 0)   return apiError('dateFrom tidak boleh melebihi dateTo', 400);
  if (diffDays > 400) return apiError('Rentang maksimal 400 hari', 400);

  const rangeStart       = wibStartOfDay(dateFrom);
  const rangeEndExclusive = wibEndOfDay(dateTo);

  try {
    // ── 1. Daftar semua kasir aktif yang punya shift di periode ini ──
    const allKasirRaw = await db
      .selectDistinct({
        id:       employees.id,
        fullName: employees.fullName,
        nim:      employees.nim,
        jabatan:  employees.jabatan,
      })
      .from(employees)
      .innerJoin(shifts, eq(shifts.employeeId, employees.id))
      .where(
        and(
          eq(employees.isActive, true),
          isNull(employees.deletedAt),
          gte(shifts.clockIn, rangeStart),
          lt(shifts.clockIn, rangeEndExclusive),
          kasirId ? eq(employees.id, kasirId) : undefined,
        ),
      )
      .orderBy(employees.fullName);

    // Kecualikan akun testing & dummy dari semua laporan
    const allKasir = allKasirRaw.filter(
      (k) => !isExcludedAccount(k.fullName, k.nim)
    );

    if (allKasir.length === 0) {
      return apiOk({
        dateFrom,
        dateTo,
        summary: [],
        shiftDetails: [],
      });
    }

    const kasirIds = allKasir.map((k) => k.id);

    // ── 2. Semua shift dalam periode (per kasirId) ──────────────
    const shiftList = await db
      .select({
        id:          shifts.id,
        employeeId:  shifts.employeeId,
        clockIn:     shifts.clockIn,
        clockOut:    shifts.clockOut,
        status:      shifts.status,
        modalAwal:   shifts.modalAwal,
        actualCash:  shifts.actualCash,
        auditFlags:  shifts.auditFlags,
        serahTerimaDiff: shifts.serahTerimaDiff,
      })
      .from(shifts)
      .where(
        and(
          inArray(shifts.employeeId, kasirIds),
          gte(shifts.clockIn, rangeStart),
          lt(shifts.clockIn, rangeEndExclusive),
        ),
      )
      .orderBy(sql`${shifts.clockIn} DESC`)
      .limit(500); // guard

    const shiftIds = shiftList.map((s) => s.id);

    // ── 3. Agregasi transaksi per shift (COMPLETED, non-test) ───
    type TxAgg = {
      shiftId:      string;
      totalOmzet:   string;
      totalHpp:     string;
      txCount:      number;
      voidCount:    number;
      txCountCash:  number;
      txCountQris:  number;
    };

    const txAgg: TxAgg[] = shiftIds.length > 0
      ? await db
          .select({
            shiftId:     transactions.shiftId,
            totalOmzet:  sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false THEN ${transactions.grossAmount} ELSE 0 END), 0)`,
            totalHpp:    sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false THEN ${transactions.totalHpp} ELSE 0 END), 0)`,
            txCount:     sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false THEN 1 END)`,
            voidCount:   sql<number>`COUNT(CASE WHEN ${transactions.status} = 'VOID' THEN 1 END)`,
            txCountCash: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false AND ${transactions.paymentMethod} = 'CASH' THEN 1 END)`,
            txCountQris: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false AND ${transactions.paymentMethod} = 'QRIS' THEN 1 END)`,
          })
          .from(transactions)
          .where(inArray(transactions.shiftId, shiftIds))
          .groupBy(transactions.shiftId) as TxAgg[]
      : [];

    const txByShift = new Map<string, TxAgg>();
    for (const t of txAgg) txByShift.set(t.shiftId, t);

    // ── 4. Petty cash movements per shift ──────────────────────
    const cashMovements = shiftIds.length > 0
      ? await db
          .select({
            shiftId:      shiftCashMovements.shiftId,
            movementType: shiftCashMovements.movementType,
            total:        sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
          })
          .from(shiftCashMovements)
          .where(inArray(shiftCashMovements.shiftId, shiftIds))
          .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType)
      : [];

    const cashOutMap = new Map<string, number>();
    const cashInMap  = new Map<string, number>();
    for (const m of cashMovements) {
      const val = parseFloat(m.total || '0');
      if (m.movementType === 'CASH_OUT') cashOutMap.set(m.shiftId, val);
      else if (m.movementType === 'CASH_IN')  cashInMap.set(m.shiftId, val);
    }

    // ── 5. Cash sales per shift (split payment aware) ──────────
    const splitCash = shiftIds.length > 0
      ? await db
          .select({
            shiftId: transactions.shiftId,
            total:   sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(and(
            inArray(transactions.shiftId, shiftIds),
            eq(transactions.status, 'COMPLETED'),
            eq(transactionPayments.paymentMethod, 'CASH'),
            eq(transactions.isTest, false),
          ))
          .groupBy(transactions.shiftId)
      : [];

    const cashSalesMap = new Map<string, number>();
    for (const s of splitCash) {
      cashSalesMap.set(s.shiftId, (cashSalesMap.get(s.shiftId) ?? 0) + parseFloat(s.total || '0'));
    }

    // Legacy CASH (no transaction_payments row)
    const directCash = shiftIds.length > 0
      ? await db
          .select({
            shiftId: transactions.shiftId,
            total:   sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
          })
          .from(transactions)
          .where(and(
            inArray(transactions.shiftId, shiftIds),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.paymentMethod, 'CASH'),
            eq(transactions.isTest, false),
            sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
          ))
          .groupBy(transactions.shiftId)
      : [];

    for (const d of directCash) {
      cashSalesMap.set(d.shiftId, (cashSalesMap.get(d.shiftId) ?? 0) + parseFloat(d.total || '0'));
    }

    // ── 6. Top item per kasir ───────────────────────────────────
    // Ambil 1 produk terlaris per kasir menggunakan subquery (simplified)
    const topItems = shiftIds.length > 0
      ? await db
          .select({
            employeeId:  transactions.employeeId,
            productName: transactionItems.productNameSnapshot,
            totalQty:    sql<number>`SUM(${transactionItems.qty})`,
          })
          .from(transactionItems)
          .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
          .where(and(
            inArray(transactions.shiftId, shiftIds),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.isTest, false),
          ))
          .groupBy(transactions.employeeId, transactionItems.productNameSnapshot)
          .orderBy(sql`SUM(${transactionItems.qty}) DESC`)
          .limit(kasirIds.length * 5) // top 5 per kasir estimate
      : [];

    // Group top item per kasir
    const topItemByKasir = new Map<string, string>();
    for (const item of topItems) {
      if (!topItemByKasir.has(item.employeeId)) {
        topItemByKasir.set(item.employeeId, item.productName);
      }
    }

    // ── 7. Assemble shift detail rows ───────────────────────────
    const shiftDetails = shiftList.map((s) => {
      const tx         = txByShift.get(s.id);
      const modalAwal  = s.modalAwal  ? parseFloat(s.modalAwal)  : 0;
      const actualCash = s.actualCash ? parseFloat(s.actualCash) : null;
      const omzet      = tx ? parseFloat(tx.totalOmzet) : 0;
      const hpp        = tx ? parseFloat(tx.totalHpp)   : 0;
      const cashSales  = cashSalesMap.get(s.id) ?? 0;
      const cashOut    = cashOutMap.get(s.id)   ?? 0;
      const cashIn     = cashInMap.get(s.id)    ?? 0;
      const expectedCash = modalAwal + cashSales - cashOut + cashIn;
      const discrepancy  = actualCash !== null ? actualCash - expectedCash : null;

      let statusLaci: 'RUNNING' | 'BALANCED' | 'SHORTAGE' | 'OVERAGE' = 'RUNNING';
      let discrepancyTier: 'HIJAU' | 'KUNING' | 'MERAH' | 'OVERAGE' = 'HIJAU';

      if (s.status === 'CLOSED') {
        if (discrepancy === null || Math.abs(discrepancy) <= 2000) {
          statusLaci = 'BALANCED'; discrepancyTier = 'HIJAU';
        } else if (discrepancy < 0) {
          statusLaci = 'SHORTAGE';
          discrepancyTier = discrepancy < -20000 ? 'MERAH' : 'KUNING';
        } else {
          statusLaci = 'OVERAGE'; discrepancyTier = 'OVERAGE';
        }
      }

      // Durasi shift dalam menit
      const durMins = s.clockOut
        ? Math.round((new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime()) / 60000)
        : null;

      return {
        shiftId:         s.id,
        employeeId:      s.employeeId,
        clockIn:         s.clockIn,
        clockOut:        s.clockOut,
        status:          s.status,
        durasiMenit:     durMins,
        modalAwal,
        omzet,
        hpp,
        labaKotor:       omzet - hpp,
        txCount:         Number(tx?.txCount    ?? 0),
        voidCount:       Number(tx?.voidCount  ?? 0),
        txCountCash:     Number(tx?.txCountCash ?? 0),
        txCountQris:     Number(tx?.txCountQris ?? 0),
        cashSales,
        cashOut,
        cashIn,
        expectedCash,
        actualCash,
        discrepancy,
        statusLaci,
        discrepancyTier,
        serahTerimaDiff: s.serahTerimaDiff ? parseFloat(s.serahTerimaDiff) : null,
        auditFlags:      s.auditFlags ?? '',
      };
    });

    // ── 8. Agregasi per kasir (summary) ────────────────────────
    const summaryMap = new Map<string, {
      kasirId:           string;
      kasirName:         string;
      kasirNim:          string;
      jabatan:           string;
      totalShift:        number;
      totalOmzet:        number;
      totalHpp:          number;
      totalLabaKotor:    number;
      totalTxCount:      number;
      totalVoidCount:    number;
      totalTxCash:       number;
      totalTxQris:       number;
      totalPenjualanCash: number;
      totalPenjualanQris: number;
      totalModalAwal:    number;
      avgOmzetPerShift:  number;
      topProduk:         string;
      totalDurasiMenit:  number;
      selisihLaciCount:  { hijau: number; kuning: number; merah: number; overage: number };
    }>();

    for (const k of allKasir) {
      summaryMap.set(k.id, {
        kasirId:            k.id,
        kasirName:          k.fullName,
        kasirNim:           k.nim,
        jabatan:            k.jabatan,
        totalShift:         0,
        totalOmzet:         0,
        totalHpp:           0,
        totalLabaKotor:     0,
        totalTxCount:       0,
        totalVoidCount:     0,
        totalTxCash:        0,
        totalTxQris:        0,
        totalPenjualanCash: 0,
        totalPenjualanQris: 0,
        totalModalAwal:     0,
        avgOmzetPerShift:   0,
        topProduk:          topItemByKasir.get(k.id) ?? '—',
        totalDurasiMenit:   0,
        selisihLaciCount:   { hijau: 0, kuning: 0, merah: 0, overage: 0 },
      });
    }

    for (const s of shiftDetails) {
      const rec = summaryMap.get(s.employeeId);
      if (!rec) continue;
      rec.totalShift++;
      rec.totalOmzet          += s.omzet;
      rec.totalHpp            += s.hpp;
      rec.totalLabaKotor      += s.labaKotor;
      rec.totalTxCount        += s.txCount;
      rec.totalVoidCount      += s.voidCount;
      rec.totalTxCash         += s.txCountCash;
      rec.totalTxQris         += s.txCountQris;
      rec.totalPenjualanCash  += s.cashSales;   // nominal Rp cash masuk laci
      // Omzet QRIS = total omzet shift dikurangi cash sales
      rec.totalPenjualanQris  += Math.max(0, s.omzet - s.cashSales);
      rec.totalModalAwal      += s.modalAwal;
      if (s.durasiMenit) rec.totalDurasiMenit += s.durasiMenit;
      if (s.status === 'CLOSED') {
        if (s.discrepancyTier === 'HIJAU')   rec.selisihLaciCount.hijau++;
        if (s.discrepancyTier === 'KUNING')  rec.selisihLaciCount.kuning++;
        if (s.discrepancyTier === 'MERAH')   rec.selisihLaciCount.merah++;
        if (s.discrepancyTier === 'OVERAGE') rec.selisihLaciCount.overage++;
      }
    }

    // Hitung rata-rata per shift
    for (const rec of summaryMap.values()) {
      if (rec.totalShift > 0) {
        rec.avgOmzetPerShift = Math.round(rec.totalOmzet / rec.totalShift);
      }
    }

    const summary = [...summaryMap.values()].sort((a, b) => b.totalOmzet - a.totalOmzet);

    return apiOk({
      dateFrom,
      dateTo,
      totalKasir: summary.length,
      summary,
      shiftDetails: kasirId ? shiftDetails.filter((s) => s.employeeId === kasirId) : shiftDetails,
    });
  } catch {
    return apiError('Gagal mengambil data rekap kasir', 500);
  }
}
