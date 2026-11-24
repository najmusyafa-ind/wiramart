'use client';

// =============================================================
// BatchStokTab.tsx — Tab Manajemen Batch Stok & FEFO Kedaluwarsa
// Smartkasir Perwira (Wiramart UNPERBA)
// Fitur:
// 1. KPI Alert Kedaluwarsa (Expired, H-7 Kritis, H-30 Perhatian)
// 2. Filter Kelas Umur Simpan (HARIAN, PENDEK, PANJANG)
// 3. Modal Input Penerimaan Barang Masuk (Batch Baru)
// 4. Tabel inventaris per-batch & pelacakan FEFO
// =============================================================

import { useState, useEffect, useCallback, useId, useMemo } from 'react';
import {
  Package, AlertTriangle, AlertCircle, CheckCircle2, Clock, Plus,
  Search, RefreshCw, Loader2, X,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils/helpers';
import { useAdmin } from '../PortalLayoutClient';

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

type BatchStatusFilter = 'ALL' | 'EXPIRED' | 'EXPIRING_7' | 'EXPIRING_30' | 'ACTIVE';

type BatchFetchResult =
  | { ok: true; batches: BatchItem[]; summary: BatchSummary }
  | { ok: false; error: string };

async function requestBatches(
  statusFilter: BatchStatusFilter,
  expiryClassFilter: string,
  search: string,
  signal?: AbortSignal,
): Promise<BatchFetchResult> {
  const params = new URLSearchParams();
  if (statusFilter !== 'ALL') params.set('status', statusFilter);
  if (expiryClassFilter !== 'ALL') params.set('expiryClass', expiryClassFilter);
  if (search.trim()) params.set('q', search.trim());

  const res = await fetch(`/api/admin/gudang/batch?${params.toString()}`, { signal });
  const j = await res.json() as {
    success?: boolean;
    data?: { batches: BatchItem[]; summary: BatchSummary };
    error?: string;
  };

  if (res.ok && j.success && j.data) {
    return { ok: true, batches: j.data.batches, summary: j.data.summary };
  }
  return { ok: false, error: j.error || 'Gagal memuat data batch.' };
}

export default function BatchStokTab({
  onBatchUpdated,
  initialSearch = '',
}: {
  onBatchUpdated?: () => void;
  initialSearch?: string;
}) {
  const uid = useId();
  const { isManager } = useAdmin();
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
  const [prevInitialSearch, setPrevInitialSearch] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  if (initialSearch !== prevInitialSearch) {
    setPrevInitialSearch(initialSearch);
    if (initialSearch) {
      setSearch(initialSearch);
    }
  }

  const [statusFilter, setStatusFilter] = useState<BatchStatusFilter>('ALL');
  const [expiryClassFilter, setExpiryClassFilter] = useState<string>('ALL');

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);

  const applyBatchResult = useCallback((result: BatchFetchResult) => {
    if (result.ok) {
      setBatches(result.batches);
      setSummary(result.summary);
    } else {
      setError(result.error);
    }
  }, []);

  const startFilterTransition = (applyFilter: () => void) => {
    setLoading(true);
    setError('');
    applyFilter();
  };

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await requestBatches(statusFilter, expiryClassFilter, search);
      applyBatchResult(result);
    } catch {
      setError('Kesalahan jaringan saat memuat batch.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, expiryClassFilter, applyBatchResult]);

  useEffect(() => {
    const controller = new AbortController();

    requestBatches(statusFilter, expiryClassFilter, search, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          applyBatchResult(result);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setError('Kesalahan jaringan saat memuat batch.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [search, statusFilter, expiryClassFilter, applyBatchResult]);

  // Lacak batch aktif pertama per produk untuk visualisasi urutan FEFO
  const firstActiveBatchPerProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) {
      if (b.currentQty > 0 && !map.has(b.productId)) {
        map.set(b.productId, b.id);
      }
    }
    return map;
  }, [batches]);

  return (
    <div>
      {/* 1. KPI Alert Kedaluwarsa Cards (2x2 di HP, 4-kolom di Desktop) */}
      <div className="rep-kpi-grid" style={{ marginBottom: 'var(--space-4)' }}>
        {/* Card 1: Expired */}
        <button
          type="button"
          aria-pressed={statusFilter === 'EXPIRED'}
          onClick={() => startFilterTransition(() => setStatusFilter(statusFilter === 'EXPIRED' ? 'ALL' : 'EXPIRED'))}
          className="rep-kpi"
          style={{
            textAlign: 'left',
            border: `1.5px solid ${statusFilter === 'EXPIRED' || summary.expiredCount > 0 ? 'var(--color-error)' : '#e2e8f0'}`,
            backgroundColor: summary.expiredCount > 0 ? 'hsl(0 84% 60% / 0.06)' : '#ffffff',
            cursor: 'pointer',
          }}
        >
          <span className="rep-kpi__top">
            <span className="rep-kpi__label" style={{ color: 'var(--color-error)' }}>Kedaluwarsa</span>
          </span>
          <span className="rep-kpi__val" style={{ color: 'var(--color-error)' }}>
            {summary.expiredCount} Batch
          </span>
          <span className="rep-kpi__sub">Tarik dari rak</span>
        </button>

        {/* Card 2: Expiring < 7 Days */}
        <button
          type="button"
          aria-pressed={statusFilter === 'EXPIRING_7'}
          onClick={() => startFilterTransition(() => setStatusFilter(statusFilter === 'EXPIRING_7' ? 'ALL' : 'EXPIRING_7'))}
          className="rep-kpi"
          style={{
            textAlign: 'left',
            border: `1.5px solid ${statusFilter === 'EXPIRING_7' || summary.expiring7Count > 0 ? 'hsl(38 92% 50%)' : '#e2e8f0'}`,
            backgroundColor: summary.expiring7Count > 0 ? 'hsl(38 92% 50% / 0.07)' : '#ffffff',
            cursor: 'pointer',
          }}
        >
          <span className="rep-kpi__top">
            <span className="rep-kpi__label" style={{ color: 'hsl(38 92% 32%)' }}>Kritis (&le; 7 Hr)</span>
          </span>
          <span className="rep-kpi__val" style={{ color: 'hsl(38 92% 32%)' }}>
            {summary.expiring7Count} Batch
          </span>
          <span className="rep-kpi__sub">Prioritas obral</span>
        </button>

        {/* Card 3: Expiring < 30 Days */}
        <button
          type="button"
          aria-pressed={statusFilter === 'EXPIRING_30'}
          onClick={() => startFilterTransition(() => setStatusFilter(statusFilter === 'EXPIRING_30' ? 'ALL' : 'EXPIRING_30'))}
          className="rep-kpi"
          style={{
            textAlign: 'left',
            border: `1.5px solid ${statusFilter === 'EXPIRING_30' ? 'var(--color-info)' : '#e2e8f0'}`,
            cursor: 'pointer',
          }}
        >
          <span className="rep-kpi__top">
            <span className="rep-kpi__label" style={{ color: 'var(--color-info)' }}>Pantau (&le; 30 Hr)</span>
          </span>
          <span className="rep-kpi__val">{summary.expiring30Count} Batch</span>
          <span className="rep-kpi__sub">Cek retur pemasok</span>
        </button>

        {/* Card 4: Total Active Batches */}
        <button
          type="button"
          aria-pressed={statusFilter === 'ALL'}
          onClick={() => {
            if (statusFilter !== 'ALL') startFilterTransition(() => setStatusFilter('ALL'));
          }}
          className="rep-kpi"
          style={{
            textAlign: 'left',
            border: `1.5px solid ${statusFilter === 'ALL' ? 'var(--color-primary)' : '#e2e8f0'}`,
            cursor: 'pointer',
          }}
        >
          <span className="rep-kpi__top">
            <span className="rep-kpi__label">Total Batch</span>
          </span>
          <span className="rep-kpi__val" style={{ color: 'var(--color-primary)' }}>{summary.totalBatches} Batch</span>
          <span className="rep-kpi__sub">{summary.totalStockInBatches.toLocaleString('id-ID')} unit terdata</span>
        </button>
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
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', flex: '1 1 240px', minWidth: 0 }}>
            <div className="form-input-icon" style={{ flex: '1 1 180px', minWidth: 0 }}>
              <Search size={15} className="form-input-icon__icon" aria-hidden="true" />
              <input
                id={`${uid}-search`}
                type="text"
                aria-label="Cari produk, kode batch, atau barcode"
                className="form-input"
                style={{ minHeight: 44, fontSize: 'var(--text-base)' }}
                placeholder="Cari produk / kode batch / barcode..."
                value={search}
                onChange={(e) => startFilterTransition(() => setSearch(e.target.value))}
              />
            </div>

            <select
              aria-label="Filter status kedaluwarsa"
              className="form-input form-select"
              style={{ flex: '1 1 180px', maxWidth: '100%', minHeight: 44, fontSize: 'var(--text-base)' }}
              value={statusFilter}
              onChange={(e) => startFilterTransition(() => setStatusFilter(e.target.value as BatchStatusFilter))}
            >
              <option value="ALL">Semua Status Kedaluwarsa</option>
              <option value="EXPIRED">Sudah Kedaluwarsa</option>
              <option value="EXPIRING_7">Kritis (&le; 7 Hari)</option>
              <option value="EXPIRING_30">Perhatian (&le; 30 Hari)</option>
              <option value="ACTIVE">Hanya yang Ada Stok (&gt; 0)</option>
            </select>

            <select
              aria-label="Filter kelas umur simpan"
              className="form-input form-select"
              style={{ flex: '1 1 180px', maxWidth: '100%', minHeight: 44, fontSize: 'var(--text-base)' }}
              value={expiryClassFilter}
              onChange={(e) => startFilterTransition(() => setExpiryClassFilter(e.target.value))}
            >
              <option value="ALL">Semua Kelas Umur Simpan</option>
              <option value="HARIAN">HARIAN (Basi hari ini)</option>
              <option value="PENDEK">PENDEK (Susu, Roti basah)</option>
              <option value="PANJANG">PANJANG (Snack, Minuman)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={fetchBatches}
              className="btn btn-secondary btn-sm"
              title="Segarkan data batch"
              aria-label="Segarkan data batch"
              style={{ minWidth: 44, minHeight: 44, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
            </button>

            {isManager && (
              <button
                type="button"
                id="btn-tambah-batch"
                onClick={() => setShowAddModal(true)}
                className="btn btn-primary btn-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  minHeight: 44,
                  padding: '8px 14px',
                  backgroundColor: 'hsl(142 71% 35%)',
                  borderColor: 'hsl(142 71% 30%)',
                }}
              >
                <Plus size={16} />
                Terima Barang (Batch Masuk)
              </button>
            )}
          </div>
        </div>
      </div>

      {!isManager && (
        <div
          role="status"
          style={{
            marginBottom: 'var(--space-4)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface-alt)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Mode Pantau Batch: Untuk <strong>Stok Opname (Tambah, Edit, Koreksi Stok, dan Hapus Produk)</strong>, gunakan tab <strong>Katalog</strong>. Penambahan batch gudang langsung tetap memerlukan persetujuan Manager.
        </div>
      )}

      {/* 3. Table & Mobile Cards of Stock Batches */}
      <div className="card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Loader2 size={32} className="spin-icon" style={{ margin: '0 auto var(--space-3)' }} />
              <p>Memuat daftar batch stok...</p>
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
            <>
            <div className="table-wrapper rep-desktop-only" style={{ margin: 0, border: 'none', borderRadius: 0, WebkitOverflowScrolling: 'touch' }}>
            <table className="table" aria-label="Daftar batch stok produk">
              <thead>
                <tr>
                  <th scope="col">Produk</th>
                  <th scope="col">Kode Batch</th>
                  <th scope="col">Kelas Umur</th>
                  <th scope="col">Kedaluwarsa</th>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
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
                          {b.currentQty > 0 ? (
                            firstActiveBatchPerProduct.get(b.productId) === b.id ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  backgroundColor: '#dcfce7',
                                  color: '#15803d',
                                  border: '1px solid #86efac',
                                  borderRadius: '4px',
                                  padding: '1px 5px',
                                }}
                              >
                                PRIORITAS 1
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  backgroundColor: '#f1f5f9',
                                  color: '#475569',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  padding: '1px 5px',
                                }}
                              >
                                Batch Cadangan
                              </span>
                            )
                          ) : (
                            <span
                              style={{
                                fontSize: '0.68rem',
                                color: '#94a3b8',
                                fontStyle: 'italic',
                              }}
                            >
                              Habis terjual
                            </span>
                          )}
                        </div>
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
            </div>

            {/* Mobile Cards — Batch Stok */}
            <div className="rep-mobile-only" style={{ padding: 'var(--space-3)' }}>
              {batches.map((b) => {
                const isExpired = b.expiryStatus === 'EXPIRED';
                const isCritical = b.expiryStatus === 'CRITICAL_7';
                const isPriority = b.currentQty > 0 && firstActiveBatchPerProduct.get(b.productId) === b.id;
                return (
                  <div
                    key={b.id}
                    className="rep-mcard"
                    style={{
                      background: isExpired ? 'hsl(0 84% 98%)' : isCritical ? 'hsl(38 95% 97%)' : '#ffffff',
                    }}
                  >
                    <div className="rep-mcard__top">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--color-text)' }}>
                          {b.productName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {b.batchCode}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                        <span className={`badge ${b.expiryClass === 'HARIAN' ? 'badge-warning' : b.expiryClass === 'PENDEK' ? 'badge-info' : 'badge-secondary'}`} style={{ fontSize: '0.66rem' }}>
                          {b.expiryClass}
                        </span>
                        {isPriority && (
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#15803d', background: '#dcfce7', padding: '1px 5px', borderRadius: 4 }}>
                            PRIORITAS 1
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rep-mcard__grid">
                      <div>
                        <div className="rep-mcard__k">Kedaluwarsa</div>
                        <div className="rep-mcard__v" style={{ color: isExpired ? 'var(--color-error)' : isCritical ? 'hsl(38 92% 32%)' : '#0f172a' }}>
                          {b.expiryDate
                            ? new Date(b.expiryDate + 'T00:00:00Z').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
                            : 'Tidak ada tgl'}
                          {b.daysRemaining !== null && (
                            <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 600 }}>
                              {isExpired ? `${Math.abs(b.daysRemaining)} hr lalu` : `Sisa ${b.daysRemaining} hr`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="rep-mcard__k">Sisa / Awal</div>
                        <div className="rep-mcard__v">
                          {b.currentQty} / {b.initialQty} {b.productUnit}
                        </div>
                      </div>
                      <div>
                        <div className="rep-mcard__k">HPP Masuk</div>
                        <div className="rep-mcard__v">{formatRupiah(parseFloat(b.costPrice))}</div>
                      </div>
                      <div>
                        <div className="rep-mcard__k">Tgl Diterima</div>
                        <div className="rep-mcard__v">
                          {new Date(b.receivedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                    </div>
                    {b.notes && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
                        Catatan: {b.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}
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
        padding:
          'calc(var(--space-3) + env(safe-area-inset-top, 0px)) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom, 0px))',
        backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 540, maxHeight: '90dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" style={{ fontSize: 'var(--text-base)', margin: 0 }}>
              Penerimaan Barang Masuk (Batch FEFO)
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
              Catat batch masuk baru dari pemasok beserta masa kedaluwarsa
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup form"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              minWidth: 44,
              minHeight: 44,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              borderRadius: 'var(--radius-md)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card-body" style={{ paddingBottom: 'calc(var(--space-5) + env(safe-area-inset-bottom, 0px))' }}>
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
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 'var(--space-3)' }}>
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
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
                />
              </div>

              <div>
                <label htmlFor={`${uid}-class`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Kelas Umur Simpan <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <select
                  id={`${uid}-class`}
                  className="form-input form-select"
                  value={expiryClass}
                  onChange={(e) => setExpiryClass(e.target.value as typeof expiryClass)}
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
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
                style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor={`${uid}-cost`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  HPP Kulakan (Rp) <span style={{ color: 'var(--color-error)' }}>*</span>
                </label>
                <input
                  id={`${uid}-cost`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  className="form-input"
                  placeholder="0"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
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
                  inputMode="numeric"
                  min="1"
                  className="form-input"
                  placeholder="0"
                  value={initialQty}
                  onChange={(e) => setInitialQty(e.target.value)}
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
                  required
                />
              </div>
            </div>

            {/* 5. Nama Pemasok / Supplier & Catatan */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 'var(--space-3)' }}>
              <div>
                <label htmlFor={`${uid}-supplier`} className="form-label" style={{ fontSize: '0.8rem' }}>
                  Nama Pemasok / Supplier
                </label>
                <input
                  id={`${uid}-supplier`}
                  type="text"
                  className="form-input"
                  placeholder="Contoh: Koperasi / PT ABC"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
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
                  style={{ fontSize: 'var(--text-base)', minHeight: 44 }}
                />
              </div>
            </div>

            {/* Tombol Simpan */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" style={{ minHeight: 44, padding: '8px 16px' }} disabled={submitting}>
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
                  minHeight: 44,
                  padding: '8px 16px',
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
