'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Package, CheckCircle, XCircle, Clock, Loader2, Sparkles,
  ArrowRight, ShieldCheck, AlertCircle, RefreshCw,
} from 'lucide-react';

type Proposal = {
  id: string;
  name: string;
  barcode: string | null;
  unit: string;
  photoUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
  createdAt: string;
  categoryId: string;
  categoryName: string | null;
  proposedBy: {
    id: string;
    fullName: string;
    nim: string;
    programStudi: string | null;
  } | null;
};

export default function UsulanProdukTab({
  onApproved,
}: {
  onApproved?: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [globalMargin, setGlobalMargin] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');

  // Modal Review State
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [costPrice, setCostPrice] = useState<string>('');
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [initialStock, setInitialStock] = useState<string>('0');
  const [adminNote, setAdminNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/produk/usulan?status=${filter}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setProposals(json.data.proposals);
        setGlobalMargin(json.data.globalMargin ?? 20);
      }
    } catch (err) {
      console.error('Gagal mengambil usulan:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // Kalkulasi harga rekomendasi saat HPP diisi
  function handleCostPriceChange(val: string) {
    setCostPrice(val);
    const numHpp = parseFloat(val);
    if (!isNaN(numHpp) && numHpp > 0) {
      const marginFactor = 1 + (globalMargin / 100);
      // Pembulatan ke atas kelipatan 100 rupiah (aturan B8)
      const rawPrice = numHpp * marginFactor;
      const roundedPrice = Math.ceil(rawPrice / 100) * 100;
      setSellingPrice(roundedPrice.toString());
    } else {
      setSellingPrice('');
    }
  }

  function openReviewModal(p: Proposal) {
    setSelectedProposal(p);
    setCostPrice('');
    setSellingPrice('');
    setInitialStock('0');
    setAdminNote('');
    setErrorMsg('');
  }

  async function handleApprove() {
    if (!selectedProposal) return;
    const numCost = parseFloat(costPrice);
    const numSell = parseFloat(sellingPrice);
    const numStock = parseInt(initialStock, 10);

    if (isNaN(numCost) || numCost <= 0) {
      setErrorMsg('Harga Pokok Pembelian (HPP) wajib diisi lebih dari 0.');
      return;
    }
    if (isNaN(numSell) || numSell <= 0) {
      setErrorMsg('Harga jual harus lebih dari 0.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin/produk/usulan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: selectedProposal.id,
          action: 'APPROVE',
          costPrice: numCost,
          sellingPrice: numSell,
          initialStock: isNaN(numStock) ? 0 : Math.max(0, numStock),
          adminNote: adminNote.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Gagal menyetujui produk.');
        return;
      }

      setSelectedProposal(null);
      fetchProposals();
      if (onApproved) onApproved();
    } catch {
      setErrorMsg('Terjadi kesalahan jaringan.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!selectedProposal) return;
    const note = prompt('Masukkan alasan penolakan usulan (opsional):');
    if (note === null) return; // kasir cancel

    setRejecting(true);
    try {
      const res = await fetch('/api/admin/produk/usulan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: selectedProposal.id,
          action: 'REJECT',
          adminNote: note.trim() || 'Ditolak oleh admin/gudang',
        }),
      });
      if (res.ok) {
        fetchProposals();
      } else {
        alert('Gagal menolak usulan.');
      }
    } finally {
      setRejecting(false);
    }
  }

  const pendingCount = proposals.filter((p) => p.status === 'PENDING').length;

  return (
    <div>
      {/* Sub-header Filter */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 'var(--space-4)',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setFilter('PENDING')}
            className={`btn btn-sm ${filter === 'PENDING' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Menunggu Review ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`btn btn-sm ${filter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Semua Riwayat Usulan
          </button>
        </div>

        <button
          type="button"
          onClick={fetchProposals}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* List Usulan */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
          <Loader2 size={32} className="spin-icon" style={{ margin: '0 auto' }} />
          <p style={{ marginTop: 8, fontSize: 13 }}>Memuat data usulan kasir...</p>
        </div>
      ) : proposals.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 'var(--space-12)',
          background: 'var(--color-surface)',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
        }}>
          <Package size={40} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
          <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
            {filter === 'PENDING' ? 'Tidak ada usulan baru dari kasir.' : 'Belum ada riwayat usulan.'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Kasir dapat mengusulkan produk baru lewat menu Produk di aplikasi POS mereka.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {proposals.map((p) => (
            <div
              key={p.id}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              {/* Foto thumbnail */}
              <div style={{
                width: 64, height: 64, borderRadius: 10,
                background: 'var(--color-surface-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                {p.photoUrl ? (
                  <img src={p.photoUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Package size={28} color="var(--color-text-muted)" />
                )}
              </div>

              {/* Info Produk */}
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{p.name}</h3>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background:
                      p.status === 'PENDING'
                        ? 'rgba(234, 179, 8, 0.15)'
                        : p.status === 'APPROVED'
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'rgba(239, 68, 68, 0.15)',
                    color:
                      p.status === 'PENDING'
                        ? '#ca8a04'
                        : p.status === 'APPROVED'
                        ? '#16a34a'
                        : '#dc2626',
                  }}>
                    {p.status === 'PENDING' ? 'Menunggu Review' : p.status === 'APPROVED' ? 'Disetujui' : 'Ditolak'}
                  </span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <span>Kategori: <strong>{p.categoryName ?? '—'}</strong></span>
                  {p.barcode && <span>Barcode: <code>{p.barcode}</code></span>}
                  <span>Satuan: <strong>{p.unit}</strong></span>
                </div>

                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Diusulkan oleh: <strong>{p.proposedBy?.fullName ?? 'Kasir'}</strong> ({p.proposedBy?.nim ?? '—'}) · {new Date(p.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>

                {p.adminNote && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                    Catatan: {p.adminNote}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {p.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => openReviewModal(p)}
                    className="btn btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                  >
                    <ShieldCheck size={15} /> Review & Tentukan Harga
                  </button>
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={rejecting}
                    className="btn btn-secondary btn-sm"
                    style={{ color: 'var(--color-error)' }}
                  >
                    <XCircle size={15} /> Tolak
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Review & Penetapan HPP / Margin Global (K2 & K8) */}
      {selectedProposal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            background: 'var(--color-surface)',
            width: '100%', maxWidth: 500,
            borderRadius: 16, padding: '24px',
            boxShadow: 'var(--shadow-xl)',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0' }}>
              Penetapan HPP & Harga Jual Produk
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 16px 0' }}>
              Produk: <strong>{selectedProposal.name}</strong> ({selectedProposal.categoryName ?? 'Kategori'})
            </p>

            {errorMsg && (
              <div style={{
                background: 'var(--color-error-light)',
                color: 'var(--color-error)',
                padding: '10px 12px', borderRadius: 8,
                fontSize: 13, marginBottom: 16,
              }}>
                {errorMsg}
              </div>
            )}

            {/* Banner Otomasi Margin Global K2 */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 10,
              padding: '12px',
              fontSize: 12,
              marginBottom: 16,
              lineHeight: 1.5,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#059669', marginBottom: 2 }}>
                <Sparkles size={14} /> Otomasi Margin Global Toko: {globalMargin}%
              </div>
              Harga jual akan dihitung otomatis: <code>HPP × (1 + {globalMargin}%)</code>, dibulatkan ke atas ke ratusan terdekat.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Input HPP */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Harga Pokok Pembelian (HPP) / Modal Kulakan (Rp) *
                </label>
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  placeholder="Contoh: 3000"
                  value={costPrice}
                  onChange={(e) => handleCostPriceChange(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Input Harga Jual Final */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Harga Jual Kasir (Rp) *
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                    (Rekomendasi otomatis dihitung dari HPP + margin {globalMargin}%)
                  </span>
                </label>
                <input
                  type="number"
                  min={1}
                  className="form-input"
                  placeholder="Contoh: 3600"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                />
              </div>

              {/* Input Stok Awal */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Stok Fisik Awal di Rak ({selectedProposal.unit})
                </label>
                <input
                  type="number"
                  min={0}
                  className="form-input"
                  placeholder="0"
                  value={initialStock}
                  onChange={(e) => setInitialStock(e.target.value)}
                />
              </div>

              {/* Catatan Admin */}
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Catatan Admin / Gudang (opsional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Contoh: Kulakan dari Agen Berkah"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button
                type="button"
                onClick={() => setSelectedProposal(null)}
                className="btn btn-secondary"
                disabled={submitting}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="btn btn-primary"
                style={{ fontWeight: 700 }}
              >
                {submitting ? <><Loader2 size={16} className="spin-icon" /> Menyimpan...</> : '✅ Setujui & Rilis ke Katalog'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
