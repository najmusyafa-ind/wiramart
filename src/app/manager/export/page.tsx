'use client';

import { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  ShoppingCart,
  Package,
  Users,
  Clock,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Info,
  BarChart3,
  FileText,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
type ExportType = 'sales_report' | 'full' | 'transactions' | 'products' | 'employees';
type ExportPeriodPreset =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'october'
  | 'november'
  | 'oct_nov'
  | 'all';

type ExportOption = {
  type: ExportType;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  sheets: string[];
  featured?: boolean;
  badgeText?: string;
  supportsPeriod: boolean;
};

type PresetOption = {
  key: ExportPeriodPreset;
  label: string;
  hint: string;
  highlight?: boolean;
};

const EXPORT_MAX_ROWS_LABEL = '10.000';

const PERIOD_PRESETS: readonly PresetOption[] = [
  { key: 'monthly', label: 'Bulan Ini', hint: 'Awal bulan s/d hari ini' },
  { key: 'october', label: 'Oktober', hint: '01 Okt – 31 Okt', highlight: true },
  { key: 'november', label: 'November', hint: '01 Nov – 30 Nov', highlight: true },
  { key: 'oct_nov', label: 'Oktober + November', hint: '01 Okt – 30 Nov', highlight: true },
  { key: 'all', label: 'Keseluruhan', hint: 'Seluruh riwayat tercatat', highlight: true },
  { key: 'weekly', label: 'Minggu Ini', hint: '7 hari terakhir' },
  { key: 'daily', label: 'Hari Ini', hint: 'Tanggal WIB hari ini' },
];

const EXPORT_OPTIONS: ExportOption[] = [
  {
    type: 'sales_report',
    label: 'Laporan Penjualan & Keuangan',
    desc: 'Laporan hasil lengkap siap cetak: ringkasan omzet, HPP, laba kotor/bersih, bagi hasil 50-50, rekap bulanan/harian, per-kasir & per-jam, produk terlaris, audit shift, detail transaksi, serta biaya operasional dengan formula =SUM().',
    icon: <BarChart3 size={22} />,
    color: 'hsl(152 68% 36%)',
    sheets: [
      'Ringkasan Hasil',
      'Rekap Bulanan & Harian',
      'Rekap Per Kasir & Jam',
      'Produk Terlaris & Laba',
      'Audit Shift & Kas Gerak',
      'Detail Transaksi',
      'Biaya Operasional',
    ],
    featured: true,
    badgeText: 'Utama · Siap Lapor',
    supportsPeriod: true,
  },
  {
    type: 'full',
    label: 'Backup Lengkap',
    desc: 'Arsip mentah semua data + lembar ringkasan hasil & formula =SUM: transaksi, detail item, produk, karyawan, shift, dan stok.',
    icon: <FileSpreadsheet size={22} />,
    color: 'hsl(220 80% 54%)',
    sheets: [
      'INFO & Ringkasan',
      'Transaksi',
      'Detail Item',
      'Produk',
      'Karyawan',
      'Histori Shift',
      'Penyesuaian Stok',
    ],
    supportsPeriod: true,
  },
  {
    type: 'transactions',
    label: 'Transaksi',
    desc: 'Riwayat penjualan terfilter periode beserta ringkasan hasil, detail item, HPP, dan laba kotor.',
    icon: <ShoppingCart size={22} />,
    color: 'hsl(142 68% 40%)',
    sheets: ['INFO & Ringkasan', 'Transaksi', 'Detail Item Transaksi'],
    supportsPeriod: true,
  },
  {
    type: 'products',
    label: 'Produk',
    desc: 'Daftar produk aktif beserta nilai persediaan (HPP), potensi jual, margin rata-rata, dan stok.',
    icon: <Package size={22} />,
    color: 'hsl(38 90% 48%)',
    sheets: ['INFO & Ringkasan', 'Produk'],
    supportsPeriod: false,
  },
  {
    type: 'employees',
    label: 'Karyawan',
    desc: 'Data karyawan aktif & historis: NIM, program studi, jabatan, dan status aktif.',
    icon: <Users size={22} />,
    color: 'hsl(280 65% 55%)',
    sheets: ['INFO & Ringkasan', 'Karyawan'],
    supportsPeriod: false,
  },
];

function getTodayWibClient(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ─── Period & Date Range Selector ─────────────────────────────
function PeriodFilterPanel({
  selectedPreset,
  dateFrom,
  dateTo,
  onSelectPreset,
  onFromChange,
  onToChange,
  onClearCustomDates,
  disabled,
}: {
  selectedPreset: ExportPeriodPreset | null;
  dateFrom: string;
  dateTo: string;
  onSelectPreset: (preset: ExportPeriodPreset) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onClearCustomDates: () => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '16px',
        background: 'hsl(210 100% 60% / 0.05)',
        border: '1px solid hsl(210 80% 55% / 0.22)',
        borderRadius: 'var(--radius-lg)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {/* Quick Presets */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'hsl(210 80% 45%)',
            fontWeight: 700,
            fontSize: '0.8rem',
            marginBottom: 8,
          }}
        >
          <Calendar size={15} />
          Pilih Preset Periode Cepat
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PERIOD_PRESETS.map((p) => {
            const active = selectedPreset === p.key && !dateFrom && !dateTo;
            return (
              <button
                key={p.key}
                type="button"
                id={`export-preset-${p.key}`}
                disabled={disabled}
                onClick={() => onSelectPreset(p.key)}
                title={p.hint}
                className={active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                style={{
                  minHeight: 36,
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  borderColor: active
                    ? undefined
                    : p.highlight
                      ? 'hsl(152 55% 40% / 0.45)'
                      : 'var(--color-border)',
                  color: active ? undefined : p.highlight ? 'hsl(152 65% 32%)' : 'var(--color-text-primary)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Date Range */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          paddingTop: 10,
          borderTop: '1px dashed hsl(210 50% 55% / 0.25)',
        }}
      >
        <div
          style={{
            fontSize: '0.78rem',
            color: 'var(--color-text-secondary)',
            fontWeight: 600,
            alignSelf: 'center',
            minWidth: 165,
          }}
        >
          Atau Rentang Tanggal Kustom:
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label
              htmlFor="export-date-from"
              style={{
                display: 'block',
                fontSize: '0.72rem',
                color: 'var(--color-text-muted)',
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              DARI
            </label>
            <input
              id="export-date-from"
              type="date"
              className="form-input"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => onFromChange(e.target.value)}
              disabled={disabled}
              style={{
                padding: '8px 12px',
                fontSize: '0.875rem',
                cursor: disabled ? 'not-allowed' : 'auto',
              }}
            />
          </div>
          <span
            style={{
              color: 'var(--color-text-muted)',
              paddingBottom: 10,
              fontSize: '0.8rem',
            }}
          >
            s/d
          </span>
          <div>
            <label
              htmlFor="export-date-to"
              style={{
                display: 'block',
                fontSize: '0.72rem',
                color: 'var(--color-text-muted)',
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              SAMPAI
            </label>
            <input
              id="export-date-to"
              type="date"
              className="form-input"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => onToChange(e.target.value)}
              disabled={disabled}
              style={{
                padding: '8px 12px',
                fontSize: '0.875rem',
                cursor: disabled ? 'not-allowed' : 'auto',
              }}
            />
          </div>
          {(dateFrom || dateTo) && !disabled && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClearCustomDates}
              style={{ minHeight: 38, fontSize: '0.8rem' }}
            >
              Reset Tanggal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Export Card ─────────────────────────────────────────────
function ExportCard({
  option,
  selected,
  onSelect,
}: {
  option: ExportOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      id={`export-type-${option.type}`}
      className="card-clickable"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: option.featured ? '20px 22px' : '18px 20px',
        gridColumn: option.featured ? '1 / -1' : undefined,
        background: selected ? 'var(--color-primary-light)' : 'var(--color-surface)',
        border: `2px solid ${selected ? option.color : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-xl)',
        cursor: 'pointer',
        textAlign: 'left',
        transition:
          'border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: selected ? 'var(--shadow-md)' : 'none',
      }}
      aria-pressed={selected}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-lg)',
              background: selected ? option.color : 'var(--color-surface-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: selected ? '#fff' : option.color,
              flexShrink: 0,
              transition:
                'background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), color 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {option.icon}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--color-text-primary)' }}>
                {option.label}
              </span>
              {option.badgeText && (
                <span className="badge badge-success" style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                  {option.badgeText}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.45 }}>
              {option.desc}
            </div>
          </div>
        </div>
      </div>

      {/* Sheet list */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {option.sheets.map((s) => (
          <span
            key={s}
            style={{
              fontSize: '0.69rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '999px',
              background: selected ? 'var(--color-surface)' : 'var(--color-surface-muted)',
              color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              border: `1px solid ${selected ? option.color : 'transparent'}`,
            }}
          >
            {s}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function ExportPage() {
  const [selectedType, setSelectedType] = useState<ExportType>('sales_report');
  const [selectedPreset, setSelectedPreset] = useState<ExportPeriodPreset | null>('monthly');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHarian, setLoadingHarian] = useState(false);
  const [lastExport, setLastExport] = useState<{
    type: string;
    at: string;
    filename: string;
    truncated?: string;
    maxRows?: string;
  } | null>(null);
  const [error, setError] = useState('');

  const selectedOption = EXPORT_OPTIONS.find((o) => o.type === selectedType) ?? EXPORT_OPTIONS[0];
  const isCustomRange = Boolean(dateFrom || dateTo);
  const activePresetLabel = isCustomRange
    ? `${dateFrom || '...'} s/d ${dateTo || '...'}`
    : PERIOD_PRESETS.find((p) => p.key === selectedPreset)?.label ?? 'Bulan Ini';

  function buildPeriodParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (dateFrom || dateTo) {
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
    } else if (selectedPreset) {
      params.set('period', selectedPreset);
    }
    return params;
  }

  async function downloadExcelFromEndpoint(
    url: string,
    label: string,
    fallbackPrefix: string,
  ): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? `Export gagal (${res.status})`);
      return;
    }

    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match?.[1] ?? `${fallbackPrefix}-${getTodayWibClient()}.xlsx`;
    const truncated = (res.headers.get('X-Export-Truncated') ?? '').trim();
    const maxRows = (res.headers.get('X-Export-Max-Rows') ?? EXPORT_MAX_ROWS_LABEL).trim();

    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);

    setLastExport({
      type: label,
      filename,
      at: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      truncated: truncated || undefined,
      maxRows,
    });
  }

  async function handleExport(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const params = selectedOption.supportsPeriod ? buildPeriodParams() : new URLSearchParams();
      params.set('type', selectedType);
      await downloadExcelFromEndpoint(
        `/api/admin/export?${params.toString()}`,
        selectedOption.label,
        `smartkasir-${selectedType}`,
      );
    } catch {
      setError('Kesalahan jaringan saat mengunduh file Excel. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  async function handleExportHarian(): Promise<void> {
    setLoadingHarian(true);
    setError('');
    try {
      const params = buildPeriodParams();
      await downloadExcelFromEndpoint(
        `/api/admin/export/harian?${params.toString()}`,
        'Skema Harian 1-Sheet',
        'skema-harian-wiramart',
      );
    } catch {
      setError('Kesalahan jaringan saat mengunduh Skema Harian. Silakan coba lagi.');
    } finally {
      setLoadingHarian(false);
    }
  }

  function handleSelectPreset(preset: ExportPeriodPreset): void {
    setSelectedPreset(preset);
    setDateFrom('');
    setDateTo('');
  }

  function handleDateFromChange(v: string): void {
    setDateFrom(v);
    if (v) setSelectedPreset(null);
    else if (!dateTo) setSelectedPreset('monthly');
  }

  function handleDateToChange(v: string): void {
    setDateTo(v);
    if (v) setSelectedPreset(null);
    else if (!dateFrom) setSelectedPreset('monthly');
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 920 }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-lg)',
              background: 'hsl(152 68% 36% / 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'hsl(152 68% 36%)',
            }}
          >
            <Download size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>
              Export Data &amp; Laporan Excel
            </h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Unduh laporan penjualan siap lapor lengkap dengan hasil &amp; formula, atau arsip backup Wiramart (.xlsx)
            </p>
          </div>
        </div>

        {/* Info notice */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '10px 14px',
            background: 'hsl(210 100% 60% / 0.06)',
            border: '1px solid hsl(210 80% 60% / 0.2)',
            borderRadius: 'var(--radius-lg)',
            fontSize: '0.8rem',
            color: 'var(--color-text-secondary)',
            marginTop: 'var(--space-3)',
          }}
        >
          <Info size={15} style={{ color: 'hsl(210 80% 50%)', flexShrink: 0, marginTop: 2 }} />
          <span>
            Kapasitas ekspor ditingkatkan hingga <strong>{EXPORT_MAX_ROWS_LABEL} baris</strong> per sheet dengan filter waktu{' '}
            <strong>WIB</strong> &amp; formula Excel <code>=SUM()</code> / <code>=SUMIFS()</code> asli. File bersifat{' '}
            <strong>rahasia</strong> — gunakan sesuai wewenang pengelola.
          </span>
        </div>
      </div>

      {/* 1 — Pilih tipe export */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          1 — Pilih Tipe Export
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {EXPORT_OPTIONS.map((opt) => (
            <ExportCard
              key={opt.type}
              option={opt}
              selected={selectedType === opt.type}
              onSelect={() => setSelectedType(opt.type)}
            />
          ))}
        </div>
      </div>

      {/* 2 — Filter Periode */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          2 — Filter Periode
          {!selectedOption.supportsPeriod && (
            <span
              style={{
                fontWeight: 400,
                textTransform: 'none',
                fontSize: '0.78rem',
                color: 'var(--color-text-muted)',
                marginLeft: 8,
              }}
            >
              (hanya berlaku untuk Laporan Penjualan, Backup Lengkap, dan Transaksi)
            </span>
          )}
        </div>
        <PeriodFilterPanel
          selectedPreset={selectedPreset}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onSelectPreset={handleSelectPreset}
          onFromChange={handleDateFromChange}
          onToChange={handleDateToChange}
          onClearCustomDates={() => {
            setDateFrom('');
            setDateTo('');
            setSelectedPreset('monthly');
          }}
          disabled={!selectedOption.supportsPeriod}
        />
      </div>

      {/* 3 — Download */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          3 — Download
        </div>

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: 10,
              padding: '12px 16px',
              background: 'hsl(0 70% 55% / 0.1)',
              border: '1px solid hsl(0 70% 55% / 0.3)',
              borderRadius: 'var(--radius-lg)',
              color: 'hsl(0 65% 45%)',
              fontSize: '0.85rem',
              marginBottom: 'var(--space-3)',
              alignItems: 'center',
            }}
          >
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        {lastExport && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 'var(--space-3)',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 10,
                padding: '12px 16px',
                background: 'hsl(142 70% 45% / 0.08)',
                border: '1px solid hsl(142 70% 45% / 0.3)',
                borderRadius: 'var(--radius-lg)',
                color: 'hsl(142 65% 32%)',
                fontSize: '0.82rem',
                alignItems: 'center',
              }}
            >
              <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
              <span>
                <strong>{lastExport.type}</strong> (<code>{lastExport.filename}</code>) berhasil diunduh pada{' '}
                {lastExport.at}.
              </span>
            </div>

            {lastExport.truncated && (
              <div
                role="status"
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '12px 16px',
                  background: 'hsl(38 92% 50% / 0.1)',
                  border: '1px solid hsl(38 92% 45% / 0.35)',
                  borderRadius: 'var(--radius-lg)',
                  color: 'hsl(32 80% 30%)',
                  fontSize: '0.82rem',
                  alignItems: 'center',
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>
                  Peringatan kapasitas: sheet <strong>{lastExport.truncated}</strong> melebihi batas{' '}
                  <strong>{EXPORT_MAX_ROWS_LABEL} baris</strong> sehingga terpotong. Persempit rentang periode (misal
                  ekspor terpisah <strong>Oktober</strong> &amp; <strong>November</strong>) untuk data lengkap.
                </span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            id="btn-download-export"
            onClick={handleExport}
            disabled={loading || loadingHarian}
            className="btn btn-lg"
            style={{
              background: loading ? 'var(--color-surface-muted)' : selectedOption.color,
              color: loading ? 'var(--color-text-muted)' : '#fff',
              boxShadow: loading ? 'none' : 'var(--shadow-primary)',
              minWidth: 260,
              cursor: loading || loadingHarian ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spin-icon" /> Menyiapkan Excel...
              </>
            ) : (
              <>
                <Download size={18} /> Unduh {selectedOption.label} (.xlsx)
              </>
            )}
          </button>

          {selectedType === 'sales_report' && (
            <button
              type="button"
              id="btn-download-export-harian"
              onClick={handleExportHarian}
              disabled={loading || loadingHarian}
              className="btn btn-secondary btn-lg"
              style={{
                cursor: loading || loadingHarian ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingHarian ? (
                <>
                  <Loader2 size={17} className="spin-icon" /> Menyiapkan 1-Sheet...
                </>
              ) : (
                <>
                  <FileText size={17} /> Unduh Skema Harian 1-Sheet (.xlsx)
                </>
              )}
            </button>
          )}
        </div>

        <p style={{ margin: '10px 0 0', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
          Format: Excel (.xlsx) · Encoding: UTF-8 · Max: {EXPORT_MAX_ROWS_LABEL} baris/sheet
          {selectedOption.supportsPeriod && ` · Periode aktif: ${activePresetLabel}`}
        </p>
      </div>

      {/* Divider info */}
      <div
        style={{
          padding: '16px 20px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          fontSize: '0.8rem',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />
          Panduan Jenis File Export
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px 24px' }}>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              📊 Laporan Penjualan &amp; Keuangan (7 Sheet)
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <li>Ringkasan hasil omzet, HPP, laba bersih &amp; bagi hasil 50-50</li>
              <li>Rekap bulanan, harian, per-kasir &amp; per-jam (WIB)</li>
              <li>Formula =SUM() / =SUMIFS() siap audit &amp; presentasi</li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              📁 Backup Arsip Data (Hingga {EXPORT_MAX_ROWS_LABEL} baris/sheet)
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <li>Backup Lengkap, Transaksi, Produk, &amp; Karyawan dengan ringkasan cover</li>
              <li>Filter tanggal WIB mencakup Transaksi, Detail Item, Shift &amp; Koreksi Stok</li>
              <li>Aman dari formula injection &amp; mengecualikan transaksi dummy/test</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
