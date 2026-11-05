'use client';

// =============================================================
// src/app/admin/produk/RiwayatKoreksiStokTab.tsx
// Tab Audit Trail Koreksi Stok (Stock Opname & Manual Adjustment)
// Menjawab Uji Dosen: Tertera diedit kapan, dari berapa ke berapa, dan oleh siapa
// STANDAR: Spatial UI/UX, WCAG AA, Real-Time Sync
// =============================================================

import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  History,
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  User,
  Clock,
  Package,
  FileText,
  AlertCircle,
  Loader2,
  Calendar,
} from 'lucide-react';

export type StockAdjustmentItem = {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  qtyBefore: number;
  qtyAfter: number;
  qtyDiff: number;
  reason: string;
  createdAt: string;
  adminName: string | null;
  adminNidn: string | null;
  adminRole: string | null;
};

export default function RiwayatKoreksiStokTab({
  filterProductId,
  onResetFilter,
}: {
  filterProductId?: string | null;
  onResetFilter?: () => void;
}) {
  const searchInputId = useId();
  const [items, setItems] = useState<StockAdjustmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchAdjustments = useCallback(async (prodId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (prodId) params.set('productId', prodId);
      params.set('limit', '100');

      const res = await fetch(`/api/admin/stok-adjustment?${params}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setItems(json.data?.items ?? []);
      } else {
        setError(json.error ?? 'Gagal memuat riwayat koreksi stok.');
      }
    } catch {
      setError('Kesalahan koneksi saat memuat riwayat stok.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdjustments(filterProductId);
  }, [fetchAdjustments, filterProductId]);

  const filteredItems = items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.productName.toLowerCase().includes(q) ||
      item.reason.toLowerCase().includes(q) ||
      (item.adminName && item.adminName.toLowerCase().includes(q))
    );
  });

  const fmtWaktu = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
      {/* Header Tab */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--weight-bold)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: 0,
              color: 'var(--color-text)',
            }}
          >
            <History size={18} style={{ color: 'var(--color-primary)' }} />
            <span>Audit Trail Riwayat Koreksi Stok</span>
          </h2>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            Bukti historis perubahan kuantitas stok: siapa pengubah, waktu kejadian, dan alasan opname.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {filterProductId && onResetFilter && (
            <button
              type="button"
              onClick={onResetFilter}
              className="btn btn-sm btn-secondary"
              style={{ fontSize: 11 }}
            >
              Hapus Filter Produk
            </button>
          )}
          <button
            type="button"
            onClick={() => fetchAdjustments(filterProductId)}
            disabled={loading}
            className="btn btn-sm btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* Filter Pencarian */}
      <div style={{ marginBottom: 'var(--space-4)', maxWidth: 360 }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-muted)',
            }}
          />
          <input
            id={searchInputId}
            type="text"
            placeholder="Cari produk, alasan, atau nama admin..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            style={{ paddingLeft: 32, fontSize: 'var(--text-xs)', width: '100%' }}
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)', fontSize: 12 }}>
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
          <Loader2 size={24} className="spin-icon" style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: 12 }}>Memuat riwayat koreksi stok...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '36px var(--space-4)',
            backgroundColor: 'var(--color-surface-alt, #f8fafc)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <Package size={32} style={{ color: 'var(--color-text-muted)', margin: '0 auto 8px', opacity: 0.5 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px' }}>
            Belum Ada Riwayat Koreksi Stok
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>
            Setiap koreksi stok dari tombol "Koreksi Stok" atau edit master produk akan tercatat di sini secara permanen.
          </p>
        </div>
      ) : (
        /* Tabel Riwayat */
        <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-alt, #f8fafc)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', width: 150 }}>Waktu (WIB)</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Produk</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>Sebelum</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>Sesudah</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>Selisih</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Alasan Opname</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Diedit Oleh</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const isPositive = item.qtyDiff > 0;
                const isZero = item.qtyDiff === 0;

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      transition: 'background-color 0.15s',
                    }}
                  >
                    {/* Waktu */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={13} />
                        <span>{fmtWaktu(item.createdAt)}</span>
                      </div>
                    </td>

                    {/* Produk */}
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text)' }}>
                      <span>{item.productName}</span>
                    </td>

                    {/* Sebelum */}
                    <td style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      <span>{item.qtyBefore} {item.unit}</span>
                    </td>

                    {/* Sesudah */}
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                      <span>{item.qtyAfter} {item.unit}</span>
                    </td>

                    {/* Selisih */}
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          padding: '2px 8px',
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 700,
                          backgroundColor: isPositive
                            ? 'rgba(34, 197, 94, 0.12)'
                            : isZero
                            ? 'rgba(148, 163, 184, 0.12)'
                            : 'rgba(239, 68, 68, 0.12)',
                          color: isPositive ? '#16a34a' : isZero ? '#64748b' : '#dc2626',
                        }}
                      >
                        {isPositive ? <TrendingUp size={12} /> : !isZero ? <TrendingDown size={12} /> : null}
                        <span>{isPositive ? `+${item.qtyDiff}` : item.qtyDiff}</span>
                      </span>
                    </td>

                    {/* Alasan */}
                    <td style={{ padding: '10px 14px', color: 'var(--color-text)', maxWidth: 260 }}>
                      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.reason}
                      </span>
                    </td>

                    {/* Oleh Siapa */}
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            backgroundColor: 'var(--color-primary-light, rgba(22, 108, 52, 0.1))',
                            color: 'var(--color-primary, #166c34)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          <User size={12} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--color-text)' }}>
                            {item.adminName || 'Admin Toko'}
                          </div>
                          {item.adminNidn && (
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                              ID: {item.adminNidn}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

