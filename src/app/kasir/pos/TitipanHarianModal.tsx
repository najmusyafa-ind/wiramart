'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  PackageCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
  ArrowRight,
  Search,
} from 'lucide-react';
import type { GraceRecalcResult } from './KasGerakModal';

interface ConsignmentItem {
  id: string;
  entryDate: string;
  productId: string;
  productName: string;
  productUnit: string;
  mitraName: string;
  qtyInitial: number;
  hargaSetor: number;
  sellingPrice: number;
  status: 'OPEN' | 'CARRYOVER' | 'SETTLED';
  qtySoldPos: number;
  qtyRemaining: number | null;
  qtySoldPhysical: number | null;
  qtyDiscrepancy: number;
  totalPayout: number;
  payoutSource: string | null;
  notes: string | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  unit: string;
  sellingPrice: number;
  stockQty: number;
  isPerishable: boolean;
  suggestedHargaSetor: number | null;
  categoryName: string | null;
}

interface SupplierItem {
  id: string;
  name: string;
}

interface TitipanHarianModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: (graceUpdate?: GraceRecalcResult | null) => void;
}

const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

export default function TitipanHarianModal({ isOpen, onClose, onChanged }: TitipanHarianModalProps) {
  if (!isOpen) return null;
  return <TitipanHarianBody onClose={onClose} onChanged={onChanged} />;
}

function TitipanHarianBody({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: (graceUpdate?: GraceRecalcResult | null) => void;
}) {
  const [tab, setTab] = useState<'list' | 'add'>('list');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [todayEntries, setTodayEntries] = useState<ConsignmentItem[]>([]);
  const [carryoverEntries, setCarryoverEntries] = useState<ConsignmentItem[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);

  // Form Tambah Titip
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [mitraName, setMitraName] = useState('');
  const [qtyInitial, setQtyInitial] = useState('10');
  const [hargaSetor, setHargaSetor] = useState('');
  const [addNotes, setAddNotes] = useState('');

  // Form Hitung Sisa Inline
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [sisaInput, setSisaInput] = useState('');
  const [payoutSource, setPayoutSource] = useState<'CASH_LACI' | 'TRANSFER_PENGELOLA'>('CASH_LACI');

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/kasir/titipan', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Gagal memuat Titipan Harian.');
        return;
      }
      setTodayEntries(json.data.todayEntries ?? []);
      setCarryoverEntries(json.data.carryoverEntries ?? []);
      setProducts(json.data.products ?? []);
      setSuppliers(json.data.suppliers ?? []);
    } catch {
      setError('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 60);
  }, [products, productSearch]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  function handleSelectProduct(prodId: string) {
    setSelectedProductId(prodId);
    const found = products.find((p) => p.id === prodId);
    if (found && found.suggestedHargaSetor !== null && found.suggestedHargaSetor > 0) {
      setHargaSetor(Math.round(found.suggestedHargaSetor).toLocaleString('id-ID'));
    }
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const qtyNum = parseInt(qtyInitial, 10);
    const setorNum = parseFloat(hargaSetor.replace(/\D/g, ''));

    if (!selectedProductId) {
      setError('Pilih produk terlebih dahulu.');
      return;
    }
    if (mitraName.trim().length < 2) {
      setError('Isi nama penitip.');
      return;
    }
    if (isNaN(qtyNum) || qtyNum < 1) {
      setError('Jumlah titip minimal 1.');
      return;
    }
    if (isNaN(setorNum) || setorNum < 0) {
      setError('Isi harga setor mitra.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/kasir/titipan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProductId,
          mitraName: mitraName.trim(),
          qtyInitial: qtyNum,
          hargaSetor: setorNum,
          notes: addNotes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Gagal mencatat titipan.');
        return;
      }
      setSuccessMsg(json.data?.message ?? 'Titipan tercatat.');
      setSelectedProductId('');
      setMitraName('');
      setQtyInitial('10');
      setHargaSetor('');
      setAddNotes('');
      setTab('list');
      await loadData();
      if (onChanged) onChanged(null);
    } catch {
      setError('Gangguan koneksi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSettle(entry: ConsignmentItem) {
    if (submitting) return;
    const sisaNum = parseInt(sisaInput, 10);
    if (isNaN(sisaNum) || sisaNum < 0 || sisaNum > entry.qtyInitial) {
      setError(`Sisa fisik harus antara 0 sampai ${entry.qtyInitial}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/kasir/titipan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SETTLE',
          id: entry.id,
          qtyRemaining: sisaNum,
          payoutSource,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Gagal menyelesaikan titipan.');
        return;
      }
      setSuccessMsg(json.data?.message ?? 'Titipan selesai.');
      setSettlingId(null);
      setSisaInput('');
      await loadData();
      if (onChanged) onChanged(json.data?.graceUpdate ?? null);
    } catch {
      setError('Gangguan koneksi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCarryover(id: string) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/kasir/titipan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_CARRYOVER', id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Gagal menandai diambil besok.');
        return;
      }
      setSuccessMsg('Ditandai diambil besok.');
      await loadData();
      if (onChanged) onChanged(null);
    } catch {
      setError('Gangguan koneksi.');
    } finally {
      setSubmitting(false);
    }
  }

  const openList = [
    ...carryoverEntries,
    ...todayEntries.filter((e) => e.status !== 'SETTLED'),
  ];
  const settledToday = todayEntries.filter((e) => e.status === 'SETTLED');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titipan-title"
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
          maxWidth: 540,
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
            <PackageCheck size={18} style={{ color: 'var(--color-primary)' }} />
            <h2 id="titipan-title" style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>
              Titipan Harian
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

        {/* Tabs */}
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
            onClick={() => { setTab('list'); setError(null); }}
            style={{
              minHeight: 46,
              border: 'none',
              fontWeight: 700,
              fontSize: '0.84rem',
              background: tab === 'list' ? 'var(--color-surface)' : 'transparent',
              color: tab === 'list' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: tab === 'list' ? '2.5px solid var(--color-primary)' : '2.5px solid transparent',
              cursor: 'pointer',
            }}
          >
            Aktif &amp; Susulan ({openList.length})
          </button>
          <button
            type="button"
            onClick={() => { setTab('add'); setError(null); }}
            style={{
              minHeight: 46,
              border: 'none',
              fontWeight: 700,
              fontSize: '0.84rem',
              background: tab === 'add' ? 'var(--color-surface)' : 'transparent',
              color: tab === 'add' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: tab === 'add' ? '2.5px solid var(--color-primary)' : '2.5px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <Plus size={15} />
            Catat Titip
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: 'hsl(0 84% 96%)', border: '1px solid hsl(0 72% 84%)', color: 'hsl(0 72% 38%)', fontSize: '0.78rem', fontWeight: 600 }}>
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: 'hsl(145 65% 95%)', border: '1px solid hsl(145 55% 80%)', color: 'hsl(145 65% 26%)', fontSize: '0.78rem', fontWeight: 600 }}>
              <CheckCircle2 size={15} />
              <span>{successMsg}</span>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--color-text-muted)' }}>
              <Loader2 size={22} className="spin" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: '0.8rem' }}>Memuat...</div>
            </div>
          ) : tab === 'add' ? (
            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Produk
                </label>
                <div style={{ position: 'relative', marginBottom: 6 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: 13, color: 'var(--color-text-muted)' }} />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Cari produk..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    style={{ paddingLeft: 32, minHeight: 40, fontSize: '0.85rem' }}
                  />
                </div>
                <select
                  className="form-input"
                  value={selectedProductId}
                  onChange={(e) => handleSelectProduct(e.target.value)}
                  required
                  style={{ width: '100%', minHeight: 44, fontSize: '0.88rem' }}
                >
                  <option value="">-- Pilih Produk --</option>
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Jual {rp(p.sellingPrice)} · Stok {p.stockQty})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Nama Penitip / Mitra
                </label>
                <input
                  type="text"
                  list="titipan-suppliers-list"
                  className="form-input"
                  placeholder="Contoh: Bu Yuli"
                  value={mitraName}
                  onChange={(e) => setMitraName(e.target.value)}
                  required
                  style={{ minHeight: 44, fontSize: '0.9rem' }}
                />
                <datalist id="titipan-suppliers-list">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Jumlah Titip
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    className="form-input"
                    value={qtyInitial}
                    onChange={(e) => setQtyInitial(e.target.value)}
                    required
                    style={{ minHeight: 44, fontWeight: 800, fontSize: '1rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Harga Setor / pcs (Rp)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="form-input"
                    placeholder="Contoh: 6.000"
                    value={hargaSetor}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      setHargaSetor(v ? parseInt(v, 10).toLocaleString('id-ID') : '');
                    }}
                    required
                    style={{ minHeight: 44, fontWeight: 800, fontSize: '1rem' }}
                  />
                </div>
              </div>

              {selectedProduct && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', background: 'var(--color-surface-elevated)', padding: '8px 10px', borderRadius: 8 }}>
                  Harga Jual POS: <strong>{rp(selectedProduct.sellingPrice)}</strong>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Catatan (Opsional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Contoh: Diambil jam 14.30"
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  style={{ minHeight: 42, fontSize: '0.88rem' }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary"
                style={{ width: '100%', minHeight: 46, fontWeight: 700, marginTop: 4 }}
              >
                {submitting ? 'Menyimpan...' : 'Simpan Titipan'}
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {openList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 10px', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                  Tidak ada titipan aktif.
                </div>
              ) : (
                openList.map((item) => {
                  const isCarry = item.status === 'CARRYOVER' || carryoverEntries.some((c) => c.id === item.id);
                  const isSettling = settlingId === item.id;
                  const parsedSisa = sisaInput === '' ? null : parseInt(sisaInput, 10);
                  const previewLakuFisik =
                    parsedSisa !== null && !isNaN(parsedSisa) && parsedSisa >= 0 && parsedSisa <= item.qtyInitial
                      ? item.qtyInitial - parsedSisa
                      : null;
                  const previewDiff = previewLakuFisik !== null ? previewLakuFisik - item.qtySoldPos : 0;
                  const previewPay = previewLakuFisik !== null ? previewLakuFisik * item.hargaSetor : 0;

                  return (
                    <div
                      key={item.id}
                      style={{
                        border: isCarry ? '1.5px solid hsl(38 85% 58%)' : '1px solid var(--color-border)',
                        borderRadius: 12,
                        padding: 12,
                        background: 'var(--color-surface)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{item.productName}</div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)' }}>
                            {item.mitraName} · Setor {rp(item.hargaSetor)}
                          </div>
                        </div>
                        {isCarry && (
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'hsl(38 92% 92%)', color: 'hsl(32 85% 28%)', flexShrink: 0 }}>
                            Susulan {item.entryDate.slice(5)}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8, textAlign: 'center', fontSize: '0.75rem' }}>
                        <div style={{ background: 'var(--color-surface-elevated)', padding: '6px 4px', borderRadius: 8 }}>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.66rem' }}>Titip</div>
                          <strong>{item.qtyInitial}</strong>
                        </div>
                        <div style={{ background: 'var(--color-surface-elevated)', padding: '6px 4px', borderRadius: 8 }}>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.66rem' }}>Laku POS</div>
                          <strong style={{ color: 'hsl(145 65% 28%)' }}>{item.qtySoldPos}</strong>
                        </div>
                        <div style={{ background: 'var(--color-surface-elevated)', padding: '6px 4px', borderRadius: 8 }}>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.66rem' }}>Est. Sisa</div>
                          <strong>{Math.max(0, item.qtyInitial - item.qtySoldPos)}</strong>
                        </div>
                      </div>

                      {!isSettling ? (
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSettlingId(item.id);
                              setSisaInput(String(Math.max(0, item.qtyInitial - item.qtySoldPos)));
                              setPayoutSource('CASH_LACI');
                              setError(null);
                            }}
                            className="btn btn-primary btn-sm"
                            style={{ flex: 2, minHeight: 40, fontSize: '0.8rem', fontWeight: 700 }}
                          >
                            Hitung Sisa <ArrowRight size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCarryover(item.id)}
                            disabled={submitting}
                            className="btn btn-secondary btn-sm"
                            style={{ flex: 1, minHeight: 40, fontSize: '0.76rem' }}
                          >
                            <Clock size={13} /> Besok
                          </button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <label style={{ fontSize: '0.7rem', fontWeight: 700, display: 'block', marginBottom: 3 }}>
                                Sisa Fisik
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={item.qtyInitial}
                                className="form-input"
                                value={sisaInput}
                                onChange={(e) => setSisaInput(e.target.value)}
                                style={{ minHeight: 42, fontWeight: 800, fontSize: '1rem' }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.7rem', fontWeight: 700, display: 'block', marginBottom: 3 }}>
                                Sumber Bayar
                              </label>
                              <select
                                className="form-input"
                                value={payoutSource}
                                onChange={(e) => setPayoutSource(e.target.value as 'CASH_LACI' | 'TRANSFER_PENGELOLA')}
                                style={{ minHeight: 42, fontSize: '0.8rem' }}
                              >
                                <option value="CASH_LACI">Cash Laci</option>
                                <option value="TRANSFER_PENGELOLA">Transfer Bu Dyah</option>
                              </select>
                            </div>
                          </div>

                          {previewLakuFisik !== null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: previewDiff !== 0 ? 'hsl(0 84% 96%)' : 'hsl(145 60% 96%)', fontSize: '0.78rem' }}>
                              <div>
                                Laku fisik: <strong>{previewLakuFisik} {item.productUnit}</strong>
                                {previewDiff !== 0 && (
                                  <span style={{ display: 'block', color: 'hsl(0 72% 40%)', fontWeight: 700 }}>
                                    Selisih vs POS: {previewDiff > 0 ? `+${previewDiff}` : previewDiff} pcs
                                  </span>
                                )}
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>Bayar Mitra</div>
                                <strong style={{ fontSize: '0.92rem' }}>{rp(previewPay)}</strong>
                              </div>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => setSettlingId(null)}
                              className="btn btn-secondary btn-sm"
                              style={{ flex: 1, minHeight: 42 }}
                              disabled={submitting}
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSettle(item)}
                              className="btn btn-primary btn-sm"
                              style={{ flex: 2, minHeight: 42, fontWeight: 700 }}
                              disabled={submitting}
                            >
                              {submitting ? 'Memproses...' : 'Bayar & Selesai'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {settledToday.length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                    Selesai Hari Ini ({settledToday.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {settledToday.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'var(--color-surface-elevated)',
                          fontSize: '0.76rem',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {item.productName} <span style={{ fontWeight: 400 }}>({item.mitraName})</span>
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                            Titip {item.qtyInitial} · Laku {item.qtySoldPhysical} · Sisa {item.qtyRemaining}
                            {item.qtyDiscrepancy !== 0 ? ` · Selisih ${item.qtyDiscrepancy}` : ''}
                          </div>
                        </div>
                        <strong style={{ color: 'hsl(145 65% 28%)' }}>{rp(item.totalPayout)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
