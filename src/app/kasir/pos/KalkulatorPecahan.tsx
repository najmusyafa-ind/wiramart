'use client';

import React, { useState, useEffect } from 'react';
import { Banknote, Coins, RotateCcw } from 'lucide-react';

export type DenominasiMap = {
  // Lembar
  '100000'?: number;
  '50000'?: number;
  '20000'?: number;
  '10000'?: number;
  '5000'?: number;
  '2000'?: number;
  '1000'?: number;
  // Koin
  'koin1000'?: number;
  'koin500'?: number;
  'koin200'?: number;
  'koin100'?: number;
  [key: string]: number | undefined;
};

interface KalkulatorPecahanProps {
  initialBreakdown?: DenominasiMap;
  onChange: (total: number, breakdown: DenominasiMap) => void;
}

const PECAHAN_LEMBAR = [
  { key: '100000', label: 'Rp 100.000', value: 100_000, color: 'hsl(348, 83%, 47%)' },
  { key: '50000',  label: 'Rp 50.000',  value: 50_000,  color: 'hsl(217, 91%, 45%)' },
  { key: '20000',  label: 'Rp 20.000',  value: 20_000,  color: 'hsl(142, 71%, 38%)' },
  { key: '10000',  label: 'Rp 10.000',  value: 10_000,  color: 'hsl(271, 76%, 45%)' },
  { key: '5000',   label: 'Rp 5.000',   value: 5_000,   color: 'hsl(32, 95%, 44%)' },
  { key: '2000',   label: 'Rp 2.000',   value: 2_000,   color: 'hsl(180, 55%, 38%)' },
  { key: '1000',   label: 'Rp 1.000',   value: 1_000,   color: 'hsl(45, 80%, 40%)' },
];

const PECAHAN_KOIN = [
  { key: 'koin1000', label: 'Rp 1.000 (Koin)', value: 1_000 },
  { key: 'koin500',  label: 'Rp 500 (Koin)',   value: 500 },
  { key: 'koin200',  label: 'Rp 200 (Koin)',   value: 200 },
  { key: 'koin100',  label: 'Rp 100 (Koin)',   value: 100 },
];

export default function KalkulatorPecahan({
  initialBreakdown = {},
  onChange,
}: KalkulatorPecahanProps) {
  const [counts, setCounts] = useState<DenominasiMap>(initialBreakdown);

  // Hitung total nilai nominal
  const total = React.useMemo(() => {
    let sum = 0;
    for (const item of PECAHAN_LEMBAR) {
      const qty = counts[item.key] ?? 0;
      sum += qty * item.value;
    }
    for (const item of PECAHAN_KOIN) {
      const qty = counts[item.key] ?? 0;
      sum += qty * item.value;
    }
    return sum;
  }, [counts]);

  useEffect(() => {
    onChange(total, counts);
  }, [total, counts, onChange]);

  function handleCountChange(key: string, val: string) {
    const parsed = parseInt(val.replace(/\D/g, ''), 10);
    const qty = isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 9999));
    setCounts((prev) => ({
      ...prev,
      [key]: qty,
    }));
  }

  function handleQuickStep(key: string, delta: number) {
    setCounts((prev) => {
      const current = prev[key] ?? 0;
      const next = Math.max(0, Math.min(current + delta, 9999));
      return { ...prev, [key]: next };
    });
  }

  function handleReset() {
    setCounts({});
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header Total Ringkasan */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'hsl(142 76% 95%)',
          border: '1px solid hsl(142 70% 80%)',
        }}
      >
        <div>
          <div style={{ fontSize: '0.72rem', color: 'hsl(142 60% 30%)', fontWeight: 600 }}>
            Total Uang Fisik Terhitung:
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'hsl(142 70% 25%)',
            }}
          >
            Rp {total.toLocaleString('id-ID')}
          </div>
        </div>
        {total > 0 && (
          <button
            type="button"
            onClick={handleReset}
            className="btn btn-secondary btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.72rem',
              padding: '4px 8px',
            }}
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      {/* Bagian Uang Kertas */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.78rem',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
          }}
        >
          <Banknote size={15} style={{ color: 'var(--color-primary)' }} />
          <span>Uang Kertas (Lembar)</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PECAHAN_LEMBAR.map((item) => {
            const qty = counts[item.key] ?? 0;
            const subtotal = qty * item.value;
            return (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-elevated)',
                  border: qty > 0 ? `1.5px solid ${item.color}` : '1px solid var(--color-border)',
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 90 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: item.color }}>
                    {item.label}
                  </div>
                  {qty > 0 && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                      = Rp {subtotal.toLocaleString('id-ID')}
                    </div>
                  )}
                </div>

                {/* Counter Control */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => handleQuickStep(item.key, -1)}
                    disabled={qty <= 0}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: qty <= 0 ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      opacity: qty <= 0 ? 0.4 : 1,
                    }}
                  >
                    -
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={qty === 0 ? '' : qty.toString()}
                    placeholder="0"
                    onChange={(e) => handleCountChange(item.key, e.target.value)}
                    style={{
                      width: 48,
                      height: 28,
                      textAlign: 'center',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickStep(item.key, 1)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickStep(item.key, 5)}
                    style={{
                      height: 28,
                      padding: '0 6px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: 'pointer',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                    }}
                  >
                    +5
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bagian Uang Logam (Koin) */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.78rem',
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
            marginTop: 4,
          }}
        >
          <Coins size={15} style={{ color: 'hsl(38 95% 45%)' }} />
          <span>Uang Logam / Koin (Keping)</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {PECAHAN_KOIN.map((item) => {
            const qty = counts[item.key] ?? 0;
            return (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-elevated)',
                  border: qty > 0 ? '1.5px solid hsl(38 90% 50%)' : '1px solid var(--color-border)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{item.label}</span>
                  {qty > 0 && (
                    <span style={{ fontSize: '0.68rem', color: 'hsl(38 80% 35%)', fontWeight: 600 }}>
                      Rp {(qty * item.value).toLocaleString('id-ID')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => handleQuickStep(item.key, -1)}
                    disabled={qty <= 0}
                    style={{
                      flex: 1,
                      height: 26,
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: qty <= 0 ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      opacity: qty <= 0 ? 0.4 : 1,
                    }}
                  >
                    -
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={qty === 0 ? '' : qty.toString()}
                    placeholder="0"
                    onChange={(e) => handleCountChange(item.key, e.target.value)}
                    style={{
                      width: 44,
                      height: 26,
                      textAlign: 'center',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickStep(item.key, 1)}
                    style={{
                      flex: 1,
                      height: 26,
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
