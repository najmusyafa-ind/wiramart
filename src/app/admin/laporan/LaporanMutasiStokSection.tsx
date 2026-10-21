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

  // Ekspor ke CSV
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
              <Boxes size={22} color="#0284c7" />
              Laporan Mutasi Stok Terintegrasi (Gudang &amp; Kasir)
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Rekonsiliasi inventaris stok awal, kiriman supplier yang disetujui, penjualan kasir, obral promo, dan pemusnahan FEFO.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!reportData || reportData.items.length === 0}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Download size={14} /> Unduh CSV
            </button>

            <button
              type="button"
              onClick={() => fetchReport(startDate, endDate)}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#0284c7',
                color: '#ffffff',
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
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', width: 40, textAlign: 'center' }}>No</th>
                  <th style={{ padding: '10px 12px', minWidth: 160 }}>Produk</th>
                  <th style={{ padding: '10px 12px' }}>Kategori</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', background: '#f1f5f9' }}>Stok Awal</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#15803d' }}>Masuk (+)</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#1d4ed8' }}>Keluar Kasir (-)</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#d97706' }}>Obral FEFO</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#dc2626' }}>Musnah (-)</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', color: '#ea580c' }}>Retur (-)</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, background: '#f0fdf4', color: '#166534' }}>
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
                        borderBottom: '1px solid #f1f5f9',
                        background: hasActivity ? '#ffffff' : '#fafafa',
                      }}
                    >
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                        {row.productName}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748b' }}>
                        {row.categoryName}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, background: '#f8fafc', color: '#334155' }}>
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
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
