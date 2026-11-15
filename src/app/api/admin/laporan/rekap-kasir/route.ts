// =============================================================
// GET /api/admin/laporan/rekap-kasir
// Rekap kinerja per kasir (karyawan) & rekapan per jam (WIB).
//
// Query params:
//   period=<PeriodKey>   (daily|weekly|monthly|semi_annual|october|november|oct_nov|all)
//   dateFrom=YYYY-MM-DD  (default: 7 hari terakhir inklusif, WIB)
//   dateTo=YYYY-MM-DD    (default: hari ini, WIB)
//   kasirId=<uuid>       (opsional — filter per kasir tertentu)
//
// Response:
//   dateFrom, dateTo, periodLabel, totalKasir
//   summary[]         — agregasi per kasir berbasis transactions.employeeId (ikutkan co-cashier & non-aktif)
//   shiftDetails[]    — audit laci per sesi shift (termasuk rekan co-cashier)
//   hourlyBreakdown[] — rekapan penjualan per jam WIB (0..23)
//
// Akses: MANAGER only
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  attendances,
  employees,
  shifts,
  transactions,
  transactionItems,
  transactionPayments,
  shiftCashMovements,
} from '@/lib/db/schema';
import { eq, and, gte, lt, lte, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  InvalidRangeError,
  isPeriodKey,
  resolveReportRange,
  wibToday,
  addDays,
  type PeriodKey,
} from '@/lib/finance/report';
import { EXPORT_MAX_ROWS } from '@/lib/services/exportWorkbookService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SQL_IN_CHUNK_SIZE = 1_500;

function isExcludedAccount(name: string, nim: string): boolean {
  const lname = name.toLowerCase();
  const lnim = nim.toLowerCase();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lname.includes('ketua umkm') ||
    lnim === '02405013' ||
    lnim === '00000000'
  );
}

function chunkArray<T>(items: readonly T[], size = SQL_IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function fmtHourWibLabel(hour: number): string {
  const hh = String(hour).padStart(2, '0');
  return `${hh}:00 - ${hh}:59 WIB`;
}

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Rekap Kasir hanya dapat diakses oleh Manager (Dosen).', 403);
  }

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  const rawFrom = sp.get('dateFrom') || undefined;
  const rawTo = sp.get('dateTo') || undefined;
  const kasirId = sp.get('kasirId') || null;

  if (rawPeriod && !isPeriodKey(rawPeriod)) {
    return apiError(`Parameter period '${rawPeriod}' tidak valid`, 400);
  }

  let period: PeriodKey = 'weekly';
  let dateFromParam = rawFrom;
  let dateToParam = rawTo;

  if (rawPeriod && isPeriodKey(rawPeriod)) {
    period = rawPeriod;
  } else if (!rawFrom && !rawTo) {
    const today = wibToday();
    dateFromParam = addDays(today, -6);
    dateToParam = today;
  } else if (rawFrom && !rawTo) {
    dateToParam = wibToday();
  } else if (!rawFrom && rawTo) {
    dateFromParam = addDays(rawTo, -6);
  }

  let range;
  try {
    range = resolveReportRange({
      period,
      dateFrom: dateFromParam,
      dateTo: dateToParam,
    });
  } catch (err: unknown) {
    if (err instanceof InvalidRangeError) {
      return apiError(err.message, 400);
    }
    return apiError('Parameter tanggal tidak valid', 400);
  }

  const rangeStart = range.start;
  const rangeEndExclusive = range.endExclusive;
  const dateFrom = range.startDate;
  const dateTo = range.endDate;

  try {
    // ── 1. Temukan seluruh kasir yang terlibat di periode ini (shift opener, transaksi co-cashier, absensi shift)
    // Tidak memfilter isActive = true agar riwayat kasir non-aktif historis tetap terjaga!
    const [shiftOwnerEmpRows, trxEmpRows, attEmpRows] = kasirId
      ? [[{ employeeId: kasirId }], [], []]
      : await Promise.all([
          db
            .selectDistinct({ employeeId: shifts.employeeId })
            .from(shifts)
            .where(and(gte(shifts.clockIn, rangeStart), lt(shifts.clockIn, rangeEndExclusive))),
          db
            .selectDistinct({ employeeId: transactions.employeeId })
            .from(transactions)
            .where(
              and(
                eq(transactions.isTest, false),
                gte(transactions.createdAt, rangeStart),
                lt(transactions.createdAt, rangeEndExclusive),
              ),
            ),
          db
            .selectDistinct({ employeeId: attendances.employeeId })
            .from(attendances)
            .where(
              and(
                isNotNull(attendances.shiftId),
                gte(attendances.attendanceDate, dateFrom),
                lte(attendances.attendanceDate, dateTo),
              ),
            ),
        ]);

    const candidateEmpIds = [
      ...new Set([
        ...shiftOwnerEmpRows.map((r) => r.employeeId),
        ...trxEmpRows.map((r) => r.employeeId),
        ...attEmpRows.map((r) => r.employeeId),
      ]),
    ];

    const allKasirRaw: Array<{
      id: string;
      fullName: string;
      nim: string;
      jabatan: string;
      isActive: boolean;
    }> = [];

    for (const idChunk of chunkArray(candidateEmpIds)) {
      const empChunk = await db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          nim: employees.nim,
          jabatan: employees.jabatan,
          isActive: employees.isActive,
        })
        .from(employees)
        .where(and(inArray(employees.id, idChunk), isNull(employees.deletedAt)));
      allKasirRaw.push(...empChunk);
    }

    const allKasir = allKasirRaw
      .filter((k) => !isExcludedAccount(k.fullName, k.nim))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'id'));

    if (allKasir.length === 0) {
      return apiOk({
        dateFrom,
        dateTo,
        periodLabel: range.label,
        totalKasir: 0,
        summary: [],
        shiftDetails: [],
        hourlyBreakdown: [],
      });
    }

    const kasirIds = allKasir.map((k) => k.id);

    // ── 2. Agregasi penjualan PER-KASIR murni berbasis transactions.employeeId ──
    type PersonalTxAgg = {
      employeeId: string;
      totalOmzet: string;
      totalHpp: string;
      txCount: number;
      voidCount: number;
      txCountCash: number;
      txCountQris: number;
    };

    const personalAggList: PersonalTxAgg[] = [];
    const personalCashMap = new Map<string, number>();
    const personalQrisMap = new Map<string, number>();
    const topItemByKasir = new Map<string, { name: string; qty: number }>();

    for (const idChunk of chunkArray(kasirIds)) {
      const [chunkPersonalAgg, chunkSplitPays, chunkDirectPays, chunkTopItems] = await Promise.all([
        db
          .select({
            employeeId: transactions.employeeId,
            totalOmzet: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' THEN ${transactions.grossAmount} ELSE 0 END), 0)`,
            totalHpp: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' THEN ${transactions.totalHpp} ELSE 0 END), 0)`,
            txCount: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' THEN 1 END)::int`,
            voidCount: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'VOID' THEN 1 END)::int`,
            txCountCash: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'CASH' THEN 1 END)::int`,
            txCountQris: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'QRIS' THEN 1 END)::int`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
            ),
          )
          .groupBy(transactions.employeeId) as Promise<PersonalTxAgg[]>,
        db
          .select({
            employeeId: transactions.employeeId,
            paymentMethod: transactionPayments.paymentMethod,
            total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
            ),
          )
          .groupBy(transactions.employeeId, transactionPayments.paymentMethod),
        db
          .select({
            employeeId: transactions.employeeId,
            paymentMethod: transactions.paymentMethod,
            total: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
              sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
            ),
          )
          .groupBy(transactions.employeeId, transactions.paymentMethod),
        db
          .select({
            employeeId: transactions.employeeId,
            productName: transactionItems.productNameSnapshot,
            totalQty: sql<number>`COALESCE(SUM(${transactionItems.qty}), 0)::int`,
          })
          .from(transactionItems)
          .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
            ),
          )
          .groupBy(transactions.employeeId, transactionItems.productNameSnapshot)
          .orderBy(sql`COALESCE(SUM(${transactionItems.qty}), 0) DESC`),
      ]);

      personalAggList.push(...chunkPersonalAgg);

      for (const spRow of chunkSplitPays) {
        const val = parseFloat(spRow.total || '0') || 0;
        if (spRow.paymentMethod === 'CASH') {
          personalCashMap.set(spRow.employeeId, (personalCashMap.get(spRow.employeeId) ?? 0) + val);
        } else if (spRow.paymentMethod === 'QRIS') {
          personalQrisMap.set(spRow.employeeId, (personalQrisMap.get(spRow.employeeId) ?? 0) + val);
        }
      }

      for (const dpRow of chunkDirectPays) {
        const val = parseFloat(dpRow.total || '0') || 0;
        if (dpRow.paymentMethod === 'CASH') {
          personalCashMap.set(dpRow.employeeId, (personalCashMap.get(dpRow.employeeId) ?? 0) + val);
        } else if (dpRow.paymentMethod === 'QRIS') {
          personalQrisMap.set(dpRow.employeeId, (personalQrisMap.get(dpRow.employeeId) ?? 0) + val);
        }
      }

      for (const item of chunkTopItems) {
        const qty = Number(item.totalQty ?? 0);
        const cur = topItemByKasir.get(item.employeeId);
        if (!cur || qty > cur.qty) {
          topItemByKasir.set(item.employeeId, { name: item.productName, qty });
        }
      }
    }

    const personalAggByEmp = new Map(personalAggList.map((r) => [r.employeeId, r]));

    // ── 3. Rekapan Penjualan Per-Jam (WIB 0..23) ──────────────
    const hourWibExpr = sql<number>`EXTRACT(HOUR FROM (${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta'))::int`;

    type HourBucketMutable = {
      hour: number;
      label: string;
      txCount: number;
      voidCount: number;
      omzet: number;
      hpp: number;
      labaKotor: number;
      cash: number;
      qris: number;
      activeKasirCount: number;
    };
    const hourlyMap = new Map<number, HourBucketMutable>();
    const ensureHour = (h: number): HourBucketMutable => {
      const hour = Number.isFinite(h) ? ((h % 24) + 24) % 24 : 0;
      const existing = hourlyMap.get(hour);
      if (existing) return existing;
      const created: HourBucketMutable = {
        hour,
        label: fmtHourWibLabel(hour),
        txCount: 0,
        voidCount: 0,
        omzet: 0,
        hpp: 0,
        labaKotor: 0,
        cash: 0,
        qris: 0,
        activeKasirCount: 0,
      };
      hourlyMap.set(hour, created);
      return created;
    };

    const hourlyKasirTrack = new Map<number, number>();
    for (const idChunk of chunkArray(kasirIds)) {
      const [hourMainRows, hourSplitRows, hourDirectRows] = await Promise.all([
        db
          .select({
            hour: hourWibExpr,
            txCount: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' THEN 1 END)::int`,
            voidCount: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'VOID' THEN 1 END)::int`,
            omzet: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' THEN ${transactions.grossAmount} ELSE 0 END), 0)`,
            hpp: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' THEN ${transactions.totalHpp} ELSE 0 END), 0)`,
            kasirCount: sql<number>`COUNT(DISTINCT CASE WHEN ${transactions.status} = 'COMPLETED' THEN ${transactions.employeeId} END)::int`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
            ),
          )
          .groupBy(hourWibExpr),
        db
          .select({
            hour: hourWibExpr,
            paymentMethod: transactionPayments.paymentMethod,
            total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
            ),
          )
          .groupBy(hourWibExpr, transactionPayments.paymentMethod),
        db
          .select({
            hour: hourWibExpr,
            paymentMethod: transactions.paymentMethod,
            total: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.employeeId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              gte(transactions.createdAt, rangeStart),
              lt(transactions.createdAt, rangeEndExclusive),
              sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
            ),
          )
          .groupBy(hourWibExpr, transactions.paymentMethod),
      ]);

      for (const hr of hourMainRows) {
        const b = ensureHour(Number(hr.hour ?? 0));
        b.txCount += Number(hr.txCount ?? 0);
        b.voidCount += Number(hr.voidCount ?? 0);
        const omzet = parseFloat(hr.omzet || '0') || 0;
        const hpp = parseFloat(hr.hpp || '0') || 0;
        b.omzet += omzet;
        b.hpp += hpp;
        b.labaKotor += omzet - hpp;
        hourlyKasirTrack.set(b.hour, (hourlyKasirTrack.get(b.hour) ?? 0) + Number(hr.kasirCount ?? 0));
        b.activeKasirCount = hourlyKasirTrack.get(b.hour) ?? 0;
      }

      for (const sr of hourSplitRows) {
        const b = ensureHour(Number(sr.hour ?? 0));
        const val = parseFloat(sr.total || '0') || 0;
        if (sr.paymentMethod === 'CASH') b.cash += val;
        else if (sr.paymentMethod === 'QRIS') b.qris += val;
      }

      for (const dr of hourDirectRows) {
        const b = ensureHour(Number(dr.hour ?? 0));
        const val = parseFloat(dr.total || '0') || 0;
        if (dr.paymentMethod === 'CASH') b.cash += val;
        else if (dr.paymentMethod === 'QRIS') b.qris += val;
      }
    }

    const hourlyBreakdown = [...hourlyMap.values()]
      .map((h) => ({
        ...h,
        omzet: Math.round(h.omzet),
        hpp: Math.round(h.hpp),
        labaKotor: Math.round(h.labaKotor),
        cash: Math.round(h.cash),
        qris: Math.round(h.qris),
      }))
      .sort((a, b) => a.hour - b.hour);

    // ── 4. Kumpulkan Shift Terlibat (Pembuka Shift + Co-Cashier teamShift) ──
    const shiftParticipationSet = new Set<string>();
    const [ownedShiftIdsRows, trxParticipatedShiftRows, attParticipatedShiftRows] = await Promise.all([
      (async () => {
        const rows: Array<{ id: string }> = [];
        for (const idChunk of chunkArray(kasirIds)) {
          const chunk = await db
            .select({ id: shifts.id })
            .from(shifts)
            .where(
              and(
                inArray(shifts.employeeId, idChunk),
                gte(shifts.clockIn, rangeStart),
                lt(shifts.clockIn, rangeEndExclusive),
              ),
            );
          rows.push(...chunk);
        }
        return rows;
      })(),
      (async () => {
        const rows: Array<{ shiftId: string; employeeId: string }> = [];
        for (const idChunk of chunkArray(kasirIds)) {
          const chunk = await db
            .selectDistinct({ shiftId: transactions.shiftId, employeeId: transactions.employeeId })
            .from(transactions)
            .where(
              and(
                inArray(transactions.employeeId, idChunk),
                eq(transactions.isTest, false),
                gte(transactions.createdAt, rangeStart),
                lt(transactions.createdAt, rangeEndExclusive),
              ),
            );
          rows.push(...chunk);
        }
        return rows;
      })(),
      (async () => {
        const rows: Array<{ shiftId: string | null; employeeId: string }> = [];
        for (const idChunk of chunkArray(kasirIds)) {
          const chunk = await db
            .selectDistinct({ shiftId: attendances.shiftId, employeeId: attendances.employeeId })
            .from(attendances)
            .where(
              and(
                inArray(attendances.employeeId, idChunk),
                isNotNull(attendances.shiftId),
                gte(attendances.attendanceDate, dateFrom),
                lte(attendances.attendanceDate, dateTo),
              ),
            );
          rows.push(...chunk);
        }
        return rows;
      })(),
    ]);

    const shiftParticipantsByShift = new Map<string, Set<string>>();
    const participatedShiftsByEmp = new Map<string, Set<string>>();

    for (const r of ownedShiftIdsRows) shiftParticipationSet.add(r.id);
    for (const r of trxParticipatedShiftRows) {
      shiftParticipationSet.add(r.shiftId);
      const pSet = shiftParticipantsByShift.get(r.shiftId) ?? new Set<string>();
      pSet.add(r.employeeId);
      shiftParticipantsByShift.set(r.shiftId, pSet);

      const eSet = participatedShiftsByEmp.get(r.employeeId) ?? new Set<string>();
      eSet.add(r.shiftId);
      participatedShiftsByEmp.set(r.employeeId, eSet);
    }
    for (const r of attParticipatedShiftRows) {
      if (!r.shiftId) continue;
      shiftParticipationSet.add(r.shiftId);
      const pSet = shiftParticipantsByShift.get(r.shiftId) ?? new Set<string>();
      pSet.add(r.employeeId);
      shiftParticipantsByShift.set(r.shiftId, pSet);

      const eSet = participatedShiftsByEmp.get(r.employeeId) ?? new Set<string>();
      eSet.add(r.shiftId);
      participatedShiftsByEmp.set(r.employeeId, eSet);
    }

    const candidateShiftIds = [...shiftParticipationSet];
    const rawShiftList: Array<{
      id: string;
      employeeId: string;
      ownerName: string;
      clockIn: Date;
      clockOut: Date | null;
      status: string;
      modalAwal: string | null;
      actualCash: string | null;
      auditFlags: string | null;
      serahTerimaDiff: string | null;
    }> = [];

    for (const idChunk of chunkArray(candidateShiftIds)) {
      const chunk = await db
        .select({
          id: shifts.id,
          employeeId: shifts.employeeId,
          ownerName: employees.fullName,
          clockIn: shifts.clockIn,
          clockOut: shifts.clockOut,
          status: shifts.status,
          modalAwal: shifts.modalAwal,
          actualCash: shifts.actualCash,
          auditFlags: shifts.auditFlags,
          serahTerimaDiff: shifts.serahTerimaDiff,
        })
        .from(shifts)
        .innerJoin(employees, eq(shifts.employeeId, employees.id))
        .where(inArray(shifts.id, idChunk));
      rawShiftList.push(...chunk);
    }

    rawShiftList.sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime());
    const shiftList = rawShiftList.slice(0, EXPORT_MAX_ROWS);

    for (const sh of shiftList) {
      const pSet = shiftParticipantsByShift.get(sh.id) ?? new Set<string>();
      pSet.add(sh.employeeId);
      shiftParticipantsByShift.set(sh.id, pSet);

      const eSet = participatedShiftsByEmp.get(sh.employeeId) ?? new Set<string>();
      eSet.add(sh.id);
      participatedShiftsByEmp.set(sh.employeeId, eSet);
    }

    const shiftIds = shiftList.map((s) => s.id);

    // ── 5. Agregasi Drawer Level Shift (Laci Fisik & Kas Gerak) ──
    type ShiftTxAgg = {
      shiftId: string;
      totalOmzet: string;
      totalHpp: string;
      txCount: number;
      voidCount: number;
      txCountCash: number;
      txCountQris: number;
    };

    const txByShift = new Map<string, ShiftTxAgg>();
    const cashOutMap = new Map<string, number>();
    const cashInMap = new Map<string, number>();
    const cashSalesMap = new Map<string, number>();
    const shiftAllParticipantsMap = new Map<string, Set<string>>();

    for (const idChunk of chunkArray(shiftIds)) {
      const [chunkTxAgg, chunkMovements, chunkSplitCash, chunkDirectCash, chunkEmpInShift] = await Promise.all([
        db
          .select({
            shiftId: transactions.shiftId,
            totalOmzet: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false THEN ${transactions.grossAmount} ELSE 0 END), 0)`,
            totalHpp: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false THEN ${transactions.totalHpp} ELSE 0 END), 0)`,
            txCount: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false THEN 1 END)::int`,
            voidCount: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'VOID' THEN 1 END)::int`,
            txCountCash: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false AND ${transactions.paymentMethod} = 'CASH' THEN 1 END)::int`,
            txCountQris: sql<number>`COUNT(CASE WHEN ${transactions.status} = 'COMPLETED' AND ${transactions.isTest} = false AND ${transactions.paymentMethod} = 'QRIS' THEN 1 END)::int`,
          })
          .from(transactions)
          .where(inArray(transactions.shiftId, idChunk))
          .groupBy(transactions.shiftId) as Promise<ShiftTxAgg[]>,
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
              sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
            ),
          )
          .groupBy(transactions.shiftId),
        db
          .selectDistinct({ shiftId: transactions.shiftId, fullName: employees.fullName, empId: employees.id })
          .from(transactions)
          .innerJoin(employees, eq(transactions.employeeId, employees.id))
          .where(and(inArray(transactions.shiftId, idChunk), eq(transactions.isTest, false))),
      ]);

      for (const t of chunkTxAgg) txByShift.set(t.shiftId, t);
      for (const m of chunkMovements) {
        const val = parseFloat(m.total || '0') || 0;
        if (m.movementType === 'CASH_OUT') cashOutMap.set(m.shiftId, val);
        else if (m.movementType === 'CASH_IN') cashInMap.set(m.shiftId, val);
      }
      for (const sc of chunkSplitCash) {
        cashSalesMap.set(sc.shiftId, (cashSalesMap.get(sc.shiftId) ?? 0) + (parseFloat(sc.total || '0') || 0));
      }
      for (const dc of chunkDirectCash) {
        cashSalesMap.set(dc.shiftId, (cashSalesMap.get(dc.shiftId) ?? 0) + (parseFloat(dc.total || '0') || 0));
      }
      for (const ep of chunkEmpInShift) {
        const s = shiftAllParticipantsMap.get(ep.shiftId) ?? new Set<string>();
        s.add(ep.fullName);
        shiftAllParticipantsMap.set(ep.shiftId, s);
      }
    }

    // ── 6. Assemble shift detail rows (tanpa silent overwrite modalAwal) ──
    const shiftDetails = shiftList.map((s) => {
      const tx = txByShift.get(s.id);
      const parsedModal = s.modalAwal !== null && s.modalAwal !== undefined && s.modalAwal !== ''
        ? parseFloat(s.modalAwal)
        : NaN;
      const modalAwal = Number.isFinite(parsedModal) ? parsedModal : 100_000;
      const hasModalWarning = modalAwal > 150_000 || modalAwal <= 0;

      const parsedActual = s.actualCash !== null && s.actualCash !== undefined && s.actualCash !== ''
        ? parseFloat(s.actualCash)
        : NaN;
      const actualCash = Number.isFinite(parsedActual) ? parsedActual : null;

      const omzet = tx ? parseFloat(tx.totalOmzet) : 0;
      const hpp = tx ? parseFloat(tx.totalHpp) : 0;
      const cashSales = cashSalesMap.get(s.id) ?? 0;
      const cashOut = cashOutMap.get(s.id) ?? 0;
      const cashIn = cashInMap.get(s.id) ?? 0;
      const expectedCash = modalAwal + cashSales - cashOut + cashIn;
      const discrepancy = actualCash !== null ? actualCash - expectedCash : null;

      let statusLaci: 'RUNNING' | 'BALANCED' | 'SHORTAGE' | 'OVERAGE' = 'RUNNING';
      let discrepancyTier: 'HIJAU' | 'KUNING' | 'MERAH' | 'OVERAGE' = 'HIJAU';

      if (s.status === 'CLOSED') {
        if (discrepancy === null || Math.abs(discrepancy) <= 2000) {
          statusLaci = 'BALANCED';
          discrepancyTier = 'HIJAU';
        } else if (discrepancy < 0) {
          statusLaci = 'SHORTAGE';
          discrepancyTier = discrepancy < -20000 ? 'MERAH' : 'KUNING';
        } else {
          statusLaci = 'OVERAGE';
          discrepancyTier = 'OVERAGE';
        }
      }

      const durMins = s.clockOut
        ? Math.round((new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime()) / 60000)
        : null;

      const parsedSerah = s.serahTerimaDiff !== null && s.serahTerimaDiff !== undefined && s.serahTerimaDiff !== ''
        ? parseFloat(s.serahTerimaDiff)
        : NaN;
      const serahTerimaDiff = Number.isFinite(parsedSerah) ? parsedSerah : null;

      const flagList = [s.auditFlags ?? ''].filter(Boolean);
      if (hasModalWarning && !flagList.join(',').includes('MODAL_NON_STANDAR')) {
        flagList.push(`MODAL_NON_STANDAR(${Math.round(modalAwal)})`);
      }

      const openerName = s.ownerName || '—';
      const coCashierNames = [...(shiftAllParticipantsMap.get(s.id) ?? new Set<string>())]
        .filter((name) => name !== openerName);

      return {
        shiftId: s.id,
        employeeId: s.employeeId,
        kasirPembukaName: openerName,
        participantEmployeeIds: [...(shiftParticipantsByShift.get(s.id) ?? new Set([s.employeeId]))],
        coCashierNames,
        clockIn: s.clockIn,
        clockOut: s.clockOut,
        status: s.status,
        durasiMenit: durMins,
        modalAwal,
        rawModalWarning: hasModalWarning,
        omzet,
        hpp,
        labaKotor: omzet - hpp,
        txCount: Number(tx?.txCount ?? 0),
        voidCount: Number(tx?.voidCount ?? 0),
        txCountCash: Number(tx?.txCountCash ?? 0),
        txCountQris: Number(tx?.txCountQris ?? 0),
        cashSales,
        cashOut,
        cashIn,
        expectedCash,
        actualCash,
        discrepancy,
        statusLaci,
        discrepancyTier,
        serahTerimaDiff,
        auditFlags: flagList.join(' · '),
      };
    });

    // ── 7. Agregasi summary per kasir (penjualan per transactions.employeeId + audit laci per shifts.employeeId)
    const ownedShiftsByEmp = new Map<string, typeof shiftDetails>();
    for (const sd of shiftDetails) {
      const list = ownedShiftsByEmp.get(sd.employeeId) ?? [];
      list.push(sd);
      ownedShiftsByEmp.set(sd.employeeId, list);
    }

    const summary = allKasir
      .map((k) => {
        const p = personalAggByEmp.get(k.id);
        const totalOmzet = p ? Math.round(parseFloat(p.totalOmzet || '0') || 0) : 0;
        const totalHpp = p ? Math.round(parseFloat(p.totalHpp || '0') || 0) : 0;
        const totalLabaKotor = totalOmzet - totalHpp;
        const totalTxCount = p ? Number(p.txCount ?? 0) : 0;
        const totalVoidCount = p ? Number(p.voidCount ?? 0) : 0;
        const totalTxCash = p ? Number(p.txCountCash ?? 0) : 0;
        const totalTxQris = p ? Number(p.txCountQris ?? 0) : 0;
        const totalPenjualanCash = Math.round(personalCashMap.get(k.id) ?? 0);
        const totalPenjualanQris = Math.round(personalQrisMap.get(k.id) ?? 0);

        const ownedShifts = ownedShiftsByEmp.get(k.id) ?? [];
        const allParticipatedIds = participatedShiftsByEmp.get(k.id) ?? new Set<string>();
        const totalShift = allParticipatedIds.size;
        const shiftDipimpin = ownedShifts.length;
        const shiftPendamping = Math.max(0, totalShift - shiftDipimpin);

        let totalModalAwal = 0;
        let totalDurasiMenit = 0;
        const selisihLaciCount = { hijau: 0, kuning: 0, merah: 0, overage: 0 };

        for (const sd of shiftDetails) {
          if (!allParticipatedIds.has(sd.shiftId)) continue;
          if (sd.durasiMenit) totalDurasiMenit += sd.durasiMenit;
          if (sd.employeeId === k.id) {
            totalModalAwal += sd.modalAwal;
            if (sd.status === 'CLOSED') {
              if (sd.discrepancyTier === 'HIJAU') selisihLaciCount.hijau++;
              else if (sd.discrepancyTier === 'KUNING') selisihLaciCount.kuning++;
              else if (sd.discrepancyTier === 'MERAH') selisihLaciCount.merah++;
              else if (sd.discrepancyTier === 'OVERAGE') selisihLaciCount.overage++;
            }
          }
        }

        const avgOmzetPerShift = totalShift > 0 ? Math.round(totalOmzet / totalShift) : 0;

        return {
          kasirId: k.id,
          kasirName: k.fullName,
          kasirNim: k.nim,
          jabatan: k.jabatan,
          isActive: k.isActive,
          totalShift,
          shiftDipimpin,
          shiftPendamping,
          totalOmzet,
          totalHpp,
          totalLabaKotor,
          totalTxCount,
          totalVoidCount,
          totalTxCash,
          totalTxQris,
          totalPenjualanCash,
          totalPenjualanQris,
          totalModalAwal: Math.round(totalModalAwal),
          avgOmzetPerShift,
          topProduk: topItemByKasir.get(k.id)?.name ?? '—',
          totalDurasiMenit,
          selisihLaciCount,
        };
      })
      .sort((a, b) => b.totalOmzet - a.totalOmzet || b.totalShift - a.totalShift);

    return apiOk({
      dateFrom,
      dateTo,
      periodLabel: range.label,
      totalKasir: summary.length,
      summary,
      shiftDetails: kasirId
        ? shiftDetails.filter(
            (s) => s.employeeId === kasirId || s.participantEmployeeIds.includes(kasirId),
          )
        : shiftDetails,
      hourlyBreakdown,
    });
  } catch {
    return apiError('Gagal mengambil data rekap kasir', 500);
  }
}
