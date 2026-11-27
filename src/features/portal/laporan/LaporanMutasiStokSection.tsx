'use client';
// =============================================================
// src/app/admin/laporan/LaporanMutasiStokSection.tsx
// Modul Laporan Rekonsiliasi Mutasi Stok Gudang (Wiramart v3.0 - Fase 5)
// STANDAR: Spatial UI/UX, WCAG AA, Export CSV, Real-Time Inventory Equation
// =============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  Search,
  Calendar,
  RefreshCw,
  TrendingUp,
  PackageCheck,
  Trash2,
  AlertCircle,
  Boxes,
  ArrowUpDown,
  FileSpreadsheet,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils/helpers';
import type { StockMutationReportResult } from '@/lib/services/stockMutationReportService';
import {
  EXCEL_BORDER,
  EXCEL_FILL,
  EXCEL_FMT,
  EXCEL_FONT,
  applySheetLayout,
  calcWrapRowHeight,
  colLetter,
  createWiramartWorkbook,
  downloadCsvBlob,
  downloadWorkbookBlob,
  formatWibDateTime,
  sanitizeExcelText,
  styleBannerBlock,
  toSafeExcelNum,
} from '@/lib/utils/exportSelectedExcel';

function getTodayWibDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

type StockMutationFetchResult =
  | { ok: true; data: StockMutationReportResult }
  | { ok: false; error: string };

async function requestStockMutationReport(
  start: string,
  end: string,
  searchQuery: string,
  signal?: AbortSignal,
): Promise<StockMutationFetchResult> {
  const params = new URLSearchParams({
    startDate: start,
    endDate: end,
    ...(searchQuery.trim() && { search: searchQuery.trim() }),
  });

  const res = await fetch(`/api/admin/laporan/mutasi-stok?${params}`, { signal });
  const json = await res.json();
  if (res.ok && json.success) {
    return { ok: true, data: json.data };
  }
  return { ok: false, error: json.error ?? 'Gagal memuat laporan mutasi stok.' };
}

export default function LaporanMutasiStokSection() {
  const [initialRangeDate] = useState(getTodayWibDate);
  const [startDate, setStartDate] = useState(initialRangeDate);
  const [endDate, setEndDate] = useState(initialRangeDate);
  const [preset, setPreset] = useState<'today' | '7days' | 'month' | 'custom'>('today');
  const [showCustomDates, setShowCustomDates] = useState(false);
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<StockMutationReportResult | null>(null);

  // Ambil data mutasi stok (untuk trigger filter/preset/refresh imperatif)
  const fetchReport = useCallback(
    async (start: string, end: string, searchQuery = search) => {
      setLoading(true);
      setError(null);
      try {
        const result = await requestStockMutationReport(start, end, searchQuery);
        if (result.ok) {
          setReportData(result.data);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Terjadi kegagalan koneksi ke server.');
      } finally {
        setLoading(false);
      }
    },
    [search],
  );

  // Ubah preset tanggal
  function handlePresetChange(newPreset: 'today' | '7days' | 'month') {
    setPreset(newPreset);
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    if (newPreset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
      fetchReport(todayStr, todayStr);
    } else if (newPreset === '7days') {
      const past7 = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      const past7Str = past7.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      setStartDate(past7Str);
      setEndDate(todayStr);
      fetchReport(past7Str, todayStr);
    } else if (newPreset === 'month') {
      const firstDay = `${todayStr.slice(0, 7)}-01`;
      setStartDate(firstDay);
      setEndDate(todayStr);
      fetchReport(firstDay, todayStr);
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    requestStockMutationReport(initialRangeDate, initialRangeDate, '', controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setReportData(result.data);
        } else {
          setError(result.error);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError('Terjadi kegagalan koneksi ke server.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [initialRangeDate]);

  const [exportingExcel, setExportingExcel] = useState(false);

  // ── Ekspor ke Excel (.xlsx) Standar Akuntansi Wiramart ──
  async function handleExportExcel() {
    if (!reportData || reportData.items.length === 0) return;
    setExportingExcel(true);
    try {
      const wb = await createWiramartWorkbook('Manager Gudang - Mutasi Stok');
      const ws = wb.addWorksheet('Mutasi Stok Gudang');

      const mutasiCols = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Nama Produk', width: 34, align: 'left' as const },
        { header: 'Kategori', width: 16, align: 'center' as const },
        { header: 'Satuan', width: 10, align: 'center' as const },
        { header: 'Stok Awal', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Masuk (Supplier)', width: 15, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Nilai HPP Masuk (Rp)', width: 21, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Keluar (Kasir)', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Total Bruto Keluar (Rp)', width: 21, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Promo FEFO', width: 13, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Musnah / Kedaluwarsa', width: 18, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Kerugian Musnah (Rp)', width: 21, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Retur Supplier', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Stok Akhir', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
      ];

      mutasiCols.forEach((col, i) => {
        ws.getColumn(i + 1).width = col.width;
      });

      styleBannerBlock(ws, {
        title: 'LAPORAN REKONSILIASI MUTASI STOK GUDANG & KASIR — WIRAMART UNPERBA',
        subtitle: `Periode: ${startDate} s/d ${endDate} • Dicetak: ${formatWibDateTime()} WIB • Stok Akhir = Stok Awal + Masuk - Keluar - Musnah - Retur`,
        endCol: mutasiCols.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws.getRow(3).height = 8;

      const hRow = ws.getRow(4);
      hRow.height = 28;
      mutasiCols.forEach((col, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = col.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: col.align, wrapText: true };
      });

      const dataStart = 5;

      reportData.items.forEach((it, idx) => {
        const rowNum = dataStart + idx;
        const row = ws.getRow(rowNum);
        const prodName = sanitizeExcelText(it.productName) || '—';
        const catName = sanitizeExcelText(it.categoryName) || '—';
        const unitTxt = sanitizeExcelText(it.unit) || '—';

        const initialN = Math.round(toSafeExcelNum(it.initialStock));
        const inN = Math.round(toSafeExcelNum(it.qtyIn));
        const hppInN = Math.round(toSafeExcelNum(it.totalHppIn));
        const outN = Math.round(toSafeExcelNum(it.qtyOut));
        const grossOutN = Math.round(toSafeExcelNum(it.totalGrossOut));
        const promoN = Math.round(toSafeExcelNum(it.discountedQtyOut));
        const destN = Math.round(toSafeExcelNum(it.qtyDestroyed));
        const lossN = Math.round(toSafeExcelNum(it.lossAmountDestroyed));
        const retN = Math.round(toSafeExcelNum(it.qtyReturned));
        const finalN = Math.round(toSafeExcelNum(it.finalStock));

        const formulaExpected = initialN + inN - outN - destN - retN;
        const finalCellVal: number | { formula: string; result: number } =
          formulaExpected === finalN
            ? { formula: `E${rowNum}+F${rowNum}-H${rowNum}-K${rowNum}-M${rowNum}`, result: finalN }
            : finalN;

        const rowValues: (string | number | { formula: string; result: number })[] = [
          idx + 1,
          prodName,
          catName,
          unitTxt,
          initialN,
          inN,
          hppInN,
          outN,
          grossOutN,
          promoN,
          destN,
          lossN,
          retN,
          finalCellVal,
        ];

        const isZebra = idx % 2 === 1;
        rowValues.forEach((val, cIdx) => {
          const cell = row.getCell(cIdx + 1);
          const meta = mutasiCols[cIdx];
          cell.value = val;
          cell.font = cIdx === 13 ? EXCEL_FONT.BOLD : EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 1,
          };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (isZebra) cell.fill = EXCEL_FILL.ZEBRA;
        });

        row.height = calcWrapRowHeight(
          [{ text: prodName, width: mutasiCols[1].width }],
          21,
          14,
        );
      });

      const s = reportData.summary;
      const dataEnd = dataStart + reportData.items.length - 1;
      const totalRow = ws.getRow(dataEnd + 1);
      totalRow.height = 25;

      const summaryMap: Record<number, number> = {
        4: Math.round(toSafeExcelNum(s.totalInitialStock)),
        5: Math.round(toSafeExcelNum(s.totalQtyIn)),
        6: Math.round(toSafeExcelNum(s.totalHppIn)),
        7: Math.round(toSafeExcelNum(s.totalQtyOut)),
        8: Math.round(toSafeExcelNum(s.totalGrossOut)),
        9: Math.round(toSafeExcelNum(s.totalDiscountedQtyOut)),
        10: Math.round(toSafeExcelNum(s.totalDestroyedQty)),
        11: Math.round(toSafeExcelNum(s.totalLossAmount)),
        12: Math.round(toSafeExcelNum(s.totalReturnedQty)),
        13: Math.round(toSafeExcelNum(s.totalFinalStock)),
      };

      mutasiCols.forEach((col, cIdx) => {
        const cell = totalRow.getCell(cIdx + 1);
        const colChar = colLetter(cIdx + 1);
        if (cIdx === 1) {
          cell.value = `TOTAL MUTASI INVENTARIS (${reportData.items.length} Produk)`;
        } else if (cIdx in summaryMap) {
          cell.value = {
            formula: `SUM(${colChar}${dataStart}:${colChar}${dataEnd})`,
            result: summaryMap[cIdx],
          };
        } else {
          cell.value = '';
        }
        cell.font = EXCEL_FONT.BOLD;
        cell.fill = EXCEL_FILL.TOTAL;
        cell.border = EXCEL_BORDER.TOTAL;
        cell.alignment = { vertical: 'middle', horizontal: col.align };
        if (col.fmt) cell.numFmt = col.fmt;
      });

      applySheetLayout(ws, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: mutasiCols.length } },
        orientation: 'landscape',
      });

      await downloadWorkbookBlob(wb, `Laporan_Mutasi_Stok_Wiramart_${startDate}_sd_${endDate}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('Gagal mengekspor file Excel mutasi stok.');
    } finally {
      setExportingExcel(false);
    }
  }

  // Ekspor ke CSV Cadangan (UTF-8 BOM + Blob + Anti Formula-Injection)
  function handleExportCsv() {
    if (!reportData || reportData.items.length === 0) return;

    const headers = [
      'No',
      'Nama Produk',
      'Kategori',
      'Satuan',
      'Stok Awal',
      'Masuk (Supplier ACC)',
      'Nilai HPP Masuk (Rp)',
      'Keluar (Kasir)',
      'Total Bruto Keluar (Rp)',
      'Promo FEFO',
      'Musnah / Kedaluwarsa',
      'Nilai Kerugian Musnah (Rp)',
      'Retur Supplier',
      'Stok Akhir',
    ];

    const rows = reportData.items.map((it, idx) => [
      idx + 1,
      it.productName,
      it.categoryName,
      it.unit,
      it.initialStock,
      it.qtyIn,
      it.totalHppIn,
      it.qtyOut,
      it.totalGrossOut,
      it.discountedQtyOut,
      it.qtyDestroyed,
      it.lossAmountDestroyed,
      it.qtyReturned,
      it.finalStock,
    ]);

    downloadCsvBlob(`mutasi_stok_wiramart_${startDate}_sd_${endDate}.csv`, headers, rows);
  }

  const summary = reportData?.summary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── HEADER & FILTER BAR ── */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          padding: '18px 20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Boxes size={18} color="#0f172a" />
            <span>Mutasi Stok</span>
          </h2>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!reportData || reportData.items.length === 0 || exportingExcel}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#0f172a',
                color: '#ffffff',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: exportingExcel || !reportData || reportData.items.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {exportingExcel ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Membuat...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet size={14} color="#38bdf8" />
                  <span>Excel</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!reportData || reportData.items.length === 0}
              style={{
                padding: '7px 11px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Download size={13} /> CSV
            </button>

            <button
              type="button"
              onClick={() => fetchReport(startDate, endDate)}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Segarkan
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="rep-chip-bar" style={{ maxWidth: '100%' }}>
              {[
                { id: 'today', label: 'Hari Ini' },
                { id: '7days', label: '7 Hari' },
                { id: 'month', label: 'Bulan Ini' },
              ].map((p) => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setShowCustomDates(false);
                      handlePresetChange(p.id as 'today' | '7days' | 'month');
                    }}
                    className={`rep-chip${active ? ' active' : ''}`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowCustomDates((v) => !v)}
                className={`rep-chip${showCustomDates || preset === 'custom' ? ' active' : ''}`}
              >
                <Calendar size={12} />
                <span>Tanggal</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 10px', flex: '1 1 180px', maxWidth: 280 }}>
              <Search size={14} color="#64748b" />
              <input
                type="text"
                placeholder="Cari produk..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchReport(startDate, endDate, search);
                }}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.82rem', width: '100%' }}
              />
            </div>
          </div>

          {showCustomDates && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <input
                type="date"
                className="form-input"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPreset('custom');
                }}
                style={{ width: 145, minHeight: 34, padding: '4px 8px', fontSize: '0.78rem' }}
              />
              <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>s/d</span>
              <input
                type="date"
                className="form-input"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPreset('custom');
                }}
                style={{ width: 145, minHeight: 34, padding: '4px 8px', fontSize: '0.78rem' }}
              />
              <button
                type="button"
                onClick={() => fetchReport(startDate, endDate)}
                className="btn btn-primary btn-sm"
              >
                Terapkan
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 4 KARTU RINGKAS MUTASI STOK (2x2 MOBILE) ── */}
      {summary && (
        <div className="rep-kpi-grid" style={{ marginBottom: 0 }}>
          <div className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Barang Masuk</span>
              <PackageCheck size={15} color="#15803d" />
            </div>
            <div className="rep-kpi__val" style={{ color: '#15803d' }}>+{summary.totalQtyIn} pcs</div>
            <div className="rep-kpi__sub">HPP {formatRupiah(summary.totalHppIn)}</div>
          </div>

          <div className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Terjual</span>
              <TrendingUp size={15} color="#2563eb" />
            </div>
            <div className="rep-kpi__val" style={{ color: '#1d4ed8' }}>-{summary.totalQtyOut} pcs</div>
            <div className="rep-kpi__sub">Omzet {formatRupiah(summary.totalGrossOut)}</div>
          </div>

          <div className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Musnah</span>
              <Trash2 size={15} color="#dc2626" />
            </div>
            <div className="rep-kpi__val" style={{ color: '#b91c1c' }}>-{summary.totalDestroyedQty} pcs</div>
            <div className="rep-kpi__sub" style={{ color: '#dc2626' }}>Rugi {formatRupiah(summary.totalLossAmount)}</div>
          </div>

          <div className="rep-kpi">
            <div className="rep-kpi__top">
              <span className="rep-kpi__label">Stok Akhir</span>
              <ArrowUpDown size={15} color="#ea580c" />
            </div>
            <div className="rep-kpi__val">{summary.totalFinalStock} pcs</div>
            <div className="rep-kpi__sub">Retur -{summary.totalReturnedQty} pcs</div>
          </div>
        </div>
      )}

      {/* ── ERROR ALERT ── */}
      {error && (
        <div style={{ padding: 14, borderRadius: 10, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* ── TABEL MUTASI STOK LENGKAP ── */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#1e293b' }}>
            Daftar Produk ({reportData?.items.length ?? 0})
          </span>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            {startDate} s/d {endDate}
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px' }} />
            <p style={{ margin: 0, fontSize: '0.85rem' }}>Mengkalkulasi mutasi inventaris toko...</p>
          </div>
        ) : !reportData || reportData.items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
            <Boxes size={42} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
            <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: '#334155' }}>
              Tidak ada data mutasi produk pada periode ini.
            </p>
          </div>
        ) : (
          <>
          {/* Desktop Table (Light Modern Header) */}
          <div className="rep-desktop-only" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left', borderBottom: '1.5px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 12px', width: 42, textAlign: 'center', fontWeight: 700, fontSize: '0.72rem' }}>No</th>
                  <th style={{ padding: '10px 12px', minWidth: 170, fontWeight: 700, fontSize: '0.72rem' }}>Produk</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, fontSize: '0.72rem' }}>Kategori</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, fontSize: '0.72rem' }}>Awal</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#15803d', fontWeight: 700, fontSize: '0.72rem' }}>Masuk</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#1d4ed8', fontWeight: 700, fontSize: '0.72rem' }}>Terjual</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#b45309', fontWeight: 700, fontSize: '0.72rem' }}>Obral</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: '0.72rem' }}>Musnah</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#c2410c', fontWeight: 700, fontSize: '0.72rem' }}>Retur</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: '#166534', background: '#f0fdf4', fontSize: '0.72rem' }}>
                    Stok Akhir
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.items.map((row, idx) => (
                    <tr
                      key={row.productId}
                      style={{
                        borderBottom: '1px solid #e2e8f0',
                        background: idx % 2 === 1 ? '#f8fafc' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                        {row.productName}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748b' }}>
                        {row.categoryName}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, background: '#f1f5f9', color: '#334155' }}>
                        {row.initialStock} {row.unit}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, color: row.qtyIn > 0 ? '#15803d' : '#94a3b8' }}>
                        {row.qtyIn > 0 ? `+${row.qtyIn}` : '0'}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, color: row.qtyOut > 0 ? '#1d4ed8' : '#94a3b8' }}>
                        {row.qtyOut > 0 ? `-${row.qtyOut}` : '0'}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', color: row.discountedQtyOut > 0 ? '#b45309' : '#94a3b8' }}>
                        {row.discountedQtyOut > 0 ? (
                          <span style={{ background: '#fef3c7', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                            {row.discountedQtyOut} pcs
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', color: row.qtyDestroyed > 0 ? '#dc2626' : '#94a3b8' }}>
                        {row.qtyDestroyed > 0 ? (
                          <span title={`Kerugian HPP: ${formatRupiah(row.lossAmountDestroyed)}`} style={{ fontWeight: 800, color: '#dc2626' }}>
                            -{row.qtyDestroyed}
                          </span>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', color: row.qtyReturned > 0 ? '#ea580c' : '#94a3b8' }}>
                        {row.qtyReturned > 0 ? `-${row.qtyReturned}` : '0'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 900, background: '#f0fdf4', color: '#15803d' }}>
                        {row.finalStock} {row.unit}
                      </td>
                    </tr>
                ))}
              </tbody>
              {summary && (
                <tfoot>
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                    <td colSpan={3} style={{ padding: '11px 14px', textAlign: 'left', color: '#0f172a', fontSize: '0.8rem' }}>
                      TOTAL ({summary.totalProducts} Produk)
                    </td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#0f172a' }}>
                      {summary.totalInitialStock}
                    </td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#15803d' }}>
                      +{summary.totalQtyIn}
                    </td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#1d4ed8' }}>
                      -{summary.totalQtyOut}
                    </td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#b45309' }}>
                      {summary.totalDiscountedQtyOut}
                    </td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#dc2626' }}>
                      -{summary.totalDestroyedQty}
                    </td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#c2410c' }}>
                      -{summary.totalReturnedQty}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', background: '#f0fdf4', color: '#166534' }}>
                      {summary.totalFinalStock}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile Stock Cards */}
          <div className="rep-mobile-only" style={{ padding: '10px 12px' }}>
            {reportData.items.map((row) => (
              <div key={row.productId} className="rep-mcard">
                <div className="rep-mcard__top">
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.84rem', color: '#0f172a' }}>{row.productName}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{row.categoryName}</div>
                  </div>
                  <span style={{ padding: '3px 9px', borderRadius: 99, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', fontWeight: 800, fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
                    Akhir: {row.finalStock} {row.unit}
                  </span>
                </div>
                <div className="rep-mcard__grid rep-mcard__grid--4">
                  <div>
                    <div className="rep-mcard__k">Awal</div>
                    <div className="rep-mcard__v">{row.initialStock}</div>
                  </div>
                  <div>
                    <div className="rep-mcard__k">Masuk</div>
                    <div className="rep-mcard__v" style={{ color: row.qtyIn > 0 ? '#15803d' : '#94a3b8' }}>
                      {row.qtyIn > 0 ? `+${row.qtyIn}` : '0'}
                    </div>
                  </div>
                  <div>
                    <div className="rep-mcard__k">Terjual</div>
                    <div className="rep-mcard__v" style={{ color: row.qtyOut > 0 ? '#1d4ed8' : '#94a3b8' }}>
                      {row.qtyOut > 0 ? `-${row.qtyOut}` : '0'}
                    </div>
                  </div>
                  <div>
                    <div className="rep-mcard__k">Musnah/Retur</div>
                    <div className="rep-mcard__v" style={{ color: row.qtyDestroyed + row.qtyReturned > 0 ? '#dc2626' : '#94a3b8' }}>
                      {row.qtyDestroyed + row.qtyReturned > 0 ? `-${row.qtyDestroyed + row.qtyReturned}` : '0'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
