// =============================================================
// GET /api/admin/shift-monitor
// Pantauan Operasional Shift & Riwayat Transaksi untuk ADMIN_SHIFT (Model 2)
//   - mode=today   : Shift Pagi & Shift Siang hari ini (Modal Awal, Omzet Tunai/QRIS,
//                    Kas Gerak, daftar transaksi hari ini + eligibility VOID <= 10 mnt)
//   - mode=my_7d   : Riwayat 7 hari terakhir KHUSUS shift yang dijaga/ditangani
//                    oleh Admin Shift bersangkutan (read-only)
// Zero-Trust Privacy: TIDAK pernah mengembalikan Laba Kotor, Laba Bersih,
// HPP agregat, Biaya Operasional, ataupun Bagi Hasil 50:50.
// Blind Count Guard: actualCash & discrepancy hanya ditampilkan setelah shift CLOSED.
// =============================================================

import { NextRequest } from 'next/server';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  attendances,
  employees,
  shiftCashMovements,
  shifts,
  transactionPayments,
  transactions,
} from '@/lib/db/schema';
import { apiError, apiOk, verifyJwt } from '@/lib/utils/auth';
import { getOffsetDateWib, getTodayWib } from '@/lib/utils/helpers';
import { resolveShiftSessionWithContext } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_SHIFT_VOID_WINDOW_MS = 10 * 60 * 1000;
const MANAGER_VOID_WINDOW_MS = 24 * 60 * 60 * 1000;
const ADMIN_SHIFT_MAX_VOIDS_PER_DAY = 3;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Unauthorized', 401);
  }

  const activeAdmin = await db.query.admins.findFirst({
    where: and(
      eq(admins.id, session.sub),
      eq(admins.isActive, true),
      isNull(admins.deletedAt),
    ),
    columns: { id: true, nidn: true, fullName: true, role: true },
  });
  if (!activeAdmin) {
    return apiError('Akun pengelola tidak aktif.', 403);
  }

  const isManager = activeAdmin.role === 'MANAGER';
  const mode = req.nextUrl.searchParams.get('mode') === 'my_7d' ? 'my_7d' : 'today';
  const todayWib = getTodayWib();
  const todayStart = new Date(`${todayWib}T00:00:00+07:00`);
  const tomorrowStart = new Date(`${getOffsetDateWib(1)}T00:00:00+07:00`);
  const sevenDaysAgoDate = getOffsetDateWib(-7);
  const sevenDaysAgoStart = new Date(`${sevenDaysAgoDate}T00:00:00+07:00`);

  try {
    // Hitung sisa kuota VOID hari ini untuk Admin Shift
    const [{ count: todayVoidUsed }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, 'VOID'),
          eq(transactions.voidedByAdminId, activeAdmin.id),
          gte(transactions.voidedAt, todayStart),
        ),
      );

    // Resolve employee record milik Admin Shift ini (jika ada, berdasarkan NIM == NIDN)
    const selfEmployee = await db.query.employees.findFirst({
      where: and(eq(employees.nim, activeAdmin.nidn), isNull(employees.deletedAt)),
      columns: { id: true, fullName: true, nim: true },
    });

    let targetShiftIds: string[] = [];
    let shiftRows: Array<{
      id: string;
      employeeId: string;
      kasirName: string;
      clockIn: Date;
      clockOut: Date | null;
      status: string;
      modalAwal: string | null;
      actualCash: string | null;
      notes: string | null;
    }> = [];

    if (mode === 'today') {
      shiftRows = await db
        .select({
          id: shifts.id,
          employeeId: shifts.employeeId,
          kasirName: employees.fullName,
          clockIn: shifts.clockIn,
          clockOut: shifts.clockOut,
          status: shifts.status,
          modalAwal: shifts.modalAwal,
          actualCash: shifts.actualCash,
          notes: shifts.notes,
        })
        .from(shifts)
        .innerJoin(employees, eq(shifts.employeeId, employees.id))
        .where(
          and(
            gte(shifts.clockIn, todayStart),
            lt(shifts.clockIn, tomorrowStart),
            sql`COALESCE(${shifts.notes}, '') NOT ILIKE '%SANDBOX%'`,
          ),
        )
        .orderBy(shifts.clockIn)
        .limit(30);
      targetShiftIds = shiftRows.map((s) => s.id);
    } else {
      // mode === 'my_7d': hanya shift 7 hari terakhir yang dijaga oleh Admin Shift ini
      if (selfEmployee) {
        const [attShiftRows, txShiftRows] = await Promise.all([
          db
            .select({ shiftId: attendances.shiftId })
            .from(attendances)
            .where(
              and(
                eq(attendances.employeeId, selfEmployee.id),
                gte(attendances.attendanceDate, sevenDaysAgoDate),
                sql`${attendances.shiftId} IS NOT NULL`,
              ),
            )
            .limit(40),
          db
            .selectDistinct({ shiftId: transactions.shiftId })
            .from(transactions)
            .where(
              and(
                eq(transactions.employeeId, selfEmployee.id),
                eq(transactions.isTest, false),
                gte(transactions.createdAt, sevenDaysAgoStart),
                sql`${transactions.shiftId} IS NOT NULL`,
              ),
            )
            .limit(40),
        ]);

        const relatedIds = new Set<string>();
        for (const r of attShiftRows) if (r.shiftId) relatedIds.add(r.shiftId);
        for (const r of txShiftRows) if (r.shiftId) relatedIds.add(r.shiftId);

        const cond =
          relatedIds.size > 0
            ? or(
                eq(shifts.employeeId, selfEmployee.id),
                inArray(shifts.id, Array.from(relatedIds)),
              )
            : eq(shifts.employeeId, selfEmployee.id);

        shiftRows = await db
          .select({
            id: shifts.id,
            employeeId: shifts.employeeId,
            kasirName: employees.fullName,
            clockIn: shifts.clockIn,
            clockOut: shifts.clockOut,
            status: shifts.status,
            modalAwal: shifts.modalAwal,
            actualCash: shifts.actualCash,
            notes: shifts.notes,
          })
          .from(shifts)
          .innerJoin(employees, eq(shifts.employeeId, employees.id))
          .where(
            and(
              cond,
              gte(shifts.clockIn, sevenDaysAgoStart),
              lt(shifts.clockIn, tomorrowStart),
              sql`COALESCE(${shifts.notes}, '') NOT ILIKE '%SANDBOX%'`,
            ),
          )
          .orderBy(desc(shifts.clockIn))
          .limit(30);
        targetShiftIds = shiftRows.map((s) => s.id);
      }
    }

    if (targetShiftIds.length === 0) {
      return apiOk({
        mode,
        todayWib,
        isManager,
        voidPolicy: {
          windowMinutes: isManager ? 1440 : 10,
          dailyLimit: isManager ? null : ADMIN_SHIFT_MAX_VOIDS_PER_DAY,
          usedToday: todayVoidUsed,
          remainingToday: isManager ? null : Math.max(0, ADMIN_SHIFT_MAX_VOIDS_PER_DAY - todayVoidUsed),
        },
        shifts: [],
        transactions: [],
      });
    }

    // Ambil daftar transaksi terbaru (max 120) + agregasi lengkap per-shift (bebas truncation) secara batch
    const NO_PAYMENT_ROWS = sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = ${transactions.id})`;
    const [txRows, txAggRows, payRows, movementRows] = await Promise.all([
      db
        .select({
          id: transactions.id,
          shiftId: transactions.shiftId,
          invoiceNumber: transactions.invoiceNumber,
          paymentMethod: transactions.paymentMethod,
          grossAmount: transactions.grossAmount,
          status: transactions.status,
          voidReason: transactions.voidReason,
          createdAt: transactions.createdAt,
          kasirName: employees.fullName,
        })
        .from(transactions)
        .innerJoin(employees, eq(transactions.employeeId, employees.id))
        .where(
          and(
            inArray(transactions.shiftId, targetShiftIds),
            eq(transactions.isTest, false),
          ),
        )
        .orderBy(desc(transactions.createdAt))
        .limit(120),
      db
        .select({
          shiftId: transactions.shiftId,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED')::int`,
          voided: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')::int`,
          legacyCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'CASH' AND ${NO_PAYMENT_ROWS}), 0)`,
          legacyQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'QRIS' AND ${NO_PAYMENT_ROWS}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.shiftId, targetShiftIds),
            eq(transactions.isTest, false),
          ),
        )
        .groupBy(transactions.shiftId),
      db
        .select({
          shiftId: transactions.shiftId,
          paymentMethod: transactionPayments.paymentMethod,
          amount: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
        })
        .from(transactionPayments)
        .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
        .where(
          and(
            inArray(transactions.shiftId, targetShiftIds),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.isTest, false),
          ),
        )
        .groupBy(transactions.shiftId, transactionPayments.paymentMethod),
      db
        .select({
          shiftId: shiftCashMovements.shiftId,
          movementType: shiftCashMovements.movementType,
          amount: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
        })
        .from(shiftCashMovements)
        .where(inArray(shiftCashMovements.shiftId, targetShiftIds))
        .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType),
    ]);

    // Map per-shift stats (gabungan split payment + transaksi legacy, bebas limit 120)
    const payByShift = new Map<string, { cash: number; qris: number }>();
    for (const p of payRows) {
      if (!p.shiftId) continue;
      const cur = payByShift.get(p.shiftId) ?? { cash: 0, qris: 0 };
      if (p.paymentMethod === 'CASH') cur.cash += Math.round(Number(p.amount));
      else cur.qris += Math.round(Number(p.amount));
      payByShift.set(p.shiftId, cur);
    }

    const moveByShift = new Map<string, { cashIn: number; cashOut: number }>();
    for (const m of movementRows) {
      const cur = moveByShift.get(m.shiftId) ?? { cashIn: 0, cashOut: 0 };
      if (m.movementType === 'CASH_IN') cur.cashIn += Math.round(Number(m.amount));
      else cur.cashOut += Math.round(Number(m.amount));
      moveByShift.set(m.shiftId, cur);
    }

    const txCountByShift = new Map<string, { completed: number; voided: number; legacyCash: number; legacyQris: number }>();
    for (const a of txAggRows) {
      if (!a.shiftId) continue;
      txCountByShift.set(a.shiftId, {
        completed: Number(a.completed ?? 0),
        voided: Number(a.voided ?? 0),
        legacyCash: Math.round(Number(a.legacyCash ?? 0)),
        legacyQris: Math.round(Number(a.legacyQris ?? 0)),
      });
    }

    const fmtDateWib = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);

    const shiftLabelById = new Map<string, string>();
    const formattedShifts = shiftRows.map((s) => {
      const dateWib = fmtDateWib(s.clockIn);
      const hasClosedMorningEarlierSameDay = shiftRows.some(
        (other) =>
          other.id !== s.id &&
          other.status === 'CLOSED' &&
          other.clockIn.getTime() < s.clockIn.getTime() &&
          fmtDateWib(other.clockIn) === dateWib &&
          resolveShiftSessionWithContext({ clockIn: other.clockIn }) === 'Pagi',
      );
      const sessionType = resolveShiftSessionWithContext({
        clockIn: s.clockIn,
        hasClosedMorningShiftEarlier: hasClosedMorningEarlierSameDay,
      });
      const sessionLabel = sessionType === 'Siang' ? 'Shift Siang' : 'Shift Pagi';
      shiftLabelById.set(s.id, sessionLabel);

      const pay = payByShift.get(s.id);
      const cnt = txCountByShift.get(s.id) ?? { completed: 0, voided: 0, legacyCash: 0, legacyQris: 0 };
      const omzetCash = (pay?.cash ?? 0) + cnt.legacyCash;
      const omzetQris = (pay?.qris ?? 0) + cnt.legacyQris;
      const omzetTotal = omzetCash + omzetQris;
      const mov = moveByShift.get(s.id) ?? { cashIn: 0, cashOut: 0 };
      const modalAwal = s.modalAwal !== null ? Math.round(Number(s.modalAwal)) : 100000;
      const expectedCash = modalAwal + omzetCash + mov.cashIn - mov.cashOut;
      const isClosed = s.status === 'CLOSED';
      const actualCash = isClosed && s.actualCash !== null ? Math.round(Number(s.actualCash)) : null;
      const discrepancy = isClosed && actualCash !== null ? actualCash - expectedCash : null;

      return {
        shiftId: s.id,
        dateWib,
        sessionLabel,
        kasirName: s.kasirName,
        status: s.status,
        clockIn: s.clockIn.toISOString(),
        clockOut: s.clockOut ? s.clockOut.toISOString() : null,
        modalAwal,
        txCount: cnt.completed,
        voidCount: cnt.voided,
        omzetCash,
        omzetQris,
        omzetTotal,
        cashIn: mov.cashIn,
        cashOut: mov.cashOut,
        // Blind Count Guard: target & fisik kas hanya tampil setelah shift CLOSED
        expectedCash: isClosed ? expectedCash : null,
        actualCash,
        discrepancy,
        notes: s.notes,
      };
    });

    const nowMs = Date.now();
    const voidWindowMs = isManager ? MANAGER_VOID_WINDOW_MS : ADMIN_SHIFT_VOID_WINDOW_MS;
    const quotaAvailable = isManager || todayVoidUsed < ADMIN_SHIFT_MAX_VOIDS_PER_DAY;

    const formattedTransactions = txRows.map((t) => {
      const ageMs = nowMs - t.createdAt.getTime();
      const ageMinutes = Math.max(0, Math.floor(ageMs / 60000));
      const canVoid =
        t.status === 'COMPLETED' &&
        ageMs >= 0 &&
        ageMs <= voidWindowMs &&
        quotaAvailable;
      return {
        id: t.id,
        invoiceNumber: t.invoiceNumber,
        shiftId: t.shiftId,
        sessionLabel: (t.shiftId ? shiftLabelById.get(t.shiftId) : null) ?? 'Shift',
        kasirName: t.kasirName,
        paymentMethod: t.paymentMethod,
        grossAmount: Math.round(Number(t.grossAmount)),
        status: t.status,
        voidReason: t.voidReason,
        createdAt: t.createdAt.toISOString(),
        ageMinutes,
        canVoid,
      };
    });

    return apiOk({
      mode,
      todayWib,
      isManager,
      voidPolicy: {
        windowMinutes: isManager ? 1440 : 10,
        dailyLimit: isManager ? null : ADMIN_SHIFT_MAX_VOIDS_PER_DAY,
        usedToday: todayVoidUsed,
        remainingToday: isManager ? null : Math.max(0, ADMIN_SHIFT_MAX_VOIDS_PER_DAY - todayVoidUsed),
      },
      shifts: formattedShifts,
      transactions: formattedTransactions,
    });
  } catch (err) {
    console.error('[shift-monitor GET]', err);
    return apiError('Gagal memuat pantauan shift operasional.', 500);
  }
}
