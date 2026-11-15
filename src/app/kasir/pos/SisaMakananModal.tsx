'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Utensils,
  RotateCcw,
  Trash2,
  Check,
  Coffee,
  Tag,
  Package,
} from 'lucide-react';

interface FoodItem {
  id: string;
  name: string;
  barcode: string | null;
  sellingPrice: string;
  stockQty: number;
  unit: string;
  categoryName: string | null;
  isPerishable?: boolean;
  perishableType?: string | null;
}

interface SisaMakananModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type CutOffDisposition =
  | 'RETUR'
  | 'BUANG_BASI'
  | 'HABIS'
  | 'SIMPAN'
  | 'MAKAN_PETUGAS'
  | 'OBRAL';

type ItemState = {
  qtySisa: number;
  disposition: CutOffDisposition;
  notes: string;
};

type DispositionOption = {
  value: CutOffDisposition;
  label: string;
  icon: React.ReactNode;
  activeBorder: string;
  activeBg: string;
  activeColor: string;
};

const DISPOSITION_OPTIONS: DispositionOption[] = [
  {
    value: 'RETUR',
    label: 'Retur Mitra',
    icon: <RotateCcw size={11} aria-hidden="true" />,
    activeBorder: '1.5px solid hsl(217 91% 60%)',
    activeBg: 'hsl(217 91% 95%)',
    activeColor: 'hsl(217 91% 35%)',
  },
  {
    value: 'OBRAL',
    label: 'Obral Sore',
    icon: <Tag size={11} aria-hidden="true" />,
    activeBorder: '1.5px solid hsl(28 92% 50%)',
    activeBg: 'hsl(28 92% 94%)',
    activeColor: 'hsl(28 92% 35%)',
  },
  {
    value: 'SIMPAN',
    label: 'Simpan Chiller',
    icon: <Package size={11} aria-hidden="true" />,
    activeBorder: '1.5px solid hsl(199 89% 45%)',
    activeBg: 'hsl(199 89% 94%)',
    activeColor: 'hsl(199 89% 32%)',
  },
  {
    value: 'MAKAN_PETUGAS',
    label: 'Konsumsi',
    icon: <Coffee size={11} aria-hidden="true" />,
    activeBorder: '1.5px solid hsl(142 76% 40%)',
    activeBg: 'hsl(142 76% 94%)',
    activeColor: 'hsl(142 76% 30%)',
  },
  {
    value: 'BUANG_BASI',
    label: 'Basi/Buang',
    icon: <Trash2 size={11} aria-hidden="true" />,
    activeBorder: '1.5px solid var(--color-error)',
    activeBg: 'var(--color-error-light)',
    activeColor: 'var(--color-error)',
  },
  {
    value: 'HABIS',
    label: 'Habis Laku',
    icon: <Check size={11} aria-hidden="true" />,
    activeBorder: '1.5px solid var(--color-success)',
    activeBg: 'var(--color-success-light)',
    activeColor: 'var(--color-success)',
  },
];

function getDefaultDisposition(item: FoodItem): CutOffDisposition {
  if (item.stockQty <= 0) return 'HABIS';
  if (item.perishableType === 'BELI_LEPAS') return 'OBRAL';
  return 'RETUR';
}

function getDefaultItemState(item: FoodItem): ItemState {
  return {
    qtySisa: Math.max(0, item.stockQty),
    disposition: getDefaultDisposition(item),
    notes: '',
  };
}

export default function SisaMakananModal({
  isOpen,
  onClose,
  onSuccess,
}: SisaMakananModalProps) {
  if (!isOpen) return null;
  return <SisaMakananModalBody onClose={onClose} onSuccess={onSuccess} />;
}

function SisaMakananModalBody({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, ItemState>>({});
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    fetch('/api/kasir/makanan-sisa', { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error ?? 'Gagal memuat daftar makanan harian.');
        }
        return json;
      })
      .then((json) => {
        if (ignore) return;
        const list: FoodItem[] = json?.data?.items ?? [];
        setItems(list);
        const initial: Record<string, ItemState> = {};
        for (const item of list) {
          initial[item.id] = getDefaultItemState(item);
        }
        setStateMap(initial);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof Error ? err.message : 'Koneksi terputus. Coba lagi.',
        );
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
      controller.abort();
    };
  }, []);

  function handleQtyChange(item: FoodItem, delta: number) {
    setStateMap((prev) => {
      const current = prev[item.id] ?? getDefaultItemState(item);
      const nextQty = Math.max(0, current.qtySisa + delta);
      const fallbackNonZeroDisp =
        item.perishableType === 'BELI_LEPAS' ? 'OBRAL' : 'RETUR';
      return {
        ...prev,
        [item.id]: {
          ...current,
          qtySisa: nextQty,
          disposition:
            nextQty === 0
              ? 'HABIS'
              : current.disposition === 'HABIS'
              ? fallbackNonZeroDisp
              : current.disposition,
        },
      };
    });
  }

  function handleDispositionChange(item: FoodItem, disp: CutOffDisposition) {
    setStateMap((prev) => {
      const current = prev[item.id] ?? getDefaultItemState(item);
      const nextQty =
        disp === 'HABIS'
          ? 0
          : current.qtySisa === 0 && item.stockQty > 0
          ? item.stockQty
          : current.qtySisa;
      return {
        ...prev,
        [item.id]: {
          ...current,
          disposition: disp,
          qtySisa: nextQty,
        },
      };
    });
  }

  function handleNotesChange(item: FoodItem, notes: string) {
    setStateMap((prev) => {
      const current = prev[item.id] ?? getDefaultItemState(item);
      return {
        ...prev,
        [item.id]: {
          ...current,
          notes,
        },
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;

    setSubmitLoading(true);
    setError(null);
    setSuccessMsg(null);

    const payloadItems = items.map((item) => {
      const st = stateMap[item.id] ?? getDefaultItemState(item);
      return {
        productId: item.id,
        qtySisaFisik: st.qtySisa,
        disposition: st.disposition,
        notes: st.notes.trim() ? st.notes.trim() : undefined,
      };
    });

    try {
      const res = await fetch('/api/kasir/makanan-sisa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payloadItems }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Gagal menyimpan cut-off makanan.');
        return;
      }

      setSuccessMsg(json.data?.message ?? 'Cut-off makanan berhasil disimpan!');
      if (onSuccess) onSuccess();
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch {
      setError('Kesalahan koneksi internet. Coba lagi.');
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cutoff-makanan-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2600,
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
          maxWidth: 560,
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
            <Utensils size={20} aria-hidden="true" style={{ color: 'hsl(32, 95%, 44%)' }} />
            <div>
              <h2
                id="cutoff-makanan-title"
                style={{
                  fontSize: 'var(--text-base)',
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                🍱 Opname Sisa Makanan Jam 15:00 WIB
              </h2>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                Catat sisa makanan cepat basi / non-barcode sebelum tutup shift sore
              </div>
            </div>
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

        {/* Modal Body */}
        <div
          style={{
            padding: 'var(--space-4)',
            paddingBottom: 'calc(var(--space-4) + env(safe-area-inset-bottom, 0px))',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {error && (
            <div
              role="alert"
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
              <AlertTriangle size={16} aria-hidden="true" />
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
              <CheckCircle2 size={16} aria-hidden="true" />
              {successMsg}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--color-text-muted)' }}>
              <Loader2 size={24} className="spin" style={{ margin: '0 auto 8px' }} />
              Memuat produk makanan harian...
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>
              Tidak ada produk makanan harian yang perlu di-cut-off.
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Tombol Aksi Cepat Massal */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 6, marginBottom: 2 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      for (const it of items) {
                        updated[it.id] = {
                          qtySisa: Math.max(0, it.stockQty),
                          disposition: it.stockQty > 0 ? 'RETUR' : 'HABIS',
                          notes: prev[it.id]?.notes ?? '',
                        };
                      }
                      return updated;
                    });
                  }}
                  className="btn btn-secondary"
                  style={{ minHeight: 44, fontSize: '0.8rem', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Set Semua Diretur
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      for (const it of items) {
                        updated[it.id] = {
                          qtySisa: 0,
                          disposition: 'HABIS',
                          notes: prev[it.id]?.notes ?? '',
                        };
                      }
                      return updated;
                    });
                  }}
                  className="btn btn-secondary"
                  style={{ minHeight: 44, fontSize: '0.8rem', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
                >
                  <Check size={14} aria-hidden="true" /> Set Semua Habis Laku
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55dvh', overflowY: 'auto' }}>
                {items.map((item) => {
                  const st = stateMap[item.id] ?? getDefaultItemState(item);
                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-surface-elevated)',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{item.name}</span>
                            {item.perishableType && (
                              <span
                                style={{
                                  fontSize: '0.6875rem',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  background: item.perishableType === 'BELI_LEPAS' ? 'hsl(38 92% 92%)' : 'hsl(217 91% 95%)',
                                  color: item.perishableType === 'BELI_LEPAS' ? 'hsl(38 92% 30%)' : 'hsl(217 91% 38%)',
                                  border: `1px solid ${item.perishableType === 'BELI_LEPAS' ? 'hsl(38 92% 75%)' : 'hsl(217 91% 80%)'}`,
                                }}
                              >
                                {item.perishableType === 'BELI_LEPAS' ? 'Modal Toko' : 'Konsinyasi'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                            Stok sistem: {item.stockQty} {item.unit} &bull; Rp {Number(item.sellingPrice).toLocaleString('id-ID')}
                          </div>
                        </div>

                        {/* Stepper Sisa Fisik */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginRight: 2 }}>Sisa:</span>
                          <button
                            type="button"
                            onClick={() => handleQtyChange(item, -1)}
                            disabled={st.qtySisa <= 0}
                            aria-label={`Kurangi sisa ${item.name}`}
                            style={{
                              minWidth: 44,
                              minHeight: 44,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-surface)',
                              cursor: st.qtySisa <= 0 ? 'not-allowed' : 'pointer',
                              fontWeight: 700,
                              fontSize: '1rem',
                              opacity: st.qtySisa <= 0 ? 0.4 : 1,
                            }}
                          >
                            -
                          </button>
                          <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 800, fontSize: '0.95rem' }}>
                            {st.qtySisa}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleQtyChange(item, 1)}
                            aria-label={`Tambah sisa ${item.name}`}
                            style={{
                              minWidth: 44,
                              minHeight: 44,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-surface)',
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: '1rem',
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Tombol Pilihan Disposisi (6 Opsi Seragam) */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 6 }}>
                        {DISPOSITION_OPTIONS.map((opt) => {
                          const isSelected = st.disposition === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => handleDispositionChange(item, opt.value)}
                              style={{
                                minHeight: 44,
                                padding: '8px 6px',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                border: isSelected ? opt.activeBorder : '1px solid var(--color-border)',
                                background: isSelected ? opt.activeBg : 'var(--color-surface)',
                                color: isSelected ? opt.activeColor : 'var(--color-text-secondary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                              }}
                            >
                              {opt.icon} {opt.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Catatan Opsional Per Item */}
                      <input
                        type="text"
                        value={st.notes}
                        onChange={(e) => handleNotesChange(item, e.target.value)}
                        maxLength={200}
                        placeholder="Catatan opsional (misal: sisa layak masuk chiller / obral 50%)"
                        aria-label={`Catatan ${item.name}`}
                        className="form-input"
                        style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitLoading}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  minHeight: 46,
                  fontWeight: 700,
                  marginTop: 6,
                }}
              >
                {submitLoading ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Menyimpan Cut-Off...
                  </>
                ) : (
                  'Simpan Opname Makanan Jam 15:00 WIB'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
