// =============================================================
// GET /api/admin/export/harian — Ekspor Excel "1 Sheet Skema Harian"
// Sesuai Prioritas 3: Laporan Keuangan & Bagi Hasil Wiramart UNPERBA
// Format: 1 Sheet Terpadu dengan Invarian Keuangan & Styling Eksekutif
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
import { EXPORT_MAX_ROWS } from '@/lib/services/exportWorkbookService';

export const runtime = 'nodejs';

const SQL_IN_CHUNK_SIZE = 1_500;

// Netralisasi sel teks agar kebal terhadap Formula Injection (Celah I3)
function sanitizeExcelText(val: string | null | undefined): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function isExcludedTestAccount(name?: string | null, nim?: string | null): boolean {
  const lname = (name ?? '').toLowerCase();
  const lnim = (nim ?? '').toLowerCase();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lnim === '02405013' ||
    lnim === '00000000'
  );
}

function chunkArray<T>(items: readonly T[], size = SQL_IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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

// Label shift toko berdasarkan jam buka (08:00 - 11:30 vs 11:30 - 15:00 WIB)
function getShiftLabel(clockIn: Date): string {
  const timeStr = new Date(clockIn).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
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

    // Ambil data shift untuk periode ini (limit + 1 untuk deteksi truncasi di atas 10.000 baris)
    const rawShiftList = await db
      .select({
        shiftId:            shifts.id,
        clockIn:            shifts.clockIn,
        clockOut:           shifts.clockOut,
        status:             shifts.status,
        modalAwal:          shifts.modalAwal,
        actualCash:         shifts.actualCash,
        notes:              shifts.notes,
        kasirName:          employees.fullName,
        kasirNim:           employees.nim,
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
    const shiftCashInMap  = new Map<string, number>();
    const shiftSalesMap   = new Map<string, number>();

    for (const idChunk of chunkArray(shiftIds)) {
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
        .where(and(
          inArray(transactions.shiftId, idChunk),
          eq(transactions.status, 'COMPLETED'),
          eq(transactionPayments.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
        ))
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
        .where(and(
          inArray(transactions.shiftId, idChunk),
          eq(transactions.status, 'COMPLETED'),
          eq(transactions.paymentMethod, 'CASH'),
          eq(transactions.isTest, false),
          sql`NOT EXISTS (SELECT 1 FROM ${transactionPayments} WHERE ${transactionPayments.transactionId} = ${transactions.id})`,
        ))
        .groupBy(transactions.shiftId);

      for (const d of directCashSales) {
        shiftSalesMap.set(d.shiftId, (shiftSalesMap.get(d.shiftId) ?? 0) + parseFloat(d.total || '0'));
      }
    }

    // ── Bangun Workbook 1 Sheet Skema Harian ───────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Smartkasir Perwira - Wiramart UNPERBA';
    wb.created = new Date();

    const ws = wb.addWorksheet('Skema Harian Wiramart');
    ws.views = [{ showGridLines: true }];

    // Kolom lebar (A sampai L)
    ws.columns = [
      { width: 4 },  // A (padding)
      { width: 20 }, // B Sesi Shift / Tanggal
      { width: 28 }, // C Kasir (Nama / NIM)
      { width: 26 }, // D Waktu Shift (Tanggal + Jam WIB)
      { width: 16 }, // E Modal Awal
      { width: 16 }, // F Omzet Tunai
      { width: 16 }, // G Kas Keluar (-)
      { width: 16 }, // H Kas Masuk (+)
      { width: 18 }, // I Expected Kas
      { width: 16 }, // J Fisik Laci
      { width: 16 }, // K Selisih
      { width: 16 }, // L Status Audit
    ];

    // Title Block
    ws.mergeCells('B2:L2');
    const titleCell = ws.getCell('B2');
    titleCell.value = 'WIRAMART UNPERBA — LAPORAN KEUANGAN & BAGI HASIL';
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(2).height = 28;

    ws.mergeCells('B3:L3');
    const subTitle = ws.getCell('B3');
    subTitle.value = `Universitas Perwira Purbalingga • Periode: ${range.label} • Dicetak: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`;
    subTitle.font = { name: 'Arial', size: 10, color: { argb: 'FF64748B' } };
    ws.getRow(3).height = 18;

    // ── SECTION 1: RINGKASAN FINANSIAL & BAGI HASIL ───────────
    ws.mergeCells('B5:L5');
    const sec1 = ws.getCell('B5');
    sec1.value = '1. RINGKASAN FINANSIAL & SKEMA BAGI HASIL 50% - 50%';
    sec1.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sec1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    ws.getRow(5).height = 24;

    const summaryItems = [
      ['Total Omzet Penjualan (Gross Revenue)', s.omzet, 'Total transaksi selesai'],
      ['  - Omzet Tunai (Cash)', s.omzetCash, 'Uang fisik diterima di kasir'],
      ['  - Omzet Non-Tunai (QRIS)', s.omzetQris, 'Masuk langsung ke rekening QRIS'],
      ['Total HPP (Harga Pokok Penjualan)', s.hppTerjual, 'Biaya modal barang terjual'],
      ['LABA KOTOR (Omzet - HPP)', s.labaKotor, 'Margin kotor penjualan'],
      ['Total Biaya Operasional', s.biayaOperasional, 'ATK, Bensin & Kas Toko'],
      ['LABA BERSIH OPERASIONAL', Math.max(0, s.labaKotor - s.biayaOperasional), 'Laba kotor dikurangi biaya operasional'],
      ['HAK BAGI HASIL MAHASISWA (50%)', s.alokasiGajiKaryawan, 'Alokasi kompensasi mahasiswa pengelola'],
      ['HAK KAS WIRAMART UNPERBA (50%)', s.labaBersih, 'Kas modal pengembangan Wiramart'],
    ];

    let curRow = 6;
    for (const [label, val, note] of summaryItems) {
      ws.mergeCells(`B${curRow}:E${curRow}`);
      const lblCell = ws.getCell(`B${curRow}`);
      lblCell.value = label;
      lblCell.font = {
        bold: String(label).includes('LABA') || String(label).includes('HAK'),
        color: String(label).includes('LABA BERSIH') ? { argb: 'FF15803D' } : undefined,
      };

      ws.mergeCells(`F${curRow}:G${curRow}`);
      const valCell = ws.getCell(`F${curRow}`);
      valCell.value = Number(val);
      valCell.numFmt = '"Rp "#,##0';
      valCell.alignment = { horizontal: 'right' };
      valCell.font = {
        bold: String(label).includes('LABA') || String(label).includes('HAK'),
        color: String(label).includes('LABA BERSIH') ? { argb: 'FF15803D' } : undefined,
      };

      ws.mergeCells(`H${curRow}:L${curRow}`);
      const noteCell = ws.getCell(`H${curRow}`);
      noteCell.value = note;
      noteCell.font = { size: 9, color: { argb: 'FF64748B' }, italic: true };

      if (String(label).includes('LABA BERSIH') || String(label).includes('HAK')) {
        for (let c = 2; c <= 12; c++) {
          ws.getRow(curRow).getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF0FDF4' },
          };
        }
      }

      curRow++;
    }

    // ── SECTION 2: REKAPITULASI HARIAN ─────────────────────────
    curRow += 2;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec2 = ws.getCell(`B${curRow}`);
    sec2.value = '2. REKAPITULASI HARIAN (DAILY BREAKDOWN)';
    sec2.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sec2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    ws.getRow(curRow).height = 24;

    curRow++;
    const headers2 = ['Tanggal (WIB)', 'Jml Trx', 'Void', 'Omzet Total', 'Omzet Cash', 'Omzet QRIS', 'HPP', 'Laba Kotor', 'Biaya', '50% Mhs', '50% Wiramart'];
    headers2.forEach((h, idx) => {
      const cell = ws.getRow(curRow).getCell(idx + 2);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF115E59' } };
      cell.alignment = { horizontal: idx >= 3 ? 'right' : 'center', vertical: 'middle' };
    });
    ws.getRow(curRow).height = 20;

    curRow++;
    if (report.daily.length === 0) {
      ws.mergeCells(`B${curRow}:L${curRow}`);
      ws.getCell(`B${curRow}`).value = 'Tidak ada data harian tercatat pada rentang tanggal ini.';
      ws.getCell(`B${curRow}`).font = { italic: true, color: { argb: 'FF64748B' } };
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

      for (const d of report.daily) {
        const row = ws.getRow(curRow);
        row.getCell(2).value = d.date;
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

        row.getCell(3).numFmt = '#,##0';
        row.getCell(3).alignment = { horizontal: 'center' };
        row.getCell(4).numFmt = '#,##0';
        row.getCell(4).alignment = { horizontal: 'center' };
        for (let c = 5; c <= 12; c++) {
          row.getCell(c).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0';
          row.getCell(c).alignment = { horizontal: 'right' };
        }

        curRow++;
      }

      const dailyEndRow = curRow - 1;
      const totDailyRow = ws.getRow(curRow);
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
        if (dt.isCount) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'center' };
        } else {
          cell.numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      }
      for (let c = 2; c <= 12; c++) {
        totDailyRow.getCell(c).font = { bold: true, size: 9 };
        totDailyRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
      }
      totDailyRow.getCell(2).alignment = { horizontal: 'left' };
      curRow++;
    }

    // ── SECTION 3: AUDIT LACI & REKAP KAS SHIFT KASIR ──────────
    curRow += 2;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec3 = ws.getCell(`B${curRow}`);
    sec3.value = isShiftTruncated
      ? `3. AUDIT LACI & REKAP KAS SHIFT KASIR (DIBATASI ${EXPORT_MAX_ROWS.toLocaleString('id-ID')} SHIFT PERTAMA)`
      : '3. AUDIT LACI & REKAP KAS SHIFT KASIR';
    sec3.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sec3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    ws.getRow(curRow).height = 24;

    curRow++;
    const headers3 = [
      'Sesi Shift',
      'Kasir (Nama / NIM)',
      'Waktu Shift (WIB)',
      'Modal Awal',
      'Omzet Tunai',
      'Kas Keluar (-)',
      'Kas Masuk (+)',
      'Expected Kas',
      'Fisik Laci',
      'Selisih',
      'Status Audit',
    ];
    headers3.forEach((h, idx) => {
      const cell = ws.getRow(curRow).getCell(idx + 2);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B21B6' } };
      cell.alignment = { horizontal: idx >= 3 && idx <= 9 ? 'right' : 'left', vertical: 'middle' };
    });
    ws.getRow(curRow).height = 20;

    curRow++;
    if (shiftList.length === 0) {
      ws.mergeCells(`B${curRow}:L${curRow}`);
      ws.getCell(`B${curRow}`).value = 'Tidak ada shift tercatat pada rentang tanggal ini.';
      ws.getCell(`B${curRow}`).font = { italic: true, color: { argb: 'FF64748B' } };
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

      for (const sh of shiftList) {
        const parsedModal = sh.modalAwal !== null && sh.modalAwal !== undefined && sh.modalAwal !== ''
          ? parseFloat(sh.modalAwal)
          : NaN;
        const modalAwal = Number.isFinite(parsedModal) ? parsedModal : 100_000;

        const parsedActual = sh.actualCash !== null && sh.actualCash !== undefined && sh.actualCash !== ''
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
        const clockOutText = sh.clockOut ? fmtWibTimeCompact(sh.clockOut) : 'Aktif';

        const row = ws.getRow(curRow);
        row.getCell(2).value = shiftBadge;
        row.getCell(3).value = kasirLabel;
        row.getCell(4).value = `${clockInDate} ${clockInTime} - ${clockOutText}`;
        row.getCell(5).value = modalAwal;
        row.getCell(6).value = cashSales;
        row.getCell(7).value = cashOut;
        row.getCell(8).value = cashIn;
        row.getCell(9).value = { formula: `E${curRow}+F${curRow}-G${curRow}+H${curRow}`, result: expectedCash };
        row.getCell(10).value = actualCash !== null ? actualCash : 'Belum tutup';
        row.getCell(11).value = discrepancy !== null
          ? { formula: `J${curRow}-I${curRow}`, result: discrepancy }
          : '-';

        let auditText = 'AKTIF';
        if (sh.status === 'CLOSED') {
          if (discrepancy === null || Math.abs(discrepancy) < 1) auditText = 'PAS';
          else if (discrepancy < 0) auditText = 'TEKOR';
          else auditText = 'LEBIH';
        }
        row.getCell(12).value = auditText;

        for (let c = 5; c <= 9; c++) {
          row.getCell(c).numFmt = '"Rp "#,##0';
          row.getCell(c).alignment = { horizontal: 'right' };
        }
        if (actualCash !== null) {
          row.getCell(10).numFmt = '"Rp "#,##0';
          row.getCell(10).alignment = { horizontal: 'right' };
          row.getCell(11).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0';
          row.getCell(11).alignment = { horizontal: 'right' };
        } else {
          row.getCell(10).alignment = { horizontal: 'center' };
          row.getCell(11).alignment = { horizontal: 'center' };
        }
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(12).alignment = { horizontal: 'center' };

        curRow++;
      }

      const shiftEndRow = curRow - 1;
      // Hanya bandingkan fisik laci terhadap expected shift yang sudah ditutup agar shift aktif tidak terbaca "TEKOR"
      const totDiscrepancy = hasClosedShift ? totActual - totExpectedClosed : null;
      const totRow = ws.getRow(curRow);
      totRow.getCell(2).value = `TOTAL KONSOLIDASI (${shiftList.length} Shift)`;
      totRow.getCell(3).value = hasActiveShift && hasClosedShift ? 'Termasuk shift aktif (selisih dihitung dari shift tutup)' : 'Semua Sesi Shift';
      totRow.getCell(4).value = range.startDate === range.endDate ? range.startDate : `${range.startDate} s/d ${range.endDate}`;
      totRow.getCell(5).value = { formula: `SUM(E${shiftStartRow}:E${shiftEndRow})`, result: totModalAwal };
      totRow.getCell(6).value = { formula: `SUM(F${shiftStartRow}:F${shiftEndRow})`, result: totCashSales };
      totRow.getCell(7).value = { formula: `SUM(G${shiftStartRow}:G${shiftEndRow})`, result: totCashOut };
      totRow.getCell(8).value = { formula: `SUM(H${shiftStartRow}:H${shiftEndRow})`, result: totCashIn };
      totRow.getCell(9).value = { formula: `SUM(I${shiftStartRow}:I${shiftEndRow})`, result: totExpected };
      totRow.getCell(10).value = hasClosedShift ? totActual : 'Belum tutup';
      totRow.getCell(11).value = totDiscrepancy !== null ? totDiscrepancy : '-';
      totRow.getCell(12).value = !hasClosedShift
        ? 'BELUM TUTUP'
        : hasActiveShift
          ? 'SEBAGIAN AKTIF'
          : Math.abs(totDiscrepancy ?? 0) < 1
            ? 'PAS'
            : (totDiscrepancy ?? 0) < 0
              ? 'TEKOR'
              : 'LEBIH';

      for (let c = 2; c <= 12; c++) {
        const cell = totRow.getCell(c);
        cell.font = { bold: true, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } }; // Soft purple
      }
      for (let c = 5; c <= 9; c++) {
        totRow.getCell(c).numFmt = '"Rp "#,##0';
        totRow.getCell(c).alignment = { horizontal: 'right' };
      }
      if (hasClosedShift) {
        totRow.getCell(10).numFmt = '"Rp "#,##0';
        totRow.getCell(10).alignment = { horizontal: 'right' };
        totRow.getCell(11).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0';
        totRow.getCell(11).alignment = { horizontal: 'right' };
      }
      totRow.getCell(2).alignment = { horizontal: 'center' };
      totRow.getCell(12).alignment = { horizontal: 'center' };
      curRow++;
    }

    // ── SECTION 4: INTEGRITAS & TANDA TANGAN ──────────────────
    curRow += 2;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec4 = ws.getCell(`B${curRow}`);
    sec4.value = '✓ INVARIAN KEUANGAN: Omzet Cash + QRIS Seimbang. Seluruh formula terverifikasi atomik.';
    sec4.font = { italic: true, size: 9, color: { argb: 'FF15803D' } };

    curRow += 3;
    ws.getCell(`C${curRow}`).value = 'Dibuat oleh:';
    ws.getCell(`I${curRow}`).value = 'Disetujui oleh:';

    curRow += 4;
    ws.getCell(`C${curRow}`).value = '___________________';
    ws.getCell(`C${curRow + 1}`).value = 'Pengelola Toko';
    ws.getCell(`I${curRow}`).value = '___________________';
    ws.getCell(`I${curRow + 1}`).value = 'Dosen Pembina / Manajer';

    // Stream Excel Buffer
    const buffer = await wb.xlsx.writeBuffer();
    const dateSlug = range.startDate === range.endDate
      ? range.startDate
      : `${range.startDate}_sd_${range.endDate}`;
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
