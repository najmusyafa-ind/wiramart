// =============================================================
// GET /api/admin/laporan/per-shift
// Laporan keuangan per shift (Pagi 07:00-11:30 | Siang 11:30-15:00)
// + Bagi hasil per mahasiswa per shift.
//
// Formula laba: SUM(subtotal_sell - subtotal_cost) dari transaction_items
// (audit-proof, tidak pakai transactions.gross_profit yang berpotensi inkonsisten)
//
// Auth: sk_admin + adminRole = MANAGER
// Query params: dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD
//              period=daily|weekly|monthly|semi_annual|october|november|oct_nov|all
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  transactions,
  transactionItems,
  shifts,
  employees,
  attendances,
  shiftSchedules,
  shiftCashMovements,
  transactionPayments,
  consignmentEntries,
} from '@/lib/db/schema';
import { and, asc, desc, eq, gte, lte, lt, inArray, isNull, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { resolveShiftSessionsBatch } from '@/lib/services/activeShiftService';
import {
  resolveReportRange,
  getFinancialReport,
  allocateProportional,
  InvalidRangeError,
  isPeriodKey,
  KETUA_UMKM_NIM,
  KETUA_UMKM_CANONICAL_ID,
  KETUA_UMKM_DUPLICATE_ID,
  PAYROLL_ATTENDANCE_RATIO,
  PAYROLL_PERFORMANCE_RATIO,
  extractRoleFromNotes,
  computePersonnelWeight,
} from '@/lib/finance/report';
import { finalizeExpiredGraceShifts } from '@/lib/services/shiftShortageService';

export const runtime = 'nodejs';

const MAX_SHIFTS_LIMIT = 5_000;
const MAX_ATTENDANCES_LIMIT = 10_000;
const SQL_IN_CHUNK_SIZE = 1_500;

function chunkArray<T>(items: readonly T[], size = SQL_IN_CHUNK_SIZE): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Akun admin/testing/dosen yang DILARANG menerima bagi hasil upah mahasiswa */
function isExcludedAccount(name?: string | null, nim?: string | null): boolean {
  const lname = (name || '').toLowerCase();
  const lnim = (nim || '').trim();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lnim === '02405013' ||
    lnim === '02405021' ||
    lnim === '02405015' ||
    lnim === '02405016' ||
    lnim === '02405050' ||
    lnim === '00000000'
  );
}

function wibDateOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

/**
 * Mengembalikan indeks hari (0=Minggu, 1=Senin, ..., 6=Sabtu) dalam zona waktu Asia/Jakarta (WIB).
 * Menggunakan jam 12:00:00 UTC agar tanggal UTC dan WIB sinkron, aman dari pergeseran timezone server (seperti Vercel UTC).
 */
function wibDayOfWeek(wibDateStr: string): number {
  return new Date(`${wibDateStr}T12:00:00Z`).getUTCDay();
}

export async function GET(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Laporan bagi hasil & laba shift khusus Manager (Dosen).', 403);
  }

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  const monthParam = sp.get('month'); // 'YYYY-MM'
  const dateParam = sp.get('date');   // 'YYYY-MM-DD'
  let dateFrom = sp.get('dateFrom') || dateParam;
  let dateTo = sp.get('dateTo') || dateParam;

  if (rawPeriod && !dateFrom && !dateTo && !monthParam && !isPeriodKey(rawPeriod)) {
    return apiError('Parameter period tidak valid', 400);
  }
  const period = isPeriodKey(rawPeriod) ? rawPeriod : null;

  if (monthParam) {
    const [yStr, mStr] = monthParam.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
      dateFrom = `${monthParam}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      dateTo = `${monthParam}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  let range;
  try {
    range = resolveReportRange({
      period: period || (monthParam ? 'monthly' : (!dateFrom ? 'monthly' : null)),
      dateFrom,
      dateTo,
    });
  } catch (err: unknown) {
    if (err instanceof InvalidRangeError) return apiError(err.message, 400);
    throw err;
  }

  try {
    const financial = await getFinancialReport(range);

    // ─────────────────────────────────────────────────────────────
    // Query daftar bulan yang tersedia (untuk navigasi filter di UI)
    // ─────────────────────────────────────────────────────────────
    const availableMonthsRaw = await db
      .select({
        month: sql<string>`TO_CHAR(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')`,
      })
      .from(shifts)
      .groupBy(sql`TO_CHAR(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') DESC`)
      .limit(60);
    const availableMonths = availableMonthsRaw.map((m) => m.month).filter(Boolean);

    // ─────────────────────────────────────────────────────────────
    // 0b. Ambil Master Jadwal Shift (Anggota Tetap per Hari & Sesi)
    // ─────────────────────────────────────────────────────────────
    const DAY_ENUM_TO_HARI: Record<string, string> = {
      SENIN: 'Senin',
      SELASA: 'Selasa',
      RABU: 'Rabu',
      KAMIS: 'Kamis',
      JUMAT: 'Jumat',
      SABTU: 'Sabtu',
      MINGGU: 'Minggu',
    };

    const scheduleRows = await db
      .select({
        dayOfWeek: shiftSchedules.dayOfWeek,
        slotStart: shiftSchedules.slotStart,
        orderInSlot: shiftSchedules.orderInSlot,
        employeeId: employees.id,
        fullName: employees.fullName,
        nim: employees.nim,
        programStudi: employees.programStudi,
        jabatan: employees.jabatan,
      })
      .from(shiftSchedules)
      .innerJoin(
        employees,
        and(
          eq(shiftSchedules.employeeId, employees.id),
          isNull(employees.deletedAt),
          eq(employees.isActive, true),
        ),
      )
      .where(eq(shiftSchedules.isActive, true))
      .orderBy(asc(shiftSchedules.dayOfWeek), asc(shiftSchedules.slotStart), asc(shiftSchedules.orderInSlot))
      .limit(500);

    const scheduleTeams: Record<
      string,
      { employeeId: string; fullName: string; nim: string; programStudi: string; jabatan: string }[]
    > = {};

    for (const sr of scheduleRows) {
      const hari = DAY_ENUM_TO_HARI[sr.dayOfWeek] ?? sr.dayOfWeek;
      const slotH = parseInt(sr.slotStart.split(':')[0] ?? '7', 10);
      const sesi = slotH >= 11 ? 'Siang' : 'Pagi';
      const key = `${hari}-${sesi}`;
      const list = scheduleTeams[key] ?? [];
      const empId =
        sr.employeeId === KETUA_UMKM_DUPLICATE_ID || sr.nim === KETUA_UMKM_NIM
          ? KETUA_UMKM_CANONICAL_ID
          : sr.employeeId;
      if (!list.some((x) => x.employeeId === empId)) {
        list.push({
          employeeId: empId,
          fullName: empId === KETUA_UMKM_CANONICAL_ID ? 'Gita Aprilianingrum' : sr.fullName,
          nim: empId === KETUA_UMKM_CANONICAL_ID ? KETUA_UMKM_NIM : sr.nim,
          programStudi: sr.programStudi,
          jabatan: empId === KETUA_UMKM_CANONICAL_ID ? 'Ketua UMKM / Admin Shift' : sr.jabatan,
        });
      }
      scheduleTeams[key] = list;
    }

    // 0c. Weekend (Sabtu/Minggu) tidak ada jadwal resmi Wiramart — query ini dihapus.

    // ─────────────────────────────────────────────────────────────
    // 1. Ambil semua shifts dalam rentang (TANPA filter nama testing)
    //    Filter testing hanya untuk tampilan laporan, bukan data shift.
    //    Kasir "testing" tetap punya laba dari shift → perlu diinclude.
    // ─────────────────────────────────────────────────────────────
    // Finalisasi otomatis shift yang masa jeda 5 menitnya sudah lewat (tanpa butuh cron)
    await finalizeExpiredGraceShifts();

    const rawShiftRows = await db
      .select({
        id: shifts.id,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        status: shifts.status,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
        serahTerimaDiff: shifts.serahTerimaDiff,
        auditFlags: shifts.auditFlags,
        shortageStatus: shifts.shortageStatus,
        shortageGraceUntil: shifts.shortageGraceUntil,
        shortageAmount: shifts.shortageAmount,
        shortageOverrideReason: shifts.shortageOverrideReason,
        notes: shifts.notes,
        sessionType: shifts.sessionType,
        employeeId: shifts.employeeId,
        kasirName: employees.fullName,
        kasirNim: employees.nim,
        kasirProdi: employees.programStudi,
        kasirJabatan: employees.jabatan,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(
        and(
          gte(shifts.clockIn, range.start),
          lt(shifts.clockIn, range.endExclusive),
        ),
      )
      .orderBy(shifts.clockIn)
      .limit(MAX_SHIFTS_LIMIT);

    // Filter: Hari Sabtu (6) & Minggu (0) bukan hari operasional resmi Wiramart.
    // Shift di hari weekend adalah data uji coba, diexclude dari laporan shift mahasiswa.
    const shiftRows = rawShiftRows.filter((s) => {
      const wib = wibDateOf(s.clockIn);
      const dow = wibDayOfWeek(wib);
      return dow !== 0 && dow !== 6;
    });

    const fs = financial.summary;
    const labaOperasionalBersih = Math.max(0, fs.labaKotor - fs.biayaOperasional);
    const poolHakMahasiswa = fs.alokasiGajiKaryawan;

    if (shiftRows.length === 0) {
      return apiOk({
        range: { startDate: range.startDate, endDate: range.endDate, label: range.label },
        formula: {
          payrollMode: 'PER_SHIFT',
          attendancePct: Math.round(PAYROLL_ATTENDANCE_RATIO * 100),
          performancePct: Math.round(PAYROLL_PERFORMANCE_RATIO * 100),
          equalRoleWeight: true,
        },
        shifts: [],
        summaryPerShiftGroup: [],
        summaryPerEmployee: [],
        scheduleTeams,
        availableMonths,
        grandTotal: {
          omzet: fs.omzet,
          labaKotor: fs.labaKotor,
          biayaOperasional: fs.biayaOperasional,
          labaOperasionalBersih,
          poolGaji: poolHakMahasiswa,
          tunjanganKetua: 0,
          poolShiftMahasiswa: poolHakMahasiswa,
          txCount: fs.txCount,
          totalUnitsSold: 0,
          totalShortageDeduction: 0,
          totalDistributed: 0,
          sisaPool: poolHakMahasiswa,
          labaBersihToko: fs.labaBersih,
        },
      });
    }

    // Normalisasi jika masih ada referensi ke duplikat akun Ketua UMKM
    for (const s of shiftRows) {
      if (s.employeeId === KETUA_UMKM_DUPLICATE_ID || s.kasirNim === KETUA_UMKM_NIM) {
        s.employeeId = KETUA_UMKM_CANONICAL_ID;
        s.kasirName = 'Gita Aprilianingrum';
        s.kasirNim = KETUA_UMKM_NIM;
        s.kasirProdi = 'Akuntansi';
        s.kasirJabatan = 'Ketua UMKM / Admin Shift';
      }
    }

    const shiftIds = shiftRows.map((s) => s.id);
    const shiftIdChunks = chunkArray(shiftIds);

    // ─────────────────────────────────────────────────────────────
    // 2. Hitung laba kotor & total unit barang laku per shift dari SNAPSHOT item
    //    + peta kasir aktual pelaku transaksi per shift (anti kontaminasi shift pagi->siang)
    // ─────────────────────────────────────────────────────────────
    const finByShift = new Map<string, { omzet: number; labaKotor: number; txCount: number; unitsSold: number }>();
    const txCashiersByShift = new Map<
      string,
      Array<{ employeeId: string; fullName: string; nim: string; programStudi: string; jabatan: string; txCount: number }>
    >();

    for (const idChunk of shiftIdChunks) {
      const [shiftFinancials, shiftTxCashiers] = await Promise.all([
        db
          .select({
            shiftId: transactions.shiftId,
            omzet: sql<string>`ROUND(COALESCE(SUM(${transactionItems.subtotalSell}), 0))`,
            labaKotor: sql<string>`ROUND(COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN ${transactionItems.subtotalSell} - ${transactionItems.subtotalCost} ELSE 0 END), 0))`,
            txCount: sql<number>`COUNT(DISTINCT ${transactions.id})::int`,
            unitsSold: sql<number>`COALESCE(SUM(${transactionItems.qty}), 0)::int`,
          })
          .from(transactionItems)
          .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
          .where(
            and(
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              inArray(transactions.shiftId, idChunk),
            ),
          )
          .groupBy(transactions.shiftId),
        db
          .select({
            shiftId: transactions.shiftId,
            employeeId: employees.id,
            fullName: employees.fullName,
            nim: employees.nim,
            programStudi: employees.programStudi,
            jabatan: employees.jabatan,
            txCount: sql<number>`COUNT(*)::int`,
          })
          .from(transactions)
          .innerJoin(employees, eq(transactions.employeeId, employees.id))
          .where(
            and(
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
              inArray(transactions.shiftId, idChunk),
            ),
          )
          .groupBy(
            transactions.shiftId,
            employees.id,
            employees.fullName,
            employees.nim,
            employees.programStudi,
            employees.jabatan,
          ),
      ]);

      for (const f of shiftFinancials) {
        if (!f.shiftId) continue;
        const prev = finByShift.get(f.shiftId) ?? { omzet: 0, labaKotor: 0, txCount: 0, unitsSold: 0 };
        finByShift.set(f.shiftId, {
          omzet: prev.omzet + parseFloat(f.omzet || '0'),
          labaKotor: prev.labaKotor + parseFloat(f.labaKotor || '0'),
          txCount: prev.txCount + f.txCount,
          unitsSold: prev.unitsSold + Number(f.unitsSold ?? 0),
        });
      }

      for (const c of shiftTxCashiers) {
        if (!c.shiftId) continue;
        const list = txCashiersByShift.get(c.shiftId) ?? [];
        const empId =
          c.employeeId === KETUA_UMKM_DUPLICATE_ID || c.nim === KETUA_UMKM_NIM
            ? KETUA_UMKM_CANONICAL_ID
            : c.employeeId;
        list.push({
          employeeId: empId,
          fullName: empId === KETUA_UMKM_CANONICAL_ID ? 'Gita Aprilianingrum' : c.fullName,
          nim: empId === KETUA_UMKM_CANONICAL_ID ? KETUA_UMKM_NIM : c.nim,
          programStudi: c.programStudi,
          jabatan: c.jabatan,
          txCount: c.txCount,
        });
        txCashiersByShift.set(c.shiftId, list);
      }
    }

    // ── 2b. Audit Uang Kas & Laci per Shift (Rincian Kas Laci + Cash Sales + Konsinyasi) ──
    const cashOutMap = new Map<string, number>();
    const cashInMap = new Map<string, number>();
    const cashSalesMap = new Map<string, number>();
    type ShiftCashMovementDetail = {
      id: string;
      movementType: string;
      category: string;
      amount: number;
      notes: string;
      isGraceCorrection: boolean;
      employeeName: string | null;
      createdAt: string;
    };
    const cashMovementsByShift = new Map<string, ShiftCashMovementDetail[]>();

    for (const idChunk of shiftIdChunks) {
      const cashMovementRows = await db
        .select({
          id: shiftCashMovements.id,
          shiftId: shiftCashMovements.shiftId,
          movementType: shiftCashMovements.movementType,
          category: shiftCashMovements.category,
          amount: shiftCashMovements.amount,
          notes: shiftCashMovements.notes,
          isGraceCorrection: shiftCashMovements.isGraceCorrection,
          createdAt: shiftCashMovements.createdAt,
          employeeName: employees.fullName,
        })
        .from(shiftCashMovements)
        .leftJoin(employees, eq(shiftCashMovements.employeeId, employees.id))
        .where(inArray(shiftCashMovements.shiftId, idChunk))
        .orderBy(desc(shiftCashMovements.createdAt));

      for (const m of cashMovementRows) {
        const val = parseFloat(m.amount || '0');
        if (m.movementType === 'CASH_OUT') cashOutMap.set(m.shiftId, (cashOutMap.get(m.shiftId) ?? 0) + val);
        else if (m.movementType === 'CASH_IN') cashInMap.set(m.shiftId, (cashInMap.get(m.shiftId) ?? 0) + val);

        const list = cashMovementsByShift.get(m.shiftId) ?? [];
        list.push({
          id: m.id,
          movementType: m.movementType,
          category: m.category,
          amount: Math.round(val),
          notes: m.notes,
          isGraceCorrection: Boolean(m.isGraceCorrection),
          employeeName: m.employeeName ?? null,
          createdAt: m.createdAt.toISOString(),
        });
        cashMovementsByShift.set(m.shiftId, list);
      }

      const splitCash = await db
        .select({
          shiftId: transactions.shiftId,
          total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
        })
        .from(transactionPayments)
        .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
        .where(and(
          inArray(transactions.shiftId, idChunk),
          eq(transactions.status, 'COMPLETED'),
          eq(transactionPayments.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
        ))
        .groupBy(transactions.shiftId);

      for (const s of splitCash) {
        if (s.shiftId) {
          cashSalesMap.set(s.shiftId, (cashSalesMap.get(s.shiftId) ?? 0) + parseFloat(s.total || '0'));
        }
      }

      const directCash = await db
        .select({
          shiftId: transactions.shiftId,
          total: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
        })
        .from(transactions)
        .where(and(
          inArray(transactions.shiftId, idChunk),
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
          sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = transactions.id)`,
        ))
        .groupBy(transactions.shiftId);

      for (const d of directCash) {
        if (d.shiftId) {
          cashSalesMap.set(d.shiftId, (cashSalesMap.get(d.shiftId) ?? 0) + parseFloat(d.total || '0'));
        }
      }
    }

    // Penentuan Sesi Shift seragam via SSOT (`shifts.session_type` -> jadwal/konteks WIB)
    const sesiByShift = await resolveShiftSessionsBatch(shiftRows);

    // ─────────────────────────────────────────────────────────────
    // 2c. Konsolidasi Sub-Shift POS dalam (Tanggal, Sesi) yang sama
    //     Mencegah kredit AutoKasir ganda saat kasir tutup-buka ulang POS
    //     di tengah sesi yang sama (mis. 07:51-10:23 & 10:24-13:13).
    // ─────────────────────────────────────────────────────────────
    const canonicalShiftIdOf = new Map<string, string>();
    const consolidatedShifts: typeof shiftRows = [];
    const sessionGroupMap = new Map<string, typeof shiftRows>();

    for (const s of shiftRows) {
      const sesi = sesiByShift.get(s.id) ?? 'Pagi';
      const sKey = `${wibDateOf(s.clockIn)}__${sesi}`;
      const arr = sessionGroupMap.get(sKey) ?? [];
      arr.push(s);
      sessionGroupMap.set(sKey, arr);
    }

    for (const [, group] of sessionGroupMap) {
      // Pilih shift utama berdasarkan transaksi terbanyak (tie-breaker: paling awal buka)
      const primary = [...group].sort((a, b) => {
        const txDiff = (finByShift.get(b.id)?.txCount ?? 0) - (finByShift.get(a.id)?.txCount ?? 0);
        if (txDiff !== 0) return txDiff;
        return a.clockIn.getTime() - b.clockIn.getTime();
      })[0]!;

      let aggOmzet = 0;
      let aggLaba = 0;
      let aggTx = 0;
      let aggUnitsSold = 0;
      let aggCashSales = 0;
      let aggCashOut = 0;
      let aggCashIn = 0;
      let earliestIn = group[0]!.clockIn;
      let earliestModalAwal = group[0]!.modalAwal;
      let latestOut: Date | null = group[0]!.clockOut;
      let latestActualCash = group[0]!.actualCash;
      let combinedFlags = primary.auditFlags;
      let combinedNotes = primary.notes;
      let combinedShortageStatus = primary.shortageStatus;
      let combinedShortageGraceUntil = primary.shortageGraceUntil;
      let combinedShortageAmount = primary.shortageAmount;
      let combinedShortageOverrideReason = primary.shortageOverrideReason;
      const mergedCashMovements: ShiftCashMovementDetail[] = [];
      const mergedTxCashiersMap = new Map<
        string,
        { employeeId: string; fullName: string; nim: string; programStudi: string; jabatan: string; txCount: number }
      >();

      for (const item of group) {
        canonicalShiftIdOf.set(item.id, primary.id);
        const f = finByShift.get(item.id);
        if (f) {
          aggOmzet += f.omzet;
          aggLaba += f.labaKotor;
          aggTx += f.txCount;
          aggUnitsSold += f.unitsSold;
        }
        aggCashSales += cashSalesMap.get(item.id) ?? 0;
        aggCashOut += cashOutMap.get(item.id) ?? 0;
        aggCashIn += cashInMap.get(item.id) ?? 0;
        mergedCashMovements.push(...(cashMovementsByShift.get(item.id) ?? []));
        for (const c of txCashiersByShift.get(item.id) ?? []) {
          const prev = mergedTxCashiersMap.get(c.employeeId);
          if (prev) prev.txCount += c.txCount;
          else mergedTxCashiersMap.set(c.employeeId, { ...c });
        }
        if (item.clockIn.getTime() < earliestIn.getTime()) {
          earliestIn = item.clockIn;
          earliestModalAwal = item.modalAwal;
        }
        if (item.clockOut && (!latestOut || item.clockOut.getTime() > latestOut.getTime())) {
          latestOut = item.clockOut;
        }
        if (item.actualCash !== null) latestActualCash = item.actualCash;
        if (item.auditFlags && item.auditFlags !== 'NORMAL') combinedFlags = item.auditFlags;
        if (item.notes && !combinedNotes) combinedNotes = item.notes;
        if (item.shortageStatus && item.shortageStatus !== 'NONE') {
          combinedShortageStatus = item.shortageStatus;
          combinedShortageGraceUntil = item.shortageGraceUntil;
          combinedShortageAmount = item.shortageAmount;
          combinedShortageOverrideReason = item.shortageOverrideReason;
        }
      }

      finByShift.set(primary.id, { omzet: aggOmzet, labaKotor: aggLaba, txCount: aggTx, unitsSold: aggUnitsSold });
      cashSalesMap.set(primary.id, aggCashSales);
      cashOutMap.set(primary.id, aggCashOut);
      cashInMap.set(primary.id, aggCashIn);
      cashMovementsByShift.set(
        primary.id,
        mergedCashMovements.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      );
      txCashiersByShift.set(primary.id, [...mergedTxCashiersMap.values()]);

      consolidatedShifts.push({
        ...primary,
        clockIn: earliestIn,
        clockOut: latestOut,
        modalAwal: earliestModalAwal ?? primary.modalAwal,
        actualCash: latestActualCash,
        auditFlags: combinedFlags,
        shortageStatus: combinedShortageStatus,
        shortageGraceUntil: combinedShortageGraceUntil,
        shortageAmount: combinedShortageAmount,
        shortageOverrideReason: combinedShortageOverrideReason,
        notes: combinedNotes,
      });
    }
    consolidatedShifts.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
    const effectiveShifts = consolidatedShifts;

    // ─────────────────────────────────────────────────────────────
    // 3. Ambil absensi yang hadir pada rentang ini
    // ─────────────────────────────────────────────────────────────
    const attRows = await db.query.attendances.findMany({
      where: and(
        gte(attendances.attendanceDate, range.startDate),
        lte(attendances.attendanceDate, range.endDate),
        inArray(attendances.status, ['HADIR', 'TELAT', 'PENGGANTI']),
      ),
      orderBy: [asc(attendances.attendanceDate), asc(attendances.createdAt)],
      limit: MAX_ATTENDANCES_LIMIT,
      with: {
        employee: {
          columns: { id: true, fullName: true, nim: true, programStudi: true, jabatan: true },
        },
        schedule: {
          columns: { slotStart: true, slotEnd: true, dayOfWeek: true },
        },
      },
    });

    for (const att of attRows) {
      if (att.employeeId === KETUA_UMKM_DUPLICATE_ID || att.employee.nim === KETUA_UMKM_NIM) {
        att.employeeId = KETUA_UMKM_CANONICAL_ID;
        att.employee.id = KETUA_UMKM_CANONICAL_ID;
        att.employee.fullName = 'Gita Aprilianingrum';
        att.employee.nim = KETUA_UMKM_NIM;
        att.employee.programStudi = 'Akuntansi';
        att.employee.jabatan = 'Ketua UMKM / Admin Shift';
      }
    }

    // Index absensi per shift (tier 1: shiftId FK langsung -> petakan ke canonicalShiftId)
    const attByShift = new Map<string, typeof attRows>();
    const attOrphan: typeof attRows = [];

    for (const att of attRows) {
      if (att.shiftId) {
        const canonId = canonicalShiftIdOf.get(att.shiftId) ?? att.shiftId;
        const list = attByShift.get(canonId) ?? [];
        list.push(att);
        attByShift.set(canonId, list);
      } else {
        attOrphan.push(att);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Matching absensi orphan ke shift — STRICT SESSION BOUNDARY
    //    Mencegah bug "7-9 orang di 1 shift" (Tim Siang absen cepat 10:25
    //    tidak boleh pernah tersedot ke Shift Pagi!) & menjaga dobel shift
    //    di hari yang sama agar kedua sesi terhitung utuh.
    // ─────────────────────────────────────────────────────────────
    const sesiOfSlot = (slotStart?: string | null): 'Pagi' | 'Siang' | null => {
      if (!slotStart) return null;
      const h = parseInt(slotStart.split(':')[0] ?? '', 10);
      if (Number.isNaN(h)) return null;
      return h >= 11 ? 'Siang' : 'Pagi';
    };

    const wibHourOf = (d: Date): number =>
      parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Jakarta',
          hour: 'numeric',
          hour12: false,
        }).format(d),
        10,
      );

    for (const att of attOrphan) {
      const attDate = att.attendanceDate;
      const candidates = effectiveShifts.filter((s) => wibDateOf(s.clockIn) === attDate);
      if (candidates.length === 0) continue;

      const attSesi = sesiOfSlot(att.schedule?.slotStart);
      const sameSessionCandidates = attSesi
        ? candidates.filter((s) => sesiByShift.get(s.id) === attSesi)
        : candidates;

      let matched: typeof candidates[0] | undefined;

      if (sameSessionCandidates.length > 0) {
        // Tier 2: Owner di sesi yang SAMA (aman untuk dobel shift hari yang sama)
        matched = sameSessionCandidates.find((s) => s.employeeId === att.employeeId);

        // Tier 3: ClockInActual overlap di dalam sesi yang SAMA
        if (!matched && att.clockInActual) {
          const attMs = new Date(att.clockInActual).getTime();
          matched = sameSessionCandidates.find((s) => {
            const sIn = s.clockIn.getTime();
            const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
            return attMs >= sIn - 45 * 60 * 1000 && attMs <= sOut + 30 * 60 * 1000;
          });
        }

        // Tier 4: Shift resmi sesi yang sama pada hari tersebut
        if (!matched) {
          matched = sameSessionCandidates[0];
        }
      } else if (!attSesi) {
        // Hanya jika absensi tidak memiliki slot jadwal sama sekali
        matched = candidates.find((s) => s.employeeId === att.employeeId);
        if (!matched && att.clockInActual) {
          const attMs = new Date(att.clockInActual).getTime();
          matched = candidates.find((s) => {
            const sIn = s.clockIn.getTime();
            const sOut = s.clockOut ? s.clockOut.getTime() : sIn + 4 * 3600 * 1000;
            return attMs >= sIn - 30 * 60 * 1000 && attMs <= sOut + 30 * 60 * 1000;
          });
        }
        if (!matched && candidates.length === 1) {
          matched = candidates[0];
        }
      } else if (candidates.length === 1) {
        // Satu POS dipakai seharian penuh (buka pagi, tutup sore >= 13:00 WIB)
        const onlyShift = candidates[0]!;
        const closedAfternoon = !onlyShift.clockOut || wibHourOf(onlyShift.clockOut) >= 13;
        if (attSesi === 'Siang' && closedAfternoon) {
          matched = onlyShift;
        }
      }

      if (matched) {
        const list = attByShift.get(matched.id) ?? [];
        list.push(att);
        attByShift.set(matched.id, list);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4b. Integrasi Kasir Shift & Deduplikasi per Shift (ANTI KONTAMINASI LINTAS SESI)
    //     Kasir pembuka shift hanya diikutkan jika benar-benar melayani transaksi di shift ini
    //     dan TIDAK sedang tercatat hadir di sesi berlawanan pada tanggal yang sama.
    //     Sebaliknya, kasir aktual pelaku transaksi POS diikutkan bila lupa absen.
    // ─────────────────────────────────────────────────────────────
    const attendedSessionsByEmpDate = new Map<string, Set<'Pagi' | 'Siang'>>();
    for (const s of effectiveShifts) {
      const sesi = sesiByShift.get(s.id) ?? 'Pagi';
      const dt = wibDateOf(s.clockIn);
      for (const att of attByShift.get(s.id) ?? []) {
        const key = `${att.employee.id}__${dt}`;
        const set = attendedSessionsByEmpDate.get(key) ?? new Set<'Pagi' | 'Siang'>();
        set.add(sesi);
        attendedSessionsByEmpDate.set(key, set);
      }
    }

    for (const s of effectiveShifts) {
      const sesi = sesiByShift.get(s.id) ?? 'Pagi';
      const oppositeSesi: 'Pagi' | 'Siang' = sesi === 'Pagi' ? 'Siang' : 'Pagi';
      const dt = wibDateOf(s.clockIn);
      const rawList = attByShift.get(s.id) ?? [];
      const deduped: typeof attRows = [];
      const seenEmp = new Set<string>();
      for (const att of rawList) {
        if (!isExcludedAccount(att.employee.fullName, att.employee.nim) && !seenEmp.has(att.employee.id)) {
          seenEmp.add(att.employee.id);
          deduped.push(att);
        }
      }

      const actualTxCashiers = txCashiersByShift.get(s.id) ?? [];
      const ownerTxCount = actualTxCashiers.find((c) => c.employeeId === s.employeeId)?.txCount ?? 0;
      const ownerAttendedOpposite = attendedSessionsByEmpDate.get(`${s.employeeId}__${dt}`)?.has(oppositeSesi) ?? false;

      // 1. Jika ada pelaku transaksi aktual di POS shift ini yang belum masuk daftar hadir -> masukkan
      //    (kecuali jika sudah ada tim hadir sah di sesi ini DAN kasir tsb sebenarnya hadir di sesi lawan,
      //     misal akun kasir pagi lupa logout saat oper ke tim siang seperti 2 Nov)
      for (const tc of actualTxCashiers) {
        if (isExcludedAccount(tc.fullName, tc.nim) || seenEmp.has(tc.employeeId)) continue;
        const tcAttendedOpposite = attendedSessionsByEmpDate.get(`${tc.employeeId}__${dt}`)?.has(oppositeSesi) ?? false;
        if (tcAttendedOpposite && seenEmp.size > 0) continue;
        seenEmp.add(tc.employeeId);
        deduped.push({
          id: `shift-tx-kasir-${s.id}-${tc.employeeId}`,
          employeeId: tc.employeeId,
          scheduleId: '',
          shiftId: s.id,
          attendanceDate: dt,
          clockInActual: s.clockIn,
          clockOutActual: s.clockOut,
          status: 'HADIR',
          lateMinutes: 0,
          roleTask: 'Kasir',
          verificationSource: 'LOGIN_AUTO',
          isSubstitute: false,
          notes: 'Peran: Kasir | Tercatat dari transaksi POS',
          recordedByAdminId: null,
          fromSwapRequestId: null,
          createdAt: s.clockIn,
          updatedAt: s.clockIn,
          employee: {
            id: tc.employeeId,
            fullName: tc.fullName,
            nim: tc.nim,
            programStudi: tc.programStudi,
            jabatan: tc.jabatan || 'Kasir',
          },
          schedule: {
            slotStart: sesi === 'Siang' ? '11:30' : '07:30',
            slotEnd: sesi === 'Siang' ? '15:00' : '11:30',
            dayOfWeek: 'SENIN',
          },
        });
      }

      // 2. Fallback untuk shift lama tanpa transaksi/tanpa absen (hanya jika owner tidak bentrok sesi lawan
      //    dan tidak ada kasir lain yang menggantikan transaksi di shift ini)
      const hasOtherActualCashier = actualTxCashiers.some((c) => c.employeeId !== s.employeeId);
      const shouldIncludeOwner =
        !isExcludedAccount(s.kasirName, s.kasirNim) &&
        !seenEmp.has(s.employeeId) &&
        !ownerAttendedOpposite &&
        (ownerTxCount > 0 || !hasOtherActualCashier);

      if (shouldIncludeOwner) {
        deduped.push({
          id: `shift-kasir-${s.id}`,
          employeeId: s.employeeId,
          scheduleId: '',
          shiftId: s.id,
          attendanceDate: dt,
          clockInActual: s.clockIn,
          clockOutActual: s.clockOut,
          status: 'HADIR',
          lateMinutes: 0,
          roleTask: 'Kasir',
          verificationSource: 'LOGIN_AUTO',
          isSubstitute: false,
          notes: 'Peran: Kasir | Kasir Shift',
          recordedByAdminId: null,
          fromSwapRequestId: null,
          createdAt: s.clockIn,
          updatedAt: s.clockIn,
          employee: {
            id: s.employeeId,
            fullName: s.kasirName,
            nim: s.kasirNim,
            programStudi: s.kasirProdi,
            jabatan: s.kasirJabatan || 'Kasir',
          },
          schedule: {
            slotStart: sesi === 'Siang' ? '11:30' : '07:30',
            slotEnd: sesi === 'Siang' ? '15:00' : '11:30',
            dayOfWeek: 'SENIN',
          },
        });
      }
      attByShift.set(s.id, deduped);
    }

    // ─────────────────────────────────────────────────────────────
    // 4c. Alokasi Pool Shift — Rumus 50% Kehadiran / 50% Laba Kotor (Sama Rata Peran 1.0)
    // ─────────────────────────────────────────────────────────────
    const poolShiftMahasiswa = poolHakMahasiswa;
    const ATTENDANCE_RATIO = PAYROLL_ATTENDANCE_RATIO;
    const PERFORMANCE_RATIO = PAYROLL_PERFORMANCE_RATIO;

    // Ambil ringkasan konsinyasi harian dalam rentang untuk panel audit shift
    const consignmentRows = await db
      .select({
        entryDate: consignmentEntries.entryDate,
        settledCount: sql<number>`COUNT(*) FILTER (WHERE ${consignmentEntries.status} = 'SETTLED')::int`,
        openCount: sql<number>`COUNT(*) FILTER (WHERE ${consignmentEntries.status} IN ('OPEN', 'CARRYOVER'))::int`,
        totalPayout: sql<string>`COALESCE(SUM(${consignmentEntries.totalPayout}) FILTER (WHERE ${consignmentEntries.status} = 'SETTLED'), 0)`,
        totalDiscrepancyQty: sql<number>`COALESCE(SUM(ABS(${consignmentEntries.qtyDiscrepancy})) FILTER (WHERE ${consignmentEntries.status} = 'SETTLED'), 0)::int`,
      })
      .from(consignmentEntries)
      .where(
        and(
          gte(consignmentEntries.entryDate, range.startDate),
          lte(consignmentEntries.entryDate, range.endDate),
        ),
      )
      .groupBy(consignmentEntries.entryDate);

    const consignmentByDate = new Map(
      consignmentRows.map((c) => [
        c.entryDate,
        {
          settledCount: Number(c.settledCount ?? 0),
          openCount: Number(c.openCount ?? 0),
          totalPayout: Math.round(parseFloat(c.totalPayout || '0')),
          totalDiscrepancyQty: Number(c.totalDiscrepancyQty ?? 0),
        },
      ]),
    );

    // Hitung total poin disiplin seluruh shift (untuk normalisasi Pool A)
    const shiftAttPoints: number[] = effectiveShifts.map((s) => {
      const atts = attByShift.get(s.id) ?? [];
      if (atts.length === 0) return 0;
      let sum = 0;
      for (const att of atts) {
        const wInfo = computePersonnelWeight({
          role: extractRoleFromNotes(att.notes, att.employee.jabatan),
          sesi: sesiByShift.get(s.id) ?? 'Pagi',
          attendanceDate: wibDateOf(s.clockIn),
          lateMinutes: att.lateMinutes,
        });
        sum += wInfo.totalWeight;
      }
      return sum;
    });
    const totalAttPoints = shiftAttPoints.reduce((a, b) => a + b, 0);

    // Hitung total laba kotor seluruh shift (untuk normalisasi Pool B)
    const shiftLabaKotor: number[] = effectiveShifts.map((s) => {
      const atts = attByShift.get(s.id) ?? [];
      if (atts.length === 0) return 0;
      return Math.max(0, finByShift.get(s.id)?.labaKotor ?? 0);
    });
    const totalLabaKotorAllShifts = shiftLabaKotor.reduce((a, b) => a + b, 0);

    const shiftWeights = effectiveShifts.map((_, idx) => {
      const att = shiftAttPoints[idx] ?? 0;
      const lk = shiftLabaKotor[idx] ?? 0;
      if (att === 0) return 0; // shift tanpa personel sah → dapat Rp 0
      const attendancePart = ATTENDANCE_RATIO * att * (totalLabaKotorAllShifts > 0 ? totalLabaKotorAllShifts : 1);
      const performancePart = PERFORMANCE_RATIO * lk * (totalAttPoints > 0 ? totalAttPoints : 1);
      return attendancePart + performancePart;
    });

    const shiftShares = allocateProportional(poolShiftMahasiswa, shiftWeights);
    const poolByShift = new Map<string, number>();
    effectiveShifts.forEach((s, idx) => {
      poolByShift.set(s.id, shiftShares[idx] ?? 0);
    });

    // ─────────────────────────────────────────────────────────────
    // 5. Bangun response PER SHIFT (tanpa pemecahan gaji per nama)
    // ─────────────────────────────────────────────────────────────
    type AttendeeRow = {
      employeeId: string;
      fullName: string;
      nim: string;
      programStudi: string;
      jabatan: string;
      status: string;
      lateMinutes: number;
      penaltyPercent: number;
      roleWeight: number;
      sessionWeight: number;
      totalWeight: number;
      /** Selalu 0 pada mode PER_SHIFT (gaji diserahkan utuh ke kelompok shift) */
      nominalBagiHasil: number;
    };

    type ShiftRow = {
      shiftId: string;
      tanggal: string;       // 'YYYY-MM-DD' WIB
      hari: string;          // 'Senin', 'Selasa', …
      sesi: 'Pagi' | 'Siang';
      slotLabel: string;     // '07:30-11:30' | '11:30-15:00'
      clockIn: string;
      clockOut: string | null;
      kasirName: string;
      kasirNim: string;
      txCount: number;
      unitsSold: number;
      omzet: number;
      labaKotor: number;
      poolGaji: number;
      modalAwal: number;
      cashSales: number;
      cashOut: number;
      cashIn: number;
      actualCash: number | null;
      expectedCash: number;
      discrepancy: number | null;
      shortageStatus: string;
      shortageGraceUntil: string | null;
      shortageOverrideReason: string | null;
      shortageDeduction: number;
      gajiBersih: number;
      auditFlags: string | null;
      notes: string | null;
      cashMovements: ShiftCashMovementDetail[];
      consignmentSummary: {
        settledCount: number;
        openCount: number;
        totalPayout: number;
        totalDiscrepancyQty: number;
      } | null;
      personnelCount: number;
      /** Selalu 0 pada mode PER_SHIFT (tidak dipecah per orang) */
      nominalPerOrang: number;
      personnel: AttendeeRow[];
    };

    type ShiftGroupMemberAttendance = {
      employeeId: string;
      fullName: string;
      nim: string;
      jabatan: string;
      totalHadir: number;
      totalLateMinutes: number;
    };

    type ShiftGroupSummary = {
      groupKey: string;
      hari: string;
      sesi: 'Pagi' | 'Siang';
      slotLabel: string;
      totalShiftCount: number;
      txCount: number;
      unitsSold: number;
      omzet: number;
      labaKotor: number;
      poolGaji: number;
      shortageDeduction: number;
      gajiBersih: number;
      rataRataPerShift: number;
      tanggalList: string[];
      anggotaTim: ShiftGroupMemberAttendance[];
    };

    const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const HARI_SORT_ORDER: Record<string, number> = {
      Senin: 1,
      Selasa: 2,
      Rabu: 3,
      Kamis: 4,
      Jumat: 5,
    };

    const groupAggMap = new Map<string, {
      groupKey: string;
      hari: string;
      sesi: 'Pagi' | 'Siang';
      slotLabel: string;
      datesSet: Set<string>;
      txCount: number;
      unitsSold: number;
      omzet: number;
      labaKotor: number;
      poolGaji: number;
      shortageDeduction: number;
      gajiBersih: number;
      membersMap: Map<string, ShiftGroupMemberAttendance>;
    }>();

    const builtShifts: ShiftRow[] = [];

    let totalShortageDeduction = 0;

    for (const s of effectiveShifts) {
      const wibDate = wibDateOf(s.clockIn);
      const sesi = sesiByShift.get(s.id) ?? 'Pagi';
      const slotLabel = sesi === 'Siang' ? '11:30-15:00' : '07:30-11:30';

      const fin = finByShift.get(s.id) ?? { omzet: 0, labaKotor: 0, txCount: 0, unitsSold: 0 };
      const poolGaji = poolByShift.get(s.id) ?? 0;

      // Audit Kas Laci (Modal Fisik Fleksibel Opsi A) + Auto-Checklist Potong Tekor (hanya jika AUTO_LOCKED)
      const rawModal = s.modalAwal !== null && s.modalAwal !== undefined ? parseFloat(s.modalAwal) : 100_000;
      const modalAwal = Number.isFinite(rawModal) && rawModal >= 0 ? rawModal : 100_000;
      const actualCash = s.actualCash ? parseFloat(s.actualCash) : null;
      const cashSales = Math.round(cashSalesMap.get(s.id) ?? 0);
      const cashOut = Math.round(cashOutMap.get(s.id) ?? 0);
      const cashIn = Math.round(cashInMap.get(s.id) ?? 0);
      const expectedCash = Math.round(modalAwal + cashSales - cashOut + cashIn);
      const discrepancy = actualCash !== null ? Math.round(actualCash - expectedCash) : null;
      const rawShortage = discrepancy !== null && discrepancy < -2000 ? Math.abs(discrepancy) : 0;

      const sStatus = s.shortageStatus || 'NONE';
      const lockedShortage =
        sStatus === 'AUTO_LOCKED'
          ? Math.max(rawShortage, Math.round(parseFloat(s.shortageAmount || '0')))
          : 0;
      const shortageDeduction = sStatus === 'AUTO_LOCKED' ? Math.min(poolGaji, lockedShortage) : 0;
      totalShortageDeduction += shortageDeduction;
      const gajiBersih = Math.max(0, poolGaji - shortageDeduction);

      const attendeesRaw = attByShift.get(s.id) ?? [];
      const count = attendeesRaw.length;

      const dayOfWeek = wibDayOfWeek(wibDate);
      const hariStr = HARI[dayOfWeek] ?? wibDate;

      const evaluated = attendeesRaw.map((att) => {
        let roleTask = extractRoleFromNotes(att.notes, att.employee.jabatan);
        if (att.employee.id === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM) {
          roleTask = 'Ketua UMKM / Admin Shift';
        } else if (att.employee.id === s.employeeId && !att.notes?.startsWith('Peran: ')) {
          const rLower = roleTask.toLowerCase();
          if (!rLower.includes('admin') && !rLower.includes('kasir')) {
            roleTask = 'Kasir';
          }
        }

        const wInfo = computePersonnelWeight({
          role: roleTask,
          sesi,
          attendanceDate: wibDate,
          lateMinutes: att.lateMinutes,
        });

        return { att, roleTask, wInfo };
      });

      const groupKey = `${hariStr}-${sesi}`;
      let gAgg = groupAggMap.get(groupKey);
      if (!gAgg) {
        gAgg = {
          groupKey,
          hari: hariStr,
          sesi,
          slotLabel,
          datesSet: new Set<string>(),
          txCount: 0,
          unitsSold: 0,
          omzet: 0,
          labaKotor: 0,
          poolGaji: 0,
          shortageDeduction: 0,
          gajiBersih: 0,
          membersMap: new Map<string, ShiftGroupMemberAttendance>(),
        };
        groupAggMap.set(groupKey, gAgg);
      }

      gAgg.datesSet.add(wibDate);
      gAgg.txCount += fin.txCount;
      gAgg.unitsSold += fin.unitsSold;
      gAgg.omzet += fin.omzet;
      gAgg.labaKotor += fin.labaKotor;
      gAgg.poolGaji += poolGaji;
      gAgg.shortageDeduction += shortageDeduction;
      gAgg.gajiBersih += gajiBersih;

      const personnel: AttendeeRow[] = evaluated.map(({ att, roleTask, wInfo }) => {
        const empId = att.employee.id;
        const displayJabatan =
          empId === KETUA_UMKM_CANONICAL_ID || att.employee.nim === KETUA_UMKM_NIM
            ? 'Ketua UMKM / Admin Shift'
            : att.employee.jabatan;

        if (!isExcludedAccount(att.employee.fullName, att.employee.nim)) {
          const existingMember = gAgg.membersMap.get(empId) ?? {
            employeeId: empId,
            fullName: att.employee.fullName,
            nim: att.employee.nim,
            jabatan: displayJabatan,
            totalHadir: 0,
            totalLateMinutes: 0,
          };
          existingMember.totalHadir += 1;
          existingMember.totalLateMinutes += wInfo.effectiveLateMinutes;
          gAgg.membersMap.set(empId, existingMember);
        }

        return {
          employeeId: empId,
          fullName: att.employee.fullName,
          nim: att.employee.nim,
          programStudi: att.employee.programStudi,
          jabatan: roleTask,
          status: wInfo.effectiveLateMinutes > 0 ? 'TELAT' : 'HADIR',
          lateMinutes: wInfo.effectiveLateMinutes,
          penaltyPercent: wInfo.penaltyPercent,
          roleWeight: wInfo.roleWeight,
          sessionWeight: wInfo.sessionWeight,
          totalWeight: wInfo.totalWeight,
          nominalBagiHasil: 0,
        };
      });

      builtShifts.push({
        shiftId: s.id,
        tanggal: wibDate,
        hari: hariStr,
        sesi,
        slotLabel,
        clockIn: s.clockIn.toISOString(),
        clockOut: s.clockOut?.toISOString() ?? null,
        kasirName: s.kasirName,
        kasirNim: s.kasirNim,
        txCount: fin.txCount,
        unitsSold: fin.unitsSold,
        omzet: fin.omzet,
        labaKotor: fin.labaKotor,
        poolGaji,
        modalAwal,
        cashSales,
        cashOut,
        cashIn,
        actualCash,
        expectedCash,
        discrepancy,
        shortageStatus: sStatus,
        shortageGraceUntil: s.shortageGraceUntil ? s.shortageGraceUntil.toISOString() : null,
        shortageOverrideReason: s.shortageOverrideReason ?? null,
        shortageDeduction,
        gajiBersih,
        auditFlags: s.auditFlags ?? null,
        notes: s.notes ?? null,
        cashMovements: cashMovementsByShift.get(s.id) ?? [],
        consignmentSummary: consignmentByDate.get(wibDate) ?? null,
        personnelCount: count,
        nominalPerOrang: 0,
        personnel,
      });
    }

    const summaryPerShiftGroup: ShiftGroupSummary[] = Array.from(groupAggMap.values())
      .map((g) => {
        const tanggalList = Array.from(g.datesSet).sort();
        const totalShiftCount = tanggalList.length;
        return {
          groupKey: g.groupKey,
          hari: g.hari,
          sesi: g.sesi,
          slotLabel: g.slotLabel,
          totalShiftCount,
          txCount: g.txCount,
          unitsSold: g.unitsSold,
          omzet: g.omzet,
          labaKotor: g.labaKotor,
          poolGaji: g.poolGaji,
          shortageDeduction: g.shortageDeduction,
          gajiBersih: g.gajiBersih,
          rataRataPerShift: totalShiftCount > 0 ? Math.round(g.gajiBersih / totalShiftCount) : 0,
          tanggalList,
          anggotaTim: Array.from(g.membersMap.values()).sort(
            (a, b) => b.totalHadir - a.totalHadir || a.fullName.localeCompare(b.fullName),
          ),
        };
      })
      .sort((a, b) => {
        const hDiff = (HARI_SORT_ORDER[a.hari] ?? 99) - (HARI_SORT_ORDER[b.hari] ?? 99);
        if (hDiff !== 0) return hDiff;
        return a.sesi === 'Pagi' ? -1 : 1;
      });

    // Rumus 50% Kehadiran Tim / 50% Laba Shift (Pembagian Utuh Per Shift) + potongan tekor terkunci kembali ke Kas Toko
    const totalDistributed = builtShifts.reduce((acc, s) => acc + s.gajiBersih, 0);
    const sisaPool = Math.max(0, poolShiftMahasiswa - totalShortageDeduction - totalDistributed);
    const labaBersihToko = fs.labaBersih + totalShortageDeduction;

    return apiOk({
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        label: range.label,
        period: period ?? 'custom',
      },
      formula: {
        payrollMode: 'PER_SHIFT',
        attendancePct: Math.round(PAYROLL_ATTENDANCE_RATIO * 100),
        performancePct: Math.round(PAYROLL_PERFORMANCE_RATIO * 100),
        equalRoleWeight: true,
      },
      grandTotal: {
        omzet: fs.omzet,
        labaKotor: fs.labaKotor,
        biayaOperasional: fs.biayaOperasional,
        labaOperasionalBersih,
        poolGaji: poolHakMahasiswa,
        tunjanganKetua: 0,
        poolShiftMahasiswa,
        txCount: fs.txCount,
        totalUnitsSold: builtShifts.reduce((acc, sh) => acc + sh.unitsSold, 0),
        totalShortageDeduction,
        totalDistributed,
        sisaPool,
        labaBersihToko,
      },
      shifts: builtShifts,
      summaryPerShiftGroup,
      summaryPerEmployee: [],
      scheduleTeams,
      availableMonths,
    });
  } catch (err) {
    console.error('[laporan/per-shift GET]', err);
    return apiError('Gagal mengambil laporan per shift', 500);
  }
}
