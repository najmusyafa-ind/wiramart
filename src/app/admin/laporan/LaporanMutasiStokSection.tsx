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
  Tag,
  ArrowUpDown,
  FileSpreadsheet,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils/helpers';
import type {
  ProductMutationRow,
  StockMutationReportResult,
} from '@/lib/services/stockMutationReportService';

export default function LaporanMutasiStokSection() {
  const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [startDate, setStartDate] = useState(todayWib);
  const [endDate, setEndDate] = useState(todayWib);
  const [preset, setPreset] = useState<'today' | '7days' | 'month' | 'custom'>('today');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<StockMutationReportResult | null>(null);

  // Ambil data mutasi stok
  const fetchReport = useCallback(
    async (start: string, end: string, searchQuery = search) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          startDate: start,
          endDate: end,
          ...(searchQuery.trim() && { search: searchQuery.trim() }),
        });

        const res = await fetch(`/api/admin/laporan/mutasi-stok?${params}`);
        const json = await res.json();
        if (res.ok && json.success) {
          setReportData(json.data);
        } else {
          setError(json.error ?? 'Gagal memuat laporan mutasi stok.');
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
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const firstDay = `${year}-${month}-01`;
      setStartDate(firstDay);
      setEndDate(todayStr);
      fetchReport(firstDay, todayStr);
    }
  }

  useEffect(() => {
    fetchReport(startDate, endDate);
  }, []);

  const [exportingExcel, setExportingExcel] = useState(false);

  // ── Ekspor ke Excel (.xlsx) Tabel Hitam Putih Clean (Fase 5.3) ──
  async function handleExportExcel() {
    if (!reportData || reportData.items.length === 0) return;
    setExportingExcel(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Wiramart UNPERBA';
      wb.lastModifiedBy = 'Manager Gudang';
      wb.created = new Date();

      const ws = wb.addWorksheet('Mutasi Stok Gudang', {
        views: [{ showGridLines: true }],
      });

      // ── BARIS 1: Header Utama Perusahaan (Hitam Elegan #18181B) ──
      ws.mergeCells('A1:N1');
      const r1 = ws.getCell('A1');
      r1.value = 'WIRAMART — UKM KEWIRAUSAHAAN UNPERBA';
      r1.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
      r1.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 30;

      // ── BARIS 2: Judul Laporan (Charcoal #27272A) ──
      ws.mergeCells('A2:N2');
      const r2 = ws.getCell('A2');
      r2.value = 'LAPORAN REKONSILIASI MUTASI STOK GUDANG & KASIR';
      r2.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF27272A' } };
      r2.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(2).height = 24;

      // ── BARIS 3: Metadata Periode & Tanggal Cetak ──
      ws.mergeCells('A3:N3');
      const r3 = ws.getCell('A3');
      const nowWib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      r3.value = `Periode: ${startDate} s/d ${endDate}   |   Dicetak: ${nowWib} WIB   |   Persamaan: Stok Akhir = Stok Awal + Masuk - Keluar - Musnah - Retur`;
      r3.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF52525B' } };
      r3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
      r3.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D8' } } };
      r3.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(3).height = 20;

      // Spacer row
      ws.getRow(4).height = 10;

      // ── BARIS 5: Tabel Header Hitam Putih Clean ──
      const headers = [
        'No',
        'Nama Produk',
        'Kategori',
        'Satuan',
        'Stok Awal',
        'Masuk (Supplier)',
        'Nilai HPP Masuk (Rp)',
        'Keluar (Kasir)',
        'Total Bruto Keluar (Rp)',
        'Promo FEFO',
        'Musnah / Basi',
        'Kerugian Musnah (Rp)',
        'Retur Supplier',
        'Stok Akhir',
      ];

      ws.columns = [
        { key: 'no', width: 6 },
        { key: 'productName', width: 36 },
        { key: 'categoryName', width: 16 },
        { key: 'unit', width: 10 },
        { key: 'initialStock', width: 13 },
        { key: 'qtyIn', width: 16 },
        { key: 'totalHppIn', width: 22 },
        { key: 'qtyOut', width: 15 },
        { key: 'totalGrossOut', width: 22 },
        { key: 'discountedQtyOut', width: 13 },
        { key: 'qtyDestroyed', width: 14 },
        { key: 'lossAmountDestroyed', width: 22 },
        { key: 'qtyReturned', width: 14 },
        { key: 'finalStock', width: 14 },
      ];

      const hRow = ws.getRow(5);
      hRow.values = headers;
      hRow.height = 26;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow.eachCell((cell: any) => {
        cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF3F3F46' } },
          right: { style: 'thin', color: { argb: 'FF3F3F46' } },
        };
      });

      // ── BARIS DATA (Hitam Putih Clean dengan Border Tipis) ──
      reportData.items.forEach((it, idx) => {
        const row = ws.addRow({
          no: idx + 1,
          productName: it.productName,
          categoryName: it.categoryName,
          unit: it.unit,
          initialStock: it.initialStock,
          qtyIn: it.qtyIn,
          totalHppIn: it.totalHppIn,
          qtyOut: it.qtyOut,
          totalGrossOut: it.totalGrossOut,
          discountedQtyOut: it.discountedQtyOut,
          qtyDestroyed: it.qtyDestroyed,
          lossAmountDestroyed: it.lossAmountDestroyed,
          qtyReturned: it.qtyReturned,
          finalStock: it.finalStock,
        });

        row.height = 20;
        const isZebra = idx % 2 === 1;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
          cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF18181B' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          };
          if (isZebra) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
          }

          // Alignment & Number format
          if (colNumber === 1 || colNumber === 3 || colNumber === 4) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 2) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          } else if (colNumber === 7 || colNumber === 9 || colNumber === 12) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '"Rp "#,##0';
          } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          }
        });

        // Highlight kolom Stok Akhir
        const finalCell = row.getCell(14);
        finalCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF18181B' } };
      });

      // ── BARIS SUMMARY TOTAL (Standar Akuntansi Double Line) ──
      const s = reportData.summary;
      const totalRow = ws.addRow({
        no: '',
        productName: 'TOTAL MUTASI INVENTARIS',
        categoryName: '',
        unit: '',
        initialStock: s.totalInitialStock,
        qtyIn: s.totalQtyIn,
        totalHppIn: s.totalHppIn,
        qtyOut: s.totalQtyOut,
        totalGrossOut: s.totalGrossOut,
        discountedQtyOut: s.totalDiscountedQtyOut,
        qtyDestroyed: s.totalDestroyedQty,
        lossAmountDestroyed: s.totalLossAmount,
        qtyReturned: s.totalReturnedQty,
        finalStock: s.totalFinalStock,
      });

      totalRow.height = 25;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totalRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF000000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E4E7' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'double', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FFD4D4D8' } },
          right: { style: 'thin', color: { argb: 'FFD4D4D8' } },
        };

        if (colNumber === 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (colNumber === 7 || colNumber === 9 || colNumber === 12) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '"Rp "#,##0';
        } else if (colNumber >= 5) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0';
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Mutasi_Stok_Wiramart_${startDate}_sd_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Gagal mengekspor file Excel mutasi stok.');
    } finally {
      setExportingExcel(false);
    }
  }

  // Ekspor ke CSV Cadangan
  function handleExportCsv() {
    if (!reportData || reportData.items.length === 0) return;

    const headers = [
      'No',
      'Nama Produk',
      'Kategori',
      'Unit',
      'Stok Awal',
      'Masuk (Supplier ACC)',
      'Nilai HPP Masuk (Rp)',
      'Keluar (Kasir)',
      'Total Bruto Keluar (Rp)',
      'Obral Promo FEFO',
      'Musnah/Basi (Write-Off)',
      'Nilai Kerugian Musnah (Rp)',
      'Retur Supplier',
      'Stok Akhir',
    ];

    const rows = reportData.items.map((it, idx) => [
      idx + 1,
      `"${it.productName.replace(/"/g, '""')}"`,
      `"${it.categoryName.replace(/"/g, '""')}"`,
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

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `mutasi_stok_wiramart_${startDate}_sd_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Boxes size={22} color="#0f172a" />
              Laporan Mutasi Stok Terintegrasi (Gudang &amp; Kasir)
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Rekonsiliasi inventaris stok awal, kiriman supplier yang disetujui, penjualan kasir, obral promo, dan pemusnahan FEFO.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!reportData || reportData.items.length === 0 || exportingExcel}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#0f172a',
                color: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: exportingExcel || !reportData || reportData.items.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 2px 6px rgba(15,23,42,0.25)',
              }}
            >
              {exportingExcel ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Membuat Excel...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet size={15} color="#38bdf8" />
                  <span>Unduh Excel (.xlsx)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!reportData || reportData.items.length === 0}
              title="Unduh format teks CSV cadangan"
              style={{
                padding: '8px 12px',
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
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Segarkan
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
          {/* Preset Buttons */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'today', label: 'Hari Ini' },
              { id: '7days', label: '7 Hari Terakhir' },
              { id: 'month', label: 'Bulan Ini' },
            ].map((p) => {
              const active = preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id as 'today' | '7days' | 'month')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 20,
                    fontSize: '0.78rem',
                    fontWeight: active ? 800 : 500,
                    border: active ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background: active ? '#e0f2fe' : '#ffffff',
                    color: active ? '#0369a1' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Date Picker Custom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
            <Calendar size={15} color="#64748b" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPreset('custom');
              }}
              style={{
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: '0.78rem',
              }}
            />
            <span style={{ color: '#94a3b8' }}>s/d</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPreset('custom');
              }}
              style={{
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: '0.78rem',
              }}
            />
            <button
              type="button"
              onClick={() => fetchReport(startDate, endDate)}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Terapkan
            </button>
          </div>

          {/* Search Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: '5px 10px', minWidth: 200 }}>
            <Search size={14} color="#64748b" />
            <input
              type="text"
              placeholder="Cari produk..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fetchReport(startDate, endDate, search);
              }}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.78rem', width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* ── KPI METRICS SUMMARY CARDS ── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {/* Card 1: Barang Masuk */}
          <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #bbf7d0', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase' }}>
                Barang Masuk (ACC)
              </span>
              <PackageCheck size={18} color="#15803d" />
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#15803d', marginTop: 4 }}>
              +{summary.totalQtyIn} <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>pcs</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
              Total Nilai HPP: <strong style={{ color: '#0f172a' }}>{formatRupiah(summary.totalHppIn)}</strong>
            </div>
          </div>

          {/* Card 2: Terjual di Kasir */}
          <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #bfdbfe', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase' }}>
                Terjual di Kasir
              </span>
              <TrendingUp size={18} color="#2563eb" />
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1d4ed8', marginTop: 4 }}>
              -{summary.totalQtyOut} <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>pcs</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
              Omzet: <strong style={{ color: '#0f172a' }}>{formatRupiah(summary.totalGrossOut)}</strong> ({summary.totalDiscountedQtyOut} pcs obral)
            </div>
          </div>

          {/* Card 3: Kerugian Write-Off (FEFO Basi/Musnah) */}
          <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #fecaca', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#991b1b', textTransform: 'uppercase' }}>
                Kerugian Write-Off
              </span>
              <Trash2 size={18} color="#dc2626" />
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#b91c1c', marginTop: 4 }}>
              -{summary.totalDestroyedQty} <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>pcs</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: 2, fontWeight: 700 }}>
              Nilai Kerugian HPP: {formatRupiah(summary.totalLossAmount)}
            </div>
          </div>

          {/* Card 4: Retur Supplier */}
          <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #fed7aa', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#9a3412', textTransform: 'uppercase' }}>
                Retur ke Supplier
              </span>
              <ArrowUpDown size={18} color="#ea580c" />
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#c2410c', marginTop: 4 }}>
              -{summary.totalReturnedQty} <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>pcs</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
              Total Stok Akhir Toko: <strong style={{ color: '#0f172a' }}>{summary.totalFinalStock} pcs</strong>
            </div>
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
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b' }}>
            Rincian Mutasi Inventaris Per Produk ({reportData?.items.length ?? 0} Produk)
          </span>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Periode: <strong>{startDate}</strong> s/d <strong>{endDate}</strong>
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#18181b', color: '#ffffff', textAlign: 'left', borderBottom: '2px solid #000000' }}>
                  <th style={{ padding: '11px 12px', width: 42, textAlign: 'center', color: '#ffffff', fontWeight: 800 }}>No</th>
                  <th style={{ padding: '11px 12px', minWidth: 170, color: '#ffffff', fontWeight: 800 }}>Produk</th>
                  <th style={{ padding: '11px 12px', color: '#ffffff', fontWeight: 800 }}>Kategori</th>
                  <th style={{ padding: '11px 10px', textAlign: 'center', background: '#27272a', color: '#ffffff', fontWeight: 800 }}>Stok Awal</th>
                  <th style={{ padding: '11px 10px', textAlign: 'center', color: '#86efac', fontWeight: 800 }}>Masuk (+)</th>
                  <th style={{ padding: '11px 10px', textAlign: 'center', color: '#93c5fd', fontWeight: 800 }}>Keluar Kasir (-)</th>
                  <th style={{ padding: '11px 10px', textAlign: 'center', color: '#fcd34d', fontWeight: 800 }}>Obral FEFO</th>
                  <th style={{ padding: '11px 10px', textAlign: 'center', color: '#fca5a5', fontWeight: 800 }}>Musnah (-)</th>
                  <th style={{ padding: '11px 10px', textAlign: 'center', color: '#fdba74', fontWeight: 800 }}>Retur (-)</th>
                  <th style={{ padding: '11px 12px', textAlign: 'center', fontWeight: 900, background: '#27272a', color: '#4ade80' }}>
                    Stok Akhir (=)
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.items.map((row, idx) => {
                  const hasActivity =
                    row.qtyIn > 0 ||
                    row.qtyOut > 0 ||
                    row.qtyDestroyed > 0 ||
                    row.qtyReturned > 0;

                  return (
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
                  );
                })}
              </tbody>
              {summary && (
                <tfoot>
                  <tr style={{ background: '#e4e4e7', borderTop: '2px solid #18181b', borderBottom: '3px double #18181b', fontWeight: 800 }}>
                    <td colSpan={3} style={{ padding: '12px 14px', textAlign: 'left', color: '#09090b', fontSize: '0.82rem' }}>
                      TOTAL SELURUH PRODUK ({summary.totalProducts} Item)
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center', color: '#09090b', fontSize: '0.82rem' }}>
                      {summary.totalInitialStock}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center', color: '#15803d', fontSize: '0.82rem' }}>
                      +{summary.totalQtyIn}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center', color: '#1d4ed8', fontSize: '0.82rem' }}>
                      -{summary.totalQtyOut}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center', color: '#b45309', fontSize: '0.82rem' }}>
                      {summary.totalDiscountedQtyOut} pcs
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center', color: '#dc2626', fontSize: '0.82rem' }}>
                      -{summary.totalDestroyedQty}
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center', color: '#ea580c', fontSize: '0.82rem' }}>
                      -{summary.totalReturnedQty}
                    </td>
                    <td style={{ padding: '12px 12px', textAlign: 'center', background: '#dcfce7', color: '#14532d', fontSize: '0.85rem' }}>
                      {summary.totalFinalStock}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
