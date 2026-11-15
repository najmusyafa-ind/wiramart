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
} from 'lucide-react';

interface MovementItem {
  id: string;
  movementType: string;
  category: string;
  amount: string;
  notes: string;
  createdAt: string;
  employeeId?: string | null;
  employeeName?: string | null;
}

interface KasGerakModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMovementAdded?: () => void;
}

interface KasGerakSummaryData {
  movements: MovementItem[];
  totalOut: number;
  totalIn: number;
  isPeerShared: boolean;
}

type FetchKasGerakResult =
  | { ok: true; data: KasGerakSummaryData }
  | { ok: false; aborted: boolean; error: string };

async function requestKasGerakSummary(signal?: AbortSignal): Promise<FetchKasGerakResult> {
  try {
    const res = await fetch('/api/kasir/shift/kas-gerak', {
      cache: 'no-store',
      signal,
    });
    const json = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: {
        movements?: MovementItem[];
        totalCashOut?: number;
        totalCashIn?: number;
        isPeerShared?: boolean;
      };
    };

    if (!res.ok) {
      return {
        ok: false,
        aborted: false,
        error: json.error ?? 'Gagal memuat data kas gerak shift.',
      };
    }

    return {
      ok: true,
      data: {
        movements: json.data?.movements ?? [],
        totalOut: json.data?.totalCashOut ?? 0,
        totalIn: json.data?.totalCashIn ?? 0,
        isPeerShared: Boolean(json.data?.isPeerShared),
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, aborted: true, error: '' };
    }
    return {
      ok: false,
      aborted: false,
      error: 'Gagal terhubung ke server saat memuat kas gerak.',
    };
  }
}

const CATEGORIES_OUT = [
  { value: 'TITIPAN_MAKANAN', label: '🍱 Titipan Makanan / Beli Lepas', desc: 'Bayar titipan kue/snack supplier' },
  { value: 'KONSUMSI_GALON', label: '🚰 Galon / Konsumsi', desc: 'Beli air galon toko' },
  { value: 'BENSIN',         label: '🛵 Bensin & Transport', desc: 'Bensin motor / kurir toko' },
  { value: 'ATK_KRESEK',     label: '📦 Kresek & ATK',      desc: 'Plastik kresek, lakban, kertas' },
  { value: 'PARKIR_KEBERSIHAN', label: '🧹 Parkir / Kebersihan', desc: 'Uang kebersihan / parkir' },
  { value: 'OPERASIONAL',    label: '⚙️ Operasional Lain',  desc: 'Biaya tak terduga toko' },
];

const CATEGORIES_IN = [
  { value: 'TAMBAH_MODAL',   label: '🪙 Tukar Receh / Tambah Modal', desc: 'Penambahan uang pecahan di laci' },
  { value: 'OPERASIONAL',    label: '➕ Kas Masuk Lain',             desc: 'Penerimaan tunai lain ke laci' },
];

const QUICK_AMOUNTS = [2_000, 5_000, 10_000, 19_000, 20_000, 30_000, 50_000];

export default function KasGerakModal({
  isOpen,
  onClose,
  onMovementAdded,
}: KasGerakModalProps) {
  if (!isOpen) return null;
  return <KasGerakModalBody onClose={onClose} onMovementAdded={onMovementAdded} />;
}

function KasGerakModalBody({
  onClose,
  onMovementAdded,
}: {
  onClose: () => void;
  onMovementAdded?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'CASH_OUT' | 'CASH_IN'>('CASH_OUT');
  const [category, setCategory] = useState<string>('KONSUMSI_GALON');
  const [amountInput, setAmountInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [totalOut, setTotalOut] = useState(0);
  const [totalIn, setTotalIn] = useState(0);
  const [isPeerShared, setIsPeerShared] = useState(false);

  function applySummaryResult(res: FetchKasGerakResult) {
    if (!res.ok) {
      if (!res.aborted) setError(res.error);
      return;
    }
    setMovements(res.data.movements);
    setTotalOut(res.data.totalOut);
    setTotalIn(res.data.totalIn);
    setIsPeerShared(res.data.isPeerShared);
  }

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
        setIsPeerShared(res.data.isPeerShared);
      }
      setFetchLoading(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // Ganti default kategori saat ganti tab
  function handleTabChange(tab: 'CASH_OUT' | 'CASH_IN') {
    setActiveTab(tab);
    if (tab === 'CASH_OUT') {
      setCategory('KONSUMSI_GALON');
    } else {
      setCategory('TAMBAH_MODAL');
    }
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const nominal = parseFloat(amountInput.replace(/\D/g, ''));
    if (isNaN(nominal) || nominal < 100) {
      setError('Masukkan nominal yang valid (minimal Rp 100).');
      return;
    }
    if (!notes.trim() || notes.trim().length < 3) {
      setError('Keterangan pengeluaran/pemasukan wajib diisi (minimal 3 huruf).');
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
        data?: { message?: string };
      };
      if (!res.ok) {
        setError(json.error ?? 'Gagal mencatat kas gerak.');
        return;
      }

      setSuccessMsg(json.data?.message ?? 'Berhasil dicatat ke laci.');
      setAmountInput('');
      setNotes('');
      setFetchLoading(true);
      const summaryRes = await requestKasGerakSummary();
      applySummaryResult(summaryRes);
      setFetchLoading(false);
      if (onMovementAdded) onMovementAdded();
    } catch {
      setError('Terjadi gangguan koneksi internet. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  const currentCategories = activeTab === 'CASH_OUT' ? CATEGORIES_OUT : CATEGORIES_IN;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kas-gerak-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-3)',
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(3px)',
        overflowY: 'auto',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Header Modal */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt size={20} style={{ color: 'var(--color-primary)' }} />
            <h2
              id="kas-gerak-title"
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 700,
                margin: 0,
              }}
            >
              Kas Keluar & Masuk Laci (Petty Cash)
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
              borderRadius: 'var(--radius-md)',
              flexShrink: 0,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
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
              gap: 8,
              minHeight: 44,
              padding: '10px 8px',
              fontWeight: 700,
              fontSize: '0.85rem',
              border: 'none',
              background: activeTab === 'CASH_OUT' ? 'var(--color-surface)' : 'transparent',
              color: activeTab === 'CASH_OUT' ? 'var(--color-error)' : 'var(--color-text-muted)',
              borderBottom: activeTab === 'CASH_OUT' ? '2.5px solid var(--color-error)' : 'none',
              cursor: 'pointer',
            }}
          >
            <MinusCircle size={16} />
            Kas Keluar (Biaya Laci)
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('CASH_IN')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 44,
              padding: '10px 8px',
              fontWeight: 700,
              fontSize: '0.85rem',
              border: 'none',
              background: activeTab === 'CASH_IN' ? 'var(--color-surface)' : 'transparent',
              color: activeTab === 'CASH_IN' ? 'var(--color-success)' : 'var(--color-text-muted)',
              borderBottom: activeTab === 'CASH_IN' ? '2.5px solid var(--color-success)' : 'none',
              cursor: 'pointer',
            }}
          >
            <PlusCircle size={16} />
            Kas Masuk (Tambah Modal)
          </button>
        </div>

        {/* Modal Body Scrollable */}
        <div
          style={{
            padding: 'var(--space-4)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {/* Ringkasan Akumulasi Laci Shift Ini */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                Total Kas Keluar Shift Ini:
              </div>
              <div
                style={{
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  color: 'var(--color-error)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <TrendingDown size={14} />
                Rp {totalOut.toLocaleString('id-ID')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                Total Kas Masuk Shift Ini:
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <TrendingUp size={14} />
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-success)' }}>
                  Rp {totalIn.toLocaleString('id-ID')}
                </span>
              </div>
            </div>
          </div>

          {isPeerShared && (
            <div
              style={{
                fontSize: '0.72rem',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'hsl(210 90% 95%)',
                border: '1px solid hsl(210 80% 82%)',
                color: 'hsl(215 70% 30%)',
              }}
            >
              Laci shift bersama aktif: pencatatan ini terhubung ke laci kas shift berjalan atas nama akun Anda.
            </div>
          )}

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-error-light)',
                color: 'var(--color-error)',
                fontSize: '0.8rem',
              }}
            >
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-success-light)',
                color: 'var(--color-success)',
                fontSize: '0.8rem',
              }}
            >
              <CheckCircle2 size={16} />
              {successMsg}
            </div>
          )}

          {/* Form Pencatatan */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Kategori */}
            <div>
              <label
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--color-text-secondary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Kategori Pengeluaran / Pemasukan:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 155px), 1fr))', gap: 6 }}>
                {currentCategories.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    style={{
                      minHeight: 48,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-md)',
                      textAlign: 'left',
                      border:
                        category === c.value
                          ? `1.5px solid ${activeTab === 'CASH_OUT' ? 'var(--color-error)' : 'var(--color-success)'}`
                          : '1px solid var(--color-border)',
                      background:
                        category === c.value
                          ? activeTab === 'CASH_OUT'
                            ? 'var(--color-error-light)'
                            : 'var(--color-success-light)'
                          : 'var(--color-surface)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>{c.label}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                      {c.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Nominal */}
            <div>
              <label
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--color-text-secondary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Nominal (Rp):
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="form-input"
                placeholder="Contoh: 19.000"
                value={amountInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setAmountInput(val ? parseInt(val, 10).toLocaleString('id-ID') : '');
                }}
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  minHeight: 44,
                }}
              />
              {/* Quick Amount Suggestion */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmountInput(amt.toLocaleString('id-ID'))}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.8rem', padding: '8px 12px', minHeight: 44, minWidth: 52 }}
                  >
                    {amt >= 1000 ? `${amt / 1000}rb` : amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Keterangan */}
            <div>
              <label
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--color-text-secondary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                Keterangan / Rincian Belanja:
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Misal: Beli 1 galon Le Minerale untuk toko"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
                style={{ fontSize: 'var(--text-base)' }}
              />
            </div>

            {/* Tombol Simpan */}
            <button
              type="submit"
              disabled={loading}
              className={`btn ${activeTab === 'CASH_OUT' ? 'btn-danger' : 'btn-success'}`}
              style={{
                width: '100%',
                minHeight: 46,
                fontWeight: 700,
                marginTop: 4,
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Menyimpan...
                </>
              ) : activeTab === 'CASH_OUT' ? (
                `Keluarkan Rp ${amountInput || '0'} dari Laci`
              ) : (
                `Masukkan Rp ${amountInput || '0'} ke Laci`
              )}
            </button>
          </form>

          {/* Riwayat Kas Gerak Shift Ini */}
          <div style={{ marginTop: 8, borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <History size={14} />
                Riwayat Kas Gerak Shift Ini ({movements.length})
              </span>
              {fetchLoading && <Loader2 size={12} className="spin" />}
            </div>

            {movements.length === 0 ? (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-text-muted)',
                  textAlign: 'center',
                  padding: '12px 0',
                }}
              >
                Belum ada kas keluar/masuk tercatat di shift ini.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
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
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-surface-elevated)',
                        fontSize: '0.75rem',
                        borderLeft: `3px solid ${isOut ? 'var(--color-error)' : 'var(--color-success)'}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{m.notes}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                          {new Date(m.createdAt).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Jakarta',
                          })}{' '}
                          WIB • {m.category}
                          {m.employeeName ? ` • ${m.employeeName}` : ''}
                        </div>
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          flexShrink: 0,
                          color: isOut ? 'var(--color-error)' : 'var(--color-success)',
                        }}
                      >
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
