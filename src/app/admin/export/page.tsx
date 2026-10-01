'use client';

import { useState } from 'react';
import {
  Download, FileSpreadsheet, ShoppingCart, Package,
  Users, Clock, Loader2, CheckCircle2, AlertTriangle,
  Calendar, ChevronRight, Info,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
type ExportType = 'full' | 'transactions' | 'products' | 'employees';

type ExportOption = {
  type: ExportType;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  sheets: string[];
};

const EXPORT_OPTIONS: ExportOption[] = [
  {
    type: 'full',
    label: 'Backup Lengkap',
    desc: 'Semua data: transaksi, produk, karyawan, shift, penyesuaian stok.',
    icon: <FileSpreadsheet size={22} />,
    color: 'hsl(220 80% 60%)',
    sheets: ['INFO', 'Transaksi', 'Detail Item', 'Produk', 'Karyawan', 'Histori Shift', 'Penyesuaian Stok'],
  },
  {
    type: 'transactions',
    label: 'Transaksi',
    desc: 'Riwayat penjualan dengan detail item, HPP, dan laba kotor.',
    icon: <ShoppingCart size={22} />,
    color: 'hsl(142 70% 45%)',
    sheets: ['INFO', 'Transaksi', 'Detail Item Transaksi'],
  },
  {
    type: 'products',
    label: 'Produk',
    desc: 'Daftar semua produk aktif beserta HPP, harga jual, dan stok.',
    icon: <Package size={22} />,
    color: 'hsl(38 90% 55%)',
    sheets: ['INFO', 'Produk'],
  },
  {
    type: 'employees',
    label: 'Karyawan',
    desc: 'Data karyawan aktif: NIM, program studi, jabatan.',
    icon: <Users size={22} />,
    color: 'hsl(280 70% 65%)',
    sheets: ['INFO', 'Karyawan'],
  },
];

// ─── Date Range Picker Row ────────────────────────────────────
function DateRangeRow({
  dateFrom, dateTo,
  onFromChange, onToChange,
  disabled,
}: {
  dateFrom: string; dateTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap',
      padding: '14px 16px',
      background: 'hsl(210 100% 60% / 0.06)',
      border: '1px solid hsl(210 80% 60% / 0.2)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'hsl(210 80% 55%)', fontWeight: 600, fontSize: '0.82rem', flexShrink: 0 }}>
        <Calendar size={15} /> Filter Tanggal <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(opsional, khusus transaksi)</span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600 }}>DARI</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => onFromChange(e.target.value)}
            disabled={disabled}
            style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: '0.875rem', cursor: disabled ? 'not-allowed' : 'auto' }}
          />
        </div>
        <span style={{ color: 'var(--color-text-muted)', alignSelf: 'flex-end', paddingBottom: 10, fontSize: '0.8rem' }}>s/d</span>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600 }}>SAMPAI</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => onToChange(e.target.value)}
            disabled={disabled}
            style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: '0.875rem', cursor: disabled ? 'not-allowed' : 'auto' }}
          />
        </div>
        {(dateFrom || dateTo) && !disabled && (
          <button
            onClick={() => { onFromChange(''); onToChange(''); }}
            style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8rem', alignSelf: 'flex-end' }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Export Card ─────────────────────────────────────────────
function ExportCard({
  option, selected, onSelect,
}: {
  option: ExportOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      id={`export-type-${option.type}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '20px',
        background: selected ? `${option.color}10` : 'var(--color-surface)',
        border: `2px solid ${selected ? option.color : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-xl)',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: selected ? `0 0 0 4px ${option.color}18` : 'none',
      }}
      aria-pressed={selected}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-lg)',
          background: `${option.color}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: option.color, flexShrink: 0,
          transition: 'all 0.15s',
          ...(selected ? { background: option.color, color: '#fff' } : {}),
        }}>
          {option.icon}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>{option.label}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{option.desc}</div>
        </div>
      </div>
      {/* Sheet list */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {option.sheets.map(s => (
          <span key={s} style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px',
            borderRadius: '999px',
            background: selected ? `${option.color}18` : 'var(--color-surface-elevated)',
            color: selected ? option.color : 'var(--color-text-muted)',
            border: `1px solid ${selected ? option.color + '44' : 'transparent'}`,
            transition: 'all 0.15s',
          }}>
            {s}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function ExportPage() {
  const [selectedType, setSelectedType] = useState<ExportType>('full');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [lastExport, setLastExport] = useState<{ type: string; at: string; rows?: number } | null>(null);
  const [error, setError]         = useState('');

  const selectedOption = EXPORT_OPTIONS.find(o => o.type === selectedType)!;

  async function handleExport() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ type: selectedType });
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo)   params.set('dateTo', dateTo);

      const res = await fetch(`/api/admin/export?${params}`);

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? `Export gagal (${res.status})`);
        return;
      }

      // Ambil filename dari header
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const filename = match?.[1] ?? `backup-smartkasir-${selectedType}-${new Date().toISOString().slice(0,10)}.xlsx`;

      // Trigger download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLastExport({
        type: selectedOption.label,
        at: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      });
    } catch {
      setError('Kesalahan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 860 }}>

      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 'var(--radius-lg)',
            background: 'hsl(220 80% 60% / 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'hsl(220 80% 60%)',
          }}>
            <Download size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>
              Export Data
            </h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Unduh backup data Wiramart sebagai file Excel (.xlsx)
            </p>
          </div>
        </div>

        {/* Info notice */}
        <div style={{
          display: 'flex', gap: 10, padding: '10px 14px',
          background: 'hsl(210 100% 60% / 0.06)',
          border: '1px solid hsl(210 80% 60% / 0.2)',
          borderRadius: 'var(--radius-lg)',
          fontSize: '0.8rem', color: 'var(--color-text-secondary)',
          marginTop: 'var(--space-3)',
        }}>
          <Info size={14} style={{ color: 'hsl(210 80% 55%)', flexShrink: 0, marginTop: 2 }} />
          <span>
            Maksimum <strong>5.000 baris</strong> per sheet. File bersifat <strong>rahasia</strong> — jangan disebarkan tanpa izin.
            Export ini berbeda dari Laporan periodik — ini adalah dump arsip mentah.
          </span>
        </div>
      </div>

      {/* Pilih tipe export */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          1 — Pilih Tipe Export
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
          {EXPORT_OPTIONS.map(opt => (
            <ExportCard
              key={opt.type}
              option={opt}
              selected={selectedType === opt.type}
              onSelect={() => setSelectedType(opt.type)}
            />
          ))}
        </div>
      </div>

      {/* Filter tanggal (khusus transaksi) */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          2 — Filter Periode
          {(selectedType !== 'transactions' && selectedType !== 'full') && (
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: 8 }}>
              (hanya berlaku untuk tipe Transaksi dan Backup Lengkap)
            </span>
          )}
        </div>
        <DateRangeRow
          dateFrom={dateFrom} dateTo={dateTo}
          onFromChange={setDateFrom} onToChange={setDateTo}
          disabled={selectedType !== 'transactions' && selectedType !== 'full'}
        />
      </div>

      {/* Download button */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          3 — Download
        </div>

        {error && (
          <div style={{
            display: 'flex', gap: 10, padding: '12px 16px',
            background: 'hsl(0 70% 55% / 0.1)', border: '1px solid hsl(0 70% 55% / 0.3)',
            borderRadius: 'var(--radius-lg)', color: 'hsl(0 70% 65%)',
            fontSize: '0.85rem', marginBottom: 'var(--space-3)', alignItems: 'center',
          }}>
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        {lastExport && (
          <div style={{
            display: 'flex', gap: 10, padding: '12px 16px',
            background: 'hsl(142 70% 45% / 0.08)', border: '1px solid hsl(142 70% 45% / 0.3)',
            borderRadius: 'var(--radius-lg)', color: 'hsl(142 70% 45%)',
            fontSize: '0.82rem', marginBottom: 'var(--space-3)', alignItems: 'center',
          }}>
            <CheckCircle2 size={15} />
            <span>
              <strong>{lastExport.type}</strong> berhasil diunduh pada {lastExport.at}.
            </span>
          </div>
        )}

        <button
          id="btn-download-export"
          onClick={handleExport}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '14px 32px',
            background: loading ? 'var(--color-surface-elevated)' : selectedOption.color,
            border: 'none', borderRadius: 'var(--radius-xl)',
            color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 700, fontSize: '1rem',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: loading ? 'none' : `0 4px 14px ${selectedOption.color}44`,
            minWidth: 240,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading
            ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Menyiapkan file...</>
            : <><Download size={18} /> Unduh {selectedOption.label} (.xlsx)</>}
        </button>

        <p style={{ margin: '10px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          Format: Excel (.xlsx) · Encoding: UTF-8 · Max: 5.000 baris/sheet
          {(dateFrom || dateTo) && ` · Periode: ${dateFrom || '—'} s/d ${dateTo || '—'}`}
        </p>
      </div>

      {/* Divider info */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-xl)',
        fontSize: '0.8rem',
        color: 'var(--color-text-secondary)',
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />
          Perbedaan Export vs Laporan
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>📊 Laporan (Menu Laporan)</div>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <li>Ringkasan periodik (harian/bulanan)</li>
              <li>Grafik penjualan &amp; performa</li>
              <li>Analisis laba kotor</li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>📁 Export Data (Halaman ini)</div>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <li>Dump mentah semua data</li>
              <li>Untuk arsip &amp; backup jangka panjang</li>
              <li>Bisa dibuka di Excel/Sheets</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
