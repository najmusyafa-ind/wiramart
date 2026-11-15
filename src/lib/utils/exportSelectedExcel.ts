'use client';

import type ExcelJS from 'exceljs';

export type SelectedExcelFormat = 'currency' | 'integer' | 'decimal' | 'text';

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

const RUPIAH_FMT = '"Rp "#,##0;[Red]-"Rp "#,##0;"Rp "0';
const INT_FMT = '#,##0';
const DEC_FMT = '#,##0.0';

function sanitizeExcelText(v: string | null | undefined): string {
  const str = String(v ?? '').trim();
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || 'Baris Terpilih').slice(0, 31);
}

function colLetter(col1Based: number): string {
  let col = col1Based;
  let result = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    col = Math.floor((col - 1) / 26);
  }
  return result;
}

export function todayWibSlug(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function toSafeNum(val: string | number | null | undefined): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const parsed = Number(val ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Mengekspor baris yang dicentang ke file Excel (.xlsx) di browser lengkap dengan
 * proteksi formula injection, format Rp akuntansi, serta baris TOTAL =SUM().
 */
export async function exportSelectedRowsToExcel<T>(
  options: ExportSelectedExcelOptions<T>,
): Promise<void> {
  const { filename, sheetName = 'Baris Terpilih', title, subtitle, rows, columns } = options;
  if (rows.length === 0 || columns.length === 0) return;

  const ExcelJSModule = (await import('exceljs')).default;
  const wb = new ExcelJSModule.Workbook();
  wb.creator = 'Smartkasir Perwira - Wiramart UNPERBA';
  wb.created = new Date();

  const ws = wb.addWorksheet(sanitizeSheetName(sheetName));
  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: true }];

  const totalCols = columns.length;
  const lastCol = colLetter(totalCols);

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };

  // Row 1: Title Banner
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = sanitizeExcelText(title);
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;

  // Row 2: Subtitle + WIB timestamp
  const wibPrintedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell('A2');
  subCell.value = sanitizeExcelText(
    `${subtitle ? `${subtitle} • ` : ''}${rows.length} baris dipilih • Dicetak: ${wibPrintedAt} WIB`,
  );
  subCell.font = { size: 9.5, italic: true, color: { argb: 'FF334155' } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.getRow(3).height = 8;

  // Row 4: Table Header
  const headerRow = ws.getRow(4);
  headerRow.height = 24;
  columns.forEach((col, cIdx) => {
    const cell = headerRow.getCell(cIdx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal:
        col.format === 'currency' || col.format === 'integer' || col.format === 'decimal'
          ? 'right'
          : 'left',
      wrapText: true,
    };
    cell.border = thinBorder;
  });

  // Track max text width & aggregate sums
  const colWidths = columns.map((c) => Math.max(c.width ?? 12, c.header.length + 3));
  const colSums = columns.map(() => 0);
  const dataStartRow = 5;

  rows.forEach((rowObj, rIdx) => {
    const excelRowIdx = dataStartRow + rIdx;
    const excelRow = ws.getRow(excelRowIdx);
    excelRow.height = 20;

    columns.forEach((col, cIdx) => {
      const cell = excelRow.getCell(cIdx + 1);
      const rawVal = col.value(rowObj, rIdx);
      const fmt = col.format ?? 'text';

      if (fmt === 'currency' || fmt === 'integer' || fmt === 'decimal') {
        const num = toSafeNum(rawVal);
        cell.value = fmt === 'decimal' ? num : Math.round(num);
        cell.numFmt = fmt === 'currency' ? RUPIAH_FMT : fmt === 'integer' ? INT_FMT : DEC_FMT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        if (col.aggregate === 'sum') {
          colSums[cIdx] += fmt === 'decimal' ? num : Math.round(num);
        }
        colWidths[cIdx] = Math.max(colWidths[cIdx], String(Math.round(num)).length + 8);
      } else {
        const safeText = rawVal === null || rawVal === undefined ? '—' : sanitizeExcelText(String(rawVal));
        cell.value = safeText;
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        colWidths[cIdx] = Math.max(colWidths[cIdx], Math.min(42, safeText.length + 3));
      }

      if (rIdx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      cell.border = thinBorder;
    });
  });

  // Total Row (jika ada minimal satu kolom aggregate 'sum' atau 'count')
  const hasAggregate = columns.some((c) => c.aggregate === 'sum' || c.aggregate === 'count');
  if (hasAggregate) {
    const dataEndRow = dataStartRow + rows.length - 1;
    const totalRowIdx = dataEndRow + 1;
    const totalRow = ws.getRow(totalRowIdx);
    totalRow.height = 22;

    const totalBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FF0F172A' } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };

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
            ? RUPIAH_FMT
            : col.format === 'integer'
              ? INT_FMT
              : DEC_FMT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (col.aggregate === 'count') {
        cell.value = {
          formula: `COUNTA(${letter}${dataStartRow}:${letter}${dataEndRow})`,
          result: rows.length,
        };
        cell.numFmt = INT_FMT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (cIdx === 0) {
        cell.value = `TOTAL (${rows.length} Baris)`;
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      } else {
        cell.value = '';
      }

      cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      cell.border = totalBorder;
    });
  }

  // Apply finalized widths
  columns.forEach((col, cIdx) => {
    const columnObj = ws.getColumn(cIdx + 1);
    columnObj.width = col.width ?? Math.min(44, Math.max(11, colWidths[cIdx]));
  });

  const buffer = await wb.xlsx.writeBuffer();
  const safeFilename = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

