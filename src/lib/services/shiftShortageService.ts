// =============================================================
// Smartkasir Perwira — Shift Shortage Auto-Checklist & 5-Min Grace Service
// Menangani evaluasi selisih kas laci otomatis, jeda koreksi 5 menit,
// finalisasi malas (lazy finalization tanpa cron berbayar), dan audit trail.
// =============================================================

import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  auditLogs,
  consignmentEntries,
  shifts,
  shiftCashMovements,
  transactions,
  transactionPayments,
} from '@/lib/db/schema';
import { getWibDateStr } from './activeShiftService';

export const SHORTAGE_TOLERANCE_RP = 2_000;
export const SHORTAGE_GRACE_MS = 5 * 60 * 1000; // 5 menit jeda koreksi mandiri
export const MAX_GRACE_RECOUNTS = 1;

export type ShortageStatus =
  | 'NONE'
  | 'AUTO_VERIFIED'
  | 'PENDING_GRACE'
  | 'AUDIT_WARNING'
  | 'AUTO_LOCKED'
  | 'OVERRIDDEN';

function getWibSessionOfDate(date: Date): 'Pagi' | 'Siang' {
  const hourWib = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: 'numeric',
      hour12: false,
    }).format(date),
    10,
  );
  return (Number.isFinite(hourWib) ? hourWib % 24 : 0) >= 11 ? 'Siang' : 'Pagi';
}

/**
 * Menggabungkan sub-shift yang terputus tanpa hitung fisik (actual_cash IS NULL)
 * pada tanggal & sesi WIB yang sama agar hitungan Kasir (Tutup Shift) selalu 100% sinkron
 * dengan laporan konsolidasi Admin (/api/admin/laporan/per-shift).
 */
export async function resolveSameSessionShiftContext(targetShift: {
  id: string;
  clockIn: Date;
  modalAwal: string | null;
}): Promise<{ shiftIds: string[]; effectiveModalAwal: number }> {
  const targetClockIn = new Date(targetShift.clockIn);
  const dateWib = getWibDateStr(targetClockIn);
  const targetSession = getWibSessionOfDate(targetClockIn);
  const dayStartUtc = new Date(`${dateWib}T00:00:00+07:00`);

  const candidates = await db
    .select({
      id: shifts.id,
      clockIn: shifts.clockIn,
      modalAwal: shifts.modalAwal,
      status: shifts.status,
      actualCash: shifts.actualCash,
    })
    .from(shifts)
    .where(
      and(
        gte(shifts.clockIn, dayStartUtc),
        lte(shifts.clockIn, targetClockIn),
        or(
          eq(shifts.id, targetShift.id),
          and(eq(shifts.status, 'CLOSED'), isNull(shifts.actualCash)),
        ),
      ),
    )
    .orderBy(asc(shifts.clockIn));

  const sameSessionRows = candidates.filter(
    (row) => row.id === targetShift.id || getWibSessionOfDate(new Date(row.clockIn)) === targetSession,
  );

  if (!sameSessionRows.some((r) => r.id === targetShift.id)) {
    sameSessionRows.push({
      id: targetShift.id,
      clockIn: targetClockIn,
      modalAwal: targetShift.modalAwal,
      status: 'ACTIVE',
      actualCash: null,
    });
  }

  const earliestModalSource = sameSessionRows.find((r) => r.modalAwal !== null)?.modalAwal ?? targetShift.modalAwal;
  const rawModal = earliestModalSource !== null ? Number(earliestModalSource) : 100_000;
  const effectiveModalAwal = Number.isFinite(rawModal) && rawModal >= 0 ? rawModal : 100_000;

  return {
    shiftIds: [...new Set(sameSessionRows.map((r) => r.id))],
    effectiveModalAwal,
  };
}

export interface ShiftCashEvaluation {
  shiftId: string;
  modalAwal: number;
  cashSales: number;
  cashOut: number;
  cashIn: number;
  expectedCash: number;
  actualCash: number | null;
  discrepancy: number | null;
  shortageRp: number;
  unsettledConsignmentsCount: number;
  typoSuspected: boolean;
}

export async function evaluateShiftCashState(shiftId: string): Promise<ShiftCashEvaluation | null> {
  const shiftRow = await db.query.shifts.findFirst({
    where: eq(shifts.id, shiftId),
    columns: {
      id: true,
      clockIn: true,
      modalAwal: true,
      actualCash: true,
    },
  });

  if (!shiftRow) return null;

  const shiftDateWib = getWibDateStr(new Date(shiftRow.clockIn));
  const sessionCtx = await resolveSameSessionShiftContext({
    id: shiftRow.id,
    clockIn: new Date(shiftRow.clockIn),
    modalAwal: shiftRow.modalAwal,
  });

  const [[paySummary], [directSummary], movements, [openCons]] = await Promise.all([
    db
      .select({
        payCash: sql<string>`COALESCE(
          SUM(${transactionPayments.amount})
          FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'CASH' AND ${transactions.isTest} = false),
          0
        )`,
      })
      .from(transactionPayments)
      .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
      .where(inArray(transactions.shiftId, sessionCtx.shiftIds)),
    db
      .select({
        directCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.shiftId, sessionCtx.shiftIds),
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
          sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = transactions.id)`,
        ),
      ),
    db
      .select({
        movementType: shiftCashMovements.movementType,
        amount: shiftCashMovements.amount,
      })
      .from(shiftCashMovements)
      .where(inArray(shiftCashMovements.shiftId, sessionCtx.shiftIds)),
    db
      .select({
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(consignmentEntries)
      .where(
        and(
          eq(consignmentEntries.entryDate, shiftDateWib),
          eq(consignmentEntries.status, 'OPEN'),
        ),
      ),
  ]);

  const modalAwal = sessionCtx.effectiveModalAwal;
  const cashSales = Number(paySummary?.payCash ?? 0) + Number(directSummary?.directCash ?? 0);

  let cashOut = 0;
  let cashIn = 0;
  for (const m of movements) {
    const amt = Number(m.amount ?? 0);
    if (m.movementType === 'CASH_OUT') cashOut += amt;
    else if (m.movementType === 'CASH_IN') cashIn += amt;
  }

  const expectedCash = Math.round(modalAwal + cashSales - cashOut + cashIn);
  const actualCash = shiftRow.actualCash !== null ? Math.round(Number(shiftRow.actualCash)) : null;
  const discrepancy = actualCash !== null ? actualCash - expectedCash : null;
  const shortageRp =
    discrepancy !== null && discrepancy < -SHORTAGE_TOLERANCE_RP
      ? Math.round(Math.abs(discrepancy))
      : 0;
  const typoSuspected =
    actualCash !== null && actualCash > 0 && actualCash < 10_000 && expectedCash >= 50_000;

  return {
    shiftId,
    modalAwal,
    cashSales: Math.round(cashSales),
    cashOut: Math.round(cashOut),
    cashIn: Math.round(cashIn),
    expectedCash,
    actualCash,
    discrepancy,
    shortageRp,
    unsettledConsignmentsCount: Number(openCons?.cnt ?? 0),
    typoSuspected,
  };
}

/**
 * Evaluasi ulang status jeda 5 menit setelah ada koreksi Kas Laci, Titipan, atau Hitung Ulang Fisik.
 */
export async function recalculateGraceShiftShortage(shiftId: string): Promise<{
  status: ShortageStatus;
  shortageAmount: number;
  expectedCash: number;
  actualCash: number | null;
  discrepancy: number | null;
  graceUntil: string | null;
} | null> {
  const shiftRow = await db.query.shifts.findFirst({
    where: eq(shifts.id, shiftId),
    columns: {
      id: true,
      shortageStatus: true,
      shortageGraceUntil: true,
    },
  });
  if (!shiftRow) return null;

  const evalRes = await evaluateShiftCashState(shiftId);
  if (!evalRes) return null;

  const now = new Date();
  let nextStatus: ShortageStatus = (shiftRow.shortageStatus as ShortageStatus) || 'NONE';
  let nextGraceUntil = shiftRow.shortageGraceUntil;

  if (evalRes.shortageRp <= 0) {
    nextStatus = 'AUTO_VERIFIED';
    nextGraceUntil = null;
  } else if (shiftRow.shortageStatus === 'PENDING_GRACE') {
    if (shiftRow.shortageGraceUntil && now >= new Date(shiftRow.shortageGraceUntil)) {
      // Opsi A: ubah menjadi peringatan audit (TIDAK otomatis memotong gaji sebelum dikonfirmasi Admin)
      nextStatus = 'AUDIT_WARNING';
      nextGraceUntil = null;
    } else {
      nextStatus = 'PENDING_GRACE';
    }
  } else if (shiftRow.shortageStatus === 'AUTO_LOCKED') {
    nextStatus = 'AUTO_LOCKED';
  }

  await db
    .update(shifts)
    .set({
      shortageStatus: nextStatus,
      shortageAmount: evalRes.shortageRp.toString(),
      shortageGraceUntil: nextGraceUntil,
    })
    .where(eq(shifts.id, shiftId));

  return {
    status: nextStatus,
    shortageAmount: evalRes.shortageRp,
    expectedCash: evalRes.expectedCash,
    actualCash: evalRes.actualCash,
    discrepancy: evalRes.discrepancy,
    graceUntil: nextGraceUntil ? new Date(nextGraceUntil).toISOString() : null,
  };
}

/**
 * Finalisasi malas (lazy finalization — Opsi A):
 * Setelah jeda 5 menit habis, ubah PENDING_GRACE menjadi AUDIT_WARNING (peringatan audit untuk Admin/Pengelola).
 * TIDAK otomatis memotong gaji shift; potongan hanya aktif bila Admin Shift/Manager mengonfirmasi secara sadar.
 */
export async function finalizeExpiredGraceShifts(shiftIds?: readonly string[]): Promise<number> {
  const now = new Date();
  const baseConditions = [
    eq(shifts.shortageStatus, 'PENDING_GRACE'),
    lte(shifts.shortageGraceUntil, now),
  ];

  if (shiftIds && shiftIds.length > 0) {
    baseConditions.push(inArray(shifts.id, [...shiftIds]));
  }

  const flagged = await db
    .update(shifts)
    .set({ shortageStatus: 'AUDIT_WARNING', shortageGraceUntil: null })
    .where(and(...baseConditions))
    .returning({ id: shifts.id, shortageAmount: shifts.shortageAmount });

  return flagged.length;
}

/**
 * Cari shift CLOSED milik toko yang saat ini masih berada di masa Jeda 5 Menit (PENDING_GRACE).
 */
export async function findActiveGraceShift(): Promise<{
  id: string;
  employeeId: string;
  clockIn: Date;
  clockOut: Date | null;
  actualCash: string | null;
  shortageAmount: string;
  shortageGraceUntil: Date;
  shortageRecountCount: number;
} | null> {
  const now = new Date();
  const row = await db.query.shifts.findFirst({
    where: and(
      eq(shifts.status, 'CLOSED'),
      eq(shifts.shortageStatus, 'PENDING_GRACE'),
      gt(shifts.shortageGraceUntil, now),
    ),
    orderBy: [desc(shifts.clockOut)],
    columns: {
      id: true,
      employeeId: true,
      clockIn: true,
      clockOut: true,
      actualCash: true,
      shortageAmount: true,
      shortageGraceUntil: true,
      shortageRecountCount: true,
    },
  });

  if (!row || !row.shortageGraceUntil) return null;
  return {
    ...row,
    shortageGraceUntil: row.shortageGraceUntil,
  };
}

export async function writeGraceAuditLog(params: {
  recordId: string;
  tableName: string;
  actorType: 'EMPLOYEE' | 'ADMIN' | 'SYSTEM';
  actorId: string;
  oldValues?: Record<string, unknown> | null;
  newValues: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      tableName: params.tableName,
      recordId: params.recordId,
      action: 'UPDATE',
      oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
      newValues: JSON.stringify(params.newValues),
      actorType: params.actorType,
      actorId: params.actorId,
    });
  } catch (err) {
    console.warn('[shiftShortageService] audit_logs warning:', err);
  }
}

export async function getUnsettledConsignmentsForToday(): Promise<{
  openToday: number;
  carryover: number;
}> {
  const todayWib = getWibDateStr(new Date());
  const [counts] = await db
    .select({
      openToday: sql<number>`COUNT(*) FILTER (WHERE ${consignmentEntries.entryDate} = ${todayWib} AND ${consignmentEntries.status} = 'OPEN')::int`,
      carryover: sql<number>`COUNT(*) FILTER (WHERE ${consignmentEntries.status} = 'CARRYOVER' OR (${consignmentEntries.entryDate} < ${todayWib} AND ${consignmentEntries.status} = 'OPEN'))::int`,
    })
    .from(consignmentEntries)
    .where(inArray(consignmentEntries.status, ['OPEN', 'CARRYOVER']));

  return {
    openToday: Number(counts?.openToday ?? 0),
    carryover: Number(counts?.carryover ?? 0),
  };
}

export async function hasActiveShiftNow(): Promise<boolean> {
  const row = await db.query.shifts.findFirst({
    where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
    columns: { id: true },
  });
  return Boolean(row);
}
