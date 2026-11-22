'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  PlusCircle,
  MinusCircle,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Receipt,
  History,
  TrendingDown,
  TrendingUp,
  Clock,
} from 'lucide-react';

interface MovementItem {
  id: string;
  movementType: string;
  category: string;
  amount: string;
  notes: string;
  isGraceCorrection?: boolean;
  createdAt: string;
  employeeId?: string | null;
  employeeName?: string | null;
}

export interface GraceRecalcResult {
  status: string;
  shortageAmount: number;
  expectedCash: number;
  actualCash: number | null;
  discrepancy: number | null;
  graceUntil: string | null;
}

interface KasGerakModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMovementAdded?: (graceUpdate?: GraceRecalcResult | null) => void;
}

interface KasGerakSummaryData {
  movements: MovementItem[];
  totalOut: number;
  totalIn: number;
  isPeerShared: boolean;
  isGraceMode: boolean;
}

type FetchKasGerakResult =
  | { ok: true; data: KasGerakSummaryData }
  | { ok: false; aborted: boolean; error: string };

const CATEGORY_LABELS: Record<string, string> = {
  BAYAR_TITIPAN: 'Bayar Titipan',
  TITIPAN_MAKANAN: 'Bayar Titipan',
  SETORAN_PENGELOLA: 'Diambil Bu Dyah',
  SETORAN_BU_DYAH: 'Diambil Bu Dyah',
  BAYAR_SUPPLIER: 'Bayar Supplier',
  OPERASIONAL: 'Operasional',
  KONSUMSI_GALON: 'Operasional',
  ATK_KRESEK: 'Operasional',
  BENSIN: 'Operasional',
  UANG_TIP: 'Uang Tip',
  TAMBAH_MODAL: 'Tukar Receh',
};

const CATEGORIES_OUT = [
  { value: 'BAYAR_TITIPAN', label: 'Bayar Titipan' },
  { value: 'SETORAN_PENGELOLA', label: 'Diambil Bu Dyah' },
  { value: 'BAYAR_SUPPLIER', label: 'Bayar Supplier' },
  { value: 'OPERASIONAL', label: 'Operasional' },
];

const CATEGORIES_IN = [
  { value: 'UANG_TIP', label: 'Uang Tip' },
  { value: 'TAMBAH_MODAL', label: 'Tukar Receh' },
  { value: 'OPERASIONAL', label: 'Masuk Lainnya' },
];

const QUICK_AMOUNTS = [5_000, 10_000, 20_000, 50_000, 100_000];

async function requestKasGerakSummary(signal?: AbortSignal): Promise<FetchKasGerakResult> {
  try {
    const res = await fetch('/api/kasir/shift/kas-gerak', { cache: 'no-store', signal });
    const json = (await res.json()) as {
      error?: string;
      data?: {
        movements?: MovementItem[];
        totalCashOut?: number;
        totalCashIn?: number;
        isPeerShared?: boolean;
        isGraceMode?: boolean;
      };
    };

    if (!res.ok) {
      return { ok: false, aborted: false, error: json.error ?? 'Gagal memuat Kas Laci.' };
    }

    return {
      ok: true,
      data: {
        movements: json.data?.movements ?? [],
        totalOut: json.data?.totalCashOut ?? 0,
        totalIn: json.data?.totalCashIn ?? 0,
        isPeerShared: Boolean(json.data?.isPeerShared),
        isGraceMode: Boolean(json.data?.isGraceMode),
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, aborted: true, error: '' };
    }
    return { ok: false, aborted: false, error: 'Gagal terhubung ke server.' };
  }
}

export default function KasGerakModal({ isOpen, onClose, onMovementAdded }: KasGerakModalProps) {
  if (!isOpen) return null;
  return <KasLaciBody onClose={onClose} onMovementAdded={onMovementAdded} />;
}

function KasLaciBody({
  onClose,
  onMovementAdded,
}: {
  onClose: () => void;
  onMovementAdded?: (graceUpdate?: GraceRecalcResult | null) => void;
}) {
  const [activeTab, setActiveTab] = useState<'CASH_OUT' | 'CASH_IN'>('CASH_OUT');
  const [category, setCategory] = useState<string>('BAYAR_TITIPAN');
  const [amountInput, setAmountInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [totalOut, setTotalOut] = useState(0);
  const [totalIn, setTotalIn] = useState(0);
  const [isGraceMode, setIsGraceMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      const res = await requestKasGerakSummary(controller.signal);
      if (cancelled) return;
      if (!res.ok) {
        if (!res.aborted) setError(res.error);
      } else {
        setMovements(res.data.movements);
        setTotalOut(res.data.totalOut);
        setTotalIn(res.data.totalIn);
        setIsGraceMode(res.data.isGraceMode);
      }
      setFetchLoading(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  function handleTabChange(tab: 'CASH_OUT' | 'CASH_IN') {
    setActiveTab(tab);
    setCategory(tab === 'CASH_OUT' ? 'BAYAR_TITIPAN' : 'UANG_TIP');
    setError(null);
    setSuccessMsg(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const nominal = parseFloat(amountInput.replace(/\D/g, ''));
    if (isNaN(nominal) || nominal < 100) {
      setError('Masukkan nominal minimal Rp 100.');
      return;
    }
    if (notes.trim().length < 3) {
      setError('Isi catatan minimal 3 huruf.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/kasir/shift/kas-gerak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movementType: activeTab,
          category,
          amount: nominal,
          notes: notes.trim(),
        }),
      });

      const json = (await res.json()) as {
        error?: string;
        data?: { message?: string; graceUpdate?: GraceRecalcResult | null };
      };
      if (!res.ok) {
        setError(json.error ?? 'Gagal menyimpan.');
        return;
      }

      setSuccessMsg(json.data?.message ?? 'Tercatat.');
      setAmountInput('');
      setNotes('');

      const summaryRes = await requestKasGerakSummary();
      if (summaryRes.ok) {
        setMovements(summaryRes.data.movements);
        setTotalOut(summaryRes.data.totalOut);
        setTotalIn(summaryRes.data.totalIn);
        setIsGraceMode(summaryRes.data.isGraceMode);
      }
      if (onMovementAdded) onMovementAdded(json.data?.graceUpdate ?? null);
    } catch {
      setError('Gangguan koneksi. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  const currentCategories = activeTab === 'CASH_OUT' ? CATEGORIES_OUT : CATEGORIES_IN;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kas-laci-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 460,
          maxHeight: '92dvh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt size={18} style={{ color: 'var(--color-primary)' }} />
            <h2 id="kas-laci-title" style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>
              Kas Laci
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: 'none',
              border: 'none',
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              borderRadius: 10,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--color-surface-elevated)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <button
            type="button"
            onClick={() => handleTabChange('CASH_OUT')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: 46,
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              background: activeTab === 'CASH_OUT' ? 'var(--color-surface)' : 'transparent',
              color: activeTab === 'CASH_OUT' ? 'hsl(0 72% 45%)' : 'var(--color-text-muted)',
              borderBottom: activeTab === 'CASH_OUT' ? '2.5px solid hsl(0 72% 45%)' : '2.5px solid transparent',
              cursor: 'pointer',
            }}
          >
            <MinusCircle size={15} />
            Uang Keluar
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('CASH_IN')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: 46,
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              background: activeTab === 'CASH_IN' ? 'var(--color-surface)' : 'transparent',
              color: activeTab === 'CASH_IN' ? 'hsl(145 65% 32%)' : 'var(--color-text-muted)',
              borderBottom: activeTab === 'CASH_IN' ? '2.5px solid hsl(145 65% 32%)' : '2.5px solid transparent',
              cursor: 'pointer',
            }}
          >
            <PlusCircle size={15} />
            Uang Masuk
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Ringkasan Singkat */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                background: 'hsl(0 80% 97%)',
                border: '1px solid hsl(0 70% 88%)',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: 'hsl(0 50% 40%)', fontWeight: 600 }}>Keluar</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'hsl(0 72% 42%)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <TrendingDown size={14} />
                Rp {totalOut.toLocaleString('id-ID')}
              </div>
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                background: 'hsl(145 60% 96%)',
                border: '1px solid hsl(145 55% 84%)',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: 'hsl(145 45% 32%)', fontWeight: 600 }}>Masuk</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'hsl(145 65% 28%)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <TrendingUp size={14} />
                Rp {totalIn.toLocaleString('id-ID')}
              </div>
            </div>
          </div>

          {isGraceMode && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'hsl(38 92% 95%)',
                border: '1px solid hsl(38 80% 75%)',
                color: 'hsl(32 85% 26%)',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              <Clock size={14} />
              <span>Mode Koreksi Jeda 5 Menit — otomatis memperbarui selisih laci.</span>
            </div>
          )}

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'hsl(0 84% 96%)',
                border: '1px solid hsl(0 72% 84%)',
                color: 'hsl(0 72% 38%)',
                fontSize: '0.78rem',
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'hsl(145 65% 95%)',
                border: '1px solid hsl(145 55% 80%)',
                color: 'hsl(145 65% 26%)',
                fontSize: '0.78rem',
                fontWeight: 600,
              }}
            >
              <CheckCircle2 size={15} />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {currentCategories.map((c) => {
                const active = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    style={{
                      minHeight: 44,
                      padding: '8px 10px',
                      borderRadius: 10,
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: active
                        ? `1.5px solid ${activeTab === 'CASH_OUT' ? 'hsl(0 72% 45%)' : 'hsl(145 65% 32%)'}`
                        : '1px solid var(--color-border)',
                      background: active
                        ? activeTab === 'CASH_OUT'
                          ? 'hsl(0 80% 97%)'
                          : 'hsl(145 65% 95%)'
                        : 'var(--color-surface)',
                      color: active
                        ? activeTab === 'CASH_OUT'
                          ? 'hsl(0 72% 38%)'
                          : 'hsl(145 65% 24%)'
                        : 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                Nominal (Rp)
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="form-input"
                placeholder="0"
                value={amountInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setAmountInput(val ? parseInt(val, 10).toLocaleString('id-ID') : '');
                }}
                style={{ fontSize: '1.15rem', fontWeight: 800, minHeight: 46 }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmountInput(amt.toLocaleString('id-ID'))}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.78rem', minHeight: 38, padding: '4px 10px' }}
                  >
                    {amt / 1000}rb
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                Catatan
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Nama mitra / keperluan"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
                style={{ minHeight: 44, fontSize: '0.9rem' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`btn ${activeTab === 'CASH_OUT' ? 'btn-danger' : 'btn-success'}`}
              style={{ width: '100%', minHeight: 46, fontWeight: 700 }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Menyimpan...
                </>
              ) : activeTab === 'CASH_OUT' ? (
                `Simpan Keluar Rp ${amountInput || '0'}`
              ) : (
                `Simpan Masuk Rp ${amountInput || '0'}`
              )}
            </button>
          </form>

          {/* Riwayat */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <History size={14} />
                Riwayat Shift ({movements.length})
              </span>
              {fetchLoading && <Loader2 size={12} className="spin" />}
            </div>

            {movements.length === 0 ? (
              <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '10px 0' }}>
                Belum ada catatan.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                {movements.map((m) => {
                  const isOut = m.movementType === 'CASH_OUT';
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: 'var(--color-surface-elevated)',
                        fontSize: '0.76rem',
                        borderLeft: `3px solid ${isOut ? 'hsl(0 72% 48%)' : 'hsl(145 65% 34%)'}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{m.notes}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                          {new Date(m.createdAt).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Jakarta',
                          })}{' '}
                          · {CATEGORY_LABELS[m.category] ?? m.category}
                          {m.isGraceCorrection ? ' · Koreksi 5m' : ''}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, flexShrink: 0, color: isOut ? 'hsl(0 72% 42%)' : 'hsl(145 65% 28%)' }}>
                        {isOut ? '-' : '+'}Rp {Number(m.amount).toLocaleString('id-ID')}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
