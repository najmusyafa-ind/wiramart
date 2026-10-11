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

type ItemState = {
  qtySisa: number;
  disposition: 'RETUR' | 'BUANG_BASI' | 'HABIS' | 'SIMPAN' | 'MAKAN_PETUGAS' | 'OBRAL';
  notes: string;
};

export default function SisaMakananModal({
  isOpen,
  onClose,
  onSuccess,
}: SisaMakananModalProps) {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, ItemState>>({});
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      setError(null);
      setSuccessMsg(null);
      fetch('/api/kasir/makanan-sisa')
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (ignore) return;
          if (json?.data?.items) {
            const list: FoodItem[] = json.data.items;
            setItems(list);
            const initial: Record<string, ItemState> = {};
            for (const item of list) {
              initial[item.id] = {
                qtySisa: item.stockQty,
                disposition: 'RETUR', // default sop wiramart: retur ke penitip
                notes: '',
              };
            }
            setStateMap(initial);
          } else {
            setError('Gagal memuat daftar makanan harian.');
          }
        })
        .catch(() => {
          if (!ignore) {
            setError('Koneksi terputus. Coba lagi.');
          }
        })
        .finally(() => {
          if (!ignore) {
            setLoading(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  function handleQtyChange(id: string, delta: number) {
    setStateMap((prev) => {
      const current = prev[id] ?? { qtySisa: 0, disposition: 'RETUR', notes: '' };
      const nextQty = Math.max(0, current.qtySisa + delta);
      return {
        ...prev,
        [id]: {
          ...current,
          qtySisa: nextQty,
          disposition: nextQty === 0 ? 'HABIS' : current.disposition === 'HABIS' ? 'RETUR' : current.disposition,
        },
      };
    });
  }

  function handleDispositionChange(id: string, disp: ItemState['disposition']) {
    setStateMap((prev) => {
      const current = prev[id] ?? { qtySisa: 0, disposition: 'RETUR', notes: '' };
      return {
        ...prev,
        [id]: {
          ...current,
          disposition: disp,
          qtySisa: disp === 'HABIS' ? 0 : current.qtySisa,
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
      const st = stateMap[item.id] ?? { qtySisa: item.stockQty, disposition: 'RETUR', notes: '' };
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

  if (!isOpen) return null;

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
          maxWidth: 540,
          maxHeight: '90vh',
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
            <Utensils size={20} style={{ color: 'hsl(32, 95%, 44%)' }} />
            <div>
              <h2
                id="cutoff-makanan-title"
                style={{
                  fontSize: 'var(--text-base)',
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                🍱 Opname Sisa Makanan Jam 15:00
              </h2>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                Catat sisa makanan cepat basi / non-barcode sebelum toko tutup
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
              padding: 4,
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
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 2 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStateMap((prev) => {
                      const updated = { ...prev };
                      for (const it of items) {
                        updated[it.id] = {
                          qtySisa: it.stockQty,
                          disposition: it.stockQty > 0 ? 'RETUR' : 'HABIS',
                          notes: '',
                        };
                      }
                      return updated;
                    });
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '6px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
                >
                  <RotateCcw size={12} /> Set Semua Diretur
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
                          notes: '',
                        };
                      }
                      return updated;
                    });
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '6px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}
                >
                  <Check size={12} /> Set Semua Habis Laku
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto' }}>
                {items.map((item) => {
                  const st = stateMap[item.id] ?? { qtySisa: item.stockQty, disposition: 'RETUR', notes: '' };
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{item.name}</span>
                            {item.perishableType && (
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  background: item.perishableType === 'BELI_LEPAS' ? 'hsl(38 92% 92%)' : 'hsl(217 91% 95%)',
                                  color: item.perishableType === 'BELI_LEPAS' ? 'hsl(38 92% 35%)' : 'hsl(217 91% 40%)',
                                  border: `1px solid ${item.perishableType === 'BELI_LEPAS' ? 'hsl(38 92% 75%)' : 'hsl(217 91% 80%)'}`,
                                }}
                              >
                                {item.perishableType === 'BELI_LEPAS' ? 'Modal Toko' : 'Konsinyasi'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                            Stok sistem: {item.stockQty} {item.unit} &bull; Rp {Number(item.sellingPrice).toLocaleString('id-ID')}
                          </div>
                        </div>

                        {/* Stepper Sisa Fisik */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginRight: 4 }}>Sisa:</span>
                          <button
                            type="button"
                            onClick={() => handleQtyChange(item.id, -1)}
                            disabled={st.qtySisa <= 0}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 4,
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-surface)',
                              cursor: st.qtySisa <= 0 ? 'not-allowed' : 'pointer',
                              fontWeight: 700,
                              opacity: st.qtySisa <= 0 ? 0.4 : 1,
                            }}
                          >
                            -
                          </button>
                          <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 800, fontSize: '0.9rem' }}>
                            {st.qtySisa}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleQtyChange(item.id, 1)}
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
                        </div>
                      </div>

                      {/* Tombol Pilihan Disposisi */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => handleDispositionChange(item.id, 'RETUR')}
                          style={{
                            padding: '4px 4px',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            border: st.disposition === 'RETUR' ? '1.5px solid hsl(217 91% 60%)' : '1px solid var(--color-border)',
                            background: st.disposition === 'RETUR' ? 'hsl(217 91% 95%)' : 'var(--color-surface)',
                            color: st.disposition === 'RETUR' ? 'hsl(217 91% 35%)' : 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                          }}
                        >
                          <RotateCcw size={11} /> Retur Mitra
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDispositionChange(item.id, 'MAKAN_PETUGAS')}
                          style={{
                            padding: '4px 4px',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            border: st.disposition === 'MAKAN_PETUGAS' ? '1.5px solid hsl(142 76% 40%)' : '1px solid var(--color-border)',
                            background: st.disposition === 'MAKAN_PETUGAS' ? 'hsl(142 76% 94%)' : 'var(--color-surface)',
                            color: st.disposition === 'MAKAN_PETUGAS' ? 'hsl(142 76% 30%)' : 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                          }}
                        >
                          <Coffee size={11} /> Konsumsi
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDispositionChange(item.id, 'BUANG_BASI')}
                          style={{
                            padding: '4px 4px',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            border: st.disposition === 'BUANG_BASI' ? '1.5px solid var(--color-error)' : '1px solid var(--color-border)',
                            background: st.disposition === 'BUANG_BASI' ? 'var(--color-error-light)' : 'var(--color-surface)',
                            color: st.disposition === 'BUANG_BASI' ? 'var(--color-error)' : 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                          }}
                        >
                          <Trash2 size={11} /> Basi/Buang
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDispositionChange(item.id, 'HABIS')}
                          style={{
                            padding: '4px 4px',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            border: st.disposition === 'HABIS' ? '1.5px solid var(--color-success)' : '1px solid var(--color-border)',
                            background: st.disposition === 'HABIS' ? 'var(--color-success-light)' : 'var(--color-surface)',
                            color: st.disposition === 'HABIS' ? 'var(--color-success)' : 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                          }}
                        >
                          <Check size={11} /> Habis Laku
                        </button>
                      </div>
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
                  'Simpan Opname Makanan Jam 15:00'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
