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
//                    + Biaya Paten Rp 50.000 per BULAN OPERASIONAL (bulan yg ada transaksi),
//                      dibagi rata ke hari operasional bulan tsb → berlaku di semua mode filter
//                      (1 bulan = 50rb, 2 bulan = 100rb, 1 hari = porsi harian).
//   Pool Mahasiswa = 50% × max(0, Laba Kotor − Biaya Operasional)   (agregat periode)
//   Laba Bersih    = Laba Kotor − Pool Mahasiswa − Biaya Operasional (hak toko)
//   Pool harian/shift = pool periode dibagi proporsional (metode sisa terbesar) →
//                    Σ porsi = pool persis, tidak pernah melebihi pool.
//
// Semua batas hari memakai Asia/Jakarta (server Vercel berjalan di UTC).
// Rentang waktu = [start, endExclusive) agar tidak ada transaksi yang jatuh di celah.
// =============================================================

import { and, eq, gte, lt, lte, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { transactions, transactionItems, operatingExpenses, transactionPayments } from '@/lib/db/schema';
import type { ExpenseCategory } from '@/lib/db/schema';

// ─────────────────────────────────────────────────────────────
// Rentang periode (WIB)
// ─────────────────────────────────────────────────────────────
export type PeriodKey =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'semi_annual'
  | 'august'
  | 'september'
  | 'october'
  | 'november'
  | 'oct_nov'
  | 'all';

export const VALID_PERIOD_KEYS: readonly PeriodKey[] = [
  'daily',
  'weekly',
  'monthly',
  'semi_annual',
  'august',
  'september',
  'october',
  'november',
  'oct_nov',
  'all',
] as const;

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === 'string' && (VALID_PERIOD_KEYS as readonly string[]).includes(value);
}

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
  period?: PeriodKey | null;
};

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 1_100; // FinOps guard: mendukung laporan keseluruhan ~3 tahun
export const ALL_TIME_START_DATE = '2025-01-01';
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
  const today = wibToday(input.now);
  const rawFrom = input.dateFrom?.trim() || null;
  const rawTo = input.dateTo?.trim() || null;

  let startDate: string;
  let endDate: string;
  let label: string;

  if (rawFrom || rawTo) {
    if (rawFrom && !isRealDate(rawFrom)) {
      throw new InvalidRangeError('Format tanggal awal harus YYYY-MM-DD.');
    }
    if (rawTo && !isRealDate(rawTo)) {
      throw new InvalidRangeError('Format tanggal akhir harus YYYY-MM-DD.');
    }

    startDate = rawFrom ?? rawTo!;
    endDate = rawTo ?? (startDate <= today ? today : startDate);

    if (startDate > endDate) {
      throw new InvalidRangeError('Tanggal awal tidak boleh setelah tanggal akhir.');
    }
    const span = (utcMs(endDate) - utcMs(startDate)) / DAY_MS + 1;
    if (span > MAX_RANGE_DAYS) {
      throw new InvalidRangeError(`Rentang maksimal ${MAX_RANGE_DAYS} hari.`);
    }
    label = startDate === endDate ? formatId(startDate) : `${formatId(startDate)} s/d ${formatId(endDate)}`;
  } else {
    const [y, m] = today.split('-').map(Number);
    // Tahun referensi Agustus/September & Oktober/November
    const augSepYear = m >= 8 ? y : y - 1;
    const octNovYear = m >= 10 ? y : y - 1;

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
      case 'august': {
        startDate = `${augSepYear}-08-01`;
        endDate = `${augSepYear}-08-31`;
        label = `Agustus ${augSepYear}`;
        break;
      }
      case 'september': {
        startDate = `${augSepYear}-09-01`;
        endDate = `${augSepYear}-09-30`;
        label = `September ${augSepYear}`;
        break;
      }
      case 'october': {
        startDate = `${octNovYear}-10-01`;
        endDate = `${octNovYear}-10-31`;
        label = `Oktober ${octNovYear}`;
        break;
      }
      case 'november': {
        startDate = `${octNovYear}-11-01`;
        endDate = `${octNovYear}-11-30`;
        label = `November ${octNovYear}`;
        break;
      }
      case 'oct_nov': {
        startDate = `${octNovYear}-10-01`;
        endDate = `${octNovYear}-11-30`;
        label = `Oktober – November ${octNovYear}`;
        break;
      }
      case 'all': {
        startDate = ALL_TIME_START_DATE <= today ? ALL_TIME_START_DATE : today;
        endDate = today;
        label = `Keseluruhan (s/d ${formatId(today)})`;
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
    period: rawFrom || rawTo ? null : (input.period ?? 'daily'),
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
  /** Alokasi gaji / hak bagi hasil karyawan shift (paten 50% dari Laba Kotor) */
  alokasiGajiKaryawan: number;
  persenBagiHasil: number;
  /** Omzet dari item yang HPP-nya belum diisi (tidak dihitung dalam laba) */
  omzetTanpaHpp: number;
  /** Jumlah unit terjual yang HPP-nya belum diisi */
  unitTanpaHpp: number;
  /** false bila ada omzetTanpaHpp > 0 → laba dilabeli "tidak lengkap" */
  labaLengkap: boolean;
  biayaOperasional: number;
  biayaPerKategori: ExpenseByCategory[];
  /** Laba Bersih Hak Toko = Laba Kotor − Alokasi Gaji Karyawan − Biaya Operasional */
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
  alokasiGajiKaryawan: number;
  omzetTanpaHpp: number;
  biayaOperasional: number;
  labaBersih: number;
};

export type MonthlyBreakdownRow = {
  monthKey: string; // YYYY-MM
  monthLabel: string;
  activeDays: number;
  txCount: number;
  voidCount: number;
  omzet: number;
  omzetCash: number;
  omzetQris: number;
  hppTerjual: number;
  labaKotor: number;
  marginPct: number;
  alokasiGajiKaryawan: number;
  omzetTanpaHpp: number;
  biayaOperasional: number;
  labaBersih: number;
};

/**
 * Mengelompokkan rekap harian menjadi ringkasan bulanan secara deterministik
 * sehingga Σ baris bulanan identik 100% dengan ringkasan periode.
 */
export function summarizeDailyByMonth(daily: readonly DailyRow[]): MonthlyBreakdownRow[] {
  const bucket = new Map<string, MonthlyBreakdownRow>();

  for (const d of daily) {
    const monthKey = d.date.slice(0, 7);
    let row = bucket.get(monthKey);
    if (!row) {
      const monthLabel = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      }).format(new Date(utcMs(`${monthKey}-01`)));

      row = {
        monthKey,
        monthLabel,
        activeDays: 0,
        txCount: 0,
        voidCount: 0,
        omzet: 0,
        omzetCash: 0,
        omzetQris: 0,
        hppTerjual: 0,
        labaKotor: 0,
        marginPct: 0,
        alokasiGajiKaryawan: 0,
        omzetTanpaHpp: 0,
        biayaOperasional: 0,
        labaBersih: 0,
      };
      bucket.set(monthKey, row);
    }

    row.activeDays += 1;
    row.txCount += d.txCount;
    row.voidCount += d.voidCount;
    row.omzet = money(row.omzet + d.omzet);
    row.omzetCash = money(row.omzetCash + d.omzetCash);
    row.omzetQris = money(row.omzetQris + d.omzetQris);
    row.hppTerjual = money(row.hppTerjual + d.hppTerjual);
    row.labaKotor = money(row.labaKotor + d.labaKotor);
    row.alokasiGajiKaryawan = money(row.alokasiGajiKaryawan + d.alokasiGajiKaryawan);
    row.omzetTanpaHpp = money(row.omzetTanpaHpp + d.omzetTanpaHpp);
    row.biayaOperasional = money(row.biayaOperasional + d.biayaOperasional);
    row.labaBersih = money(row.labaBersih + d.labaBersih);
  }

  return [...bucket.values()]
    .sort((a, b) => (a.monthKey < b.monthKey ? -1 : a.monthKey > b.monthKey ? 1 : 0))
    .map((row) => ({
      ...row,
      marginPct: row.omzet > 0 ? Math.round((row.labaKotor / row.omzet) * 1000) / 10 : 0,
    }));
}

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

// Biaya Paten Bulanan Wiramart: ATK Rp 20.000 + Bensin Rp 30.000 = Rp 50.000 (Opsi W1)
export const BIAYA_PATEN_ATK     = 20_000;
export const BIAYA_PATEN_BENSIN  = 30_000;
export const BIAYA_PATEN_BULANAN = BIAYA_PATEN_ATK + BIAYA_PATEN_BENSIN;
export const PERSEN_BAGI_HASIL        = 50;
// Komposisi pembagian pool 50% antar shift (disepakati 22 Nov 2026):
// 50% Kehadiran & Ketepatan Waktu + 50% Performa Laba Kotor
export const PAYROLL_ATTENDANCE_RATIO  = 0.50;
export const PAYROLL_PERFORMANCE_RATIO = 0.50;

// Konfigurasi Keadilan Bagi Hasil Mahasiswa (Bu Dyah & Manajemen Wiramart)
export const KETUA_UMKM_NIM           = '02302017';
export const KETUA_UMKM_CANONICAL_ID  = 'bcc2db7b-aee5-4e21-bc0f-312fff73f49e';
export const KETUA_UMKM_DUPLICATE_ID  = '0ce4873b-0792-446e-b83d-f8b8d13dfff5';
export const PERSEN_TUNJANGAN_KETUA   = 0; // Sama rata sesuai keputusan operasional
export const ERA2_PRESENSI_START_DATE = '2026-10-05'; // Awal absensi kiosk digital
export const ERA3_OPSI_A_START_DATE   = '2026-11-01'; // Awal Opsi A (berlaku mulai November 2026; Okt tetap historis Era 2)
export const LATE_PENALTY_PER_5MIN    = 3; // Potongan 3% per blok 5 menit keterlambatan
export const MAX_LATE_PENALTY_PERCENT = 50; // Maksimal potongan 50% agar hak hadir tidak Rp 0

export function extractRoleFromNotes(
  notes: string | null | undefined,
  fallbackJabatan: string | null | undefined,
): string {
  if (notes?.startsWith('Peran: ')) {
    const match = notes.match(/^Peran:\s*([^|]+)/);
    if (match?.[1]) return match[1].trim();
  }
  return (fallbackJabatan || 'Kasir').trim();
}

/**
 * Bobot tanggung jawab peran per shift:
 * Diseragamkan sama rata (1.0) untuk seluruh peran (Kasir, Admin Shift, Gudang, CS Pelayan).
 * Pembeda nominal dalam 1 shift murni berdasarkan kehadiran dan ketepatan waktu.
 */
export function getRoleWeight(_role: string): number {
  void _role;
  return 1.0;
}

/**
 * Bobot durasi kerja shift:
 * - Shift Pagi (07:00-11:30 = 4,5 jam + persiapan buka toko): 1.25
 * - Shift Siang (11:30-15:00 = 3,5 jam): 1.00
 */
export function getSessionDurationWeight(sesi: 'Pagi' | 'Siang'): number {
  return sesi === 'Pagi' ? 1.25 : 1.0;
}

/**
 * Faktor kedisiplinan presensi:
 * - Era 1 (< 2026-10-05, absen kertas): dianggap tepat waktu (faktor 1.0, potongan 0%).
 * - Era 2 (2026-10-05 .. 2026-10-31, historis Oktober): `lateMinutes` dari jam mulai, floor(m/5) × 3%.
 * - Era 3 (>= 2026-11-01, Opsi A): `lateMinutes` dihitung SETELAH batas toleransi (mis. 08:00),
 *   potong 3% per blok 5 menit (ceil(m/5) × 3%: 1–5 mnt = 3%, 6–10 mnt = 6%, ..., 30 mnt = 18%,
 *   60 mnt = 36%, maks 50%). Selisih potongan otomatis terdistribusi ke rekan shift tepat waktu.
 */
export function getLateDisciplineFactor(
  attendanceDate: string,
  lateMinutes: number | null | undefined,
): { effectiveLateMinutes: number; penaltyPercent: number; factor: number } {
  if (attendanceDate < ERA2_PRESENSI_START_DATE) {
    return { effectiveLateMinutes: 0, penaltyPercent: 0, factor: 1.0 };
  }
  const mins = Math.max(0, Math.floor(Number(lateMinutes ?? 0)));
  if (mins <= 0) {
    return { effectiveLateMinutes: 0, penaltyPercent: 0, factor: 1.0 };
  }
  const blocks5Min =
    attendanceDate >= ERA3_OPSI_A_START_DATE ? Math.ceil(mins / 5) : Math.floor(mins / 5);
  const penaltyPercent = Math.min(MAX_LATE_PENALTY_PERCENT, blocks5Min * LATE_PENALTY_PER_5MIN);
  const factor = (100 - penaltyPercent) / 100;
  return { effectiveLateMinutes: mins, penaltyPercent, factor };
}

export function computePersonnelWeight(input: {
  role: string;
  sesi: 'Pagi' | 'Siang';
  attendanceDate: string;
  lateMinutes?: number | null;
}): {
  roleWeight: number;
  sessionWeight: number;
  disciplineFactor: number;
  penaltyPercent: number;
  effectiveLateMinutes: number;
  totalWeight: number;
} {
  const roleWeight = getRoleWeight(input.role);
  const sessionWeight = getSessionDurationWeight(input.sesi);
  const { effectiveLateMinutes, penaltyPercent, factor } = getLateDisciplineFactor(
    input.attendanceDate,
    input.lateMinutes,
  );
  const totalWeight = Math.round(roleWeight * sessionWeight * factor * 10000) / 10000;
  return {
    roleWeight,
    sessionWeight,
    disciplineFactor: factor,
    penaltyPercent,
    effectiveLateMinutes,
    totalWeight,
  };
}

/**
 * Bagi `total` rupiah bulat ke porsi proporsional terhadap bobot (bobot ≤ 0 → 0).
 * Metode sisa terbesar (Hamilton): Σ hasil = total persis, nol kebocoran pembulatan.
 */
export function allocateProportional(total: number, weights: readonly number[]): number[] {
  const t = Math.max(0, Math.round(total));
  const w = weights.map((x) => (x > 0 ? x : 0));
  const sumW = w.reduce((s, x) => s + x, 0);
  if (t === 0 || sumW <= 0) return w.map(() => 0);

  const raw = w.map((x) => (t * x) / sumW);
  const out = raw.map((r) => Math.floor(r));
  let rest = t - out.reduce((s, x) => s + x, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .filter((o) => (w[o.i] ?? 0) > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    out[o.i] = (out[o.i] ?? 0) + 1;
    rest -= 1;
  }
  return out;
}

function firstDayOfNextMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

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

/**
 * @deprecated Migrasi data historis sudah selesai permanen di DB produksi.
 * Dipertahankan sebagai no-op agar endpoint GET laporan murni read-only tanpa mutasi DB di cold start.
 */
export async function ensureFinancialDataIntegrity(): Promise<void> {
  return;
}

export async function getFinancialReport(range: ReportRange): Promise<FinancialReport> {

  // 1) Transaksi: omzet, metode, void + porsi legacy (transaksi tanpa baris transaction_payments)
  const NO_PAYMENT_ROWS = sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = ${transactions.id})`;
  const [tx] = await db
    .select({
      omzet:       sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED}), 0)`,
      legacyCash:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'CASH' AND ${NO_PAYMENT_ROWS}), 0)`,
      legacyQris:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'QRIS' AND ${NO_PAYMENT_ROWS}), 0)`,
      txCount:     sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED})`,
      txCountCash: sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'CASH')`,
      txCountQris: sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'QRIS')`,
      voidCount:   sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
      voidAmount:  sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'VOID'), 0)`,
    })
    .from(transactions)
    .where(txBase(range));

  // 1b) Pecahan Pembayaran: rincian Cash vs QRIS akurat (mendukung Split Payment)
  const [paySummary] = await db
    .select({
      omzetCash: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${COMPLETED} AND ${transactionPayments.paymentMethod} = 'CASH'), 0)`,
      omzetQris: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${COMPLETED} AND ${transactionPayments.paymentMethod} = 'QRIS'), 0)`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
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
      day:        WIB_DAY_TX,
      txCount:    sql<number>`COUNT(*) FILTER (WHERE ${COMPLETED})`,
      voidCount:  sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
      omzet:      sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED}), 0)`,
      legacyCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'CASH' AND ${NO_PAYMENT_ROWS}), 0)`,
      legacyQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${COMPLETED} AND ${transactions.paymentMethod} = 'QRIS' AND ${NO_PAYMENT_ROWS}), 0)`,
    })
    .from(transactions)
    .where(txBase(range))
    .groupBy(WIB_DAY_TX);

  // 4b) Pecahan harian metode pembayaran (Split payment aware)
  const payDaily = await db
    .select({
      day:       WIB_DAY_TX,
      omzetCash: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${COMPLETED} AND ${transactionPayments.paymentMethod} = 'CASH'), 0)`,
      omzetQris: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${COMPLETED} AND ${transactionPayments.paymentMethod} = 'QRIS'), 0)`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
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

  // 5) Hari operasional pada BULAN PENUH yang disentuh rentang.
  //    Dipakai membagi biaya paten 50rb/bulan secara rata ke hari operasional,
  //    sehingga rentang apa pun (harian/mingguan/bulanan/semester/bebas) konsisten.
  const monthsStart = new Date(`${range.startDate.slice(0, 7)}-01T00:00:00+07:00`);
  const monthsEnd   = new Date(`${firstDayOfNextMonth(range.endDate)}T00:00:00+07:00`);
  const opDays = await db
    .select({ day: WIB_DAY_TX })
    .from(transactions)
    .where(and(
      eq(transactions.isTest, false),
      COMPLETED,
      gte(transactions.createdAt, monthsStart),
      lt(transactions.createdAt, monthsEnd),
    ))
    .groupBy(WIB_DAY_TX);

  // ── Biaya paten per hari operasional ────────────────────
  const opDaysByMonth = new Map<string, string[]>();
  for (const { day } of opDays) {
    const key = day.slice(0, 7);
    const list = opDaysByMonth.get(key) ?? [];
    list.push(day);
    opDaysByMonth.set(key, list);
  }
  const patenPerHari = new Map<string, number>();
  for (const monthDays of opDaysByMonth.values()) {
    monthDays.sort();
    const shares = allocateProportional(BIAYA_PATEN_BULANAN, monthDays.map(() => 1));
    monthDays.forEach((d, i) => {
      if (d >= range.startDate && d <= range.endDate) patenPerHari.set(d, shares[i] ?? 0);
    });
  }
  const patenTotal  = [...patenPerHari.values()].reduce((s, v) => s + v, 0);
  const patenAtk    = Math.round((patenTotal * BIAYA_PATEN_ATK) / BIAYA_PATEN_BULANAN);
  const patenBensin = patenTotal - patenAtk;

  // ── Susun ringkasan ─────────────────────────────────────
  const expenseCatMap = new Map<ExpenseCategory, number>();
  for (const r of expenseByCat) {
    expenseCatMap.set(r.category, num(r.total));
  }
  if (patenTotal > 0) {
    expenseCatMap.set('TRANSPORT', (expenseCatMap.get('TRANSPORT') ?? 0) + patenBensin);
    expenseCatMap.set('LAINNYA',   (expenseCatMap.get('LAINNYA') ?? 0) + patenAtk);
  }

  const biayaPerKategori: ExpenseByCategory[] = [...expenseCatMap.entries()]
    .map(([category, total]) => ({ category, total: money(total) }))
    .sort((a, b) => b.total - a.total);

  const biayaDb = expenseByCat.reduce((s, r) => s + num(r.total), 0);
  const biaya   = money(biayaDb + patenTotal);

  const omzet      = money(num(tx?.omzet));
  const hpp        = money(num(it?.hppVerified));
  const labaKotor  = money(num(it?.salesVerified) - hpp);
  const salesNoHpp = money(num(it?.salesNoHpp));

  // Sistem Paten Wiramart (agregat periode, SATU-SATUNYA sumber pool):
  const labaOperasionalBersih = Math.max(0, labaKotor - biaya);
  const alokasiGajiKaryawan   = Math.round((labaOperasionalBersih * PERSEN_BAGI_HASIL) / 100);
  const labaBersih            = money(labaKotor - alokasiGajiKaryawan - biaya);

  // Gabungkan rincian split payment (transaction_payments) + transaksi legacy tanpa baris payment
  const omzetCash = money(num(paySummary?.omzetCash) + num(tx?.legacyCash));
  const omzetQris = money(num(paySummary?.omzetQris) + num(tx?.legacyQris));

  const summary: FinancialSummary = {
    omzet,
    omzetCash,
    omzetQris,
    txCount:     num(tx?.txCount),
    txCountCash: num(tx?.txCountCash),
    txCountQris: num(tx?.txCountQris),
    voidCount:   num(tx?.voidCount),
    voidAmount:  money(num(tx?.voidAmount)),
    hppTerjual:  hpp,
    labaKotor,
    alokasiGajiKaryawan,
    persenBagiHasil: PERSEN_BAGI_HASIL,
    omzetTanpaHpp: salesNoHpp,
    unitTanpaHpp:  num(it?.unitNoHpp),
    labaLengkap:   salesNoHpp === 0,
    biayaOperasional: biaya,
    biayaPerKategori,
    labaBersih,
  };

  // ── Susun harian ────────────────────────────────────────
  const days = new Map<string, DailyRow>();
  const row = (date: string): DailyRow => {
    let r = days.get(date);
    if (!r) {
      r = {
        date, txCount: 0, voidCount: 0, omzet: 0, omzetCash: 0, omzetQris: 0,
        hppTerjual: 0, labaKotor: 0, alokasiGajiKaryawan: 0, omzetTanpaHpp: 0, biayaOperasional: 0, labaBersih: 0,
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
    r.omzetCash = money(num(t.legacyCash));
    r.omzetQris = money(num(t.legacyQris));
  }
  for (const p of payDaily) {
    const r = row(p.day);
    r.omzetCash = money(r.omzetCash + num(p.omzetCash));
    r.omzetQris = money(r.omzetQris + num(p.omzetQris));
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
  for (const [day, share] of patenPerHari) {
    const r = row(day);
    r.biayaOperasional = money(r.biayaOperasional + share);
  }

  // Pool periode dibagi ke hari secara proporsional laba operasional hari itu.
  const sorted = [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const poolHarian = allocateProportional(
    alokasiGajiKaryawan,
    sorted.map((r) => r.labaKotor - r.biayaOperasional),
  );
  const daily: DailyRow[] = sorted.map((r, i) => {
    const gaji = poolHarian[i] ?? 0;
    return { ...r, alokasiGajiKaryawan: gaji, labaBersih: money(r.labaKotor - gaji - r.biayaOperasional) };
  });

  // ── Invarian & Konsistensi Matematis ─────────────────────
  const sum = (f: (r: DailyRow) => number) => daily.reduce((s, r) => s + f(r), 0);

  const checks: IntegrityChecks = {
    methodSplitMatches: approx(summary.omzetCash + summary.omzetQris, summary.omzet),
    itemsMatchOmzet:    approx(num(it?.salesVerified) + num(it?.salesNoHpp), summary.omzet),
    dailyMatchesSummary:
      approx(sum((r) => r.omzet), summary.omzet) &&
      approx(sum((r) => r.biayaOperasional), summary.biayaOperasional) &&
      approx(sum((r) => r.alokasiGajiKaryawan), summary.alokasiGajiKaryawan) &&
      approx(sum((r) => r.labaBersih), summary.labaBersih),
  };

  return { summary, daily, checks };
}

// ─────────────────────────────────────────────────────────────
// Helper Murni: Skor Disiplin Absensi & Klasifikasi Audit Laci
// ─────────────────────────────────────────────────────────────

export type AttendanceDisciplineTier =
  | 'SANGAT_DISIPLIN'
  | 'DISIPLIN'
  | 'CUKUP'
  | 'PERLU_PERHATIAN';

/**
 * Hitung persentase kehadiran & skor disiplin mahasiswa (SSOT).
 * - `TIDAK_HADIR` (Alpha) masuk ke pembagi skor disiplin bernilai 0 agar mahasiswa
 *   yang alpha tidak pernah mendapatkan skor 100% / SANGAT_DISIPLIN.
 * - `IJIN` tidak memotong skor disiplin apabila memiliki izin resmi, namun menurunkan
 *   `persenKehadiran` dari total shift.
 */
export function computeAttendanceDisciplineScore(params: {
  hadir: number;
  telat: number;
  pengganti: number;
  ijin: number;
  tidakHadir: number;
  disciplineScoreSum: number;
}): {
  totalShift: number;
  validCount: number;
  persenKehadiran: number;
  skorDisiplin: number;
  statusDisiplin: AttendanceDisciplineTier;
} {
  const hadir = Math.max(0, Math.floor(params.hadir));
  const telat = Math.max(0, Math.floor(params.telat));
  const pengganti = Math.max(0, Math.floor(params.pengganti));
  const ijin = Math.max(0, Math.floor(params.ijin));
  const tidakHadir = Math.max(0, Math.floor(params.tidakHadir));

  const validCount = hadir + telat + pengganti;
  const totalShift = validCount + ijin + tidakHadir;
  const persenKehadiran = totalShift > 0 ? Math.round((validCount / totalShift) * 100) : 0;

  const scoredCount = validCount + tidakHadir;
  const skorDisiplin =
    scoredCount > 0 ? Math.round(params.disciplineScoreSum / scoredCount) : 100;

  let statusDisiplin: AttendanceDisciplineTier = 'SANGAT_DISIPLIN';
  if (skorDisiplin >= 95) statusDisiplin = 'SANGAT_DISIPLIN';
  else if (skorDisiplin >= 80) statusDisiplin = 'DISIPLIN';
  else if (skorDisiplin >= 65) statusDisiplin = 'CUKUP';
  else statusDisiplin = 'PERLU_PERHATIAN';

  return { totalShift, validCount, persenKehadiran, skorDisiplin, statusDisiplin };
}

export type ShiftDrawerStatusLaci =
  | 'RUNNING'
  | 'BALANCED'
  | 'SHORTAGE'
  | 'OVERAGE'
  | 'UNCOUNTED';

export type ShiftDrawerTier = 'HIJAU' | 'KUNING' | 'MERAH' | 'OVERAGE';

/**
 * Klasifikasi audit laci shift (SSOT):
 * Shift `CLOSED` tanpa hitungan fisik (`actualCash === null`, mis. auto-close sistem)
 * WAJIB ditandai `UNCOUNTED` / `KUNING` ("PERLU AUDIT"), bukan `BALANCED` / `HIJAU`.
 */
export function classifyShiftDrawerAudit(params: {
  status: string;
  actualCash: number | null;
  expectedCash: number;
  toleranceRp?: number;
}): {
  discrepancy: number | null;
  statusLaci: ShiftDrawerStatusLaci;
  discrepancyTier: ShiftDrawerTier;
  harianAuditLabel: 'BERJALAN' | 'PERLU AUDIT' | 'SESUAI' | 'KURANG' | 'LEBIH';
} {
  const tolerance = params.toleranceRp ?? 2000;
  const discrepancy =
    params.actualCash !== null ? params.actualCash - params.expectedCash : null;

  if (params.status !== 'CLOSED') {
    return {
      discrepancy,
      statusLaci: 'RUNNING',
      discrepancyTier: 'HIJAU',
      harianAuditLabel: 'BERJALAN',
    };
  }

  if (discrepancy === null) {
    return {
      discrepancy: null,
      statusLaci: 'UNCOUNTED',
      discrepancyTier: 'KUNING',
      harianAuditLabel: 'PERLU AUDIT',
    };
  }

  const harianAuditLabel =
    Math.abs(discrepancy) < 1 ? 'SESUAI' : discrepancy < 0 ? 'KURANG' : 'LEBIH';

  if (Math.abs(discrepancy) <= tolerance) {
    return {
      discrepancy,
      statusLaci: 'BALANCED',
      discrepancyTier: 'HIJAU',
      harianAuditLabel,
    };
  }

  if (discrepancy < 0) {
    return {
      discrepancy,
      statusLaci: 'SHORTAGE',
      discrepancyTier: discrepancy < -20000 ? 'MERAH' : 'KUNING',
      harianAuditLabel,
    };
  }

  return {
    discrepancy,
    statusLaci: 'OVERAGE',
    discrepancyTier: 'OVERAGE',
    harianAuditLabel,
  };
}
