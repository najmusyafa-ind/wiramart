'use client';

// =============================================================
// BatchStokTab.tsx — Tab Manajemen Batch Stok & FEFO Kedaluwarsa
// Smartkasir Perwira (Wiramart UNPERBA)
// Fitur:
//   1. KPI Alert Kedaluwarsa (Expired, H-7 Kritis, H-30 Perhatian)
//   2. Filter Kelas Umur Simpan (HARIAN, PENDEK, PANJANG)
//   3. Modal Input Penerimaan Barang Masuk (Batch Baru)
//   4. Tabel inventaris per-batch & pelacakan FEFO
// =============================================================

import { useState, useEffect, useCallback, useId } from 'react';
import {
  Package, AlertTriangle, AlertCircle, CheckCircle2, Clock, Plus,
  Search, RefreshCw, Loader2, X, ShieldAlert, Calendar, Truck, Tag,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils/helpers';

export type BatchItem = {
  id: string;
  productId: string;
  productName: string;
  productBarcode: string | null;
  productUnit: string;
  productTotalStock: number;
  batchCode: string;
  costPrice: string;
  initialQty: number;
  currentQty: number;
  expiryDate: string | null;
  expiryClass: 'HARIAN' | 'PENDEK' | 'PANJANG';
  expiryStatus: 'EXPIRED' | 'CRITICAL_7' | 'WARNING_30' | 'SAFE' | 'NO_EXPIRY';
  daysRemaining: number | null;
  receivedAt: string;
  notes: string | null;
  createdAt: string;
};

type BatchSummary = {
  totalBatches: number;
  totalStockInBatches: number;
  expiredCount: number;
  expiring7Count: number;
  expiring30Count: number;
};

type ProductOption = {
  id: string;
  name: string;
  barcode: string | null;
  costPrice: string;
  unit: string;
  stockQty: number;
};

export default function BatchStokTab({
  onBatchUpdated,
}: {
  onBatchUpdated?: () => void;
}) {
  const uid = useId();
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [summary, setSummary] = useState<BatchSummary>({
    totalBatches: 0,
    totalStockInBatches: 0,
    expiredCount: 0,
    expiring7Count: 0,
    expiring30Count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'EXPIRED' | 'EXPIRING_7' | 'EXPIRING_30' | 'ACTIVE'>('ALL');
  const [expiryClassFilter, setExpiryClassFilter] = useState<string>('ALL');

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (expiryClassFilter !== 'ALL') params.set('expiryClass', expiryClassFilter);
      if (search.trim()) params.set('q', search.trim());

      const res = await fetch(`/api/admin/gudang/batch?${params.toString()}`);
      const j = await res.json() as {
        success?: boolean;
        data?: { batches: BatchItem[]; summary: BatchSummary };
        error?: string;
      };

      if (res.ok && j.success && j.data) {
        setBatches(j.data.batches);
        setSummary(j.data.summary);
      } else {
        setError(j.error || 'Gagal memuat data batch.');
      }
    } catch {
      setError('Kesalahan jaringan saat memuat batch.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, expiryClassFilter]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  return (
    <div>
      {/* 1. KPI Alert Kedaluwarsa Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-5)',
        }}
      >
        {/* Card 1: Expired */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'EXPIRED' ? 'ALL' : 'EXPIRED')}
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${summary.expiredCount > 0 ? 'var(--color-error)' : 'var(--color-border)'}`,
            backgroundColor: summary.expiredCount > 0 ? 'hsl(0 84% 60% / 0.08)' : 'var(--color-surface)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-error)' }}>
              🚨 Sudah Kedaluwarsa
            </span>
            <span className="badge badge-error" style={{ fontSize: '0.7rem' }}>
              Wajib Write-Off
            </span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 'var(--space-2)', color: 'var(--color-error)' }}>
            {summary.expiredCount} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Batch</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Diblokir otomatis oleh POS
          </div>
        </div>

        {/* Card 2: Expiring < 7 Days */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'EXPIRING_7' ? 'ALL' : 'EXPIRING_7')}
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${summary.expiring7Count > 0 ? 'hsl(38 92% 50%)' : 'var(--color-border)'}`,
            backgroundColor: summary.expiring7Count > 0 ? 'hsl(38 92% 50% / 0.08)' : 'var(--color-surface)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(38 92% 40%)' }}>
              ⚠️ Kritis (&le; 7 Hari)
            </span>
            <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
              FEFO Prioritas
            </span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 'var(--space-2)', color: 'hsl(38 92% 40%)' }}>
            {summary.expiring7Count} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Batch</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Segera diskon sore / bundling
          </div>
        </div>

        {/* Card 3: Expiring < 30 Days */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'EXPIRING_30' ? 'ALL' : 'EXPIRING_30')}
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-info)' }}>
              ⏳ Perhatian (&le; 30 Hari)
            </span>
            <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
              Pantau Stok
            </span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 'var(--space-2)', color: 'var(--color-text)' }}>
            {summary.expiring30Count} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Batch</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Retur ke pemasok jika slow-moving
          </div>
        </div>

        {/* Card 4: Total Active Batches */}
        <div
          onClick={() => setStatusFilter('ALL')}
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)' }}>
              📦 Total Batch Terdata
            </span>
            <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>
              FEFO Active
            </span>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 'var(--space-2)', color: 'var(--color-primary)' }}>
            {summary.totalBatches} <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Batch</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Total {summary.totalStockInBatches.toLocaleString('id-ID')} unit terdaftar
          </div>
        </div>
      </div>

      {/* 2. Control Toolbar & Actions */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div
          className="card-body"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Search & Filters */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', flex: 1, minWidth: 280 }}>
            <div className="form-input-icon" style={{ flex: 1, minWidth: 180 }}>
              <Search size={15} className="form-input-icon__icon" aria-hidden="true" />
              <input
                id={`${uid}-search`}
                type="text"
                className="form-input"
                style={{ height: 38, fontSize: '0.85rem' }}
                placeholder="Cari produk / kode batch / barcode..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="form-input"
              style={{ width: 'auto', height: 38, fontSize: '0.85rem' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="ALL">Semua Status Kedaluwarsa</option>
              <option value="EXPIRED">🚨 Sudah Kedaluwarsa</option>
              <option value="EXPIRING_7">⚠️ Kritis (&le; 7 Hari)</option>
              <option value="EXPIRING_30">⏳ Perhatian (&le; 30 Hari)</option>
              <option value="ACTIVE">Hanya yang Ada Stok (&gt; 0)</option>
            </select>

            <select
              className="form-input"
              style={{ width: 'auto', height: 38, fontSize: '0.85rem' }}
              value={expiryClassFilter}
              onChange={(e) => setExpiryClassFilter(e.target.value)}
            >
              <option value="ALL">Semua Kelas Umur Simpan</option>
              <option value="HARIAN">HARIAN (Basi hari ini)</option>
              <option value="PENDEK">PENDEK (Susu, Roti basah)</option>
              <option value="PANJANG">PANJANG (Snack, Minuman)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={fetchBatches}
              className="btn btn-secondary btn-sm"
              title="Segarkan data batch"
              style={{ height: 38 }}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            </button>

            <button
              id="btn-tambah-batch"
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                height: 38,
                backgroundColor: 'hsl(142 71% 35%)',
                borderColor: 'hsl(142 71% 30%)',
              }}
            >
              <Plus size={16} />
              Terima Barang (Batch Masuk)
            </button>
          </div>
        </div>
      </div>

      {/* 3. Table of Stock Batches */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper" style={{ margin: 0, border: 'none', borderRadius: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Loader2 size={32} className="spin-icon" style={{ margin: '0 auto var(--space-3)' }} />
              <p>Memuat daftar batch stok FEFO...</p>
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-error)' }}>
              <AlertCircle size={32} style={{ margin: '0 auto var(--space-3)' }} />
              <p>{error}</p>
            </div>
          ) : batches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Package size={36} style={{ margin: '0 auto var(--space-3)', opacity: 0.4 }} />
              <p>Tidak ada batch stok yang sesuai dengan filter.</p>
            </div>
          ) : (
            <table className="table" aria-label="Daftar batch stok produk FEFO">
              <thead>
                <tr>
                  <th scope="col">Produk</th>
                  <th scope="col">Kode Batch</th>
                  <th scope="col">Kelas Umur</th>
                  <th scope="col">Kedaluwarsa (FEFO)</th>
                  <th scope="col" className="text-right">HPP Masuk</th>
                  <th scope="col" className="text-center">Sisa / Awal</th>
                  <th scope="col">Tgl Diterima</th>
                  <th scope="col">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const isExpired = b.expiryStatus === 'EXPIRED';
                  const isCritical = b.expiryStatus === 'CRITICAL_7';
                  const isWarning = b.expiryStatus === 'WARNING_30';

                  return (
                    <tr
                      key={b.id}
                      style={{
                        backgroundColor: isExpired
                          ? 'hsl(0 84% 60% / 0.05)'
                          : isCritical
                          ? 'hsl(38 92% 50% / 0.05)'
                          : undefined,
                      }}
                    >
                      {/* Produk */}
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                          {b.productName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                          Barcode: {b.productBarcode || '—'} &bull; Total Stok Rak: {b.productTotalStock} {b.productUnit}
                        </div>
                      </td>

                      {/* Kode Batch */}
                      <td>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            backgroundColor: 'var(--color-surface-elevated)',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          {b.batchCode}
                        </span>
                      </td>

                      {/* Kelas Umur Simpan */}
                      <td>
                        <span
                          className={`badge ${
                            b.expiryClass === 'HARIAN'
                              ? 'badge-warning'
                              : b.expiryClass === 'PENDEK'
                              ? 'badge-info'
                              : 'badge-secondary'
                          }`}
                          style={{ fontSize: '0.7rem' }}
                        >
                          {b.expiryClass}
                        </span>
                      </td>

                      {/* Kedaluwarsa */}
                      <td>
                        {b.expiryDate ? (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                              {new Date(b.expiryDate + 'T00:00:00Z').toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </div>
                            {isExpired ? (
                              <span
                                className="badge badge-error"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', marginTop: 2 }}
                              >
                                <AlertTriangle size={10} /> Kedaluwarsa ({Math.abs(b.daysRemaining || 0)} hr lalu)
                              </span>
                            ) : isCritical ? (
                              <span
                                className="badge badge-warning"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', marginTop: 2 }}
                              >
                                <Clock size={10} /> Sisa {b.daysRemaining} hari lagi
                              </span>
                            ) : isWarning ? (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  color: 'var(--color-info)',
                                  fontWeight: 500,
                                  display: 'block',
                                  marginTop: 2,
                                }}
                              >
                                Sisa {b.daysRemaining} hari
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.68rem', color: 'var(--color-success)', fontWeight: 500 }}>
                                Aman ({b.daysRemaining} hr)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            Tidak ada tgl
                          </span>
                        )}
                      </td>

                      {/* HPP */}
                      <td className="text-right" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {formatRupiah(parseFloat(b.costPrice))}
                      </td>

                      {/* Sisa / Awal */}
                      <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            fontWeight: 700,
                            color: b.currentQty === 0 ? 'var(--color-text-muted)' : isExpired ? 'var(--color-error)' : 'inherit',
                          }}
                        >
                          {b.currentQty}
                        </span>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                          {' '}/ {b.initialQty} {b.productUnit}
                        </span>
                      </td>

                      {/* Tgl Masuk */}
                      <td style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(b.receivedAt).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Catatan / Pemasok */}
                      <td style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', maxWidth: 160 }}>
                        {b.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 4. Modal Penerimaan Barang Masuk (Batch Baru) */}
      {showAddModal && (
        <PenerimaanBarangModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchBatches();
            onBatchUpdated?.();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Modal Form: Penerimaan Barang Masuk (Batch Baru)
// ─────────────────────────────────────────────────────────────
function PenerimaanBarangModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uid = useId();
  const [productList, setProductList] = useState<ProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  // Form State
  const [selectedProductId, setSelectedProductId] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [initialQty, setInitialQty] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [expiryClass, setExpiryClass] = useState<'HARIAN' | 'PENDEK' | 'PANJANG'>('PANJANG');
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load products for dropdown
  useEffect(() => {
    fetch('/api/admin/produk')
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: { products?: ProductOption[] } }) => {
        if (j.success && Array.isArray(j.data?.products)) {
          setProductList(j.data.products);
        }
      })
      .catch(() => setError('Gagal memuat daftar produk.'))
      .finally(() => setProductsLoading(false));
  }, []);

  // When product is selected, auto-fill default HPP and generate batch code
  function handleProductChange(prodId: string) {
    setSelectedProductId(prodId);
    const prod = productList.find((p) => p.id === prodId);
    if (prod) {
      setCostPrice(prod.costPrice ? parseFloat(prod.costPrice).toString() : '0');
      const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      setBatchCode(`BATCH-${nowStr}-${Math.floor(100 + Math.random() * 900)}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductId) {
      setError('Silakan pilih produk yang diterima.');
      return;
    }
    const qtyNum = parseInt(initialQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setError('Kuantitas masuk harus bilangan bulat positif.');
      return;
    }
    const costNum = parseFloat(costPrice);
    if (isNaN(costNum) || costNum < 0) {
      setError('HPP masuk harus berupa angka non-negatif.');
      return;
    }
    if ((expiryClass === 'HARIAN' || expiryClass === 'PENDEK') && !expiryDate) {
      setError(`Produk dengan kelas umur simpan "${expiryClass}" wajib mengisi tanggal kedaluwarsa.`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/admin/gudang/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProductId,
          batchCode: batchCode.trim() || undefined,
          costPrice: costNum,
          initialQty: qtyNum,
          expiryDate: expiryDate || null,
          expiryClass,
          supplierName: supplierName.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const j = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error || 'Gagal menyimpan penerimaan batch.');
        return;
      }

      onSuccess();
    } catch {
      setError('Kesalahan jaringan saat menyimpan batch.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: 'var(--text-base)', margin: 0 }}>
              Penerimaan Barang Masuk (Batch FEFO)
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
              Catat batch masuk baru dari pemasok beserta masa kedaluwarsa
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup form"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card-body">
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)', fontSize: '0.8rem' }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* 1. Pilih Produk */}
            <div>
              <label htmlFor={`${uid}-prod`} className="form-label" style={{ fontSize: '0.8rem' }}>
                Pilih Produk <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              {productsLoading ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Memuat daftar produk...</div>
              ) : (
                <select
                  id={`${uid}-prod`}
                  className="form-input"
                  value={selectedProductId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  required
                >
                  <option value="">-- Pilih Produk --</option>
                  {productList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stok: {p.stockQty} {p.unit}) {p.barcode ? `[${p.barcode}]` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 2. Kode Batch & Kelas Umur */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor={`${uid}-code`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Kode Batch
                </label>
                <input
                  id={`${uid}-code`}
                  type="text"
                  className="form-input"
                  placeholder="BATCH-YYYYMMDD-..."
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor={`${uid}-class`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Kelas Umur Simpan <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <select
                  id={`${uid}-class`}
                  className="form-input"
                  value={expiryClass}
                  onChange={(e) => setExpiryClass(e.target.value as typeof expiryClass)}
                  required
                >
                  <option value="PANJANG">PANJANG (Snack, Minuman)</option>
                  <option value="PENDEK">PENDEK (Susu, Roti kemasan)</option>
                  <option value="HARIAN">HARIAN (Cepat basi / Siap saji)</option>
                </select>
              </div>
            </div>

            {/* 3. Tanggal Kedaluwarsa */}
            <div>
              <label htmlFor={`${uid}-exp`} className="form-label" style={{ fontSize: '0.8rem' }}>
                Tanggal Kedaluwarsa (Expiry Date){' '}
                {expiryClass !== 'PANJANG' && <span style={{ color: 'var(--color-error)' }}>*</span>}
              </label>
              <input
                id={`${uid}-exp`}
                type="date"
                className="form-input"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                required={expiryClass !== 'PANJANG'}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                {expiryClass === 'HARIAN'
                  ? 'Wajib diisi. Produk akan diblokir jual setelah tanggal ini.'
                  : expiryClass === 'PENDEK'
                  ? 'Wajib diisi. Peringatan H-7 & H-3 akan aktif.'
                  : 'Opsional untuk makanan kering / tahan lama.'}
              </span>
            </div>

            {/* 4. HPP & Kuantitas Masuk */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor={`${uid}-cost`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  HPP Kulakan (Rp) <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <input
                  id={`${uid}-cost`}
                  type="number"
                  step="any"
                  min="0"
                  className="form-input"
                  placeholder="0"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor={`${uid}-qty`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Kuantitas Masuk <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <input
                  id={`${uid}-qty`}
                  type="number"
                  min="1"
                  className="form-input"
                  placeholder="0"
                  value={initialQty}
                  onChange={(e) => setInitialQty(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* 5. Nama Pemasok / Supplier & Catatan */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor={`${uid}-supplier`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Nama Pemasok / Supplier
                </label>
                <input
                  id={`${uid}-supplier`}
                  type="text"
                  className="form-input"
                  placeholder="Contoh: Bu Dyah / Koperasi / PT ABC"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor={`${uid}-notes`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Catatan Tambahan
                </label>
                <input
                  id={`${uid}-notes`}
                  type="text"
                  className="form-input"
                  placeholder="No. Faktur / Keterangan rak"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Tombol Simpan */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={submitting}>
                Batal
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  backgroundColor: 'hsl(142 71% 35%)',
                  borderColor: 'hsl(142 71% 30%)',
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="spin-icon" /> Menyimpan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Simpan Penerimaan Batch
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
