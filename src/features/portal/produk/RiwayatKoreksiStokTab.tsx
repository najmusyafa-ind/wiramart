'use client';

// =============================================================
// src/app/admin/produk/RiwayatKoreksiStokTab.tsx
// Tab Audit Trail Koreksi Stok (Stock Opname & Manual Adjustment)
// Menjawab Uji Dosen: Tertera diedit kapan, dari berapa ke berapa, dan oleh siapa
// STANDAR: Spatial UI/UX, WCAG AA, Real-Time Sync
// =============================================================

import React, { useState, useEffect, useId } from 'react';
import {
  History,
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  User,
  Clock,
  Package,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
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

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZE = 25;

function formatRoleLabel(role: string | null): string | null {
  if (!role) return null;
  if (role === 'MANAGER') return 'Manager / Dosen';
  if (role === 'ADMIN_SHIFT') return 'Admin Shift';
  return role;
}

export default function RiwayatKoreksiStokTab({
  filterProductId,
  onResetFilter,
}: {
  filterProductId?: string | null;
  onResetFilter?: () => void;
}) {
  const searchInputId = useId();
  const [items, setItems] = useState<StockAdjustmentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageState, setPageState] = useState<{ filter: string | null | undefined; page: number }>({
    filter: filterProductId,
    page: 1,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  const effectivePage = pageState.filter === filterProductId ? pageState.page : 1;
  const requestKey = `${filterProductId ?? ''}|${effectivePage}|${debouncedSearch}|${reloadToken}`;
  const loading = loadedKey !== requestKey;

  // Debounce pencarian server-side & reset ke halaman 1
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPageState({ filter: filterProductId, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filterProductId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (filterProductId) params.set('productId', filterProductId);
    if (debouncedSearch) params.set('q', debouncedSearch);
    params.set('page', String(effectivePage));
    params.set('limit', String(PAGE_SIZE));

    fetch(`/api/admin/stok-adjustment?${params}`, { signal: controller.signal })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (controller.signal.aborted) return;
        if (ok && json.success) {
          setError(null);
          setItems(json.data?.items ?? []);
          const meta = json.data?.pagination as PaginationMeta | undefined;
          if (meta) {
            setPagination(meta);
          } else {
            const totalFallback =
              typeof json.data?.total === 'number'
                ? json.data.total
                : (json.data?.items?.length ?? 0);
            setPagination({
              page: effectivePage,
              limit: PAGE_SIZE,
              total: totalFallback,
              totalPages: Math.max(1, Math.ceil(totalFallback / PAGE_SIZE)),
            });
          }
        } else {
          setError(json.error ?? 'Gagal memuat riwayat koreksi stok.');
        }
        setLoadedKey(requestKey);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError('Kesalahan koneksi saat memuat riwayat stok.');
        setLoadedKey(requestKey);
      });

    return () => controller.abort();
  }, [filterProductId, effectivePage, debouncedSearch, requestKey]);

  const fmtWaktu = (iso: string) => {
    try {
      return `${new Date(iso).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })} WIB`;
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
            Bukti historis perubahan kuantitas stok: siapa pengubah, waktu kejadian, perubahan dari berapa menjadi berapa, dan alasan opname.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {filterProductId && onResetFilter && (
            <button
              type="button"
              onClick={onResetFilter}
              className="btn btn-sm btn-secondary"
              style={{ fontSize: 12, minHeight: 36 }}
            >
              Hapus Filter Produk
            </button>
          )}
          <button
            type="button"
            onClick={() => setReloadToken((t) => t + 1)}
            disabled={loading}
            className="btn btn-sm btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, minHeight: 36 }}
          >
            <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* Filter Pencarian + Ringkasan Total */}
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
        <div style={{ flex: '1 1 280px', maxWidth: 400, position: 'relative' }}>
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
            placeholder="Cari produk, alasan opname, atau nama admin..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input"
            style={{ paddingLeft: 32, fontSize: 'var(--text-xs)', width: '100%' }}
          />
        </div>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          Total tercatat: <strong style={{ color: 'var(--color-text)' }}>{pagination.total}</strong> riwayat
        </span>
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
      ) : items.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '36px var(--space-4)',
            backgroundColor: 'var(--color-surface-alt)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <Package size={32} style={{ color: 'var(--color-text-muted)', margin: '0 auto 8px', opacity: 0.5 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px' }}>
            {debouncedSearch ? 'Tidak Ada Riwayat yang Cocok' : 'Belum Ada Riwayat Koreksi Stok'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
            {debouncedSearch
              ? 'Coba ubah kata kunci pencarian produk, alasan, atau nama pengubah.'
              : 'Setiap koreksi stok dari tombol "Koreksi Stok", pemusnahan/retur FEFO, atau edit master produk akan tercatat permanen.'}
          </p>
        </div>
      ) : (
        <>
          {/* Tabel Riwayat */}
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', width: 170 }}>Waktu (WIB)</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Produk</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>Dari</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>Jadi</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>Selisih</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Alasan &amp; Catatan Pelaksana</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>Diedit / Disetujui Oleh</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isPositive = item.qtyDiff > 0;
                  const isZero = item.qtyDiff === 0;
                  const roleLabel = formatRoleLabel(item.adminRole);

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        transition: 'background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
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
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        <span>{item.qtyBefore} {item.unit}</span>
                      </td>

                      {/* Sesudah */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                        <span>{item.qtyAfter} {item.unit}</span>
                      </td>

                      {/* Selisih */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
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
                              ? 'var(--color-success-light)'
                              : isZero
                              ? 'var(--color-surface-muted)'
                              : 'var(--color-error-light)',
                            color: isPositive
                              ? 'var(--color-success)'
                              : isZero
                              ? 'var(--color-text-muted)'
                              : 'var(--color-error)',
                          }}
                        >
                          {isPositive ? <TrendingUp size={12} /> : !isZero ? <TrendingDown size={12} /> : null}
                          <span>{isPositive ? `+${item.qtyDiff}` : item.qtyDiff}</span>
                        </span>
                      </td>

                      {/* Alasan */}
                      <td style={{ padding: '10px 14px', color: 'var(--color-text)', maxWidth: 300, lineHeight: 1.45 }}>
                        <span>{item.reason}</span>
                      </td>

                      {/* Oleh Siapa */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              backgroundColor: 'var(--color-primary-light)',
                              color: 'var(--color-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <User size={12} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text)' }}>
                              {item.adminName || 'Admin Toko'}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                              {roleLabel ? `${roleLabel}${item.adminNidn ? ` · ${item.adminNidn}` : ''}` : item.adminNidn ? `ID: ${item.adminNidn}` : '-'}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginasi */}
          {pagination.totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-3)',
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Halaman <strong style={{ color: 'var(--color-text)' }}>{pagination.page}</strong> dari{' '}
                <strong style={{ color: 'var(--color-text)' }}>{pagination.totalPages}</strong>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={pagination.page <= 1 || loading}
                  onClick={() =>
                    setPageState({
                      filter: filterProductId,
                      page: Math.max(1, effectivePage - 1),
                    })
                  }
                  className="btn btn-sm btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 36, padding: '0 12px' }}
                >
                  <ChevronLeft size={14} />
                  <span>Sebelumnya</span>
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages || loading}
                  onClick={() =>
                    setPageState({
                      filter: filterProductId,
                      page: Math.min(pagination.totalPages, effectivePage + 1),
                    })
                  }
                  className="btn btn-sm btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 36, padding: '0 12px' }}
                >
                  <span>Berikutnya</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

