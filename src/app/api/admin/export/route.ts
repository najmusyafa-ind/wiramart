// =============================================================
// GET /api/admin/export — Export backup data ke Excel (.xlsx)
// Query params:
//   type = 'full' | 'transactions' | 'products' | 'employees'
//   dateFrom = YYYY-MM-DD (opsional, hanya berlaku untuk type='transactions')
//   dateTo   = YYYY-MM-DD
// Auth: Admin only
// Output: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
//
// FinOps Guard: semua query dibatasi 5000 rows
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { desc, gte, lte, and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  transactions,
  transactionItems,
  products,
  employees,
  stockAdjustments,
  shifts,
  categories,
} from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// FinOps — batas max rows per sheet
const MAX_ROWS = 5_000;

// ─────────────────────────────────────────────────────────────
// Helper: style header row
// ─────────────────────────────────────────────────────────────
function styleHeader(ws: ExcelJS.Worksheet, row: number) {
  const headerRow = ws.getRow(row);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF2563EB' }, // brand blue
    };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
  });
  headerRow.height = 24;
}

// Helper: format tanggal ke string lokal Indonesia
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Jakarta',
  });
}

// Helper: parse decimal string dari Drizzle (decimal columns return string)
function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? parseFloat(v) : v;
}

// ─────────────────────────────────────────────────────────────
// Sheet builders
// ─────────────────────────────────────────────────────────────

async function buildTransactionsSheet(
  wb: ExcelJS.Workbook,
  start?: Date,
  end?: Date,
) {
  const ws = wb.addWorksheet('Transaksi');

  ws.columns = [
    { header: 'Invoice', key: 'invoice', width: 22 },
    { header: 'Tanggal (WIB)', key: 'tanggal', width: 22 },
    { header: 'Kasir', key: 'kasir', width: 24 },
    { header: 'Metode', key: 'metode', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Omzet (Rp)', key: 'gross', width: 16 },
    { header: 'HPP (Rp)', key: 'hpp', width: 16 },
    { header: 'Laba (Rp)', key: 'laba', width: 16 },
    { header: 'Tunai (Rp)', key: 'cash', width: 16 },
    { header: 'Kembalian (Rp)', key: 'change', width: 16 },
    { header: 'Alasan Void', key: 'void', width: 32 },
  ];
  styleHeader(ws, 1);

  const conditions = [];
  if (start) conditions.push(gte(transactions.createdAt, start));
  if (end)   conditions.push(lte(transactions.createdAt, end));

  const rows = await db
    .select({
      invoiceNumber: transactions.invoiceNumber,
      createdAt:     transactions.createdAt,
      kasir:         employees.fullName,
      paymentMethod: transactions.paymentMethod,
      status:        transactions.status,
      grossAmount:   transactions.grossAmount,
      totalHpp:      transactions.totalHpp,
      grossProfit:   transactions.grossProfit,
      cashReceived:  transactions.cashReceived,
      changeAmount:  transactions.changeAmount,
      voidReason:    transactions.voidReason,
    })
    .from(transactions)
    .innerJoin(employees, eq(transactions.employeeId, employees.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactions.createdAt))
    .limit(MAX_ROWS);

  for (const r of rows) {
    ws.addRow({
      invoice: r.invoiceNumber,
      tanggal: fmtDate(r.createdAt),
      kasir:   r.kasir,
      metode:  r.paymentMethod,
      status:  r.status,
      gross:   toNum(r.grossAmount),
      hpp:     toNum(r.totalHpp),
      laba:    toNum(r.grossProfit),
      cash:    toNum(r.cashReceived),
      change:  toNum(r.changeAmount),
      void:    r.voidReason ?? '',
    });
  }

  // Format kolom Rp sebagai number
  ['gross', 'hpp', 'laba', 'cash', 'change'].forEach((key) => {
    const col = ws.getColumn(key);
    col.numFmt = '#,##0';
  });

  return rows.length;
}

async function buildTransactionItemsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Detail Item Transaksi');
  ws.columns = [
    { header: 'Invoice', key: 'invoice', width: 22 },
    { header: 'Tanggal (WIB)', key: 'tanggal', width: 22 },
    { header: 'Nama Produk (Snapshot)', key: 'produk', width: 32 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Harga Jual Snapshot (Rp)', key: 'sell', width: 20 },
    { header: 'HPP Snapshot (Rp)', key: 'cost', width: 18 },
    { header: 'Subtotal Jual (Rp)', key: 'subJual', width: 18 },
    { header: 'Subtotal HPP (Rp)', key: 'subHpp', width: 18 },
  ];
  styleHeader(ws, 1);

  const rows = await db
    .select({
      invoiceNumber:        transactions.invoiceNumber,
      createdAt:            transactions.createdAt,
      productNameSnapshot:  transactionItems.productNameSnapshot,
      qty:                  transactionItems.qty,
      sellingPriceSnapshot: transactionItems.sellingPriceSnapshot,
      costPriceSnapshot:    transactionItems.costPriceSnapshot,
      subtotalSell:         transactionItems.subtotalSell,
      subtotalCost:         transactionItems.subtotalCost,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .orderBy(desc(transactions.createdAt))
    .limit(MAX_ROWS);

  for (const r of rows) {
    ws.addRow({
      invoice: r.invoiceNumber,
      tanggal: fmtDate(r.createdAt),
      produk:  r.productNameSnapshot,
      qty:     r.qty,
      sell:    toNum(r.sellingPriceSnapshot),
      cost:    toNum(r.costPriceSnapshot),
      subJual: toNum(r.subtotalSell),
      subHpp:  toNum(r.subtotalCost),
    });
  }

  ['sell', 'cost', 'subJual', 'subHpp'].forEach((key) => {
    ws.getColumn(key).numFmt = '#,##0';
  });
}

async function buildProductsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Produk');
  ws.columns = [
    { header: 'Nama Produk', key: 'nama', width: 32 },
    { header: 'Kategori', key: 'kategori', width: 20 },
    { header: 'HPP (Rp)', key: 'hpp', width: 14 },
    { header: 'Harga Jual (Rp)', key: 'jual', width: 16 },
    { header: 'Stok', key: 'stok', width: 8 },
    { header: 'Satuan', key: 'satuan', width: 10 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Dibuat', key: 'createdAt', width: 22 },
    { header: 'Diupdate', key: 'updatedAt', width: 22 },
  ];
  styleHeader(ws, 1);

  const rows = await db
    .select({
      nama:      products.name,
      kategori:  categories.name,
      hpp:       products.costPrice,
      jual:      products.sellingPrice,
      stok:      products.stockQty,
      satuan:    products.unit,
      isActive:  products.isActive,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(isNull(products.deletedAt))
    .orderBy(products.name)
    .limit(MAX_ROWS);

  for (const r of rows) {
    ws.addRow({
      nama:      r.nama,
      kategori:  r.kategori,
      hpp:       toNum(r.hpp),
      jual:      toNum(r.jual),
      stok:      r.stok,
      satuan:    r.satuan,
      status:    r.isActive ? 'Aktif' : 'Nonaktif',
      createdAt: fmtDate(r.createdAt),
      updatedAt: fmtDate(r.updatedAt),
    });
  }

  ['hpp', 'jual'].forEach((key) => {
    ws.getColumn(key).numFmt = '#,##0';
  });
}

async function buildEmployeesSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Karyawan');
  ws.columns = [
    { header: 'Nama Lengkap', key: 'nama', width: 28 },
    { header: 'NIM', key: 'nim', width: 18 },
    { header: 'Program Studi', key: 'prodi', width: 24 },
    { header: 'Jabatan', key: 'jabatan', width: 18 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Terdaftar', key: 'createdAt', width: 22 },
  ];
  styleHeader(ws, 1);

  const rows = await db
    .select({
      nama:      employees.fullName,
      nim:       employees.nim,
      prodi:     employees.programStudi,
      jabatan:   employees.jabatan,
      isActive:  employees.isActive,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .where(isNull(employees.deletedAt))
    .orderBy(employees.fullName)
    .limit(MAX_ROWS);

  for (const r of rows) {
    ws.addRow({
      nama:      r.nama,
      nim:       r.nim,
      prodi:     r.prodi,
      jabatan:   r.jabatan,
      status:    r.isActive ? 'Aktif' : 'Nonaktif',
      createdAt: fmtDate(r.createdAt),
    });
  }
}

async function buildShiftsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Histori Shift');
  ws.columns = [
    { header: 'Kasir', key: 'kasir', width: 28 },
    { header: 'Clock In (WIB)', key: 'clockIn', width: 22 },
    { header: 'Clock Out (WIB)', key: 'clockOut', width: 22 },
    { header: 'Status', key: 'status', width: 10 },
  ];
  styleHeader(ws, 1);

  const rows = await db
    .select({
      kasir:    employees.fullName,
      clockIn:  shifts.clockIn,
      clockOut: shifts.clockOut,
      status:   shifts.status,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .orderBy(desc(shifts.clockIn))
    .limit(MAX_ROWS);

  for (const r of rows) {
    ws.addRow({
      kasir:    r.kasir,
      clockIn:  fmtDate(r.clockIn),
      clockOut: r.clockOut ? fmtDate(r.clockOut) : 'Belum keluar',
      status:   r.status,
    });
  }
}

async function buildStockAdjSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Penyesuaian Stok');
  ws.columns = [
    { header: 'Produk', key: 'produk', width: 32 },
    { header: 'Stok Sebelum', key: 'before', width: 14 },
    { header: 'Stok Sesudah', key: 'after', width: 14 },
    { header: 'Selisih', key: 'diff', width: 10 },
    { header: 'Alasan', key: 'alasan', width: 36 },
    { header: 'Dilakukan Oleh', key: 'admin', width: 28 },
    { header: 'Tanggal (WIB)', key: 'tanggal', width: 22 },
  ];
  styleHeader(ws, 1);

  // stockAdjustments tidak punya join ke admins secara langsung di schema query
  // — fetch langsung dengan kolom yang ada
  const rows = await db
    .select({
      productName:      products.name,
      qtyBefore:        stockAdjustments.qtyBefore,
      qtyAfter:         stockAdjustments.qtyAfter,
      qtyDiff:          stockAdjustments.qtyDiff,
      reason:           stockAdjustments.reason,
      createdAt:        stockAdjustments.createdAt,
    })
    .from(stockAdjustments)
    .innerJoin(products, eq(stockAdjustments.productId, products.id))
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(MAX_ROWS);

  for (const r of rows) {
    ws.addRow({
      produk:  r.productName,
      before:  r.qtyBefore,
      after:   r.qtyAfter,
      diff:    r.qtyDiff,
      alasan:  r.reason,
      admin:   '—', // admin name join melalui adjustedByAdminId (untuk v2)
      tanggal: fmtDate(r.createdAt),
    });
  }
}

// ─────────────────────────────────────────────────────────────
// GET Handler
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const type     = searchParams.get('type') ?? 'full';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo   = searchParams.get('dateTo');

    const validTypes = ['full', 'transactions', 'products', 'employees'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Type tidak valid. Pilih: ${validTypes.join(', ')}` },
        { status: 400 },
      );
    }

    // Parse date range
    const start = dateFrom ? new Date(`${dateFrom}T00:00:00+07:00`) : undefined;
    const end   = dateTo   ? new Date(`${dateTo}T23:59:59+07:00`)   : undefined;

    // Build workbook
    const wb = new ExcelJS.Workbook();
    wb.creator   = 'Smartkasir Perwira';
    wb.created   = new Date();
    wb.modified  = new Date();

    // Cover sheet — selalu ada
    const wsCover = wb.addWorksheet('INFO');
    wsCover.getCell('A1').value = 'BACKUP DATA — SMARTKASIR PERWIRA';
    wsCover.getCell('A1').font  = { bold: true, size: 14 };
    wsCover.getCell('A2').value = `Tanggal Export: ${fmtDate(new Date())}`;
    wsCover.getCell('A3').value = `Tipe Export: ${type.toUpperCase()}`;
    wsCover.getCell('A4').value = dateFrom ? `Periode: ${dateFrom} s/d ${dateTo ?? '-'}` : 'Periode: Semua data';
    wsCover.getCell('A5').value = `Batas: ${MAX_ROWS.toLocaleString('id-ID')} baris per sheet`;
    wsCover.getCell('A7').value = '⚠ File ini bersifat RAHASIA. Jangan disebarkan tanpa izin.';
    wsCover.getCell('A7').font  = { color: { argb: 'FFDC2626' }, italic: true };
    wsCover.columns = [{ width: 50 }];

    // Build sheets sesuai type
    if (type === 'full' || type === 'transactions') {
      await buildTransactionsSheet(wb, start, end);
      await buildTransactionItemsSheet(wb);
    }
    if (type === 'full' || type === 'products') {
      await buildProductsSheet(wb);
    }
    if (type === 'full' || type === 'employees') {
      await buildEmployeesSheet(wb);
    }
    if (type === 'full') {
      await buildShiftsSheet(wb);
      await buildStockAdjSheet(wb);
    }

    // Stream buffer ke response
    const buffer = await wb.xlsx.writeBuffer();

    const dateStr    = new Date().toISOString().slice(0, 10);
    const filename   = `backup-smartkasir-${type}-${dateStr}.xlsx`;
    const mimeType   = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':        mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(buffer.byteLength),
        'Cache-Control':       'no-store',
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ success: false, error: 'Export gagal' }, { status: 500 });
  }
}
