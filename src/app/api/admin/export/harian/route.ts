// =============================================================
// GET /api/admin/export/harian — Ekspor Excel "1 Sheet Skema Harian"
// Laporan Keuangan, Rekapitulasi Harian & Audit Kas Shift Wiramart UNPERBA
// Format: 1 Sheet Terpadu Siap Cetak A4 Landscape dengan Invarian & Formula Asli
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { eq, and, gte, lt, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  transactions,
  employees,
  shifts,
  transactionPayments,
  shiftCashMovements,
} from '@/lib/db/schema';
import { requireManager } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
import {
  getFinancialReport,
  InvalidRangeError,
  isPeriodKey,
  resolveReportRange,
  type PeriodKey,
} from '@/lib/finance/report';
import {
  EXPORT_MAX_ROWS,
  HEADER_BORDER,
  INT_FMT,
  RUPIAH_FMT,
  SERVER_EXCEL_COLOR,
  THIN_BORDER,
  TOTAL_BORDER,
  TOTAL_FILL,
  ZEBRA_FILL,
  applyServerPageSetup,
  calcServerWrapRowHeight,
  chunkArray,
  fmtWibDateTime,
  isExcludedTestAccount,
  sanitizeExcelText,
} from '@/lib/services/exportWorkbookService';

export const runtime = 'nodejs';

const SQL_IN_CHUNK_SIZE = 1_500;

function fmtWibDateCompact(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(d);
}

function fmtWibTimeCompact(d: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

// Label sesi shift operasional toko berdasarkan waktu buka (07:00-11:30 vs 11:30-15:00 WIB)
function getShiftLabel(clockIn: Date): string {
  const timeStr = new Date(clockIn).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = timeStr.split(':').map(Number);
  const totalM = (h ?? 0) * 60 + (m ?? 0);
  return totalM < 690 ? 'Shift 1 (Pagi)' : 'Shift 2 (Siang)';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireManager();

    const { searchParams } = new URL(req.url);
    const rawPeriod = searchParams.get('period');
    if (rawPeriod !== null && rawPeriod !== '' && !isPeriodKey(rawPeriod)) {
      return NextResponse.json(
        { success: false, error: `Parameter period '${rawPeriod}' tidak valid` },
        { status: 400 },
      );
    }
    const period: PeriodKey = rawPeriod && isPeriodKey(rawPeriod) ? rawPeriod : 'daily';
    const dateFrom = searchParams.get('dateFrom') ?? undefined;
    const dateTo = searchParams.get('dateTo') ?? undefined;

    const range = resolveReportRange({ period, dateFrom, dateTo });
    const report = await getFinancialReport(range);
    const s = report.summary;

    const rawShiftList = await db
      .select({
        shiftId: shifts.id,
        clockIn: shifts.clockIn,
        clockOut: shifts.clockOut,
        status: shifts.status,
        modalAwal: shifts.modalAwal,
        actualCash: shifts.actualCash,
        notes: shifts.notes,
        kasirName: employees.fullName,
        kasirNim: employees.nim,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(and(gte(shifts.clockIn, range.start), lt(shifts.clockIn, range.endExclusive)))
      .orderBy(sql`${shifts.clockIn} ASC`)
      .limit(EXPORT_MAX_ROWS + 1);

    const isShiftTruncated = rawShiftList.length > EXPORT_MAX_ROWS;
    const shiftList = rawShiftList
      .slice(0, EXPORT_MAX_ROWS)
      .filter((sh) => !isExcludedTestAccount(sh.kasirName, sh.kasirNim));

    const shiftIds = shiftList.map((x) => x.shiftId);
    const shiftCashOutMap = new Map<string, number>();
    const shiftCashInMap = new Map<string, number>();
    const shiftSalesMap = new Map<string, number>();

    for (const idChunk of chunkArray(shiftIds, SQL_IN_CHUNK_SIZE)) {
      const movements = await db
        .select({
          shiftId: shiftCashMovements.shiftId,
          movementType: shiftCashMovements.movementType,
          total: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
        })
        .from(shiftCashMovements)
        .where(inArray(shiftCashMovements.shiftId, idChunk))
        .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType);

      for (const m of movements) {
        const val = parseFloat(m.total || '0');
        if (m.movementType === 'CASH_OUT') {
          shiftCashOutMap.set(m.shiftId, (shiftCashOutMap.get(m.shiftId) ?? 0) + val);
        } else if (m.movementType === 'CASH_IN') {
          shiftCashInMap.set(m.shiftId, (shiftCashInMap.get(m.shiftId) ?? 0) + val);
        }
      }

      const splitCashSales = await db
        .select({
          shiftId: transactions.shiftId,
          total: sql<string>`COALESCE(SUM(${transactionPayments.amount}), 0)`,
        })
        .from(transactionPayments)
        .innerJoin(transactions, eq(transactionPayments.transactionId, transactions.id))
        .where(
          and(
            inArray(transactions.shiftId, idChunk),
            eq(transactions.status, 'COMPLETED'),
            eq(transactionPayments.paymentMethod, 'CASH'),
            eq(transactions.isTest, false),
          ),
        )
        .groupBy(transactions.shiftId);

      for (const sc of splitCashSales) {
        shiftSalesMap.set(sc.shiftId, (shiftSalesMap.get(sc.shiftId) ?? 0) + parseFloat(sc.total || '0'));
      }

      const directCashSales = await db
        .select({
          shiftId: transactions.shiftId,
          total: sql<string>`COALESCE(SUM(${transactions.grossAmount}), 0)`,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.shiftId, idChunk),
            eq(transactions.status, 'COMPLETED'),
            eq(transactions.paymentMethod, 'CASH'),
            eq(transactions.isTest, false),
            sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
          ),
        )
        .groupBy(transactions.shiftId);

      for (const d of directCashSales) {
        shiftSalesMap.set(d.shiftId, (shiftSalesMap.get(d.shiftId) ?? 0) + parseFloat(d.total || '0'));
      }
    }

    // ── Bangun Workbook 1 Sheet Skema Harian ───────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Smartkasir Perwira - Wiramart UNPERBA';
    wb.created = new Date();
    wb.calcProperties.fullCalcOnLoad = true;

    const ws = wb.addWorksheet('Skema Harian Wiramart', {
      views: [{ showGridLines: true }],
    });
    applyServerPageSetup(ws, 'landscape');

    // Kolom lebar (B sampai L, dengan kolom A sebagai margin cetak kecil)
    ws.columns = [
      { width: 3 },  // A: Margin cetak
      { width: 20 }, // B: Tanggal / Sesi Shift
      { width: 28 }, // C: Kasir (Nama / NIM) / Jumlah Transaksi
      { width: 26 }, // D: Waktu Shift / Void
      { width: 17 }, // E: Modal Awal / Omzet Total
      { width: 17 }, // F: Omzet Tunai
      { width: 17 }, // G: Kas Keluar (-) / Omzet QRIS
      { width: 17 }, // H: Kas Masuk (+) / HPP
      { width: 18 }, // I: Kas Ekspektasi / Laba Kotor
      { width: 17 }, // J: Fisik Laci / Biaya Operasional
      { width: 17 }, // K: Selisih Kas / 50% Mahasiswa
      { width: 19 }, // L: Status Audit / 50% Kas Wiramart
    ];

    ws.getRow(1).height = 8;

    // Banner Judul Eksekutif (Navy Institusi)
    ws.mergeCells('B2:L2');
    const titleCell = ws.getCell('B2');
    titleCell.value = 'WIRAMART UNPERBA — LAPORAN KEUANGAN & AUDIT KAS HARIAN';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.BANNER } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 30;

    ws.mergeCells('B3:L3');
    const subTitle = ws.getCell('B3');
    subTitle.value = sanitizeExcelText(
      `Universitas Perwira Purbalingga • Periode: ${range.label} (${range.startDate} s/d ${range.endDate} WIB) • Dicetak: ${fmtWibDateTime(new Date())} WIB`,
    );
    subTitle.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: SERVER_EXCEL_COLOR.SUBTITLE_TEXT } };
    subTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.SUBTITLE_BG } };
    subTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(3).height = 20;

    ws.getRow(4).height = 8;

    // ── SECTION 1: RINGKASAN FINANSIAL & BAGI HASIL ───────────
    ws.mergeCells('B5:L5');
    const sec1 = ws.getCell('B5');
    sec1.value = '1. RINGKASAN FINANSIAL & SKEMA BAGI HASIL 50% - 50%';
    sec1.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
    sec1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.HEADER } };
    sec1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(5).height = 24;

    const labaOperasionalBersih = Math.max(0, s.labaKotor - s.biayaOperasional);
    const summaryItems: Array<{
      label: string;
      val: number | { formula: string; result: number };
      note: string;
      highlight?: boolean;
    }> = [
      { label: 'Total Omzet Penjualan (Gross Revenue)', val: s.omzet, note: `${s.txCount} transaksi selesai (COMPLETED)` },
      { label: '  - Pembayaran Tunai (Cash)', val: s.omzetCash, note: 'Penerimaan tunai pada laci kasir' },
      { label: '  - Pembayaran Non-Tunai (QRIS)', val: s.omzetQris, note: 'Masuk langsung ke rekening QRIS Wiramart' },
      { label: 'Total HPP (Harga Pokok Penjualan)', val: s.hppTerjual, note: 'Modal pokok barang terjual terverifikasi' },
      { label: 'LABA KOTOR (Gross Profit)', val: s.labaKotor, note: 'Margin kotor item ber-HPP terverifikasi' },
      { label: 'Total Biaya Operasional + Biaya Paten', val: s.biayaOperasional, note: 'Biaya operasional & alokasi paten bulanan' },
      { label: 'LABA BERSIH OPERASIONAL', val: { formula: 'MAX(0,F10-F11)', result: labaOperasionalBersih }, note: 'Laba kotor dikurangi total biaya operasional', highlight: true },
      { label: 'HAK BAGI HASIL MAHASISWA (50%)', val: s.alokasiGajiKaryawan, note: 'Alokasi kompensasi mahasiswa pengelola shift', highlight: true },
      { label: 'HAK KAS TOKO WIRAMART (50%)', val: s.labaBersih, note: 'Kas modal pengembangan unit usaha Wiramart', highlight: true },
    ];

    let curRow = 6;
    for (const item of summaryItems) {
      ws.mergeCells(`B${curRow}:E${curRow}`);
      ws.mergeCells(`F${curRow}:G${curRow}`);
      ws.mergeCells(`H${curRow}:L${curRow}`);

      const lblCell = ws.getCell(`B${curRow}`);
      lblCell.value = item.label;
      lblCell.alignment = { vertical: 'middle', horizontal: 'left' };

      const valCell = ws.getCell(`F${curRow}`);
      valCell.value = item.val;
      valCell.numFmt = RUPIAH_FMT;
      valCell.alignment = { vertical: 'middle', horizontal: 'right' };

      const noteCell = ws.getCell(`H${curRow}`);
      noteCell.value = sanitizeExcelText(item.note);
      noteCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

      for (let c = 2; c <= 12; c++) {
        const cell = ws.getRow(curRow).getCell(c);
        cell.border = THIN_BORDER;
        cell.font = {
          name: 'Calibri',
          size: c >= 8 ? 9.5 : 10,
          italic: c >= 8 && !item.highlight,
          bold: Boolean(item.highlight),
          color: { argb: c >= 8 && !item.highlight ? SERVER_EXCEL_COLOR.SUBTITLE_TEXT : SERVER_EXCEL_COLOR.BODY_TEXT },
        };
        if (item.highlight) {
          cell.fill = TOTAL_FILL;
        }
      }
      ws.getRow(curRow).height = 21;
      curRow++;
    }

    // ── SECTION 2: REKAPITULASI HARIAN ─────────────────────────
    ws.getRow(curRow).height = 10;
    curRow += 1;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec2 = ws.getCell(`B${curRow}`);
    sec2.value = '2. REKAPITULASI PENJUALAN & BAGI HASIL HARIAN (WIB)';
    sec2.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
    sec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.BANNER } };
    sec2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(curRow).height = 24;

    curRow++;
    const headers2 = [
      'Tanggal (WIB)',
      'Jumlah Transaksi',
      'Pembatalan',
      'Omzet Total (Rp)',
      'Omzet Tunai (Rp)',
      'Omzet QRIS (Rp)',
      'HPP (Rp)',
      'Laba Kotor (Rp)',
      'Biaya Operasional (Rp)',
      'Hak Mahasiswa 50% (Rp)',
      'Hak Wiramart 50% (Rp)',
    ];
    headers2.forEach((h, idx) => {
      const cell = ws.getRow(curRow).getCell(idx + 2);
      cell.value = h;
      cell.font = { name: 'Calibri', bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.HEADER } };
      cell.border = HEADER_BORDER;
      cell.alignment = { horizontal: idx === 0 ? 'center' : 'right', vertical: 'middle', wrapText: true };
    });
    ws.getRow(curRow).height = 26;

    curRow++;
    if (report.daily.length === 0) {
      ws.mergeCells(`B${curRow}:L${curRow}`);
      const emptyCell = ws.getCell(`B${curRow}`);
      emptyCell.value = 'Tidak ada data harian tercatat pada rentang tanggal ini.';
      emptyCell.font = { name: 'Calibri', italic: true, size: 10, color: { argb: SERVER_EXCEL_COLOR.SUBTITLE_TEXT } };
      emptyCell.border = THIN_BORDER;
      ws.getRow(curRow).height = 21;
      curRow++;
    } else {
      const dailyStartRow = curRow;
      let sumTxCount = 0;
      let sumVoidCount = 0;
      let sumOmzet = 0;
      let sumCash = 0;
      let sumQris = 0;
      let sumHpp = 0;
      let sumLabaKotor = 0;
      let sumBiaya = 0;
      let sumAlokasi = 0;
      let sumLabaBersih = 0;

      report.daily.forEach((d, idx) => {
        const row = ws.getRow(curRow);
        row.getCell(2).value = sanitizeExcelText(d.date);
        row.getCell(3).value = d.txCount;
        row.getCell(4).value = d.voidCount;
        row.getCell(5).value = d.omzet;
        row.getCell(6).value = d.omzetCash;
        row.getCell(7).value = d.omzetQris;
        row.getCell(8).value = d.hppTerjual;
        row.getCell(9).value = d.labaKotor;
        row.getCell(10).value = d.biayaOperasional;
        row.getCell(11).value = d.alokasiGajiKaryawan;
        row.getCell(12).value = d.labaBersih;

        sumTxCount += d.txCount;
        sumVoidCount += d.voidCount;
        sumOmzet += d.omzet;
        sumCash += d.omzetCash;
        sumQris += d.omzetQris;
        sumHpp += d.hppTerjual;
        sumLabaKotor += d.labaKotor;
        sumBiaya += d.biayaOperasional;
        sumAlokasi += d.alokasiGajiKaryawan;
        sumLabaBersih += d.labaBersih;

        for (let c = 2; c <= 12; c++) {
          const cell = row.getCell(c);
          cell.font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
          cell.border = THIN_BORDER;
          if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
          if (c === 2) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (c <= 4) {
            cell.numFmt = INT_FMT;
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else {
            cell.numFmt = RUPIAH_FMT;
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
        }
        row.height = 21;
        curRow++;
      });

      const dailyEndRow = curRow - 1;
      const totDailyRow = ws.getRow(curRow);
      totDailyRow.height = 24;
      totDailyRow.getCell(2).value = `TOTAL (${report.daily.length} Hari)`;
      const dailyTotals: ReadonlyArray<{ col: number; letter: string; sum: number; isCount?: boolean }> = [
        { col: 3, letter: 'C', sum: sumTxCount, isCount: true },
        { col: 4, letter: 'D', sum: sumVoidCount, isCount: true },
        { col: 5, letter: 'E', sum: sumOmzet },
        { col: 6, letter: 'F', sum: sumCash },
        { col: 7, letter: 'G', sum: sumQris },
        { col: 8, letter: 'H', sum: sumHpp },
        { col: 9, letter: 'I', sum: sumLabaKotor },
        { col: 10, letter: 'J', sum: sumBiaya },
        { col: 11, letter: 'K', sum: sumAlokasi },
        { col: 12, letter: 'L', sum: sumLabaBersih },
      ];
      for (const dt of dailyTotals) {
        const cell = totDailyRow.getCell(dt.col);
        cell.value = { formula: `SUM(${dt.letter}${dailyStartRow}:${dt.letter}${dailyEndRow})`, result: dt.sum };
        cell.numFmt = dt.isCount ? INT_FMT : RUPIAH_FMT;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
      for (let c = 2; c <= 12; c++) {
        const cell = totDailyRow.getCell(c);
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
        cell.fill = TOTAL_FILL;
        cell.border = TOTAL_BORDER;
      }
      totDailyRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
      curRow++;
    }

    // ── SECTION 3: AUDIT LACI & REKAP KAS SHIFT KASIR ──────────
    ws.getRow(curRow).height = 10;
    curRow += 1;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec3 = ws.getCell(`B${curRow}`);
    sec3.value = isShiftTruncated
      ? `3. AUDIT LACI & REKAPITULASI KAS SHIFT KASIR (DIBATASI ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} SHIFT PERTAMA)`
      : '3. AUDIT LACI & REKAPITULASI KAS SHIFT KASIR';
    sec3.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
    sec3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.BANNER } };
    sec3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(curRow).height = 24;

    curRow++;
    const headers3 = [
      'Sesi Shift',
      'Kasir (Nama / NIM)',
      'Waktu Shift (WIB)',
      'Modal Awal (Rp)',
      'Omzet Tunai (Rp)',
      'Kas Keluar (Rp)',
      'Kas Masuk (Rp)',
      'Kas Ekspektasi (Rp)',
      'Fisik Laci (Rp)',
      'Selisih Kas (Rp)',
      'Status Audit',
    ];
    headers3.forEach((h, idx) => {
      const cell = ws.getRow(curRow).getCell(idx + 2);
      cell.value = h;
      cell.font = { name: 'Calibri', bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SERVER_EXCEL_COLOR.HEADER_SUB } };
      cell.border = HEADER_BORDER;
      cell.alignment = {
        horizontal: idx >= 3 && idx <= 9 ? 'right' : idx === 10 ? 'center' : 'left',
        vertical: 'middle',
        wrapText: true,
      };
    });
    ws.getRow(curRow).height = 26;

    curRow++;
    if (shiftList.length === 0) {
      ws.mergeCells(`B${curRow}:L${curRow}`);
      const emptyShift = ws.getCell(`B${curRow}`);
      emptyShift.value = 'Tidak ada shift tercatat pada rentang tanggal ini.';
      emptyShift.font = { name: 'Calibri', italic: true, size: 10, color: { argb: SERVER_EXCEL_COLOR.SUBTITLE_TEXT } };
      emptyShift.border = THIN_BORDER;
      ws.getRow(curRow).height = 21;
      curRow++;
    } else {
      const shiftStartRow = curRow;
      let totModalAwal = 0;
      let totCashSales = 0;
      let totCashOut = 0;
      let totCashIn = 0;
      let totExpected = 0;
      let totExpectedClosed = 0;
      let totActual = 0;
      let hasClosedShift = false;
      let hasActiveShift = false;

      shiftList.forEach((sh, idx) => {
        const parsedModal =
          sh.modalAwal !== null && sh.modalAwal !== undefined && sh.modalAwal !== ''
            ? parseFloat(sh.modalAwal)
            : NaN;
        const modalAwal = Number.isFinite(parsedModal) ? parsedModal : 100_000;

        const parsedActual =
          sh.actualCash !== null && sh.actualCash !== undefined && sh.actualCash !== ''
            ? parseFloat(sh.actualCash)
            : NaN;
        const actualCash = Number.isFinite(parsedActual) ? parsedActual : null;

        const cashSales = shiftSalesMap.get(sh.shiftId) ?? 0;
        const cashOut = shiftCashOutMap.get(sh.shiftId) ?? 0;
        const cashIn = shiftCashInMap.get(sh.shiftId) ?? 0;
        const expectedCash = modalAwal + cashSales - cashOut + cashIn;
        const discrepancy = actualCash !== null ? actualCash - expectedCash : null;

        totModalAwal += modalAwal;
        totCashSales += cashSales;
        totCashOut += cashOut;
        totCashIn += cashIn;
        totExpected += expectedCash;
        if (actualCash !== null) {
          totActual += actualCash;
          totExpectedClosed += expectedCash;
          hasClosedShift = true;
        } else {
          hasActiveShift = true;
        }

        const shiftBadge = getShiftLabel(sh.clockIn);
        const kasirLabel = sanitizeExcelText(`${sh.kasirName} (${sh.kasirNim})`);
        const clockInDate = fmtWibDateCompact(sh.clockIn);
        const clockInTime = fmtWibTimeCompact(sh.clockIn);
        const clockOutText = sh.clockOut ? fmtWibTimeCompact(sh.clockOut) : 'Berjalan';

        const row = ws.getRow(curRow);
        row.getCell(2).value = shiftBadge;
        row.getCell(3).value = kasirLabel;
        row.getCell(4).value = `${clockInDate} ${clockInTime} - ${clockOutText}`;
        row.getCell(5).value = modalAwal;
        row.getCell(6).value = cashSales;
        row.getCell(7).value = cashOut;
        row.getCell(8).value = cashIn;
        row.getCell(9).value = {
          formula: `E${curRow}+F${curRow}-G${curRow}+H${curRow}`,
          result: expectedCash,
        };
        row.getCell(10).value = actualCash !== null ? actualCash : 'Belum Ditutup';
        row.getCell(11).value =
          discrepancy !== null
            ? { formula: `J${curRow}-I${curRow}`, result: discrepancy }
            : '—';

        let auditText = 'BERJALAN';
        if (sh.status === 'CLOSED') {
          if (discrepancy === null || Math.abs(discrepancy) < 1) auditText = 'SESUAI';
          else if (discrepancy < 0) auditText = 'KURANG';
          else auditText = 'LEBIH';
        }
        row.getCell(12).value = auditText;

        for (let c = 2; c <= 12; c++) {
          const cell = row.getCell(c);
          cell.font = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
          cell.border = THIN_BORDER;
          if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
        }

        for (let c = 5; c <= 9; c++) {
          row.getCell(c).numFmt = RUPIAH_FMT;
          row.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
        }
        if (actualCash !== null) {
          row.getCell(10).numFmt = RUPIAH_FMT;
          row.getCell(10).alignment = { horizontal: 'right', vertical: 'middle' };
          row.getCell(11).numFmt = RUPIAH_FMT;
          row.getCell(11).alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          row.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' };
        }
        row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(12).alignment = { horizontal: 'center', vertical: 'middle' };
        row.height = calcServerWrapRowHeight([{ text: kasirLabel, width: 28 }], 21, 14);

        curRow++;
      });

      const shiftEndRow = curRow - 1;
      const totDiscrepancy = hasClosedShift ? totActual - totExpectedClosed : null;
      const totRow = ws.getRow(curRow);
      totRow.height = 24;
      totRow.getCell(2).value = `TOTAL (${shiftList.length} Shift)`;
      totRow.getCell(3).value =
        hasActiveShift && hasClosedShift
          ? 'Mencakup shift berjalan (selisih dihitung dari shift tutup)'
          : 'Semua Sesi Shift';
      totRow.getCell(4).value =
        range.startDate === range.endDate ? range.startDate : `${range.startDate} s/d ${range.endDate}`;
      totRow.getCell(5).value = { formula: `SUM(E${shiftStartRow}:E${shiftEndRow})`, result: totModalAwal };
      totRow.getCell(6).value = { formula: `SUM(F${shiftStartRow}:F${shiftEndRow})`, result: totCashSales };
      totRow.getCell(7).value = { formula: `SUM(G${shiftStartRow}:G${shiftEndRow})`, result: totCashOut };
      totRow.getCell(8).value = { formula: `SUM(H${shiftStartRow}:H${shiftEndRow})`, result: totCashIn };
      totRow.getCell(9).value = { formula: `SUM(I${shiftStartRow}:I${shiftEndRow})`, result: totExpected };
      totRow.getCell(10).value = hasClosedShift
        ? { formula: `SUM(J${shiftStartRow}:J${shiftEndRow})`, result: totActual }
        : 'Belum Ditutup';
      totRow.getCell(11).value =
        totDiscrepancy !== null
          ? { formula: `SUM(K${shiftStartRow}:K${shiftEndRow})`, result: totDiscrepancy }
          : '—';
      totRow.getCell(12).value = !hasClosedShift
        ? 'BELUM DITUTUP'
        : hasActiveShift
          ? 'SEBAGIAN BERJALAN'
          : Math.abs(totDiscrepancy ?? 0) < 1
            ? 'SESUAI'
            : (totDiscrepancy ?? 0) < 0
              ? 'KURANG'
              : 'LEBIH';

      for (let c = 2; c <= 12; c++) {
        const cell = totRow.getCell(c);
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
        cell.fill = TOTAL_FILL;
        cell.border = TOTAL_BORDER;
      }
      for (let c = 5; c <= 9; c++) {
        totRow.getCell(c).numFmt = RUPIAH_FMT;
        totRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      if (hasClosedShift) {
        totRow.getCell(10).numFmt = RUPIAH_FMT;
        totRow.getCell(10).alignment = { horizontal: 'right', vertical: 'middle' };
        totRow.getCell(11).numFmt = RUPIAH_FMT;
        totRow.getCell(11).alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        totRow.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
        totRow.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' };
      }
      totRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      totRow.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
      totRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      totRow.getCell(12).alignment = { horizontal: 'center', vertical: 'middle' };
      curRow++;
    }

    // ── SECTION 4: INTEGRITAS & PENGESAHAN ────────────────────
    curRow += 2;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec4 = ws.getCell(`B${curRow}`);
    const checksOk = report.checks.methodSplitMatches && report.checks.dailyMatchesSummary;
    sec4.value = checksOk
      ? 'Status Integritas Keuangan: Pembagian metode pembayaran (Tunai + QRIS) dan konsolidasi harian terverifikasi seimbang.'
      : 'Status Integritas Keuangan: Diperlukan pemeriksaan lanjutan pada rekonsiliasi metode atau konsolidasi harian.';
    sec4.font = {
      name: 'Calibri',
      italic: true,
      size: 9.5,
      color: { argb: checksOk ? 'FF15803D' : 'FFB45309' },
    };

    curRow += 3;
    const sigHeaderFont = { name: 'Calibri', size: 10, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
    const sigTitleFont = { name: 'Calibri', size: 10, bold: true, color: { argb: SERVER_EXCEL_COLOR.BODY_TEXT } };
    ws.getCell(`C${curRow}`).value = 'Disusun oleh,';
    ws.getCell(`C${curRow}`).font = sigHeaderFont;
    ws.getCell(`I${curRow}`).value = 'Disetujui oleh,';
    ws.getCell(`I${curRow}`).font = sigHeaderFont;

    curRow += 4;
    ws.getCell(`C${curRow}`).value = '( .............................. )';
    ws.getCell(`C${curRow}`).font = sigHeaderFont;
    ws.getCell(`C${curRow + 1}`).value = 'Admin Pengelola Shift';
    ws.getCell(`C${curRow + 1}`).font = sigTitleFont;

    ws.getCell(`I${curRow}`).value = '( .............................. )';
    ws.getCell(`I${curRow}`).font = sigHeaderFont;
    ws.getCell(`I${curRow + 1}`).value = 'Manajer / Pembina Wiramart';
    ws.getCell(`I${curRow + 1}`).font = sigTitleFont;

    const buffer = await wb.xlsx.writeBuffer();
    const dateSlug =
      range.startDate === range.endDate ? range.startDate : `${range.startDate}_sd_${range.endDate}`;
    const periodSlug = dateFrom || dateTo ? 'custom' : range.period;
    const filename = `skema-harian-wiramart-${periodSlug}-${dateSlug}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
        'X-Export-Max-Rows': String(EXPORT_MAX_ROWS),
        'X-Export-Truncated': isShiftTruncated ? 'Shift' : '',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.statusCode });
    }
    if (err instanceof InvalidRangeError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    const errorMsg = err instanceof Error ? err.message : 'Gagal ekspor laporan skema harian';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
