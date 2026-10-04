// =============================================================
// Service Keuangan — SATU sumber kebenaran angka laporan
//
// Definisi baku (Bagian 5 + keputusan Q1/Q4):
//   Omzet          = Σ gross_amount transaksi COMPLETED (void & data uji dikecualikan)
//   Omzet Cash     = Σ gross_amount COMPLETED bermetode CASH   (kembalian tidak ikut)
//   Omzet QRIS     = Σ gross_amount COMPLETED bermetode QRIS
//   Invarian       : Omzet Cash + Omzet QRIS = Omzet
//   HPP terjual    = Σ subtotal_cost item BER-HPP (cost_price_snapshot > 0)
//   Laba Kotor     = Σ subtotal_sell item BER-HPP − HPP terjual
//                    Item dengan HPP ≤ 0 ("HPP belum diisi") TIDAK dihitung laba;
//                    nilainya dilaporkan terpisah sebagai omzetTanpaHpp → "laba tidak lengkap".
//   Biaya Operasional = Σ operating_expenses (belum dihapus) pada tanggal bisnis WIB periode
//   Laba Bersih    = Laba Kotor − Biaya Operasional
//
// Semua batas hari memakai Asia/Jakarta (server Vercel berjalan di UTC).
// Rentang waktu = [start, endExclusive) agar tidak ada transaksi yang jatuh di celah.
// =============================================================

import { and, eq, gte, lt, lte, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { transactions, transactionItems, operatingExpenses } from '@/lib/db/schema';
import type { ExpenseCategory } from '@/lib/db/schema';

// ─────────────────────────────────────────────────────────────
// Rentang periode (WIB)
// ─────────────────────────────────────────────────────────────
export type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'semi_annual';

export type ReportRange = {
  /** 'YYYY-MM-DD' WIB, inklusif */
  startDate: string;
  /** 'YYYY-MM-DD' WIB, inklusif */
  endDate: string;
  /** Awal rentang (00:00 WIB hari pertama), inklusif */
  start: Date;
  /** Awal hari SETELAH endDate (00:00 WIB), eksklusif */
  endExclusive: Date;
  label: string;
};

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 400; // FinOps guard: batasi rentang kustom
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isRealDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  return new Date(utcMs(dateStr)).toISOString().slice(0, 10) === dateStr;
}

export function addDays(dateStr: string, n: number): string {
  return new Date(utcMs(dateStr) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Tanggal hari ini menurut WIB, 'YYYY-MM-DD'. */
export function wibToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function formatId(dateStr: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(utcMs(dateStr)));
}

export class InvalidRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRangeError';
  }
}

export function resolveReportRange(input: {
  period?: PeriodKey | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  now?: Date;
}): ReportRange {
  let startDate: string;
  let endDate: string;
  let label: string;

  if (input.dateFrom && input.dateTo) {
    if (!isRealDate(input.dateFrom) || !isRealDate(input.dateTo)) {
      throw new InvalidRangeError('Format tanggal harus YYYY-MM-DD.');
    }
    if (input.dateFrom > input.dateTo) {
      throw new InvalidRangeError('Tanggal awal tidak boleh setelah tanggal akhir.');
    }
    const span = (utcMs(input.dateTo) - utcMs(input.dateFrom)) / DAY_MS + 1;
    if (span > MAX_RANGE_DAYS) {
      throw new InvalidRangeError(`Rentang maksimal ${MAX_RANGE_DAYS} hari.`);
    }
    startDate = input.dateFrom;
    endDate = input.dateTo;
    label = `${formatId(startDate)} s/d ${formatId(endDate)}`;
  } else {
    const today = wibToday(input.now);
    const [y, m] = today.split('-').map(Number);
    switch (input.period ?? 'daily') {
      case 'daily':
        startDate = today;
        endDate = today;
        label = formatId(today);
        break;
      case 'weekly': {
        const dow = new Date(utcMs(today)).getUTCDay(); // 0 = Minggu
        startDate = addDays(today, -((dow + 6) % 7)); // Senin
        endDate = addDays(startDate, 6);
        label = `${formatId(startDate)} – ${formatId(endDate)}`;
        break;
      }
      case 'monthly': {
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const mm = String(m).padStart(2, '0');
        startDate = `${y}-${mm}-01`;
        endDate = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
        label = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', month: 'long', year: 'numeric' })
          .format(new Date(utcMs(startDate)));
        break;
      }
      case 'semi_annual': {
        const firstHalf = m <= 6;
        startDate = `${y}-${firstHalf ? '01-01' : '07-01'}`;
        endDate = `${y}-${firstHalf ? '06-30' : '12-31'}`;
        label = `${firstHalf ? 'Semester 1' : 'Semester 2'} ${y}`;
        break;
      }
    }
  }

  return {
    startDate,
    endDate,
    start: new Date(`${startDate}T00:00:00+07:00`),
    endExclusive: new Date(`${addDays(endDate, 1)}T00:00:00+07:00`),
    label,
  };
}

// ─────────────────────────────────────────────────────────────
// Tipe hasil
// ─────────────────────────────────────────────────────────────
export type ExpenseByCategory = { category: ExpenseCategory; total: number };

export type FinancialSummary = {
  omzet: number;
  omzetCash: number;
  omzetQris: number;
  txCount: number;
  txCountCash: number;
  txCountQris: number;
  voidCount: number;
  voidAmount: number;
  hppTerjual: number;
  labaKotor: number;
  /** Omzet dari item yang HPP-nya belum diisi (tidak dihitung dalam laba) */
  omzetTanpaHpp: number;
  /** Jumlah unit terjual yang HPP-nya belum diisi */
  unitTanpaHpp: number;
  /** false bila ada omzetTanpaHpp > 0 → laba dilabeli "tidak lengkap" */
  labaLengkap: boolean;
  biayaOperasional: number;
  biayaPerKategori: ExpenseByCategory[];
  labaBersih: number;
};

export type DailyRow = {
  date: string; // YYYY-MM-DD (WIB)
  txCount: number;
  voidCount: number;
  omzet: number;
  omzetCash: number;
  omzetQris: number;
  hppTerjual: number;
  labaKotor: number;
  omzetTanpaHpp: number;
  biayaOperasional: number;
  labaBersih: number;
};

export type IntegrityChecks = {
  /** Omzet Cash + Omzet QRIS = Omzet */
  methodSplitMatches: boolean;
  /** Σ item (ber-HPP + tanpa HPP) = Omzet */
  itemsMatchOmzet: boolean;
  /** Σ baris harian = ringkasan (omzet, laba bersih) */
  dailyMatchesSummary: boolean;
};

export type FinancialReport = {
  summary: FinancialSummary;
  daily: DailyRow[];
  checks: IntegrityChecks;
};

// ─────────────────────────────────────────────────────────────
// Util angka (rupiah, toleransi 1 sen untuk pembulatan numeric)
// ─────────────────────────────────────────────────────────────
const num = (v: string | number | null | undefined): number => Number(v ?? 0);
const money = (v: number): number => Math.round(v * 100) / 100;
const approx = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

// ─────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────
const WIB_DAY_TX = sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

const COMPLETED = sql`${transactions.status} = 'COMPLETED'`;
const HAS_HPP   = sql`${transactionItems.costPriceSnapshot} > 0`;
const NO_HPP    = sql`${transactionItems.costPriceSnapshot} <= 0`;

function txBase(range: ReportRange) {
  return and(
    eq(transactions.isTest, false),
    gte(transactions.createdAt, range.start),
    lt(transactions.createdAt, range.endExclusive),
  );
}

export async function getFinancialReport(range: ReportRange): Promise<FinancialReport> {
  // 1) Transaksi: omzet, metode, void
  const [tx] = await db
    .select({
      omzet:       sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED}), 0)`,
      omzetCash:   sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'CASH'), 0)`,
      omzetQris:   sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'QRIS'), 0)`,
      txCount:     sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED})`,
      txCountCash: sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'CASH')`,
      txCountQris: sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'QRIS')`,
      voidCount:   sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
      voidAmount:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'VOID'), 0)`,
    })
    .from(transactions)
    .where(txBase(range));

  // 2) Item: HPP & laba kotor hanya dari item ber-HPP
  const [it] = await db
    .select({
      salesVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${HAS_HPP}), 0)`,
      hppVerified:   sql<string>`COALESCE(SUM(${transactionItems.subtotalCost}) FILTER (WHERE ${HAS_HPP}), 0)`,
      salesNoHpp:    sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${NO_HPP}), 0)`,
      unitNoHpp:     sql<number>`COALESCE(SUM(${transactionItems.qty}) FILTER (WHERE ${NO_HPP}), 0)`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(and(txBase(range), COMPLETED));

  // 3) Biaya operasional (tanggal bisnis WIB, yang belum dihapus)
  const expenseWhere = and(
    isNull(operatingExpenses.deletedAt),
    gte(operatingExpenses.expenseDate, range.startDate),
    lte(operatingExpenses.expenseDate, range.endDate),
  );
  const expenseByCat = await db
    .select({
      category: operatingExpenses.category,
      total:    sql<string>`SUM(${operatingExpenses.amount})`,
    })
    .from(operatingExpenses)
    .where(expenseWhere)
    .groupBy(operatingExpenses.category);

  // 4) Rekap harian (3 query terkelompok, digabung di memori)
  const txDaily = await db
    .select({
      day:       WIB_DAY_TX,
      txCount:   sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED})`,
      voidCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
      omzet:     sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED}), 0)`,
      omzetCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'CASH'), 0)`,
      omzetQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'QRIS'), 0)`,
    })
    .from(transactions)
    .where(txBase(range))
    .groupBy(WIB_DAY_TX);

  const itemDaily = await db
    .select({
      day:           WIB_DAY_TX,
      salesVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${HAS_HPP}), 0)`,
      hppVerified:   sql<string>`COALESCE(SUM(${transactionItems.subtotalCost}) FILTER (WHERE ${HAS_HPP}), 0)`,
      salesNoHpp:    sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${NO_HPP}), 0)`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(and(txBase(range), COMPLETED))
    .groupBy(WIB_DAY_TX);

  const expenseDaily = await db
    .select({
      day:   sql<string>`to_char(${operatingExpenses.expenseDate}, 'YYYY-MM-DD')`,
      total: sql<string>`SUM(${operatingExpenses.amount})`,
    })
    .from(operatingExpenses)
    .where(expenseWhere)
    .groupBy(operatingExpenses.expenseDate);

  // ── Susun ringkasan ─────────────────────────────────────
  const omzet      = money(num(tx?.omzet));
  const hpp        = money(num(it?.hppVerified));
  const labaKotor  = money(num(it?.salesVerified) - hpp);
  const salesNoHpp = money(num(it?.salesNoHpp));
  const biaya      = money(expenseByCat.reduce((s, r) => s + num(r.total), 0));

  const summary: FinancialSummary = {
    omzet,
    omzetCash:   money(num(tx?.omzetCash)),
    omzetQris:   money(num(tx?.omzetQris)),
    txCount:     num(tx?.txCount),
    txCountCash: num(tx?.txCountCash),
    txCountQris: num(tx?.txCountQris),
    voidCount:   num(tx?.voidCount),
    voidAmount:  money(num(tx?.voidAmount)),
    hppTerjual:  hpp,
    labaKotor,
    omzetTanpaHpp: salesNoHpp,
    unitTanpaHpp:  num(it?.unitNoHpp),
    labaLengkap:   salesNoHpp === 0,
    biayaOperasional: biaya,
    biayaPerKategori: expenseByCat
      .map((r) => ({ category: r.category, total: money(num(r.total)) }))
      .sort((a, b) => b.total - a.total),
    labaBersih: money(labaKotor - biaya),
  };

  // ── Susun harian ────────────────────────────────────────
  const days = new Map<string, DailyRow>();
  const row = (date: string): DailyRow => {
    let r = days.get(date);
    if (!r) {
      r = {
        date, txCount: 0, voidCount: 0, omzet: 0, omzetCash: 0, omzetQris: 0,
        hppTerjual: 0, labaKotor: 0, omzetTanpaHpp: 0, biayaOperasional: 0, labaBersih: 0,
      };
      days.set(date, r);
    }
    return r;
  };
  for (const t of txDaily) {
    const r = row(t.day);
    r.txCount = num(t.txCount);
    r.voidCount = num(t.voidCount);
    r.omzet = money(num(t.omzet));
    r.omzetCash = money(num(t.omzetCash));
    r.omzetQris = money(num(t.omzetQris));
  }
  for (const i of itemDaily) {
    const r = row(i.day);
    r.hppTerjual = money(num(i.hppVerified));
    r.labaKotor = money(num(i.salesVerified) - num(i.hppVerified));
    r.omzetTanpaHpp = money(num(i.salesNoHpp));
  }
  for (const e of expenseDaily) {
    row(e.day).biayaOperasional = money(num(e.total));
  }
  const daily = [...days.values()]
    .map((r) => ({ ...r, labaBersih: money(r.labaKotor - r.biayaOperasional) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ── Invarian ────────────────────────────────────────────
  const sum = (f: (r: DailyRow) => number) => daily.reduce((s, r) => s + f(r), 0);
  const checks: IntegrityChecks = {
    methodSplitMatches: approx(summary.omzetCash + summary.omzetQris, summary.omzet),
    itemsMatchOmzet:    approx(num(it?.salesVerified) + num(it?.salesNoHpp), summary.omzet),
    dailyMatchesSummary:
      approx(sum((r) => r.omzet), summary.omzet) &&
      approx(sum((r) => r.labaBersih), summary.labaBersih),
  };

  return { summary, daily, checks };
}
