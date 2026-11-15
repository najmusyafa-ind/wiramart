'use client';

import { useState } from 'react';
import { CheckSquare, Download, Loader2, X } from 'lucide-react';

export type SelectedMetricTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface SelectedMetric {
  label: string;
  value: string;
  tone?: SelectedMetricTone;
}

export interface SelectedRowsBarProps {
  selectedCount: number;
  itemLabel?: string;
  metrics: readonly SelectedMetric[];
  onExportExcel: () => Promise<void> | void;
  onClear: () => void;
  exportLabel?: string;
  disabled?: boolean;
}

const TONE_COLOR: Record<SelectedMetricTone, string> = {
  default: 'var(--color-text-primary)',
  primary: 'hsl(152 68% 30%)',
  success: 'hsl(142 70% 30%)',
  warning: 'hsl(32 85% 34%)',
  danger: 'hsl(0 68% 42%)',
  info: 'hsl(214 78% 40%)',
};

/**
 * Checkbox header "Pilih Semua" dengan dukungan status indeterminate (sebagian dipilih).
 */
export function SelectAllCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel = 'Pilih semua baris terlihat',
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        width: 16,
        height: 16,
        cursor: disabled ? 'not-allowed' : 'pointer',
        accentColor: 'var(--color-primary)',
        verticalAlign: 'middle',
      }}
    />
  );
}

/**
 * Floating/sticky summary dock yang menghitung subtotal baris tercentang secara real-time
 * serta menyediakan aksi Reset Centang & Unduh Excel Baris Terpilih (.xlsx).
 */
export function SelectedRowsBar({
  selectedCount,
  itemLabel = 'baris',
  metrics,
  onExportExcel,
  onClear,
  exportLabel = 'Unduh Excel Baris Terpilih (.xlsx)',
  disabled = false,
}: SelectedRowsBarProps) {
  const [exporting, setExporting] = useState(false);

  if (selectedCount <= 0) return null;

  async function handleExportClick(): Promise<void> {
    if (exporting || disabled) return;
    setExporting(true);
    try {
      await onExportExcel();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={`Ringkasan ${selectedCount} ${itemLabel} terpilih`}
      style={{
        position: 'sticky',
        bottom: 14,
        zIndex: 25,
        marginTop: 12,
        padding: '12px 16px',
        background: 'var(--color-surface)',
        border: '1.5px solid hsl(152 60% 38% / 0.45)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 10px 28px -6px rgba(15, 23, 42, 0.16), 0 0 0 3px hsl(152 60% 42% / 0.1)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px 16px',
        transition:
          'box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Left: Selected count badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="badge badge-success"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            fontSize: '0.8rem',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <CheckSquare size={14} />
          {selectedCount} {itemLabel} dicentang
        </span>
      </div>

      {/* Center: Live Subtotal Metrics */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 18px',
          flex: '1 1 280px',
        }}
      >
        {metrics.map((m) => (
          <div
            key={m.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 96,
            }}
          >
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--color-text-muted)',
              }}
            >
              {m.label}
            </span>
            <span
              style={{
                fontSize: '0.92rem',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                color: TONE_COLOR[m.tone ?? 'default'],
              }}
            >
              {m.value}
            </span>
          </div>
        ))}
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClear}
          disabled={exporting}
          style={{ minHeight: 36, fontSize: '0.78rem' }}
        >
          <X size={14} /> Bersihkan
        </button>

        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleExportClick}
          disabled={exporting || disabled}
          style={{ minHeight: 36, fontSize: '0.8rem' }}
        >
          {exporting ? (
            <>
              <Loader2 size={14} className="spin-icon" /> Menyiapkan Excel...
            </>
          ) : (
            <>
              <Download size={14} /> {exportLabel}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

