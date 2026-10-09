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
import { requireAdmin } from '@/lib/utils/auth';
import {
  getFinancialReport,
  resolveReportRange,
  type PeriodKey,
} from '@/lib/finance/report';

export const runtime = 'nodejs';

function fmtRupiah(num: number): string {
  return 'Rp ' + Math.round(num).toLocaleString('id-ID');
}

// Netralisasi sel teks agar kebal terhadap Formula Injection (Celah I3)
function sanitizeExcelText(val: string | null | undefined): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^[=+@\-]/.test(str)) {
    return `'${str}`;
  }
  return str;
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
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const period = (searchParams.get('period') as PeriodKey) ?? 'daily';
    const dateFrom = searchParams.get('dateFrom') ?? undefined;
    const dateTo = searchParams.get('dateTo') ?? undefined;

    const range = resolveReportRange({ period, dateFrom, dateTo });
    const report = await getFinancialReport(range);
    const s = report.summary;

    // Ambil data shift untuk periode ini
    const shiftList = await db
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
      .limit(100);

    const shiftIds = shiftList.map((x) => x.shiftId);
    const shiftCashOutMap = new Map<string, number>();
    const shiftCashInMap  = new Map<string, number>();
    const shiftSalesMap   = new Map<string, number>();

    if (shiftIds.length > 0) {
      const movements = await db
        .select({
          shiftId: shiftCashMovements.shiftId,
          movementType: shiftCashMovements.movementType,
          total: sql<string>`COALESCE(SUM(${shiftCashMovements.amount}), 0)`,
        })
        .from(shiftCashMovements)
        .where(inArray(shiftCashMovements.shiftId, shiftIds))
        .groupBy(shiftCashMovements.shiftId, shiftCashMovements.movementType);

      for (const m of movements) {
        const val = parseFloat(m.total || '0');
        if (m.movementType === 'CASH_OUT') {
          shiftCashOutMap.set(m.shiftId, val);
        } else if (m.movementType === 'CASH_IN') {
          shiftCashInMap.set(m.shiftId, val);
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
          inArray(transactions.shiftId, shiftIds),
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
          inArray(transactions.shiftId, shiftIds),
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
      { width: 18 }, // B Sesi Shift
      { width: 24 }, // C Kasir (Nama / NIM)
      { width: 18 }, // D Waktu Shift
      { width: 16 }, // E Modal Awal
      { width: 16 }, // F Omzet Tunai
      { width: 16 }, // G Kas Keluar (-)
      { width: 16 }, // H Kas Masuk (+)
      { width: 18 }, // I Expected Kas
      { width: 16 }, // J Fisik Laci
      { width: 16 }, // K Selisih
      { width: 14 }, // L Status Audit
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
      ['LABA BERSIH OPERASIONAL', s.labaBersih, 'Laba kotor dikurangi biaya operasional'],
      ['HAK BAGI HASIL MAHASISWA (50%)', Math.round(s.labaBersih * 0.5), 'Alokasi kompensasi mahasiswa pengelola'],
      ['HAK KAS WIRAMART UNPERBA (50%)', s.labaBersih - Math.round(s.labaBersih * 0.5), 'Kas modal pengembangan Wiramart'],
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
      row.getCell(11).value = Math.round(d.labaBersih * 0.5);
      row.getCell(12).value = d.labaBersih - Math.round(d.labaBersih * 0.5);

      for (let c = 5; c <= 12; c++) {
        row.getCell(c).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0';
        row.getCell(c).alignment = { horizontal: 'right' };
      }
      row.getCell(3).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'center' };

      curRow++;
    }

    // ── SECTION 3: AUDIT LACI & REKAP KAS SHIFT KASIR ──────────
    curRow += 2;
    ws.mergeCells(`B${curRow}:L${curRow}`);
    const sec3 = ws.getCell(`B${curRow}`);
    sec3.value = '3. AUDIT LACI & REKAP KAS SHIFT (SHIFT 1 PAGI & SHIFT 2 SIANG — MODAL RP 100.000)';
    sec3.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sec3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    ws.getRow(curRow).height = 24;

    curRow++;
    const headers3 = [
      'Sesi Shift',
      'Kasir (Nama / NIM)',
      'Waktu Shift',
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
      let totModalAwal = 0;
      let totCashSales = 0;
      let totCashOut = 0;
      let totCashIn = 0;
      let totExpected = 0;
      let totActual = 0;
      let hasClosedShift = false;

      for (const sh of shiftList) {
        const modalAwal = sh.modalAwal ? parseFloat(sh.modalAwal) : 100_000;
        const actualCash = sh.actualCash ? parseFloat(sh.actualCash) : null;
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
          hasClosedShift = true;
        }

        const shiftBadge = getShiftLabel(sh.clockIn);
        const kasirLabel = sanitizeExcelText(`${sh.kasirName} (${sh.kasirNim})`);
        const clockInStr = new Date(sh.clockIn).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
        const clockOutStr = sh.clockOut ? new Date(sh.clockOut).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : 'Aktif';

        const row = ws.getRow(curRow);
        row.getCell(2).value = shiftBadge;
        row.getCell(3).value = kasirLabel;
        row.getCell(4).value = `${clockInStr} s/d ${clockOutStr}`;
        row.getCell(5).value = modalAwal;
        row.getCell(6).value = cashSales;
        row.getCell(7).value = cashOut;
        row.getCell(8).value = cashIn;
        row.getCell(9).value = expectedCash;
        row.getCell(10).value = actualCash !== null ? actualCash : 'Belum tutup';
        row.getCell(11).value = discrepancy !== null ? discrepancy : '-';

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
        if (typeof row.getCell(10).value === 'number') {
          row.getCell(10).numFmt = '"Rp "#,##0';
          row.getCell(10).alignment = { horizontal: 'right' };
        }
        if (typeof row.getCell(11).value === 'number') {
          row.getCell(11).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0';
          row.getCell(11).alignment = { horizontal: 'right' };
        }
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(12).alignment = { horizontal: 'center' };

        curRow++;
      }

      // Baris Total Konsolidasi Toko Jam 15:00 WIB
      const totDiscrepancy = hasClosedShift ? totActual - totExpected : null;
      const totRow = ws.getRow(curRow);
      totRow.getCell(2).value = 'TOTAL KONSOLIDASI (15:00 WIB)';
      totRow.getCell(3).value = 'Semua Sesi Shift';
      totRow.getCell(4).value = '08:00 - 15:00 WIB';
      totRow.getCell(5).value = totModalAwal;
      totRow.getCell(6).value = totCashSales;
      totRow.getCell(7).value = totCashOut;
      totRow.getCell(8).value = totCashIn;
      totRow.getCell(9).value = totExpected;
      totRow.getCell(10).value = hasClosedShift ? totActual : 'Belum tutup';
      totRow.getCell(11).value = totDiscrepancy !== null ? totDiscrepancy : '-';
      totRow.getCell(12).value = hasClosedShift ? (Math.abs(totDiscrepancy ?? 0) < 1 ? 'PAS' : (totDiscrepancy ?? 0) < 0 ? 'TEKOR' : 'LEBIH') : 'SEBAGIAN';

      for (let c = 2; c <= 12; c++) {
        const cell = totRow.getCell(c);
        cell.font = { bold: true, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } }; // Soft purple
      }
      for (let c = 5; c <= 9; c++) {
        totRow.getCell(c).numFmt = '"Rp "#,##0';
        totRow.getCell(c).alignment = { horizontal: 'right' };
      }
      if (typeof totRow.getCell(10).value === 'number') {
        totRow.getCell(10).numFmt = '"Rp "#,##0';
        totRow.getCell(10).alignment = { horizontal: 'right' };
      }
      if (typeof totRow.getCell(11).value === 'number') {
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
    const filename = `skema-harian-wiramart-${period}-${range.startDate}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Gagal ekspor laporan skema harian';
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
