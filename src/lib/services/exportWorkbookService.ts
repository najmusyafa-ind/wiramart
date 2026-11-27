// =============================================================
// Smartkasir Perwira — Export Workbook Builder Service (SSOT)
// Menghasilkan file Excel (.xlsx) siap lapor & backup tervalidasi:
//   - Kapasitas hingga 10.000 baris per sheet (EXPORT_MAX_ROWS)
//   - Formula =SUM() / =SUMIFS() asli Excel, format Rp, border akuntansi
//   - Sanitasi formula-injection & filter waktu WIB [start, endExclusive)
// =============================================================

import ExcelJS from 'exceljs';
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  admins,
  categories,
  employees,
  operatingExpenses,
  products,
  shiftCashMovements,
  shifts,
  stockAdjustments,
  transactionItems,
  transactionPayments,
  transactions,
} from '@/lib/db/schema';
import {
  getFinancialReport,
  summarizeDailyByMonth,
  type ReportRange,
} from '@/lib/finance/report';

export const EXPORT_MAX_ROWS = 10_000;

export const SERVER_EXCEL_COLOR = {
  BANNER: 'FF1E3A5F',
  HEADER: 'FF2B4C7E',
  HEADER_SUB: 'FF334155',
  SUBTITLE_BG: 'FFF1F5F9',
  SUBTITLE_TEXT: 'FF475569',
  BODY_TEXT: 'FF0F172A',
  ZEBRA: 'FFF8FAFC',
  TOTAL: 'FFE2E8F0',
} as const;

export const RUPIAH_FMT = '"Rp "#,##0;[Red]-"Rp "#,##0;"Rp "0';
export const INT_FMT = '#,##0';
export const PCT_FMT = '0.0"%"';

export const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

export const HEADER_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF1E3A5F' } },
  left: { style: 'thin', color: { argb: 'FF475569' } },
  bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
  right: { style: 'thin', color: { argb: 'FF475569' } },
};

export const TOTAL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF0F172A' } },
  bottom: { style: 'double', color: { argb: 'FF0F172A' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

export const ZEBRA_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: SERVER_EXCEL_COLOR.ZEBRA },
};

export const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: SERVER_EXCEL_COLOR.TOTAL },
};

// ── Util Helpers (SSOT Server Excel) ──────────────────────────
export function sanitizeExcelText(v: string | null | undefined): string {
  const str = String(v ?? '').trim();
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function toNum(val: string | number | null | undefined): number {
  const n = typeof val === 'number' ? val : Number(val ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function fmtWibDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dateObj.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(dateObj);
}

export function isExcludedTestAccount(name: string | null | undefined, nim: string | null | undefined): boolean {
  const lname = (name ?? '').toLowerCase();
  const lnim = (nim ?? '').toLowerCase();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lnim === '02405013' ||
    lnim === '00000000'
  );
}

export function colLetter(col1Based: number): string {
  let col = col1Based;
  let result = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    col = Math.floor((col - 1) / 26);
  }
  return result;
}

export function chunkArray<T>(arr: readonly T[], size = 2000): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function normalizeArgb(hex: string): string {
  const cleaned = hex.replace(/^#/, '');
  return cleaned.length === 8 ? cleaned.toUpperCase() : `FF${cleaned.toUpperCase()}`;
}

export function applyServerPageSetup(
  ws: ExcelJS.Worksheet,
  orientation: 'landscape' | 'portrait' = 'landscape',
): void {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.25,
      footer: 0.25,
    },
  };
}

export function calcServerWrapRowHeight(
  cells: readonly { text: string; width: number }[],
  minHeight = 21,
  lineHeight = 14,
): number {
  let maxLines = 1;
  for (const item of cells) {
    if (!item.text) continue;
    const usableChars = Math.max(8, Math.floor(item.width - 3));
    const parts = item.text.split(/\r?\n/);
    let lines = 0;
    for (const part of parts) {
      lines += Math.max(1, Math.ceil(part.length / usableChars));
    }
    if (lines > maxLines) maxLines = lines;
  }
  return Math.min(220, Math.max(minHeight, maxLines * lineHeight + 7));
}

export function addBannerBlock(
  ws: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  colSpan: number,
  fillHex: string = SERVER_EXCEL_COLOR.BANNER,
  orientation: 'landscape' | 'portrait' = 'landscape',
): void {
  const lastCol = colLetter(Math.max(1, colSpan));
  const bannerArgb = normalizeArgb(fillHex);
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = sanitizeExcelText(title);
  titleCell.font = { name: 'Calibri', bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bannerArgb } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell('A2');
  subCell.value = sanitizeExcelText(subtitle);
  subCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: SERVER_EXCEL_COLOR.SUBTITLE_TEXT } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.SUBTITLE_BG } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 8;

  applyServerPageSetup(ws, orientation);
}

export function styleTableHeader(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  colCount: number,
  fillHex: string = SERVER_EXCEL_COLOR.HEADER,
): void {
  const row = ws.getRow(rowIdx);
  const headerArgb = normalizeArgb(fillHex);
  row.height = 26;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerArgb } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = HEADER_BORDER;
  }
}

export function styleDataTable(
  ws: ExcelJS.Worksheet,
  opts: {
    headerRowIdx: number;
    firstDataRow: number;
    lastDataRow: number;
    colCount: number;
    rupiahCols?: readonly number[];
    intCols?: readonly number[];
    pctCols?: readonly number[];
    sumCols?: readonly number[];
    sumLabelCol?: number;
    sumLabel?: string;
    customSumFormula?: (colIdx: number, colLtr: string) => string;
    sumFilter?: { col: number; equals: string };
    freezeHeader?: boolean;
  },
): void {
  const {
    headerRowIdx,
    firstDataRow,
    lastDataRow,
    colCount,
    rupiahCols = [],
    intCols = [],
    pctCols = [],
    sumCols = [],
    sumLabelCol = 1,
    sumLabel = 'TOTAL',
    customSumFormula,
    sumFilter,
    freezeHeader = true,
  } = opts;

  if (lastDataRow >= firstDataRow) {
    const colSums = new Map<number, number>();
    for (const sCol of sumCols) colSums.set(sCol, 0);

    for (let r = firstDataRow; r <= lastDataRow; r++) {
      const row = ws.getRow(r);
      const isZebra = (r - firstDataRow) % 2 === 1;
      const matchesFilter =
        !sumFilter || String(row.getCell(sumFilter.col).value ?? '') === sumFilter.equals;
      const wrapCandidates: { text: string; width: number }[] = [];

      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        const isNumericCol = rupiahCols.includes(c) || intCols.includes(c) || pctCols.includes(c);
        const colWidth = Number(ws.getColumn(c).width ?? 16);
        const shouldWrap = !isNumericCol && colWidth >= 22;

        cell.font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
        cell.border = THIN_BORDER;
        cell.alignment = {
          vertical: 'middle',
          horizontal: isNumericCol ? 'right' : 'left',
          wrapText: shouldWrap,
        };
        if (isZebra) cell.fill = ZEBRA_FILL;
        if (rupiahCols.includes(c)) cell.numFmt = RUPIAH_FMT;
        if (intCols.includes(c)) cell.numFmt = INT_FMT;
        if (pctCols.includes(c)) cell.numFmt = PCT_FMT;

        if (shouldWrap && typeof cell.value === 'string' && cell.value.length > 0) {
          wrapCandidates.push({ text: cell.value, width: colWidth });
        }

        if (matchesFilter && sumCols.includes(c) && typeof cell.value === 'number' && Number.isFinite(cell.value)) {
          colSums.set(c, (colSums.get(c) ?? 0) + cell.value);
        }
      }

      row.height = calcServerWrapRowHeight(wrapCandidates, 21, 14);
    }

    if (sumCols.length > 0) {
      const totRowIdx = lastDataRow + 1;
      const totRow = ws.getRow(totRowIdx);
      totRow.height = 24;
      for (let c = 1; c <= colCount; c++) {
        const cell = totRow.getCell(c);
        cell.border = TOTAL_BORDER;
        cell.fill = TOTAL_FILL;
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
        if (c === sumLabelCol) {
          cell.value = sumLabel;
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else if (sumCols.includes(c)) {
          const ltr = colLetter(c);
          cell.value = {
            formula: customSumFormula
              ? customSumFormula(c, ltr)
              : `SUM(${ltr}${firstDataRow}:${ltr}${lastDataRow})`,
            result: colSums.get(c) ?? 0,
          };
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          if (rupiahCols.includes(c)) cell.numFmt = RUPIAH_FMT;
          if (intCols.includes(c)) cell.numFmt = INT_FMT;
        }
      }
    }
  }

  if (freezeHeader) {
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx, showGridLines: true }];
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: Math.max(headerRowIdx, lastDataRow), column: colCount },
    };
  }
}

export function setWidths(ws: ExcelJS.Worksheet, widths: readonly number[]): void {
  widths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });
}

export function writeRowValues(ws: ExcelJS.Worksheet, rowIdx: number, values: readonly (string | number | null)[]): void {
  const row = ws.getRow(rowIdx);
  values.forEach((v, idx) => {
    row.getCell(idx + 1).value = typeof v === 'string' ? sanitizeExcelText(v) : v;
  });
}

export function setHeaderRow(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  headers: readonly string[],
  fillHex: string = SERVER_EXCEL_COLOR.HEADER,
): void {
  const row = ws.getRow(rowIdx);
  headers.forEach((h, idx) => {
    row.getCell(idx + 1).value = h;
  });
  styleTableHeader(ws, rowIdx, headers.length, fillHex);
}

// =============================================================
// BAGIAN 1: LAPORAN PENJUALAN & KEUANGAN LENGKAP (7 SHEETS)
// =============================================================
export interface ExportWorkbookResult {
  buffer: Buffer;
  rowCounts: Record<string, number>;
  truncatedSheets: string[];
}

export async function buildSalesReportWorkbook(range: ReportRange): Promise<ExportWorkbookResult> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartkasir Perwira — UKM Wiramart UNPERBA';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const generatedWib = fmtWibDateTime(new Date());
  const report = await getFinancialReport(range);
  const monthlyRows = summarizeDailyByMonth(report.daily);
  const rowCounts: Record<string, number> = {};
  const truncatedSheets: string[] = [];

  // ── Sheet 1: Ringkasan Hasil ────────────────────────────────
  const wsSum = wb.addWorksheet('Ringkasan Hasil', { views: [{ showGridLines: true }] });
  addBannerBlock(
    wsSum,
    'LAPORAN HASIL PENJUALAN & KEUANGAN — UKM WIRAMART UNPERBA',
    `Periode: ${range.label} (${range.startDate} s/d ${range.endDate} WIB) | Dicetak: ${generatedWib} WIB`,
    4,
  );
  setWidths(wsSum, [38, 22, 20, 44]);

  const { summary, checks } = report;
  const marginPct = summary.omzet > 0 ? Math.round((summary.labaKotor / summary.omzet) * 1000) / 10 : 0;

  let sr = 4;
  setHeaderRow(wsSum, sr, ['Indikator Keuangan', 'Nilai', 'Satuan / %', 'Keterangan']);
  sr += 1;

  const kpiRows: Array<{ label: string; val: number; isRp?: boolean; pct?: number; note: string; bold?: boolean }> = [
    { label: 'Omzet Penjualan Bersih (COMPLETED)', val: summary.omzet, isRp: true, note: `${summary.txCount} transaksi sukses (non-testing)` },
    { label: '  - Pembayaran Tunai (Cash)', val: summary.omzetCash, isRp: true, pct: summary.omzet > 0 ? Math.round((summary.omzetCash / summary.omzet) * 1000) / 10 : 0, note: 'Termasuk porsi tunai pada Split Payment' },
    { label: '  - Pembayaran QRIS', val: summary.omzetQris, isRp: true, pct: summary.omzet > 0 ? Math.round((summary.omzetQris / summary.omzet) * 1000) / 10 : 0, note: 'Termasuk porsi QRIS pada Split Payment' },
    { label: 'Transaksi Dibatalkan (VOID)', val: summary.voidAmount, isRp: true, note: `${summary.voidCount} transaksi void (tidak dihitung omzet)` },
    { label: 'HPP Terjual (Item Ber-HPP > 0)', val: summary.hppTerjual, isRp: true, note: 'Modal pokok barang terjual terverifikasi' },
    { label: 'Omzet Item Belum Punya HPP', val: summary.omzetTanpaHpp, isRp: true, note: `${summary.unitTanpaHpp} unit tanpa HPP (dipisahkan dari Laba Kotor)` },
    { label: 'Laba Kotor (Gross Profit)', val: summary.labaKotor, isRp: true, pct: marginPct, note: summary.labaLengkap ? 'Laba lengkap 100%' : 'Sebagian item belum memiliki HPP', bold: true },
    { label: 'Total Biaya Operasional + Biaya Paten', val: summary.biayaOperasional, isRp: true, note: 'Biaya input harian + alokasi paten Rp 50.000/bulan aktif' },
    { label: `Alokasi Bagi Hasil Mahasiswa (${summary.persenBagiHasil}%)`, val: summary.alokasiGajiKaryawan, isRp: true, note: '50% dari max(0, Laba Kotor - Biaya Operasional)' },
    { label: 'LABA BERSIH HAK TOKO (WIRAMART)', val: summary.labaBersih, isRp: true, note: 'Laba Kotor - Biaya Operasional - Alokasi Bagi Hasil', bold: true },
  ];

  for (const item of kpiRows) {
    const r = wsSum.getRow(sr);
    r.getCell(1).value = item.label;
    r.getCell(2).value = item.val;
    r.getCell(2).numFmt = item.isRp ? RUPIAH_FMT : INT_FMT;
    r.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    r.getCell(3).value = item.pct !== undefined ? item.pct : '';
    if (item.pct !== undefined) {
      r.getCell(3).numFmt = PCT_FMT;
      r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
    }
    r.getCell(4).value = item.note;
    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    r.getCell(4).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    for (let c = 1; c <= 4; c++) {
      r.getCell(c).border = THIN_BORDER;
      r.getCell(c).font = {
        name: 'Calibri',
        size: 10,
        bold: Boolean(item.bold),
        color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT },
      };
      if (item.bold) {
        r.getCell(c).fill = TOTAL_FILL;
      }
    }
    r.height = calcServerWrapRowHeight([{ text: item.note, width: 44 }], 21, 14);
    sr += 1;
  }

  sr += 1;
  setHeaderRow(wsSum, sr, ['Kategori Biaya Operasional', 'Total (Rp)', 'Porsi (%)', 'Status Audit'], SERVER_EXCEL_COLOR.HEADER_SUB);
  sr += 1;
  const catStart = sr;
  if (summary.biayaPerKategori.length === 0) {
    writeRowValues(wsSum, sr, ['Tidak ada biaya operasional tercatat pada periode ini', 0, 0, 'OK']);
    wsSum.getRow(sr).getCell(2).numFmt = RUPIAH_FMT;
    wsSum.getRow(sr).height = 21;
    for (let c = 1; c <= 4; c++) {
      wsSum.getRow(sr).getCell(c).border = THIN_BORDER;
      wsSum.getRow(sr).getCell(c).font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
    }
    sr += 1;
  } else {
    for (const cat of summary.biayaPerKategori) {
      const porsi = summary.biayaOperasional > 0 ? Math.round((cat.total / summary.biayaOperasional) * 1000) / 10 : 0;
      writeRowValues(wsSum, sr, [cat.category, cat.total, porsi, 'Terverifikasi']);
      const row = wsSum.getRow(sr);
      row.getCell(2).numFmt = RUPIAH_FMT;
      row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
      row.getCell(3).numFmt = PCT_FMT;
      row.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
      row.height = 21;
      for (let c = 1; c <= 4; c++) {
        row.getCell(c).border = THIN_BORDER;
        row.getCell(c).font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
      }
      sr += 1;
    }
  }
  const catEnd = sr - 1;
  if (summary.biayaPerKategori.length > 0) {
    const catTotalSum = summary.biayaPerKategori.reduce((acc, cat) => acc + cat.total, 0);
    const rTot = wsSum.getRow(sr);
    rTot.height = 24;
    rTot.getCell(1).value = 'TOTAL BIAYA';
    rTot.getCell(2).value = { formula: `SUM(B${catStart}:B${catEnd})`, result: catTotalSum };
    rTot.getCell(2).numFmt = RUPIAH_FMT;
    rTot.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    rTot.getCell(4).value = `Cek Integritas: Cash+QRIS=${checks.methodSplitMatches ? 'OK' : 'CEK'}, Harian=${checks.dailyMatchesSummary ? 'OK' : 'CEK'}`;
    for (let c = 1; c <= 4; c++) {
      rTot.getCell(c).border = TOTAL_BORDER;
      rTot.getCell(c).fill = TOTAL_FILL;
      rTot.getCell(c).font = { name: 'Calibri', size: 10, bold: true, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
    }
  }
  rowCounts['Ringkasan Hasil'] = kpiRows.length;

  // ── Sheet 2: Rekap Bulanan & Harian ─────────────────────────
  const wsTime = wb.addWorksheet('Rekap Bulanan & Harian');
  addBannerBlock(
    wsTime,
    'REKAP PENJUALAN PER BULAN & HARIAN (WIB)',
    `Periode: ${range.label} | Komparasi Bulanan & Rincian Harian`,
    13,
  );
  setWidths(wsTime, [18, 10, 10, 10, 18, 16, 16, 16, 16, 10, 16, 16, 18]);

  let tr = 4;
  setHeaderRow(
    wsTime,
    tr,
    [
      'Bulan',
      'Hari Aktif',
      'Tx Sukses',
      'Tx Void',
      'Omzet (Rp)',
      'Cash (Rp)',
      'QRIS (Rp)',
      'HPP (Rp)',
      'Laba Kotor (Rp)',
      'Margin %',
      'Biaya + Paten (Rp)',
      'Bagi Hasil 50% (Rp)',
      'Laba Bersih Toko (Rp)',
    ],
  );
  tr += 1;
  const mFirst = tr;
  if (monthlyRows.length === 0) {
    writeRowValues(wsTime, tr, ['Belum ada transaksi pada periode ini', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    tr += 1;
  } else {
    for (const m of monthlyRows) {
      writeRowValues(wsTime, tr, [
        m.monthLabel,
        m.activeDays,
        m.txCount,
        m.voidCount,
        m.omzet,
        m.omzetCash,
        m.omzetQris,
        m.hppTerjual,
        m.labaKotor,
        m.marginPct,
        m.biayaOperasional,
        m.alokasiGajiKaryawan,
        m.labaBersih,
      ]);
      tr += 1;
    }
  }
  const mLast = tr - 1;
  styleDataTable(wsTime, {
    headerRowIdx: 4,
    firstDataRow: mFirst,
    lastDataRow: mLast,
    colCount: 13,
    intCols: [2, 3, 4],
    rupiahCols: [5, 6, 7, 8, 9, 11, 12, 13],
    pctCols: [10],
    sumCols: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13],
    sumLabel: 'TOTAL BULANAN',
    freezeHeader: false,
  });

  // Tabel Harian tepat di bawah Tabel Bulanan
  tr = mLast + 3;
  const dailyHeaderRow = tr;
  setHeaderRow(
    wsTime,
    dailyHeaderRow,
    [
      'Tanggal (WIB)',
      'Tx Sukses',
      'Tx Void',
      'Hari ke-',
      'Omzet (Rp)',
      'Cash (Rp)',
      'QRIS (Rp)',
      'HPP (Rp)',
      'Laba Kotor (Rp)',
      'Margin %',
      'Biaya + Paten (Rp)',
      'Bagi Hasil (Rp)',
      'Laba Bersih (Rp)',
    ],
    SERVER_EXCEL_COLOR.HEADER_SUB,
  );
  tr += 1;
  const dFirst = tr;
  if (report.daily.length === 0) {
    writeRowValues(wsTime, tr, ['Tidak ada data harian', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    tr += 1;
  } else {
    report.daily.forEach((d, idx) => {
      const mPct = d.omzet > 0 ? Math.round((d.labaKotor / d.omzet) * 1000) / 10 : 0;
      writeRowValues(wsTime, tr, [
        d.date,
        d.txCount,
        d.voidCount,
        idx + 1,
        d.omzet,
        d.omzetCash,
        d.omzetQris,
        d.hppTerjual,
        d.labaKotor,
        mPct,
        d.biayaOperasional,
        d.alokasiGajiKaryawan,
        d.labaBersih,
      ]);
      tr += 1;
    });
  }
  const dLast = tr - 1;
  styleDataTable(wsTime, {
    headerRowIdx: dailyHeaderRow,
    firstDataRow: dFirst,
    lastDataRow: dLast,
    colCount: 13,
    intCols: [2, 3, 4],
    rupiahCols: [5, 6, 7, 8, 9, 11, 12, 13],
    pctCols: [10],
    sumCols: [2, 3, 5, 6, 7, 8, 9, 11, 12, 13],
    sumLabel: 'TOTAL HARIAN',
    freezeHeader: false,
  });
  rowCounts['Rekap Bulanan & Harian'] = report.daily.length;

  // ── Sheet 3: Rekap Per Kasir & Per Jam (WIB) ────────────────
  const baseTxCond = and(
    eq(transactions.isTest, false),
    gte(transactions.createdAt, range.start),
    lt(transactions.createdAt, range.endExclusive),
  );

  const NO_PAYMENT_ROWS = sql`NOT EXISTS (SELECT 1 FROM transaction_payments tp WHERE tp.transaction_id = ${transactions.id})`;

  const cashierTxRows = await db
    .select({
      employeeId: transactions.employeeId,
      fullName: employees.fullName,
      nim: employees.nim,
      txCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED')`,
      voidCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
      omzet: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
      legacyCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'CASH' AND ${NO_PAYMENT_ROWS}), 0)`,
      legacyQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'QRIS' AND ${NO_PAYMENT_ROWS}), 0)`,
    })
    .from(transactions)
    .innerJoin(employees, eq(transactions.employeeId, employees.id))
    .where(baseTxCond)
    .groupBy(transactions.employeeId, employees.fullName, employees.nim);

  const cashierPayRows = await db
    .select({
      employeeId: transactions.employeeId,
      omzetCash: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'CASH'), 0)`,
      omzetQris: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'QRIS'), 0)`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
    .where(baseTxCond)
    .groupBy(transactions.employeeId);

  const cashierHppRows = await db
    .select({
      employeeId: transactions.employeeId,
      salesVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${transactionItems.costPriceSnapshot} > 0), 0)`,
      hppVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalCost}) FILTER (WHERE ${transactionItems.costPriceSnapshot} > 0), 0)`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(and(baseTxCond, eq(transactions.status, 'COMPLETED')))
    .groupBy(transactions.employeeId);

  const payByEmp = new Map(cashierPayRows.map((p) => [p.employeeId, p]));
  const hppByEmp = new Map(cashierHppRows.map((h) => [h.employeeId, h]));

  const cashierClean = cashierTxRows
    .filter((c) => !isExcludedTestAccount(c.fullName, c.nim))
    .map((c) => {
      const p = payByEmp.get(c.employeeId);
      const h = hppByEmp.get(c.employeeId);
      const cash = toNum(p?.omzetCash) + toNum(c.legacyCash);
      const qris = toNum(p?.omzetQris) + toNum(c.legacyQris);
      const omzet = toNum(c.omzet);
      const hpp = toNum(h?.hppVerified);
      const laba = toNum(h?.salesVerified) - hpp;
      return {
        fullName: c.fullName,
        nim: c.nim,
        txCount: toNum(c.txCount),
        voidCount: toNum(c.voidCount),
        omzet,
        cash,
        qris,
        hpp,
        laba,
      };
    })
    .sort((a, b) => b.omzet - a.omzet);

  const HOUR_WIB_EXPR = sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'HH24')`;
  const hourlyTxRows = await db
    .select({
      hour: HOUR_WIB_EXPR,
      txCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'COMPLETED')`,
      voidCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'VOID')`,
      omzet: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED'), 0)`,
      legacyCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'CASH' AND ${NO_PAYMENT_ROWS}), 0)`,
      legacyQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactions.paymentMethod} = 'QRIS' AND ${NO_PAYMENT_ROWS}), 0)`,
    })
    .from(transactions)
    .where(baseTxCond)
    .groupBy(HOUR_WIB_EXPR);

  const hourlyPayRows = await db
    .select({
      hour: HOUR_WIB_EXPR,
      omzetCash: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'CASH'), 0)`,
      omzetQris: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactions.status} = 'COMPLETED' AND ${transactionPayments.paymentMethod} = 'QRIS'), 0)`,
    })
    .from(transactionPayments)
    .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
    .where(baseTxCond)
    .groupBy(HOUR_WIB_EXPR);

  const hourlyHppRows = await db
    .select({
      hour: HOUR_WIB_EXPR,
      salesVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${transactionItems.costPriceSnapshot} > 0), 0)`,
      hppVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalCost}) FILTER (WHERE ${transactionItems.costPriceSnapshot} > 0), 0)`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(and(baseTxCond, eq(transactions.status, 'COMPLETED')))
    .groupBy(HOUR_WIB_EXPR);

  const hPayMap = new Map(hourlyPayRows.map((p) => [p.hour, p]));
  const hHppMap = new Map(hourlyHppRows.map((h) => [h.hour, h]));
  const hourlyClean = hourlyTxRows
    .map((h) => {
      const p = hPayMap.get(h.hour);
      const hp = hHppMap.get(h.hour);
      const cash = toNum(p?.omzetCash) + toNum(h.legacyCash);
      const qris = toNum(p?.omzetQris) + toNum(h.legacyQris);
      const omzet = toNum(h.omzet);
      const hpp = toNum(hp?.hppVerified);
      const laba = toNum(hp?.salesVerified) - hpp;
      return {
        jamLabel: `${h.hour}:00 – ${h.hour}:59 WIB`,
        hour: h.hour,
        txCount: toNum(h.txCount),
        voidCount: toNum(h.voidCount),
        omzet,
        cash,
        qris,
        hpp,
        laba,
      };
    })
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const wsKasirJam = wb.addWorksheet('Rekap Per Kasir & Jam');
  addBannerBlock(
    wsKasirJam,
    'REKAPITULASI PER KASIR & PER JAM PENJUALAN (WIB)',
    `Periode: ${range.label} | Atribusi akurat per kasir transaksi (termasuk co-cashier laci bersama)`,
    10,
  );
  setWidths(wsKasirJam, [28, 16, 11, 10, 18, 17, 17, 17, 17, 12]);

  let kr = 4;
  setHeaderRow(
    wsKasirJam,
    kr,
    ['Nama Kasir / Pelaku Transaksi', 'NIM', 'Tx Sukses', 'Void', 'Omzet (Rp)', 'Cash (Rp)', 'QRIS (Rp)', 'HPP (Rp)', 'Laba Kotor (Rp)', 'Porsi Omzet %'],
  );
  kr += 1;
  const kFirst = kr;
  if (cashierClean.length === 0) {
    writeRowValues(wsKasirJam, kr, ['Belum ada transaksi kasir pada periode ini', '-', 0, 0, 0, 0, 0, 0, 0, 0]);
    kr += 1;
  } else {
    for (const c of cashierClean) {
      const share = summary.omzet > 0 ? Math.round((c.omzet / summary.omzet) * 1000) / 10 : 0;
      writeRowValues(wsKasirJam, kr, [c.fullName, c.nim, c.txCount, c.voidCount, c.omzet, c.cash, c.qris, c.hpp, c.laba, share]);
      kr += 1;
    }
  }
  const kLast = kr - 1;
  styleDataTable(wsKasirJam, {
    headerRowIdx: 4,
    firstDataRow: kFirst,
    lastDataRow: kLast,
    colCount: 10,
    intCols: [3, 4],
    rupiahCols: [5, 6, 7, 8, 9],
    pctCols: [10],
    sumCols: [3, 4, 5, 6, 7, 8, 9],
    sumLabel: 'TOTAL KASIR',
    freezeHeader: false,
  });

  kr = kLast + 3;
  const jamHeaderRow = kr;
  setHeaderRow(
    wsKasirJam,
    jamHeaderRow,
    ['Jam Operasional (WIB)', 'Kode Jam', 'Tx Sukses', 'Void', 'Omzet (Rp)', 'Cash (Rp)', 'QRIS (Rp)', 'HPP (Rp)', 'Laba Kotor (Rp)', 'Porsi Omzet %'],
    SERVER_EXCEL_COLOR.HEADER_SUB,
  );
  kr += 1;
  const jFirst = kr;
  if (hourlyClean.length === 0) {
    writeRowValues(wsKasirJam, kr, ['Belum ada penjualan per jam pada periode ini', '-', 0, 0, 0, 0, 0, 0, 0, 0]);
    kr += 1;
  } else {
    for (const h of hourlyClean) {
      const share = summary.omzet > 0 ? Math.round((h.omzet / summary.omzet) * 1000) / 10 : 0;
      writeRowValues(wsKasirJam, kr, [h.jamLabel, h.hour, h.txCount, h.voidCount, h.omzet, h.cash, h.qris, h.hpp, h.laba, share]);
      kr += 1;
    }
  }
  const jLast = kr - 1;
  styleDataTable(wsKasirJam, {
    headerRowIdx: jamHeaderRow,
    firstDataRow: jFirst,
    lastDataRow: jLast,
    colCount: 10,
    intCols: [3, 4],
    rupiahCols: [5, 6, 7, 8, 9],
    pctCols: [10],
    sumCols: [3, 4, 5, 6, 7, 8, 9],
    sumLabel: 'TOTAL PER JAM',
    freezeHeader: false,
  });
  rowCounts['Rekap Per Kasir & Jam'] = cashierClean.length + hourlyClean.length;

  // ── Sheet 4: Produk Terlaris & Laba ─────────────────────────
  const productAggRows = await db
    .select({
      productId: transactionItems.productId,
      productName: transactionItems.productNameSnapshot,
      categoryName: categories.name,
      qtySold: sql<number>`COALESCE(SUM(${transactionItems.qty}), 0)`,
      omzetTotal: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}), 0)`,
      hppVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalCost}) FILTER (WHERE ${transactionItems.costPriceSnapshot} > 0), 0)`,
      salesVerified: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${transactionItems.costPriceSnapshot} > 0), 0)`,
      omzetNoHpp: sql<string>`COALESCE(SUM(${transactionItems.subtotalSell}) FILTER (WHERE ${transactionItems.costPriceSnapshot} <= 0), 0)`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .leftJoin(products, eq(transactionItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(baseTxCond, eq(transactions.status, 'COMPLETED')))
    .groupBy(transactionItems.productId, transactionItems.productNameSnapshot, categories.name)
    .orderBy(desc(sql`COALESCE(SUM(${transactionItems.subtotalSell}), 0)`))
    .limit(EXPORT_MAX_ROWS);

  if (productAggRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Produk Terlaris & Laba');

  const wsProd = wb.addWorksheet('Produk Terlaris & Laba');
  addBannerBlock(
    wsProd,
    'ANALISIS PENJUALAN PRODUK & LABA PER SKU',
    `Periode: ${range.label} | Diurutkan dari omzet tertinggi (Maks ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} SKU)`,
    9,
  );
  setWidths(wsProd, [8, 34, 18, 12, 18, 18, 18, 12, 18]);
  setHeaderRow(
    wsProd,
    4,
    ['Rank', 'Nama Produk', 'Kategori', 'Qty Terjual', 'Omzet Jual (Rp)', 'HPP Verified (Rp)', 'Laba Kotor (Rp)', 'Margin %', 'Omzet Tanpa HPP (Rp)'],
  );

  let pr = 5;
  if (productAggRows.length === 0) {
    writeRowValues(wsProd, pr, [0, 'Belum ada penjualan produk pada periode ini', '-', 0, 0, 0, 0, 0, 0]);
    pr += 1;
  } else {
    productAggRows.forEach((p, idx) => {
      const omzet = toNum(p.omzetTotal);
      const hpp = toNum(p.hppVerified);
      const laba = toNum(p.salesVerified) - hpp;
      const margin = omzet > 0 ? Math.round((laba / omzet) * 1000) / 10 : 0;
      writeRowValues(wsProd, pr, [
        idx + 1,
        p.productName,
        p.categoryName ?? '-',
        toNum(p.qtySold),
        omzet,
        hpp,
        laba,
        margin,
        toNum(p.omzetNoHpp),
      ]);
      pr += 1;
    });
  }
  styleDataTable(wsProd, {
    headerRowIdx: 4,
    firstDataRow: 5,
    lastDataRow: pr - 1,
    colCount: 9,
    intCols: [1, 4],
    rupiahCols: [5, 6, 7, 9],
    pctCols: [8],
    sumCols: [4, 5, 6, 7, 9],
    sumLabelCol: 2,
    sumLabel: 'TOTAL PRODUK',
  });
  rowCounts['Produk Terlaris & Laba'] = productAggRows.length;

  // ── Sheet 5: Audit Shift & Kas Gerak ────────────────────────
  const rawShifts = await db
    .select({
      id: shifts.id,
      kasirName: employees.fullName,
      kasirNim: employees.nim,
      clockIn: shifts.clockIn,
      clockOut: shifts.clockOut,
      status: shifts.status,
      modalAwal: shifts.modalAwal,
      actualCash: shifts.actualCash,
      serahTerimaDiff: shifts.serahTerimaDiff,
      auditFlags: shifts.auditFlags,
      notes: shifts.notes,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)))
    .orderBy(desc(shifts.clockIn))
    .limit(EXPORT_MAX_ROWS);

  const cleanShifts = rawShifts.filter((s) => !isExcludedTestAccount(s.kasirName, s.kasirNim));
  const shiftIds = cleanShifts.map((s) => s.id);
  const shiftSalesMap = new Map<string, { cash: number; qris: number; txCount: number }>();
  const shiftCashMoveMap = new Map<string, { cashIn: number; cashOut: number }>();

  if (shiftIds.length > 0) {
    // Chunk per 500 ID agar aman dari batas parameter bind PostgreSQL pada periode panjang
    for (const chunk of chunkArray(shiftIds, 500)) {
      const [sTxRows, sPayRows, mvRows] = await Promise.all([
        db
          .select({
            shiftId: transactions.shiftId,
            txCount: sql<number>`COUNT(*)`,
            legacyCash: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.paymentMethod} = 'CASH' AND ${NO_PAYMENT_ROWS}), 0)`,
            legacyQris: sql<string>`COALESCE(SUM(${transactions.grossAmount}) FILTER (WHERE ${transactions.paymentMethod} = 'QRIS' AND ${NO_PAYMENT_ROWS}), 0)`,
          })
          .from(transactions)
          .where(and(inArray(transactions.shiftId, chunk), eq(transactions.isTest, false), eq(transactions.status, 'COMPLETED')))
          .groupBy(transactions.shiftId),
        db
          .select({
            shiftId: transactions.shiftId,
            cash: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactionPayments.paymentMethod} = 'CASH'), 0)`,
            qris: sql<string>`COALESCE(SUM(${transactionPayments.amount}) FILTER (WHERE ${transactionPayments.paymentMethod} = 'QRIS'), 0)`,
          })
          .from(transactionPayments)
          .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
          .where(and(inArray(transactions.shiftId, chunk), eq(transactions.isTest, false), eq(transactions.status, 'COMPLETED')))
          .groupBy(transactions.shiftId),
        db
          .select({
            shiftId: shiftCashMovements.shiftId,
            cashIn: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_IN'), 0)`,
            cashOut: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}) FILTER (WHERE ${shiftCashMovements.movementType} = 'CASH_OUT'), 0)`,
          })
          .from(shiftCashMovements)
          .where(inArray(shiftCashMovements.shiftId, chunk))
          .groupBy(shiftCashMovements.shiftId),
      ]);

      const sPayMap = new Map(sPayRows.map((r) => [r.shiftId, r]));
      for (const st of sTxRows) {
        const sp = sPayMap.get(st.shiftId);
        shiftSalesMap.set(st.shiftId, {
          cash: toNum(sp?.cash) + toNum(st.legacyCash),
          qris: toNum(sp?.qris) + toNum(st.legacyQris),
          txCount: toNum(st.txCount),
        });
      }

      for (const mv of mvRows) {
        shiftCashMoveMap.set(mv.shiftId, { cashIn: toNum(mv.cashIn), cashOut: toNum(mv.cashOut) });
      }
    }
  }

  if (rawShifts.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Audit Shift & Kas Gerak');

  const wsShift = wb.addWorksheet('Audit Shift & Kas Gerak');
  addBannerBlock(
    wsShift,
    'AUDIT SHIFT, KAS LACI & KAS GERAK (WIB)',
    `Periode: ${range.label} | Waktu Masuk & Tutup lengkap dengan tanggal WIB`,
    13,
  );
  setWidths(wsShift, [24, 14, 20, 20, 10, 9, 16, 16, 15, 15, 16, 16, 28]);
  setHeaderRow(
    wsShift,
    4,
    ['Penanggung Jawab Laci', 'NIM', 'Masuk Shift (WIB)', 'Tutup Shift (WIB)', 'Status', 'Trx', 'Modal Awal (Rp)', 'Penjualan Cash (Rp)', 'Kas Masuk (Rp)', 'Kas Keluar (Rp)', 'Kas Laci Fisik (Rp)', 'Selisih (Rp)', 'Audit Flags / Catatan'],
  );

  let shr = 5;
  if (cleanShifts.length === 0) {
    writeRowValues(wsShift, shr, ['Belum ada shift tercatat pada periode ini', '-', '-', '-', '-', 0, 0, 0, 0, 0, 0, 0, '-']);
    shr += 1;
  } else {
    for (const s of cleanShifts) {
      const sales = shiftSalesMap.get(s.id) ?? { cash: 0, qris: 0, txCount: 0 };
      const mv = shiftCashMoveMap.get(s.id) ?? { cashIn: 0, cashOut: 0 };
      const modal = s.modalAwal !== null && s.modalAwal !== undefined ? toNum(s.modalAwal) : 100_000;
      const actualVal = s.actualCash !== null ? toNum(s.actualCash) : null;
      const expectedCash = modal + sales.cash + mv.cashIn - mv.cashOut;
      const diffVal = actualVal !== null ? actualVal - expectedCash : null;
      const uncountedNote =
        s.status === 'CLOSED' && actualVal === null ? 'Auto-Close (Belum Hitung Fisik)' : null;
      const flagText = [s.auditFlags, uncountedNote, s.notes].filter(Boolean).join(' | ');
      writeRowValues(wsShift, shr, [
        s.kasirName,
        s.kasirNim,
        fmtWibDateTime(s.clockIn),
        s.clockOut ? fmtWibDateTime(s.clockOut) : 'Masih Aktif',
        s.status,
        sales.txCount,
        modal,
        sales.cash,
        mv.cashIn,
        mv.cashOut,
        actualVal !== null ? actualVal : '-',
        diffVal !== null ? diffVal : '-',
        flagText,
      ]);
      shr += 1;
    }
  }
  styleDataTable(wsShift, {
    headerRowIdx: 4,
    firstDataRow: 5,
    lastDataRow: shr - 1,
    colCount: 13,
    intCols: [6],
    rupiahCols: [7, 8, 9, 10, 11, 12],
    sumCols: [6, 8, 9, 10, 12],
    sumLabel: 'TOTAL SHIFT',
  });
  rowCounts['Audit Shift & Kas Gerak'] = cleanShifts.length;

  // ── Sheet 6: Detail Transaksi (Max 10.000) ──────────────────
  const txList = await db
    .select({
      id: transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      createdAt: transactions.createdAt,
      kasir: employees.fullName,
      nim: employees.nim,
      paymentMethod: transactions.paymentMethod,
      status: transactions.status,
      grossAmount: transactions.grossAmount,
      totalHpp: transactions.totalHpp,
      grossProfit: transactions.grossProfit,
      cashReceived: transactions.cashReceived,
      changeAmount: transactions.changeAmount,
      voidReason: transactions.voidReason,
    })
    .from(transactions)
    .innerJoin(employees, eq(transactions.employeeId, employees.id))
    .where(baseTxCond)
    .orderBy(desc(transactions.createdAt))
    .limit(EXPORT_MAX_ROWS);

  if (txList.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Detail Transaksi');

  const txIds = txList.map((t) => t.id);
  const splitPayMap = new Map<string, { cash: number; qris: number }>();
  const txVerifiedMap = new Map<string, { hpp: number; profit: number }>();
  if (txIds.length > 0) {
    // Query chunked safely if > 2.000 IDs agar tidak melewati batas bind parameter PG
    for (let i = 0; i < txIds.length; i += 2000) {
      const chunk = txIds.slice(i, i + 2000);
      const [pRows, viRows] = await Promise.all([
        db
          .select({
            transactionId: transactionPayments.transactionId,
            paymentMethod: transactionPayments.paymentMethod,
            amount: transactionPayments.amount,
          })
          .from(transactionPayments)
          .where(inArray(transactionPayments.transactionId, chunk)),
        db
          .select({
            transactionId: transactionItems.transactionId,
            verifiedHpp: sql<string>`COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN ${transactionItems.subtotalCost} ELSE 0 END), 0)`,
            verifiedProfit: sql<string>`COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN (${transactionItems.subtotalSell} - ${transactionItems.subtotalCost}) ELSE 0 END), 0)`,
          })
          .from(transactionItems)
          .where(inArray(transactionItems.transactionId, chunk))
          .groupBy(transactionItems.transactionId),
      ]);
      for (const p of pRows) {
        const cur = splitPayMap.get(p.transactionId) ?? { cash: 0, qris: 0 };
        if (p.paymentMethod === 'CASH') cur.cash += toNum(p.amount);
        if (p.paymentMethod === 'QRIS') cur.qris += toNum(p.amount);
        splitPayMap.set(p.transactionId, cur);
      }
      for (const vi of viRows) {
        txVerifiedMap.set(vi.transactionId, {
          hpp: toNum(vi.verifiedHpp),
          profit: toNum(vi.verifiedProfit),
        });
      }
    }
  }

  const wsTx = wb.addWorksheet('Detail Transaksi');
  addBannerBlock(
    wsTx,
    'RINCIAN TRANSAKSI PENJUALAN (NON-TESTING)',
    `Periode: ${range.label} | Total baris diunduh: ${txList.length.toLocaleString('id-ID')} (Maks ${EXPORT_MAX_ROWS.toLocaleString('id-ID')}) | Baris TOTAL hanya menghitung status COMPLETED & item ber-HPP > 0`,
    13,
  );
  setWidths(wsTx, [22, 20, 24, 14, 11, 12, 16, 15, 15, 16, 16, 15, 28]);
  setHeaderRow(
    wsTx,
    4,
    ['Invoice', 'Tanggal (WIB)', 'Kasir', 'NIM', 'Metode', 'Status', 'Omzet (Rp)', 'Cash Tagihan (Rp)', 'QRIS Tagihan (Rp)', 'HPP Verified (Rp)', 'Laba Verified (Rp)', 'Kembalian (Rp)', 'Alasan Void'],
  );

  let txr = 5;
  if (txList.length === 0) {
    writeRowValues(wsTx, txr, ['Tidak ada transaksi pada periode ini', '-', '-', '-', '-', '-', 0, 0, 0, 0, 0, 0, '-']);
    txr += 1;
  } else {
    for (const t of txList) {
      const split = splitPayMap.get(t.id);
      const cashPart = split ? split.cash : t.paymentMethod === 'CASH' ? toNum(t.grossAmount) : 0;
      const qrisPart = split ? split.qris : t.paymentMethod === 'QRIS' ? toNum(t.grossAmount) : 0;
      const verified = txVerifiedMap.get(t.id);
      const txHpp = verified ? verified.hpp : toNum(t.totalHpp);
      const txProfit = verified ? verified.profit : toNum(t.grossProfit);
      writeRowValues(wsTx, txr, [
        t.invoiceNumber,
        fmtWibDateTime(t.createdAt),
        t.kasir,
        t.nim,
        t.paymentMethod,
        t.status,
        toNum(t.grossAmount),
        cashPart,
        qrisPart,
        txHpp,
        txProfit,
        toNum(t.changeAmount),
        t.voidReason ?? '',
      ]);
      txr += 1;
    }
  }
  const txLast = txr - 1;
  styleDataTable(wsTx, {
    headerRowIdx: 4,
    firstDataRow: 5,
    lastDataRow: txLast,
    colCount: 13,
    rupiahCols: [7, 8, 9, 10, 11, 12],
    sumCols: [7, 8, 9, 10, 11, 12],
    sumLabel: 'TOTAL COMPLETED',
    customSumFormula: (_c, ltr) => `SUMIFS(${ltr}5:${ltr}${txLast},F5:F${txLast},"COMPLETED")`,
    sumFilter: { col: 6, equals: 'COMPLETED' },
  });
  rowCounts['Detail Transaksi'] = txList.length;

  // ── Sheet 7: Biaya Operasional ──────────────────────────────
  const expRows = await db
    .select({
      expenseDate: operatingExpenses.expenseDate,
      category: operatingExpenses.category,
      description: operatingExpenses.description,
      amount: operatingExpenses.amount,
      createdBy: admins.fullName,
      createdAt: operatingExpenses.createdAt,
    })
    .from(operatingExpenses)
    .leftJoin(admins, eq(operatingExpenses.createdByAdminId, admins.id))
    .where(
      and(
        isNull(operatingExpenses.deletedAt),
        gte(operatingExpenses.expenseDate, range.startDate),
        lte(operatingExpenses.expenseDate, range.endDate),
      ),
    )
    .orderBy(desc(operatingExpenses.expenseDate))
    .limit(EXPORT_MAX_ROWS);

  if (expRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Biaya Operasional');

  const wsExp = wb.addWorksheet('Biaya Operasional');
  addBannerBlock(
    wsExp,
    'RINCIAN BIAYA OPERASIONAL PERIODIK',
    `Periode: ${range.label} | Catatan: Biaya Paten Rp 50.000/bulan aktif sudah dimasukkan pada Sheet Ringkasan & Bulanan`,
    5,
  );
  setWidths(wsExp, [16, 18, 40, 18, 24]);
  setHeaderRow(wsExp, 4, ['Tanggal Bisnis', 'Kategori', 'Keterangan Biaya', 'Nominal (Rp)', 'Dicatat Oleh']);

  let er = 5;
  if (expRows.length === 0) {
    writeRowValues(wsExp, er, ['-', '-', 'Tidak ada biaya operasional tambahan yang diinput pada periode ini', 0, '-']);
    er += 1;
  } else {
    for (const e of expRows) {
      writeRowValues(wsExp, er, [e.expenseDate, e.category, e.description, toNum(e.amount), e.createdBy ?? '-']);
      er += 1;
    }
  }
  styleDataTable(wsExp, {
    headerRowIdx: 4,
    firstDataRow: 5,
    lastDataRow: er - 1,
    colCount: 5,
    rupiahCols: [4],
    sumCols: [4],
    sumLabel: 'TOTAL BIAYA INPUT',
  });
  rowCounts['Biaya Operasional'] = expRows.length;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, rowCounts, truncatedSheets };
}

// =============================================================
// BAGIAN 2: BACKUP DATA TERVALIDASI (DENGAN RINGKASAN & FILTER)
// =============================================================
export type BackupExportType = 'full' | 'transactions' | 'products' | 'employees';

export async function buildBackupWorkbook(params: {
  type: BackupExportType;
  range: ReportRange | null;
}): Promise<ExportWorkbookResult> {
  const { type, range } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartkasir Perwira — Export & Backup System';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const rowCounts: Record<string, number> = {};
  const truncatedSheets: string[] = [];
  const generatedWib = fmtWibDateTime(new Date());

  const wsCover = wb.addWorksheet('INFO & Ringkasan');
  addBannerBlock(
    wsCover,
    `BACKUP & ARSIP DATA — ${type.toUpperCase()} — SMARTKASIR PERWIRA`,
    `Periode Filter: ${range ? `${range.label} (${range.startDate} s/d ${range.endDate} WIB)` : 'Semua Waktu'} | Diekspor: ${generatedWib} WIB`,
    3,
  );
  setWidths(wsCover, [34, 24, 44]);

  const txTimeWhere = range
    ? [eq(transactions.isTest, false), gte(transactions.createdAt, range.start), lt(transactions.createdAt, range.endExclusive)]
    : [eq(transactions.isTest, false)];

  // Bila mencakup transaksi & periode tersedia, muat juga ringkasan hasil penjualan di halaman cover
  let summaryBlock: Array<[string, string | number, string]> = [];
  if (range && (type === 'full' || type === 'transactions')) {
    const fin = await getFinancialReport(range);
    summaryBlock = [
      ['Omzet Penjualan Bersih (COMPLETED)', fin.summary.omzet, `${fin.summary.txCount} transaksi sukses (non-testing)`],
      ['  - Cash', fin.summary.omzetCash, 'Termasuk porsi tunai split payment'],
      ['  - QRIS', fin.summary.omzetQris, 'Termasuk porsi QRIS split payment'],
      ['HPP Terjual (Verified)', fin.summary.hppTerjual, 'Modal pokok barang terjual'],
      ['Laba Kotor (Gross Profit)', fin.summary.labaKotor, fin.summary.labaLengkap ? 'Laba lengkap' : 'Sebagian item belum memiliki HPP'],
      ['Biaya Operasional + Paten', fin.summary.biayaOperasional, 'Biaya harian + paten bulanan'],
      ['Laba Bersih Hak Toko', fin.summary.labaBersih, 'Setelah dikurangi biaya & bagi hasil 50%'],
    ];
  }

  // Sheet: Transaksi (dengan filter periode WIB & SUMIFS COMPLETED)
  if (type === 'full' || type === 'transactions') {
    const ws = wb.addWorksheet('Transaksi');
    addBannerBlock(
      ws,
      'DATA TRANSAKSI PENJUALAN (NON-TESTING)',
      `Periode: ${range ? range.label : 'Semua Waktu (Maks 10.000 baris terbaru)'} | Baris TOTAL hanya menjumlahkan COMPLETED`,
      11,
    );
    setWidths(ws, [22, 20, 24, 11, 12, 17, 16, 16, 16, 16, 30]);
    setHeaderRow(
      ws,
      4,
      ['Invoice', 'Tanggal (WIB)', 'Kasir', 'Metode', 'Status', 'Omzet (Rp)', 'HPP (Rp)', 'Laba (Rp)', 'Tunai Diterima (Rp)', 'Kembalian (Rp)', 'Alasan Void'],
    );

    const rows = await db
      .select({
        id: transactions.id,
        invoiceNumber: transactions.invoiceNumber,
        createdAt: transactions.createdAt,
        kasir: employees.fullName,
        paymentMethod: transactions.paymentMethod,
        status: transactions.status,
        grossAmount: transactions.grossAmount,
        totalHpp: transactions.totalHpp,
        grossProfit: transactions.grossProfit,
        cashReceived: transactions.cashReceived,
        changeAmount: transactions.changeAmount,
        voidReason: transactions.voidReason,
      })
      .from(transactions)
      .innerJoin(employees, eq(transactions.employeeId, employees.id))
      .where(and(...txTimeWhere))
      .orderBy(desc(transactions.createdAt))
      .limit(EXPORT_MAX_ROWS);

    if (rows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Transaksi');

    const backupVerifiedMap = new Map<string, { hpp: number; profit: number }>();
    const backupTxIds = rows.map((r) => r.id);
    for (let i = 0; i < backupTxIds.length; i += 2000) {
      const chunk = backupTxIds.slice(i, i + 2000);
      const viRows = await db
        .select({
          transactionId: transactionItems.transactionId,
          verifiedHpp: sql<string>`COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN ${transactionItems.subtotalCost} ELSE 0 END), 0)`,
          verifiedProfit: sql<string>`COALESCE(SUM(CASE WHEN ${transactionItems.costPriceSnapshot} > 0 THEN (${transactionItems.subtotalSell} - ${transactionItems.subtotalCost}) ELSE 0 END), 0)`,
        })
        .from(transactionItems)
        .where(inArray(transactionItems.transactionId, chunk))
        .groupBy(transactionItems.transactionId);
      for (const vi of viRows) {
        backupVerifiedMap.set(vi.transactionId, {
          hpp: toNum(vi.verifiedHpp),
          profit: toNum(vi.verifiedProfit),
        });
      }
    }

    let rIdx = 5;
    if (rows.length === 0) {
      writeRowValues(ws, rIdx, ['Tidak ada transaksi pada periode ini', '-', '-', '-', '-', 0, 0, 0, 0, 0, '-']);
      rIdx += 1;
    } else {
      for (const r of rows) {
        const verified = backupVerifiedMap.get(r.id);
        writeRowValues(ws, rIdx, [
          r.invoiceNumber,
          fmtWibDateTime(r.createdAt),
          r.kasir,
          r.paymentMethod,
          r.status,
          toNum(r.grossAmount),
          verified ? verified.hpp : toNum(r.totalHpp),
          verified ? verified.profit : toNum(r.grossProfit),
          toNum(r.cashReceived),
          toNum(r.changeAmount),
          r.voidReason ?? '',
        ]);
        rIdx += 1;
      }
    }
    const lastRow = rIdx - 1;
    styleDataTable(ws, {
      headerRowIdx: 4,
      firstDataRow: 5,
      lastDataRow: lastRow,
      colCount: 11,
      rupiahCols: [6, 7, 8, 9, 10],
      sumCols: [6, 7, 8, 9, 10],
      sumLabel: 'TOTAL COMPLETED',
      customSumFormula: (_c, ltr) => `SUMIFS(${ltr}5:${ltr}${lastRow},E5:E${lastRow},"COMPLETED")`,
      sumFilter: { col: 5, equals: 'COMPLETED' },
    });
    rowCounts['Transaksi'] = rows.length;

    // Sheet: Detail Item Transaksi (kini TERFILTER tanggal & non-testing!)
    const wsItems = wb.addWorksheet('Detail Item Transaksi');
    addBannerBlock(
      wsItems,
      'DETAIL ITEM TRANSAKSI',
      `Periode: ${range ? range.label : 'Semua Waktu (Maks 10.000 baris terbaru)'} | Laba Item = Subtotal Jual - Subtotal HPP`,
      10,
    );
    setWidths(wsItems, [22, 20, 32, 12, 9, 17, 17, 17, 17, 17]);
    setHeaderRow(
      wsItems,
      4,
      ['Invoice', 'Tanggal (WIB)', 'Nama Produk (Snapshot)', 'Status Trx', 'Qty', 'Harga Jual (Rp)', 'HPP (Rp)', 'Subtotal Jual (Rp)', 'Subtotal HPP (Rp)', 'Laba Item (Rp)'],
    );

    const itemRows = await db
      .select({
        invoiceNumber: transactions.invoiceNumber,
        createdAt: transactions.createdAt,
        productNameSnapshot: transactionItems.productNameSnapshot,
        status: transactions.status,
        qty: transactionItems.qty,
        sellingPriceSnapshot: transactionItems.sellingPriceSnapshot,
        costPriceSnapshot: transactionItems.costPriceSnapshot,
        subtotalSell: transactionItems.subtotalSell,
        subtotalCost: transactionItems.subtotalCost,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(and(...txTimeWhere))
      .orderBy(desc(transactions.createdAt))
      .limit(EXPORT_MAX_ROWS);

    if (itemRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Detail Item Transaksi');

    let ir = 5;
    if (itemRows.length === 0) {
      writeRowValues(wsItems, ir, ['Tidak ada item transaksi pada periode ini', '-', '-', '-', 0, 0, 0, 0, 0, 0]);
      ir += 1;
    } else {
      for (const r of itemRows) {
        const unitCost = toNum(r.costPriceSnapshot);
        const subSell = toNum(r.subtotalSell);
        const subCost = toNum(r.subtotalCost);
        const verifiedSubCost = unitCost > 0 ? subCost : 0;
        const verifiedProfit = unitCost > 0 ? subSell - subCost : 0;
        writeRowValues(wsItems, ir, [
          r.invoiceNumber,
          fmtWibDateTime(r.createdAt),
          r.productNameSnapshot,
          r.status,
          r.qty,
          toNum(r.sellingPriceSnapshot),
          unitCost,
          subSell,
          verifiedSubCost,
          verifiedProfit,
        ]);
        ir += 1;
      }
    }
    const iLast = ir - 1;
    styleDataTable(wsItems, {
      headerRowIdx: 4,
      firstDataRow: 5,
      lastDataRow: iLast,
      colCount: 10,
      intCols: [5],
      rupiahCols: [6, 7, 8, 9, 10],
      sumCols: [5, 8, 9, 10],
      sumLabel: 'TOTAL COMPLETED',
      customSumFormula: (_c, ltr) => `SUMIFS(${ltr}5:${ltr}${iLast},D5:D${iLast},"COMPLETED")`,
      sumFilter: { col: 4, equals: 'COMPLETED' },
    });
    rowCounts['Detail Item Transaksi'] = itemRows.length;
  }

  // Sheet: Produk (lengkap dengan barcode, margin, nilai aset HPP & jual)
  if (type === 'full' || type === 'products') {
    const wsProd = wb.addWorksheet('Produk');
    addBannerBlock(
      wsProd,
      'MASTER PRODUK & VALUASI STOK SAAT INI',
      `Maks ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} SKU | Nilai Aset = Stok x HPP | Potensi Jual = Stok x Harga Jual`,
      12,
    );
    setWidths(wsProd, [32, 16, 18, 15, 16, 11, 10, 10, 18, 18, 12, 20]);
    setHeaderRow(
      wsProd,
      4,
      ['Nama Produk', 'Barcode', 'Kategori', 'HPP (Rp)', 'Harga Jual (Rp)', 'Margin %', 'Stok', 'Satuan', 'Nilai Aset HPP (Rp)', 'Potensi Jual (Rp)', 'Status', 'Diupdate (WIB)'],
    );

    const pRows = await db
      .select({
        name: products.name,
        barcode: products.barcode,
        kategori: categories.name,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
        stockQty: products.stockQty,
        unit: products.unit,
        isActive: products.isActive,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(isNull(products.deletedAt))
      .orderBy(products.name)
      .limit(EXPORT_MAX_ROWS);

    if (pRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Produk');

    let pr = 5;
    if (pRows.length === 0) {
      writeRowValues(wsProd, pr, ['Belum ada produk terdaftar', '-', '-', 0, 0, 0, 0, '-', 0, 0, '-', '-']);
      pr += 1;
    } else {
      for (const r of pRows) {
        const hpp = toNum(r.costPrice);
        const sell = toNum(r.sellingPrice);
        const qty = toNum(r.stockQty);
        const margin = sell > 0 ? Math.round(((sell - hpp) / sell) * 1000) / 10 : 0;
        writeRowValues(wsProd, pr, [
          r.name,
          r.barcode ?? '-',
          r.kategori ?? 'Tanpa Kategori',
          hpp,
          sell,
          margin,
          qty,
          r.unit,
          qty * hpp,
          qty * sell,
          r.isActive ? 'AKTIF' : 'NONAKTIF',
          fmtWibDateTime(r.updatedAt),
        ]);
        pr += 1;
      }
    }
    styleDataTable(wsProd, {
      headerRowIdx: 4,
      firstDataRow: 5,
      lastDataRow: pr - 1,
      colCount: 12,
      intCols: [7],
      rupiahCols: [4, 5, 9, 10],
      pctCols: [6],
      sumCols: [7, 9, 10],
      sumLabel: 'TOTAL STOK & ASET',
    });
    rowCounts['Produk'] = pRows.length;
  }

  // Sheet: Karyawan (tanpa membocorkan pinHash, dengan status keamanan PIN)
  if (type === 'full' || type === 'employees') {
    const wsEmp = wb.addWorksheet('Karyawan');
    addBannerBlock(
      wsEmp,
      'DATA KARYAWAN / KASIR MAHASISWA',
      `Maks ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} karyawan | Tanpa data rahasia PIN hash`,
      8,
    );
    setWidths(wsEmp, [28, 16, 22, 16, 14, 14, 12, 20]);
    setHeaderRow(
      wsEmp,
      4,
      ['Nama Lengkap', 'NIM', 'Program Studi', 'Jabatan', 'Ketua Shift', 'Keamanan PIN', 'Status', 'Tanggal Daftar (WIB)'],
    );

    const eRows = await db
      .select({
        fullName: employees.fullName,
        nim: employees.nim,
        programStudi: employees.programStudi,
        jabatan: employees.jabatan,
        isKetuaShift: employees.isKetuaShift,
        hasPin: sql<boolean>`${employees.pinHash} IS NOT NULL`,
        isActive: employees.isActive,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(isNull(employees.deletedAt))
      .orderBy(employees.fullName)
      .limit(EXPORT_MAX_ROWS);

    if (eRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Karyawan');

    let er = 5;
    if (eRows.length === 0) {
      writeRowValues(wsEmp, er, ['Belum ada karyawan terdaftar', '-', '-', '-', '-', '-', '-', '-']);
      er += 1;
    } else {
      for (const r of eRows) {
        writeRowValues(wsEmp, er, [
          r.fullName,
          r.nim,
          r.programStudi,
          r.jabatan,
          r.isKetuaShift ? 'YA' : 'TIDAK',
          r.hasPin ? 'Sudah Set PIN' : 'Belum Set PIN',
          r.isActive ? 'AKTIF' : 'NONAKTIF',
          fmtWibDateTime(r.createdAt),
        ]);
        er += 1;
      }
    }
    styleDataTable(wsEmp, {
      headerRowIdx: 4,
      firstDataRow: 5,
      lastDataRow: er - 1,
      colCount: 8,
    });
    rowCounts['Karyawan'] = eRows.length;
  }

  // Sheet tambahan untuk full backup: Histori Shift & Penyesuaian Stok (kini terfilter tanggal!)
  if (type === 'full') {
    const wsShift = wb.addWorksheet('Histori Shift');
    addBannerBlock(
      wsShift,
      'HISTORI SHIFT LACI KASIR',
      `Periode: ${range ? range.label : 'Semua Waktu (Maks 10.000 baris)'}`,
      9,
    );
    setWidths(wsShift, [24, 14, 20, 20, 10, 16, 16, 16, 26]);
    setHeaderRow(
      wsShift,
      4,
      ['Kasir Pembuka Laci', 'NIM', 'Clock In (WIB)', 'Clock Out (WIB)', 'Status', 'Modal Awal (Rp)', 'Actual Cash (Rp)', 'Selisih Serah Terima (Rp)', 'Audit Flags / Catatan'],
    );

    const shiftWhere = range
      ? and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive))
      : undefined;

    const sRows = await db
      .select({
        kasir: employees.fullName,
        nim: employees.nim,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        status: shifts.status,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
        serahTerimaDiff: shifts.serahTerimaDiff,
        auditFlags: shifts.auditFlags,
        notes: shifts.notes,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(shiftWhere)
      .orderBy(desc(shifts.clockIn))
      .limit(EXPORT_MAX_ROWS);

    if (sRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Histori Shift');

    let sr = 5;
    if (sRows.length === 0) {
      writeRowValues(wsShift, sr, ['Belum ada shift pada periode ini', '-', '-', '-', '-', 0, 0, 0, '-']);
      sr += 1;
    } else {
      for (const s of sRows) {
        writeRowValues(wsShift, sr, [
          s.kasir,
          s.nim,
          fmtWibDateTime(s.clockIn),
          s.clockOut ? fmtWibDateTime(s.clockOut) : 'Masih Aktif',
          s.status,
          s.modalAwal !== null && s.modalAwal !== undefined ? toNum(s.modalAwal) : 100_000,
          s.actualCash !== null ? toNum(s.actualCash) : 0,
          s.serahTerimaDiff !== null ? toNum(s.serahTerimaDiff) : 0,
          [s.auditFlags, s.notes].filter(Boolean).join(' | '),
        ]);
        sr += 1;
      }
    }
    styleDataTable(wsShift, {
      headerRowIdx: 4,
      firstDataRow: 5,
      lastDataRow: sr - 1,
      colCount: 9,
      rupiahCols: [6, 7, 8],
      sumCols: [8],
      sumLabel: 'TOTAL SHIFT',
    });
    rowCounts['Histori Shift'] = sRows.length;

    const wsAdj = wb.addWorksheet('Penyesuaian Stok');
    addBannerBlock(
      wsAdj,
      'RIWAYAT PENYESUAIAN STOK GUDANG',
      `Periode: ${range ? range.label : 'Semua Waktu (Maks 10.000 baris)'}`,
      7,
    );
    setWidths(wsAdj, [20, 30, 12, 12, 12, 34, 22]);
    setHeaderRow(
      wsAdj,
      4,
      ['Tanggal (WIB)', 'Produk', 'Qty Sebelum', 'Qty Sesudah', 'Selisih', 'Alasan Koreksi', 'Dicatat Oleh'],
    );

    const adjWhere = range
      ? and(gte(stockAdjustments.createdAt, range.start), lt(stockAdjustments.createdAt, range.endExclusive))
      : undefined;

    const aRows = await db
      .select({
        createdAt: stockAdjustments.createdAt,
        produk: products.name,
        qtyBefore: stockAdjustments.qtyBefore,
        qtyAfter: stockAdjustments.qtyAfter,
        qtyDiff: stockAdjustments.qtyDiff,
        reason: stockAdjustments.reason,
        adminName: admins.fullName,
      })
      .from(stockAdjustments)
      .innerJoin(products, eq(stockAdjustments.productId, products.id))
      .leftJoin(admins, eq(stockAdjustments.adjustedByAdminId, admins.id))
      .where(adjWhere)
      .orderBy(desc(stockAdjustments.createdAt))
      .limit(EXPORT_MAX_ROWS);

    if (aRows.length >= EXPORT_MAX_ROWS) truncatedSheets.push('Penyesuaian Stok');

    let ar = 5;
    if (aRows.length === 0) {
      writeRowValues(wsAdj, ar, ['-', 'Belum ada penyesuaian stok pada periode ini', 0, 0, 0, '-', '-']);
      ar += 1;
    } else {
      for (const a of aRows) {
        writeRowValues(wsAdj, ar, [
          fmtWibDateTime(a.createdAt),
          a.produk,
          a.qtyBefore,
          a.qtyAfter,
          a.qtyDiff,
          a.reason,
          a.adminName ?? '-',
        ]);
        ar += 1;
      }
    }
    styleDataTable(wsAdj, {
      headerRowIdx: 4,
      firstDataRow: 5,
      lastDataRow: ar - 1,
      colCount: 7,
      intCols: [3, 4, 5],
      sumCols: [5],
      sumLabel: 'TOTAL SELISIH',
    });
    rowCounts['Penyesuaian Stok'] = aRows.length;
  }

  // Isi cover INFO & Ringkasan dengan ringkasan hasil + jumlah baris setiap sheet
  let cr = 4;
  if (summaryBlock.length > 0) {
    setHeaderRow(wsCover, cr, ['Ringkasan Hasil Penjualan', 'Nilai (Rp)', 'Keterangan']);
    cr += 1;
    for (const [label, val, note] of summaryBlock) {
      writeRowValues(wsCover, cr, [label, val, note]);
      const row = wsCover.getRow(cr);
      row.getCell(2).numFmt = RUPIAH_FMT;
      row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
      row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      for (let c = 1; c <= 3; c++) {
        row.getCell(c).border = THIN_BORDER;
        row.getCell(c).font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
      }
      row.height = calcServerWrapRowHeight([{ text: note, width: 44 }], 21, 14);
      cr += 1;
    }
    cr += 1;
  }

  setHeaderRow(wsCover, cr, ['Nama Sheet / Arsip', 'Jumlah Baris', 'Catatan'], SERVER_EXCEL_COLOR.HEADER_SUB);
  cr += 1;
  for (const [sheetName, count] of Object.entries(rowCounts)) {
    const isTruncated = truncatedSheets.includes(sheetName);
    const noteText = isTruncated
      ? `Mencapai batas maks ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} baris — gunakan filter rentang tanggal lebih sempit`
      : 'Lengkap sesuai filter periode';
    writeRowValues(wsCover, cr, [sheetName, count, noteText]);
    const row = wsCover.getRow(cr);
    row.getCell(2).numFmt = INT_FMT;
    row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    for (let c = 1; c <= 3; c++) {
      row.getCell(c).border = THIN_BORDER;
      row.getCell(c).font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
    }
    row.height = calcServerWrapRowHeight([{ text: noteText, width: 44 }], 21, 14);
    cr += 1;
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, rowCounts, truncatedSheets };
}

