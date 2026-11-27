// =============================================================
// Smartkasir Perwira — Cashier Recap Service (PRD 4.0 Fitur 1)
// Domain: Rekapitulasi Riwayat Transaksi Kasir Per-Shift & Per-Jam (WIB)
// STANDAR: Zero-Trust Aerospace Grade, Shared Drawer Aware, Zero HPP Leak
// =============================================================

import { z } from 'zod';
import { eq, and, desc, gte, lte, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  attendances,
  employees,
  products,
  shifts,
  shiftCashMovements,
  stockAdjustments,
  stockReceiveDrafts,
  stockReceiveItems,
  suppliers,
  transactions,
  transactionItems,
  transactionPayments,
} from '@/lib/db/schema';
import { AppError } from '@/lib/utils/helpers';
import { resolveShiftSessionsBatch } from '@/lib/services/activeShiftService';

// ─────────────────────────────────────────────────────────────
// 1. Zod Validation Schemas
// ─────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CASHIER_RANGE_DAYS = 1_100;

export const CashierRecapQuerySchema = z
  .object({
    employeeId: z.string().uuid('ID Karyawan tidak valid'),
    tanggal: z
      .string()
      .regex(ISO_DATE_RE, 'Format tanggal harus YYYY-MM-DD')
      .optional(),
    dateTo: z
      .string()
      .regex(ISO_DATE_RE, 'Format dateTo harus YYYY-MM-DD')
      .optional(),
    shiftId: z.string().uuid('ID Shift tidak valid').optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .superRefine((val, ctx) => {
    if (val.tanggal && val.dateTo) {
      if (val.dateTo < val.tanggal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateTo'],
          message: 'Tanggal akhir tidak boleh lebih kecil dari tanggal awal',
        });
      }
      const startMs = new Date(`${val.tanggal}T00:00:00+07:00`).getTime();
      const endMs = new Date(`${val.dateTo}T00:00:00+07:00`).getTime();
      const diffDays = Math.round((endMs - startMs) / 86_400_000) + 1;
      if (diffDays > MAX_CASHIER_RANGE_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateTo'],
          message: `Rentang tanggal kasir maksimal ${MAX_CASHIER_RANGE_DAYS} hari`,
        });
      }
    }
  });

export type CashierRecapQueryParams = z.infer<typeof CashierRecapQuerySchema>;

// ─────────────────────────────────────────────────────────────
// 2. Output DTO Types
// ─────────────────────────────────────────────────────────────

export type CashierShiftInfoDTO = {
  id: string;
  shiftName: string; // 'Shift 1 (Pagi 07:30 - 11:30)' | 'Shift 2 (Siang 11:30 - 15:00)'
  clockIn: string;
  clockOut: string | null;
  status: 'ACTIVE' | 'CLOSED';
  modalAwal: number;
  isSharedDrawer?: boolean;
  drawerOwnerName?: string;
};

export type CashierHourlyBucketDTO = {
  hour: number;       // 0..23 WIB
  label: string;      // e.g. '08:00 - 08:59 WIB'
  txCount: number;
  voidCount: number;
  omzetCash: number;
  omzetQris: number;
  omzetTotal: number;
};

export type CashierRecapSummaryDTO = {
  modalAwal: number;           // Modal awal laci kasir (default: Rp 100.000 atau dari shift)
  totalTransaksi: number;      // Total struk berhasil (COMPLETED) oleh kasir ini
  totalVoid: number;           // Total struk dibatalkan (VOID) oleh kasir ini
  totalAmountCash: number;     // Total uang tunai dari penjualan kasir ini
  totalKembalian: number;      // Total uang kembalian transaksi kasir ini
  netCashSales: number;        // Penjualan tunai bersih kasir ini
  drawerCashSales: number;     // Total penjualan tunai pada laci shift (termasuk co-cashier)
  totalCashOut: number;        // Kas Keluar Laci (Titipan makanan, beli lepas, galon, dll)
  totalCashIn: number;         // Kas Masuk Laci (Tukar receh, dll)
  totalFisikLaci: number;      // Uang fisik wajib di laci = Modal Awal + Cash Laci - Kas Keluar + Kas Masuk
  uangTinggalDiLaci: number;   // Modal Shift Berikutnya (Paten Rp 100.000)
  uangSetoranToko: number;     // Uang yang harus disetor ke amplop = max(0, totalFisikLaci - 100.000)
  totalAmountQris: number;     // Total mutasi digital QRIS masuk milik kasir ini
  totalOmzet: number;          // Total omzet kasir ini (Net Cash Sales + Total QRIS)
  totalAmountSplit: number;    // Total transaksi kombinasi CASH+QRIS kasir ini
  totalVoidAmount: number;     // Total rupiah struk yang dibatalkan kasir ini
  isSharedShift: boolean;      // True jika shift dikerjakan bersama rekan (teamShift)
  rekanKasir: string[];        // Nama rekan kasir lain pada shift yang sama
};

export type CashierRecapItemDTO = {
  id: string;
  invoiceNumber: string;
  createdAt: string;           // ISO UTC string
  itemCount: number;           // Jumlah jenis barang
  grossAmount: number;         // Nominal tagihan
  cashReceived: number | null; // Uang yang diserahkan pelanggan
  changeAmount: number | null; // Uang kembalian
  paymentMethod: 'CASH' | 'QRIS'; // Metode primer
  payments: Array<{
    paymentMethod: 'CASH' | 'QRIS';
    amount: number;
    cashReceived: number | null;
    changeAmount: number | null;
  }>;
  status: 'COMPLETED' | 'VOID';
  isVoid: boolean;
  voidReason: string | null;
};

export type ClosingProductMovementDTO = {
  productId: string;
  productName: string;
  unit: string;
  supplierName: string | null;
  qtyReceived: number;    // Qty masuk dari nota supplier pada tanggal/periode ini
  qtySold: number;        // Qty laku terjual di POS (COMPLETED)
  omzetSold: number;      // Total rupiah penjualan produk ini (tanpa HPP)
  qtyReturned: number;    // Qty diretur ke supplier / cut-off sisa makanan
  stockRemaining: number; // Sisa stok fisik saat ini di toko
};

export type CashierRecapResponseDTO = {
  kasir: {
    id: string;
    fullName: string;
    nim: string;
    jabatan: string;
  };
  tanggal: string;              // YYYY-MM-DD (WIB, tanggal awal)
  dateTo: string;               // YYYY-MM-DD (WIB, tanggal akhir)
  activeShiftId: string | null; // ID shift yang sedang aktif/difilter
  activeShiftName: string | null;
  shiftsSaya: CashierShiftInfoDTO[];
  summary: CashierRecapSummaryDTO;
  hourlyBreakdown: CashierHourlyBucketDTO[];
  closingProductRecap: ClosingProductMovementDTO[];
  transaksi: CashierRecapItemDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

// ─────────────────────────────────────────────────────────────
// 3. Date, Timezone & Payment Calculation Helpers (Asia/Jakarta)
// ─────────────────────────────────────────────────────────────

const SQL_IN_CHUNK_SIZE = 1_500;

export function getTodayWIB(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

export function getWIBDayBounds(dateStr: string): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(`${dateStr}T00:00:00+07:00`);
  const endUtc = new Date(`${dateStr}T23:59:59.999+07:00`);
  return { startUtc, endUtc };
}

function getWibHour(date: Date): number {
  const raw = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      hour12: false,
    }).format(date),
    10,
  );
  return Number.isFinite(raw) ? raw % 24 : 0;
}

function fmtHourRangeWib(hour: number): string {
  const h = String(hour).padStart(2, '0');
  return `${h}:00 - ${h}:59 WIB`;
}

function formatShiftSessionLabel(sesi: 'Pagi' | 'Siang'): string {
  return sesi === 'Pagi'
    ? 'Shift 1 (Pagi 07:30 - 11:30)'
    : 'Shift 2 (Siang 11:30 - 15:00)';
}

function chunkArray<T>(items: readonly T[], size = SQL_IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type PaymentRecord = {
  transactionId: string;
  paymentMethod: string;
  amount: string;
  cashReceived: string | null;
  changeAmount: string | null;
};

function allocateTransactionBreakdown(
  grossNum: number,
  fallbackMethod: string,
  trxPays: readonly PaymentRecord[] | undefined,
): { cash: number; qris: number; isSplit: boolean } {
  if (trxPays && trxPays.length > 0) {
    let cash = 0;
    let qris = 0;
    for (const p of trxPays) {
      const amt = parseFloat(p.amount ?? '0') || 0;
      if (p.paymentMethod === 'CASH') cash += amt;
      else if (p.paymentMethod === 'QRIS') qris += amt;
    }
    return { cash, qris, isSplit: cash > 0 && qris > 0 };
  }
  return {
    cash: fallbackMethod === 'CASH' ? grossNum : 0,
    qris: fallbackMethod === 'QRIS' ? grossNum : 0,
    isSplit: false,
  };
}

async function fetchPaymentsByTransactionIds(
  trxIds: readonly string[],
): Promise<Map<string, PaymentRecord[]>> {
  const map = new Map<string, PaymentRecord[]>();
  for (const idChunk of chunkArray(trxIds)) {
    const rows = await db
      .select({
        transactionId: transactionPayments.transactionId,
        paymentMethod: transactionPayments.paymentMethod,
        amount: transactionPayments.amount,
        cashReceived: transactionPayments.cashReceived,
        changeAmount: transactionPayments.changeAmount,
      })
      .from(transactionPayments)
      .where(inArray(transactionPayments.transactionId, idChunk));

    for (const pay of rows) {
      const arr = map.get(pay.transactionId) ?? [];
      arr.push(pay);
      map.set(pay.transactionId, arr);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// 4. Domain Service Implementation
// ─────────────────────────────────────────────────────────────

export async function getCashierDailyRecap(
  rawInput: CashierRecapQueryParams,
): Promise<CashierRecapResponseDTO> {
  const parsed = CashierRecapQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      parsed.error.issues.map((e) => e.message).join(', '),
      400,
    );
  }

  const { employeeId, shiftId, page, limit } = parsed.data;
  const tanggalWIB = parsed.data.tanggal ?? getTodayWIB();
  const dateToWIB = parsed.data.dateTo ?? tanggalWIB;
  const isMultiDayRange = dateToWIB !== tanggalWIB;

  const { startUtc } = getWIBDayBounds(tanggalWIB);
  const { endUtc } = getWIBDayBounds(dateToWIB);

  // 1. Verifikasi identitas kasir
  const cashier = await db.query.employees.findFirst({
    where: and(eq(employees.id, employeeId), isNull(employees.deletedAt)),
    columns: {
      id: true,
      fullName: true,
      nim: true,
      jabatan: true,
      isActive: true,
    },
  });

  if (!cashier) {
    throw new AppError('NOT_FOUND', 'Data kasir tidak ditemukan atau akun dinonaktifkan.', 404);
  }

  // 2. Kumpulkan seluruh Shift di mana kasir ini menjadi Pembuka Shift ATAU Kasir Pendamping (teamShift)
  // Sumber keikutsertaan yang sah: shifts.employeeId, attendances.shiftId, atau transactions.shiftId milik kasir ini.
  const [ownedShiftRows, trxShiftRows, attShiftRows] = await Promise.all([
    db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.employeeId, employeeId), gte(shifts.clockIn, startUtc), lte(shifts.clockIn, endUtc))),
    db
      .selectDistinct({ shiftId: transactions.shiftId })
      .from(transactions)
      .where(
        and(
          eq(transactions.employeeId, employeeId),
          eq(transactions.isTest, false),
          gte(transactions.createdAt, startUtc),
          lte(transactions.createdAt, endUtc),
        ),
      ),
    db
      .selectDistinct({ shiftId: attendances.shiftId })
      .from(attendances)
      .where(
        and(
          eq(attendances.employeeId, employeeId),
          isNotNull(attendances.shiftId),
          gte(attendances.attendanceDate, tanggalWIB),
          lte(attendances.attendanceDate, dateToWIB),
        ),
      ),
  ]);

  const participatedShiftIdSet = new Set<string>();
  for (const r of ownedShiftRows) participatedShiftIdSet.add(r.id);
  for (const r of trxShiftRows) if (r.shiftId) participatedShiftIdSet.add(r.shiftId);
  for (const r of attShiftRows) if (r.shiftId) participatedShiftIdSet.add(r.shiftId);

  const participatedShiftIds = [...participatedShiftIdSet];
  const myShiftsRows: Array<{
    id: string;
    employeeId: string;
    clockIn: Date;
    clockOut: Date | null;
    status: string;
    sessionType: string | null;
    actualCash: string | null;
    modalAwal: string | null;
    ownerName: string;
  }> = [];

  for (const idChunk of chunkArray(participatedShiftIds)) {
    const chunkRows = await db
      .select({
        id: shifts.id,
        employeeId: shifts.employeeId,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        status: shifts.status,
        sessionType: shifts.sessionType,
        actualCash: shifts.actualCash,
        modalAwal: shifts.modalAwal,
        ownerName: employees.fullName,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(inArray(shifts.id, idChunk));
    myShiftsRows.push(...chunkRows);
  }

  myShiftsRows.sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime());

  const sessionByShiftId = await resolveShiftSessionsBatch(myShiftsRows);

  const shiftsSaya: CashierShiftInfoDTO[] = myShiftsRows.map((s) => {
    const parsedModal = s.modalAwal !== null && s.modalAwal !== undefined && s.modalAwal !== ''
      ? parseFloat(s.modalAwal)
      : NaN;
    const modalAwal = Number.isFinite(parsedModal) && parsedModal >= 0
      ? Math.round(parsedModal)
      : 100_000;
    const isSharedDrawer = s.employeeId !== employeeId;
    const resolvedSesi = sessionByShiftId.get(s.id) ?? 'Pagi';
    return {
      id: s.id,
      shiftName: formatShiftSessionLabel(resolvedSesi),
      clockIn: s.clockIn.toISOString(),
      clockOut: s.clockOut ? s.clockOut.toISOString() : null,
      status: s.status as 'ACTIVE' | 'CLOSED',
      modalAwal,
      isSharedDrawer,
      ...(isSharedDrawer ? { drawerOwnerName: s.ownerName } : {}),
    };
  });

  // 3. Tentukan shift target yang difilter (IDOR-Proof)
  let targetShiftId: string | null = null;
  let targetShiftModalAwal = 0;
  let targetShiftName: string | null = null;

  if (shiftId) {
    const matchingShift = shiftsSaya.find((s) => s.id === shiftId);
    if (!matchingShift) {
      throw new AppError('FORBIDDEN', 'Akses ditolak. Anda tidak memiliki akses ke sesi shift ini.', 403);
    }
    targetShiftId = matchingShift.id;
    targetShiftModalAwal = matchingShift.modalAwal;
    targetShiftName = matchingShift.shiftName;
  } else if (!isMultiDayRange && shiftsSaya.length > 0) {
    const activeOrLatest = shiftsSaya.find((s) => s.status === 'ACTIVE') ?? shiftsSaya[0];
    targetShiftId = activeOrLatest.id;
    targetShiftModalAwal = activeOrLatest.modalAwal;
    targetShiftName = activeOrLatest.shiftName;
  } else if (isMultiDayRange && shiftsSaya.length > 0) {
    targetShiftModalAwal = shiftsSaya.reduce((sum, sh) => sum + sh.modalAwal, 0);
  }

  // 4. Query transaksi pribadi kasir pada shift target atau rentang tanggal
  const trxConditions = [
    eq(transactions.employeeId, employeeId),
    eq(transactions.isTest, false),
  ];

  if (targetShiftId) {
    trxConditions.push(eq(transactions.shiftId, targetShiftId));
  } else {
    trxConditions.push(gte(transactions.createdAt, startUtc));
    trxConditions.push(lte(transactions.createdAt, endUtc));
  }

  const allPersonalTrx = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      createdAt: transactions.createdAt,
      grossAmount: transactions.grossAmount,
      cashReceived: transactions.cashReceived,
      changeAmount: transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
    })
    .from(transactions)
    .where(and(...trxConditions));

  const personalTrxIds = allPersonalTrx.map((t) => t.id);
  const paymentsByTrx = await fetchPaymentsByTransactionIds(personalTrxIds);

  // 5. Kalkulasi penjualan pribadi kasir + agregasi Per-Jam (WIB)
  let totalTransaksi = 0;
  let totalVoid = 0;
  let totalAmountCash = 0;
  let totalAmountQris = 0;
  let totalAmountSplit = 0;
  let totalKembalian = 0;
  let totalVoidAmount = 0;

  const hourlyMap = new Map<number, CashierHourlyBucketDTO>();
  const getOrCreateHourBucket = (hour: number): CashierHourlyBucketDTO => {
    const existing = hourlyMap.get(hour);
    if (existing) return existing;
    const created: CashierHourlyBucketDTO = {
      hour,
      label: fmtHourRangeWib(hour),
      txCount: 0,
      voidCount: 0,
      omzetCash: 0,
      omzetQris: 0,
      omzetTotal: 0,
    };
    hourlyMap.set(hour, created);
    return created;
  };

  for (const t of allPersonalTrx) {
    const grossNum = parseFloat(t.grossAmount ?? '0') || 0;
    const changeNum = parseFloat(t.changeAmount ?? '0') || 0;
    const hourWib = getWibHour(new Date(t.createdAt));
    const bucket = getOrCreateHourBucket(hourWib);

    if (t.status === 'VOID') {
      totalVoid++;
      totalVoidAmount += grossNum;
      bucket.voidCount += 1;
      continue;
    }

    totalTransaksi++;
    totalKembalian += changeNum;

    const { cash, qris, isSplit } = allocateTransactionBreakdown(
      grossNum,
      t.paymentMethod,
      paymentsByTrx.get(t.id),
    );
    if (isSplit) totalAmountSplit += grossNum;

    totalAmountCash += cash;
    totalAmountQris += qris;

    bucket.txCount += 1;
    bucket.omzetCash += cash;
    bucket.omzetQris += qris;
    bucket.omzetTotal += cash + qris;
  }

  const hourlyBreakdown = [...hourlyMap.values()]
    .map((h) => ({
      ...h,
      omzetCash: Math.round(h.omzetCash),
      omzetQris: Math.round(h.omzetQris),
      omzetTotal: Math.round(h.omzetTotal),
    }))
    .sort((a, b) => a.hour - b.hour);

  // 6. Balancing laci fisik shift (mengikutsertakan seluruh kasir di laci yang sama / teamShift)
  const shiftIdsForDrawer = targetShiftId
    ? [targetShiftId]
    : shiftsSaya.map((s) => s.id);

  let drawerCashSales = 0;
  let totalCashOut = 0;
  let totalCashIn = 0;
  const peerNames = new Set<string>();

  if (shiftIdsForDrawer.length > 0) {
    const drawerTrx: Array<{
      id: string;
      employeeId: string;
      grossAmount: string;
      paymentMethod: string;
    }> = [];

    for (const idChunk of chunkArray(shiftIdsForDrawer)) {
      const [chunkDrawerTrx, chunkMovements, chunkPeers] = await Promise.all([
        db
          .select({
            id: transactions.id,
            employeeId: transactions.employeeId,
            grossAmount: transactions.grossAmount,
            paymentMethod: transactions.paymentMethod,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.shiftId, idChunk),
              eq(transactions.status, 'COMPLETED'),
              eq(transactions.isTest, false),
            ),
          ),
        db
          .select({
            movementType: shiftCashMovements.movementType,
            amount: shiftCashMovements.amount,
          })
          .from(shiftCashMovements)
          .where(inArray(shiftCashMovements.shiftId, idChunk)),
        db
          .selectDistinct({ fullName: employees.fullName, empId: employees.id })
          .from(transactions)
          .innerJoin(employees, eq(transactions.employeeId, employees.id))
          .where(
            and(
              inArray(transactions.shiftId, idChunk),
              eq(transactions.isTest, false),
            ),
          ),
      ]);

      drawerTrx.push(...chunkDrawerTrx);
      for (const m of chunkMovements) {
        const val = parseFloat(m.amount ?? '0') || 0;
        if (m.movementType === 'CASH_OUT') totalCashOut += val;
        else if (m.movementType === 'CASH_IN') totalCashIn += val;
      }
      for (const p of chunkPeers) {
        if (p.empId !== employeeId) peerNames.add(p.fullName);
      }
    }

    // Pastikan pemilik pembuka shift juga terdaftar sebagai rekan jika co-cashier melihat shift ini
    for (const sh of myShiftsRows) {
      if (shiftIdsForDrawer.includes(sh.id) && sh.employeeId !== employeeId) {
        peerNames.add(sh.ownerName);
      }
    }

    const missingPaymentIds = drawerTrx
      .map((t) => t.id)
      .filter((id) => !paymentsByTrx.has(id));
    if (missingPaymentIds.length > 0) {
      const extraPayments = await fetchPaymentsByTransactionIds(missingPaymentIds);
      for (const [trxId, pays] of extraPayments.entries()) {
        paymentsByTrx.set(trxId, pays);
      }
    }

    for (const dt of drawerTrx) {
      const grossNum = parseFloat(dt.grossAmount ?? '0') || 0;
      const { cash } = allocateTransactionBreakdown(
        grossNum,
        dt.paymentMethod,
        paymentsByTrx.get(dt.id),
      );
      drawerCashSales += cash;
    }
  } else {
    drawerCashSales = totalAmountCash;
  }

  const netCashSales = totalAmountCash;
  const totalFisikLaci = targetShiftModalAwal + drawerCashSales - totalCashOut + totalCashIn;
  const uangTinggalDiLaci = targetShiftId || shiftsSaya.length > 0 ? targetShiftModalAwal : 0;
  const uangSetoranToko = Math.max(0, totalFisikLaci - uangTinggalDiLaci);
  const totalOmzet = netCashSales + totalAmountQris;
  const isSharedShift = peerNames.size > 0 || shiftsSaya.some((s) => s.isSharedDrawer);

  const summary: CashierRecapSummaryDTO = {
    modalAwal: Math.round(targetShiftModalAwal),
    totalTransaksi,
    totalVoid,
    totalAmountCash: Math.round(totalAmountCash),
    totalKembalian: Math.round(totalKembalian),
    netCashSales: Math.round(netCashSales),
    drawerCashSales: Math.round(drawerCashSales),
    totalCashOut: Math.round(totalCashOut),
    totalCashIn: Math.round(totalCashIn),
    totalFisikLaci: Math.round(totalFisikLaci),
    uangTinggalDiLaci: Math.round(uangTinggalDiLaci),
    uangSetoranToko: Math.round(uangSetoranToko),
    totalAmountQris: Math.round(totalAmountQris),
    totalOmzet: Math.round(totalOmzet),
    totalAmountSplit: Math.round(totalAmountSplit),
    totalVoidAmount: Math.round(totalVoidAmount),
    isSharedShift,
    rekanKasir: [...peerNames],
  };

  // 7. Query Paged Transactions (Milik Kasir Ini)
  const totalTrxCount = allPersonalTrx.length;
  const totalPages = Math.ceil(totalTrxCount / limit) || 1;
  const offset = (page - 1) * limit;

  const pagedTrx = await db
    .select({
      id: transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      createdAt: transactions.createdAt,
      grossAmount: transactions.grossAmount,
      cashReceived: transactions.cashReceived,
      changeAmount: transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
      status: transactions.status,
      voidReason: transactions.voidReason,
    })
    .from(transactions)
    .where(and(...trxConditions))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  const pagedIds = pagedTrx.map((t) => t.id);

  // Item counts (guarded)
  const itemCountsMap = new Map<string, number>();
  for (const idChunk of chunkArray(pagedIds)) {
    const itemCounts = await db
      .select({
        transactionId: transactionItems.transactionId,
        count: sql<number>`cast(count(${transactionItems.id}) as int)`,
      })
      .from(transactionItems)
      .where(inArray(transactionItems.transactionId, idChunk))
      .groupBy(transactionItems.transactionId);

    for (const row of itemCounts) {
      itemCountsMap.set(row.transactionId, row.count);
    }
  }

  const transaksiDTO: CashierRecapItemDTO[] = pagedTrx.map((t) => {
    const trxPays = paymentsByTrx.get(t.id) ?? [];
    return {
      id: t.id,
      invoiceNumber: t.invoiceNumber,
      createdAt: t.createdAt.toISOString(),
      itemCount: itemCountsMap.get(t.id) ?? 0,
      grossAmount: Math.round(parseFloat(t.grossAmount ?? '0')),
      cashReceived: t.cashReceived ? Math.round(parseFloat(t.cashReceived)) : null,
      changeAmount: t.changeAmount ? Math.round(parseFloat(t.changeAmount)) : null,
      paymentMethod: t.paymentMethod as 'CASH' | 'QRIS',
      payments: trxPays.map((p) => ({
        paymentMethod: p.paymentMethod as 'CASH' | 'QRIS',
        amount: Math.round(parseFloat(p.amount ?? '0')),
        cashReceived: p.cashReceived ? Math.round(parseFloat(p.cashReceived)) : null,
        changeAmount: p.changeAmount ? Math.round(parseFloat(p.changeAmount)) : null,
      })),
      status: t.status as 'COMPLETED' | 'VOID',
      isVoid: t.status === 'VOID',
      voidReason: t.voidReason ?? null,
    };
  });

  // 8. Agregasi Closing Pergerakan Barang ("Masuk Nota Berapa, Laku Berapa, Retur Berapa, Sisa Berapa")
  const [soldItemsRows, receivedItemsRows, adjustmentRows] = await Promise.all([
    db
      .select({
        productId: transactionItems.productId,
        qtySold: sql<number>`cast(coalesce(sum(${transactionItems.qty}), 0) as int)`,
        omzetSold: sql<string>`coalesce(sum(${transactionItems.subtotalSell}), 0)::text`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.isTest, false),
          targetShiftId
            ? eq(transactions.shiftId, targetShiftId)
            : and(gte(transactions.createdAt, startUtc), lte(transactions.createdAt, endUtc)),
        ),
      )
      .groupBy(transactionItems.productId),

    db
      .select({
        productId: stockReceiveItems.productId,
        qtyReceived: sql<number>`cast(coalesce(sum(${stockReceiveItems.qty}), 0) as int)`,
        supplierName: sql<string | null>`max(${suppliers.name})`,
      })
      .from(stockReceiveItems)
      .innerJoin(stockReceiveDrafts, eq(stockReceiveItems.draftId, stockReceiveDrafts.id))
      .leftJoin(suppliers, eq(stockReceiveDrafts.supplierId, suppliers.id))
      .where(
        and(
          isNull(stockReceiveDrafts.deletedAt),
          sql`${stockReceiveDrafts.status} != 'REJECTED'`,
          gte(
            sql`coalesce(${stockReceiveDrafts.invoiceDate}, (${stockReceiveDrafts.createdAt} AT TIME ZONE 'Asia/Jakarta')::date)`,
            sql`${tanggalWIB}::date`,
          ),
          lte(
            sql`coalesce(${stockReceiveDrafts.invoiceDate}, (${stockReceiveDrafts.createdAt} AT TIME ZONE 'Asia/Jakarta')::date)`,
            sql`${dateToWIB}::date`,
          ),
        ),
      )
      .groupBy(stockReceiveItems.productId),

    db
      .select({
        productId: stockAdjustments.productId,
        qtyDiff: stockAdjustments.qtyDiff,
        reason: stockAdjustments.reason,
      })
      .from(stockAdjustments)
      .where(
        and(
          gte(stockAdjustments.createdAt, startUtc),
          lte(stockAdjustments.createdAt, endUtc),
          sql`${stockAdjustments.qtyDiff} < 0`,
        ),
      ),
  ]);

  const movementProductIds = new Set<string>();
  for (const r of soldItemsRows) movementProductIds.add(r.productId);
  for (const r of receivedItemsRows) movementProductIds.add(r.productId);
  for (const r of adjustmentRows) movementProductIds.add(r.productId);

  const productMetaMap = new Map<string, { name: string; unit: string; stockQty: number }>();
  for (const idChunk of chunkArray([...movementProductIds])) {
    const prodRows = await db
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        stockQty: products.stockQty,
      })
      .from(products)
      .where(inArray(products.id, idChunk));

    for (const p of prodRows) {
      productMetaMap.set(p.id, {
        name: p.name,
        unit: p.unit,
        stockQty: p.stockQty,
      });
    }
  }

  const soldMap = new Map<string, { qtySold: number; omzetSold: number }>();
  for (const r of soldItemsRows) {
    soldMap.set(r.productId, {
      qtySold: Number(r.qtySold ?? 0),
      omzetSold: Math.round(parseFloat(r.omzetSold ?? '0') || 0),
    });
  }

  const receivedMap = new Map<string, { qtyReceived: number; supplierName: string | null }>();
  for (const r of receivedItemsRows) {
    receivedMap.set(r.productId, {
      qtyReceived: Number(r.qtyReceived ?? 0),
      supplierName: r.supplierName ?? null,
    });
  }

  const returnedMap = new Map<string, number>();
  for (const adj of adjustmentRows) {
    const reasonUpper = (adj.reason ?? '').toUpperCase();
    const isReturnOrCutoff =
      reasonUpper.includes('RETUR') ||
      reasonUpper.includes('CUT-OFF') ||
      reasonUpper.includes('RETURN_SUPPLIER') ||
      reasonUpper.includes('BASI') ||
      reasonUpper.includes('EXPIRED') ||
      reasonUpper.includes('DAMAGED');
    if (isReturnOrCutoff) {
      const prev = returnedMap.get(adj.productId) ?? 0;
      returnedMap.set(adj.productId, prev + Math.abs(Number(adj.qtyDiff ?? 0)));
    }
  }

  const closingProductRecap: ClosingProductMovementDTO[] = [...movementProductIds]
    .map((pid) => {
      const meta = productMetaMap.get(pid);
      const sold = soldMap.get(pid);
      const rec = receivedMap.get(pid);
      const retQty = returnedMap.get(pid) ?? 0;
      return {
        productId: pid,
        productName: meta?.name ?? 'Produk',
        unit: meta?.unit ?? 'pcs',
        supplierName: rec?.supplierName ?? null,
        qtyReceived: rec?.qtyReceived ?? 0,
        qtySold: sold?.qtySold ?? 0,
        omzetSold: sold?.omzetSold ?? 0,
        qtyReturned: retQty,
        stockRemaining: meta?.stockQty ?? 0,
      };
    })
    .filter((item) => item.qtyReceived > 0 || item.qtySold > 0 || item.qtyReturned > 0)
    .sort((a, b) => b.qtySold - a.qtySold || b.qtyReturned - a.qtyReturned || b.qtyReceived - a.qtyReceived);

  return {
    kasir: {
      id: cashier.id,
      fullName: cashier.fullName,
      nim: cashier.nim,
      jabatan: cashier.jabatan,
    },
    tanggal: tanggalWIB,
    dateTo: dateToWIB,
    activeShiftId: targetShiftId,
    activeShiftName: targetShiftName,
    shiftsSaya,
    summary,
    hourlyBreakdown,
    closingProductRecap,
    transaksi: transaksiDTO,
    pagination: {
      page,
      limit,
      total: totalTrxCount,
      totalPages,
    },
  };
}
