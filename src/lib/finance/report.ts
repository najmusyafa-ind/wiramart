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
  period?: PeriodKey | null;
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
    period: input.period ?? (input.dateFrom && input.dateTo ? null : 'daily'),
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
export const PERSEN_BAGI_HASIL   = 50;

// Konfigurasi Keadilan Bagi Hasil Mahasiswa (Bu Dyah & Manajemen Wiramart)
export const KETUA_UMKM_NIM           = '02302017';
export const KETUA_UMKM_CANONICAL_ID  = 'bcc2db7b-aee5-4e21-bc0f-312fff73f49e';
export const KETUA_UMKM_DUPLICATE_ID  = '0ce4873b-0792-446e-b83d-f8b8d13dfff5';
export const PERSEN_TUNJANGAN_KETUA   = 6; // 6% dari Pool Mahasiswa untuk Ketua UMKM
export const ERA2_PRESENSI_START_DATE = '2026-10-05'; // Awal absensi kiosk digital
export const LATE_PENALTY_PER_5MIN    = 3; // Potongan 3% per 5 menit keterlambatan
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
 * - Admin Shift / Kasir: 1.20 (risiko laci kas, stok, HPP, & verifikasi pesanan)
 * - Kepala Gudang / Gudang: 1.10 (opname fisik, barang masuk, & FEFO)
 * - CS Pelayan / Customer Service: 1.00 (display rak & pengantaran yang sudah mendapat insentif ongkir)
 */
export function getRoleWeight(role: string): number {
  const r = role.toLowerCase();
  if (r.includes('admin') || r.includes('kasir') || r.includes('ketua')) return 1.2;
  if (r.includes('gudang')) return 1.1;
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
 * Faktor kedisiplinan presensi (Opsi 2A):
 * - Era 1 (< 2026-10-05, absen kertas): dianggap tepat waktu (faktor 1.0, potongan 0%).
 * - Era 2 (>= 2026-10-05, absen kiosk): potong 3% setiap kelipatan 5 menit telat,
 *   maksimal potongan 50% (faktor minimal 0.50). Selisih potongan otomatis terdistribusi
 *   ke rekan shift yang hadir tepat waktu melalui alokasi proporsional.
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
  const blocks5Min = Math.floor(mins / 5);
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

export async function ensureFinancialDataIntegrity(): Promise<void> {
  if (integrityEnsured) return;
  try {
    // 1. Nonaktifkan duplikat input manual biaya paten Rp 50.000 jika masih aktif
    await db.execute(sql`
      UPDATE operating_expenses
      SET deleted_at = NOW()
      WHERE id = '59939e14-c9be-43c9-9431-3b73c933ccfa'
        AND deleted_at IS NULL
    `);

    // 2. Koreksi master produk dan snapshot item yang memiliki HPP > Harga Jual (anomali input)
    await db.execute(sql`
      UPDATE products
      SET cost_price = ROUND(selling_price * 0.80)
      WHERE cost_price > selling_price AND selling_price > 0
    `);

    const fixedItems = await db.execute(sql`
      UPDATE transaction_items
      SET cost_price_snapshot = ROUND(selling_price_snapshot * 0.80),
          subtotal_cost = qty * ROUND(selling_price_snapshot * 0.80)
      WHERE cost_price_snapshot > selling_price_snapshot
      RETURNING transaction_id
    `);
    if (Array.isArray(fixedItems) && fixedItems.length > 0) {
      await db.execute(sql`
        UPDATE transactions t
        SET total_cost = sub.sum_cost,
            gross_profit = t.gross_amount - sub.sum_cost
        FROM (
          SELECT transaction_id, COALESCE(SUM(subtotal_cost), 0) AS sum_cost
          FROM transaction_items
          GROUP BY transaction_id
        ) sub
        WHERE t.id = sub.transaction_id
          AND (t.total_cost <> sub.sum_cost OR t.gross_profit <> (t.gross_amount - sub.sum_cost))
      `);
    }

    // 3. Satukan duplikat data karyawan Gita Aprilianingrum (Kasir -> Ketua UMKM / Admin Shift)
    await db.execute(sql`
      UPDATE shifts
      SET employee_id = ${KETUA_UMKM_CANONICAL_ID}
      WHERE employee_id = ${KETUA_UMKM_DUPLICATE_ID}
    `);
    await db.execute(sql`
      DELETE FROM attendances a_dup
      WHERE a_dup.employee_id = ${KETUA_UMKM_DUPLICATE_ID}
        AND EXISTS (
          SELECT 1 FROM attendances a_can
          WHERE a_can.employee_id = ${KETUA_UMKM_CANONICAL_ID}
            AND a_can.attendance_date = a_dup.attendance_date
        )
    `);
    await db.execute(sql`
      UPDATE attendances
      SET employee_id = ${KETUA_UMKM_CANONICAL_ID}
      WHERE employee_id = ${KETUA_UMKM_DUPLICATE_ID}
    `);
    await db.execute(sql`
      DELETE FROM shift_schedules
      WHERE employee_id = ${KETUA_UMKM_DUPLICATE_ID}
    `);
    await db.execute(sql`
      DELETE FROM employees
      WHERE id = ${KETUA_UMKM_DUPLICATE_ID}
    `);

    integrityEnsured = true;
  } catch (err) {
    console.warn('[finance/report] ensureFinancialDataIntegrity warning:', err);
  }
}

let integrityEnsured = false;

export async function getFinancialReport(range: ReportRange): Promise<FinancialReport> {
  await ensureFinancialDataIntegrity();

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

  const hasPayments = (num(paySummary?.omzetCash) + num(paySummary?.omzetQris)) > 0;
  const omzetCash = hasPayments ? money(num(paySummary?.omzetCash)) : money(num(tx?.omzetCash));
  const omzetQris = hasPayments ? money(num(paySummary?.omzetQris)) : money(num(tx?.omzetQris));

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
    r.omzetCash = money(num(t.omzetCash));
    r.omzetQris = money(num(t.omzetQris));
  }
  for (const p of payDaily) {
    const r = row(p.day);
    r.omzetCash = money(num(p.omzetCash));
    r.omzetQris = money(num(p.omzetQris));
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
