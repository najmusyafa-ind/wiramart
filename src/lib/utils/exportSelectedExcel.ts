'use client';

import type ExcelJS from 'exceljs';

export type SelectedExcelFormat = 'currency' | 'integer' | 'decimal' | 'percent' | 'text';

export interface SelectedExcelColumn<T> {
  header: string;
  key: string;
  width?: number;
  format?: SelectedExcelFormat;
  /** 'sum' menghasilkan formula =SUM(...) pada baris total, 'count' menghitung baris, default 'none'. */
  aggregate?: 'sum' | 'count' | 'none';
  value: (row: T, index: number) => string | number | null | undefined;
}

export interface ExportSelectedExcelOptions<T> {
  filename: string;
  sheetName?: string;
  title: string;
  subtitle?: string;
  rows: readonly T[];
  columns: readonly SelectedExcelColumn<T>[];
}

/**
 * Standar format angka akuntansi Wiramart UNPERBA (Indonesian Rupiah & numerik baku).
 */
export const EXCEL_FMT = {
  RUPIAH: '"Rp "#,##0;[Red]-"Rp "#,##0;"Rp "0',
  INT: '#,##0',
  DEC: '#,##0.0',
  DEC2: '#,##0.00',
  PCT: '0.0"%"',
} as const;

export const EXCEL_FONT = {
  TITLE: { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } } satisfies Partial<ExcelJS.Font>,
  SUBTITLE: { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FF475569' } } satisfies Partial<ExcelJS.Font>,
  SECTION: { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF1E3A5F' } } satisfies Partial<ExcelJS.Font>,
  HEADER: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } } satisfies Partial<ExcelJS.Font>,
  BODY: { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } } satisfies Partial<ExcelJS.Font>,
  BOLD: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } } satisfies Partial<ExcelJS.Font>,
  MUTED: { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } } satisfies Partial<ExcelJS.Font>,
};

export const EXCEL_FILL = {
  BANNER: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } } satisfies ExcelJS.Fill,
  SUBTITLE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } } satisfies ExcelJS.Fill,
  SECTION: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } } satisfies ExcelJS.Fill,
  HEADER: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B4C7E' } } satisfies ExcelJS.Fill,
  ZEBRA: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } satisfies ExcelJS.Fill,
  TOTAL: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } } satisfies ExcelJS.Fill,
  OK_SOFT: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } } satisfies ExcelJS.Fill,
  WARN_SOFT: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEFCE8' } } satisfies ExcelJS.Fill,
  DANGER_SOFT: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } } satisfies ExcelJS.Fill,
};

export const EXCEL_BORDER = {
  THIN: {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  } satisfies Partial<ExcelJS.Borders>,
  TOTAL: {
    top: { style: 'thin', color: { argb: 'FF0F172A' } },
    bottom: { style: 'double', color: { argb: 'FF0F172A' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  } satisfies Partial<ExcelJS.Borders>,
  HEADER: {
    top: { style: 'thin', color: { argb: 'FF1E3A5F' } },
    left: { style: 'thin', color: { argb: 'FF475569' } },
    bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
    right: { style: 'thin', color: { argb: 'FF475569' } },
  } satisfies Partial<ExcelJS.Borders>,
};

/**
 * Mencegah formula injection (=, +, -, @, tab, CR) pada teks sel Excel/CSV.
 */
export function sanitizeExcelText(v: string | number | null | undefined): string {
  const str = String(v ?? '').trim();
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Menormalkan nama worksheet agar mematuhi batas 31 karakter & karakter terlarang Excel.
 */
export function sanitizeSheetName(name: string, fallback = 'Sheet1'): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

/**
 * Mengonversi indeks kolom berbasis-1 (1 -> A, 27 -> AA) menjadi huruf kolom Excel.
 */
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

/**
 * Menghasilkan slug tanggal hari ini dalam zona waktu WIB (YYYY-MM-DD).
 */
export function todayWibSlug(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Mengonversi nilai mentah menjadi angka finite aman untuk sel Excel.
 */
export function toSafeExcelNum(val: string | number | null | undefined): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const parsed = Number(val ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Memformat tanggal/waktu ke representasi formal Indonesia (WIB).
 */
export function formatWibDateTime(date: Date | string | null | undefined = new Date()): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Menghitung tinggi baris aman bagi kolom wrapText agar catatan panjang tidak terpotong vertikal.
 */
export function calcWrapRowHeight(
  cells: readonly { text: string; width: number }[],
  minHeight = 21,
  lineHeight = 14,
): number {
  let maxLines = 1;
  for (const item of cells) {
    const raw = item.text ?? '';
    if (!raw) continue;
    const usableChars = Math.max(8, Math.floor(item.width - 3));
    const lines = raw.split(/\r?\n/);
    let totalLines = 0;
    for (const line of lines) {
      totalLines += Math.max(1, Math.ceil(line.length / usableChars));
    }
    if (totalLines > maxLines) {
      maxLines = totalLines;
    }
  }
  return Math.min(240, Math.max(minHeight, maxLines * lineHeight + 7));
}

/**
 * Membuat workbook ExcelJS baru secara dinamis dengan metadata standar & kalkulasi otomatis.
 */
export async function createWiramartWorkbook(modifiedBy = 'Wiramart UNPERBA'): Promise<ExcelJS.Workbook> {
  const ExcelJSModule = (await import('exceljs')).default;
  const wb = new ExcelJSModule.Workbook();
  wb.creator = 'Smartkasir Perwira - Wiramart UNPERBA';
  wb.lastModifiedBy = modifiedBy;
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

/**
 * Menerapkan banner judul & subjudul standar Wiramart pada bagian atas worksheet.
 */
export function styleBannerBlock(
  ws: ExcelJS.Worksheet,
  options: {
    title: string;
    subtitle?: string;
    endCol: number;
    startCol?: number;
    titleRow?: number;
    subtitleRow?: number;
    align?: 'left' | 'center';
  },
): void {
  const {
    title,
    subtitle,
    endCol,
    startCol = 1,
    titleRow = 1,
    subtitleRow = titleRow + 1,
    align = 'left',
  } = options;
  const startLetter = colLetter(startCol);
  const endLetter = colLetter(endCol);

  ws.mergeCells(`${startLetter}${titleRow}:${endLetter}${titleRow}`);
  const tCell = ws.getCell(`${startLetter}${titleRow}`);
  tCell.value = sanitizeExcelText(title);
  tCell.font = EXCEL_FONT.TITLE;
  tCell.fill = EXCEL_FILL.BANNER;
  tCell.alignment = {
    vertical: 'middle',
    horizontal: align,
    indent: align === 'left' ? 1 : 0,
  };
  ws.getRow(titleRow).height = 30;

  if (subtitle !== undefined) {
    ws.mergeCells(`${startLetter}${subtitleRow}:${endLetter}${subtitleRow}`);
    const sCell = ws.getCell(`${startLetter}${subtitleRow}`);
    sCell.value = sanitizeExcelText(subtitle);
    sCell.font = EXCEL_FONT.SUBTITLE;
    sCell.fill = EXCEL_FILL.SUBTITLE;
    sCell.alignment = {
      vertical: 'middle',
      horizontal: align,
      indent: align === 'left' ? 1 : 0,
      wrapText: true,
    };
    ws.getRow(subtitleRow).height = 20;
  }
}

/**
 * Mengatur freeze pane, auto-filter, dan konfigurasi cetak A4 rapi pada worksheet.
 */
export function applySheetLayout(
  ws: ExcelJS.Worksheet,
  options: {
    freezeRow?: number;
    freezeCol?: number;
    autoFilter?: string | { from: { row: number; column: number }; to: { row: number; column: number } };
    orientation?: 'landscape' | 'portrait';
    fitToWidth?: number;
    fitToHeight?: number;
  } = {},
): void {
  const {
    freezeRow,
    freezeCol,
    autoFilter,
    orientation = 'landscape',
    fitToWidth = 1,
    fitToHeight = 0,
  } = options;

  if (freezeRow !== undefined || freezeCol !== undefined) {
    ws.views = [
      {
        state: 'frozen',
        ySplit: freezeRow ?? 0,
        xSplit: freezeCol ?? 0,
        showGridLines: true,
      },
    ];
  } else {
    ws.views = [{ showGridLines: true }];
  }

  if (autoFilter) {
    ws.autoFilter = autoFilter;
  }

  ws.pageSetup = {
    paperSize: 9, // A4
    orientation,
    fitToPage: true,
    fitToWidth,
    fitToHeight,
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

function triggerBlobDownload(blob: Blob, safeFilename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Mengekspor Workbook ExcelJS menjadi unduhan browser (.xlsx) secara aman.
 */
export async function downloadWorkbookBlob(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const safeFilename = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerBlobDownload(blob, safeFilename);
}

function escapeCsvCell(val: string | number | null | undefined): string {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : '0';
  }
  const safe = sanitizeExcelText(val);
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Mengekspor data tabular menjadi file CSV ber-BOM UTF-8 dengan proteksi formula injection.
 */
export function downloadCsvBlob(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): void {
  const safeFilename = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');
  const dataLines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  const csvString = `\uFEFF${[headerLine, ...dataLines].join('\r\n')}`;
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, safeFilename);
}

/**
 * Mengekspor baris yang dicentang ke file Excel (.xlsx) di browser lengkap dengan
 * proteksi formula injection, format Rp akuntansi, baris TOTAL =SUM(), serta print A4.
 */
export async function exportSelectedRowsToExcel<T>(
  options: ExportSelectedExcelOptions<T>,
): Promise<void> {
  const { filename, sheetName = 'Baris Terpilih', title, subtitle, rows, columns } = options;
  if (rows.length === 0 || columns.length === 0) return;

  const wb = await createWiramartWorkbook();
  const ws = wb.addWorksheet(sanitizeSheetName(sheetName, 'Baris Terpilih'));
  const totalCols = columns.length;

  styleBannerBlock(ws, {
    title,
    subtitle: `${subtitle ? `${subtitle} • ` : ''}${rows.length} baris dipilih • Dicetak: ${formatWibDateTime()} WIB`,
    endCol: totalCols,
    titleRow: 1,
    subtitleRow: 2,
    align: 'left',
  });

  ws.getRow(3).height = 8;

  // Row 4: Table Header
  const headerRow = ws.getRow(4);
  headerRow.height = 26;
  columns.forEach((col, cIdx) => {
    const cell = headerRow.getCell(cIdx + 1);
    cell.value = sanitizeExcelText(col.header);
    cell.font = EXCEL_FONT.HEADER;
    cell.fill = EXCEL_FILL.HEADER;
    cell.alignment = {
      vertical: 'middle',
      horizontal:
        col.format === 'currency' ||
        col.format === 'integer' ||
        col.format === 'decimal' ||
        col.format === 'percent'
          ? 'right'
          : 'left',
      wrapText: true,
    };
    cell.border = EXCEL_BORDER.HEADER;
  });

  const colWidths = columns.map((c) => Math.max(c.width ?? 12, c.header.length + 3));
  const colSums = columns.map(() => 0);
  const dataStartRow = 5;

  // First pass collects widths so calcWrapRowHeight can compute accurate multi-line heights
  const resolvedRows = rows.map((rowObj, rIdx) =>
    columns.map((col, cIdx) => {
      const rawVal = col.value(rowObj, rIdx);
      const fmt = col.format ?? 'text';
      if (fmt === 'currency' || fmt === 'integer' || fmt === 'decimal' || fmt === 'percent') {
        const num = toSafeExcelNum(rawVal);
        const stored = fmt === 'decimal' || fmt === 'percent' ? num : Math.round(num);
        if (col.aggregate === 'sum') {
          colSums[cIdx] += stored;
        }
        colWidths[cIdx] = Math.max(colWidths[cIdx], String(Math.round(num)).length + 8);
        return { kind: 'num' as const, fmt, num: stored, text: String(stored) };
      }
      const safeText = rawVal === null || rawVal === undefined ? '—' : sanitizeExcelText(String(rawVal));
      colWidths[cIdx] = Math.max(colWidths[cIdx], Math.min(44, safeText.length + 4));
      return { kind: 'text' as const, fmt, text: safeText };
    }),
  );

  // Finalize column widths first so row wrap calculations match real Excel column widths
  const finalWidths = columns.map((col, cIdx) => {
    const w = col.width ?? Math.min(44, Math.max(11, colWidths[cIdx]));
    ws.getColumn(cIdx + 1).width = w;
    return w;
  });

  resolvedRows.forEach((cells, rIdx) => {
    const excelRowIdx = dataStartRow + rIdx;
    const excelRow = ws.getRow(excelRowIdx);
    const wrapCandidates: { text: string; width: number }[] = [];

    cells.forEach((resolved, cIdx) => {
      const cell = excelRow.getCell(cIdx + 1);
      cell.font = EXCEL_FONT.BODY;

      if (resolved.kind === 'num') {
        cell.value = resolved.num;
        cell.numFmt =
          resolved.fmt === 'currency'
            ? EXCEL_FMT.RUPIAH
            : resolved.fmt === 'integer'
              ? EXCEL_FMT.INT
              : resolved.fmt === 'percent'
                ? EXCEL_FMT.PCT
                : EXCEL_FMT.DEC;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cell.value = resolved.text;
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        wrapCandidates.push({ text: resolved.text, width: finalWidths[cIdx] });
      }

      if (rIdx % 2 === 1) {
        cell.fill = EXCEL_FILL.ZEBRA;
      }
      cell.border = EXCEL_BORDER.THIN;
    });

    excelRow.height = calcWrapRowHeight(wrapCandidates, 21, 14);
  });

  const hasAggregate = columns.some((c) => c.aggregate === 'sum' || c.aggregate === 'count');
  if (hasAggregate) {
    const dataEndRow = dataStartRow + rows.length - 1;
    const totalRowIdx = dataEndRow + 1;
    const totalRow = ws.getRow(totalRowIdx);
    totalRow.height = 24;

    const firstLabelColIdx = columns.findIndex(
      (c) => c.aggregate !== 'sum' && c.aggregate !== 'count',
    );

    columns.forEach((col, cIdx) => {
      const cell = totalRow.getCell(cIdx + 1);
      const letter = colLetter(cIdx + 1);

      if (col.aggregate === 'sum') {
        cell.value = {
          formula: `SUM(${letter}${dataStartRow}:${letter}${dataEndRow})`,
          result: colSums[cIdx],
        };
        cell.numFmt =
          col.format === 'currency'
            ? EXCEL_FMT.RUPIAH
            : col.format === 'integer'
              ? EXCEL_FMT.INT
              : col.format === 'percent'
                ? EXCEL_FMT.PCT
                : EXCEL_FMT.DEC;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (col.aggregate === 'count') {
        cell.value = {
          formula: `COUNTA(${letter}${dataStartRow}:${letter}${dataEndRow})`,
          result: rows.length,
        };
        cell.numFmt = EXCEL_FMT.INT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (cIdx === (firstLabelColIdx >= 0 ? firstLabelColIdx : 0)) {
        cell.value = `TOTAL (${rows.length} Baris)`;
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else {
        cell.value = '';
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }

      cell.font = EXCEL_FONT.BOLD;
      cell.fill = EXCEL_FILL.TOTAL;
      cell.border = EXCEL_BORDER.TOTAL;
    });
  }

  applySheetLayout(ws, {
    freezeRow: 4,
    autoFilter: {
      from: { row: 4, column: 1 },
      to: { row: 4, column: totalCols },
    },
    orientation: totalCols >= 6 ? 'landscape' : 'portrait',
  });

  await downloadWorkbookBlob(wb, filename);
}
