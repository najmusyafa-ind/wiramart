// =============================================================
// Tipe & helper bersama halaman Laporan (sisi klien)
// Bentuk data mengikuti respons GET /api/admin/laporan & /api/admin/biaya.
// Semua nominal rupiah = integer.
// =============================================================

import type { CSSProperties } from 'react';

/** Gaya kotak notifikasi (kelas .alert-* tidak tersedia di globals.css). */
export function noticeStyle(kind: 'error' | 'warning' | 'success'): CSSProperties {
  return {
    backgroundColor: `var(--color-${kind}-light)`,
    color: kind === 'warning' ? 'var(--color-accent-text)' : `var(--color-${kind})`,
    border: `1px solid var(--color-${kind})`,
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.5,
  };
}

export const EXPENSE_CATEGORY_LABEL = {
  LISTRIK: 'Listrik',
  PLASTIK_KEMASAN: 'Plastik / Kemasan',
  HONOR: 'Honor',
  SEWA: 'Sewa',
  TRANSPORT: 'Transport',
  KERUGIAN_BARANG: 'Kerugian Barang (expired/rusak)',
  FEE_QRIS_BANK: 'Fee QRIS / Bank',
  LAINNYA: 'Lainnya',
} as const;

export type ExpenseCategoryKey = keyof typeof EXPENSE_CATEGORY_LABEL;

export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategoryKey[];

export type DailyRowUi = {
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

export type IntegrityChecksUi = {
  methodSplitMatches: boolean;
  itemsMatchOmzet: boolean;
  dailyMatchesSummary: boolean;
};

export type ExpenseRowUi = {
  id: string;
  expenseDate: string; // YYYY-MM-DD
  category: ExpenseCategoryKey;
  description: string;
  amount: number;
  createdAt: string;
  createdByName: string;
};

/** Rupiah; angka negatif ditulis "−Rp 1.000" agar jelas sebagai rugi. */
export function formatRupiah(n: number): string {
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const abs = Math.abs(safe).toLocaleString('id-ID');
  return safe < 0 ? `−Rp ${abs}` : `Rp ${abs}`;
}

const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

/** "2026-10-05" → "Sen, 05 Okt 2026" (murni string/UTC; tidak bergantung zona waktu browser). */
export function formatTanggalWib(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${HARI[d.getUTCDay()]}, ${m[3]} ${BULAN[d.getUTCMonth()]} ${m[1]}`;
}
