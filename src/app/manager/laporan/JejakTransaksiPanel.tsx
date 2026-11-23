'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { formatRupiah } from '@/features/portal/laporan/shared';

type OutcomeType = 'COMMITTED' | 'ROLLED_BACK' | 'STARTED' | 'REJECTED';

type LogRow = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  employeeNim: string | null;
  shiftId: string | null;
  invoiceAttempt: string | null;
  attemptNumber: number;
  itemCount: number;
  grossAmount: number | null;
  paymentMethod: 'CASH' | 'QRIS' | null;
  outcome: OutcomeType;
  transactionId: string | null;
  rollbackReason: string | null;
  failedStep: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type ApiResponse = {
  rows: LogRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: { COMMITTED: number; ROLLED_BACK: number; STARTED: number; REJECTED: number };
  cashiers: Array<{ id: string; name: string; nim: string | null }>;
  range: { dateFrom: string; dateTo: string };
};

function formatWibTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function calcDurationMs(start: string, end: string | null): string {
  if (!end) return 'menggantung';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  return `${ms} ms`;
}

async function requestTransactionLogs(
  query: { dateFrom: string; dateTo: string; outcome: string; employeeId: string; page: number },
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams();
  if (query.dateFrom) sp.set('dateFrom', query.dateFrom);
  if (query.dateTo) sp.set('dateTo', query.dateTo);
  if (query.outcome) sp.set('outcome', query.outcome);
  if (query.employeeId) sp.set('employeeId', query.employeeId);
  sp.set('page', String(query.page));
  sp.set('limit', '50');

  const res = await fetch(`/api/admin/laporan/jejak-transaksi?${sp.toString()}`, { signal });
  if (res.status === 403) {
    return { status: 'forbidden' as const };
  }
  const json = (await res.json()) as { success?: boolean; data?: ApiResponse; error?: string };
  if (!res.ok || !json.success || !json.data) {
    return { status: 'error' as const, error: json.error ?? 'Gagal memuat jejak transaksi' };
  }
  return { status: 'ok' as const, data: json.data };
}

export default function JejakTransaksiPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [outcome, setOutcome] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [page, setPage] = useState(1);

  const applyLogsResult = useCallback(
    (result: Awaited<ReturnType<typeof requestTransactionLogs>>) => {
      if (result.status === 'forbidden') {
        setForbidden(true);
        return;
      }
      setForbidden(false);
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      setError('');
      setData(result.data);
    },
    [],
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    setForbidden(false);
    try {
      const result = await requestTransactionLogs({ dateFrom, dateTo, outcome, employeeId, page });
      applyLogsResult(result);
    } catch {
      setError('Gagal menghubungi server.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, outcome, employeeId, page, applyLogsResult]);

  useEffect(() => {
    const controller = new AbortController();

    requestTransactionLogs({ dateFrom, dateTo, outcome, employeeId, page }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          applyLogsResult(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Gagal menghubungi server.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [dateFrom, dateTo, outcome, employeeId, page, applyLogsResult]);

  if (forbidden) {
    return (
      <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <ShieldAlert size={32} style={{ color: '#dc2626', margin: '0 auto 10px' }} />
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
          Khusus Manager
        </h3>
        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>
          Log transaksi sistem hanya dapat dilihat oleh akun Manager.
        </p>
      </div>
    );
  }

  const summary = data?.summary ?? { COMMITTED: 0, ROLLED_BACK: 0, STARTED: 0, REJECTED: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Ringkasan Status Singkat (2x2 di HP) */}
      <div className="rep-kpi-grid" style={{ marginBottom: 0 }}>
        {[
          { key: 'COMMITTED', label: 'Berhasil', count: summary.COMMITTED, color: '#15803d', icon: <CheckCircle2 size={15} /> },
          { key: 'ROLLED_BACK', label: 'Gagal', count: summary.ROLLED_BACK, color: '#dc2626', icon: <XCircle size={15} /> },
          { key: 'REJECTED', label: 'Ditolak', count: summary.REJECTED, color: '#d97706', icon: <AlertTriangle size={15} /> },
          { key: 'STARTED', label: 'Diproses', count: summary.STARTED, color: '#475569', icon: <Clock size={15} /> },
        ].map((item) => {
          const active = outcome === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => { setOutcome(active ? '' : item.key); setPage(1); }}
              className="rep-kpi"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: active ? item.color : '#e2e8f0',
                boxShadow: active ? `0 0 0 2px ${item.color}25` : undefined,
              }}
            >
              <div className="rep-kpi__top">
                <span className="rep-kpi__label">{item.label}</span>
                <span style={{ color: item.color }}>{item.icon}</span>
              </div>
              <div className="rep-kpi__val" style={{ color: item.color }}>
                {item.count.toLocaleString('id-ID')}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 130px' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Dari
            </label>
            <input
              type="date"
              className="form-input"
              value={dateFrom || data?.range.dateFrom || ''}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px', minHeight: 38 }}
            />
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Sampai
            </label>
            <input
              type="date"
              className="form-input"
              value={dateTo || data?.range.dateTo || ''}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px', minHeight: 38 }}
            />
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Status
            </label>
            <select
              className="form-input form-select"
              value={outcome}
              onChange={(e) => { setOutcome(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px', minHeight: 38 }}
            >
              <option value="">Semua Status</option>
              <option value="COMMITTED">Berhasil</option>
              <option value="ROLLED_BACK">Gagal</option>
              <option value="REJECTED">Ditolak</option>
              <option value="STARTED">Diproses</option>
            </select>
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Kasir
            </label>
            <select
              className="form-input form-select"
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px', minHeight: 38 }}
            >
              <option value="">Semua Kasir</option>
              {data?.cashiers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.nim ? `(${c.nim})` : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => fetchLogs()}
            className="rep-chip"
            style={{ minHeight: 38 }}
          >
            <RefreshCw size={13} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Tabel Log Transaksi */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="rep-desktop-only" style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Waktu</th>
                <th style={{ padding: '10px 12px' }}>Invoice</th>
                <th style={{ padding: '10px 12px' }}>Kasir</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '10px 12px' }}>Metode</th>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px' }}>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                    Memuat log transaksi...
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                    Tidak ada log pada periode ini.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => {
                  const rowBg =
                    row.outcome === 'ROLLED_BACK'
                      ? '#fef2f2'
                      : row.outcome === 'REJECTED'
                        ? '#fffbeb'
                        : row.outcome === 'STARTED'
                          ? '#f8fafc'
                          : 'transparent';

                  return (
                    <tr key={row.id} style={{ background: rowBg, borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{formatWibTime(row.createdAt)}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {row.outcome === 'STARTED' ? 'Menunggu' : calcDurationMs(row.createdAt, row.finishedAt)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                        {row.invoiceAttempt ?? '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{row.employeeName ?? '—'}</div>
                        {row.employeeNim && (
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{row.employeeNim}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {row.grossAmount !== null ? formatRupiah(row.grossAmount) : '—'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{row.itemCount} item</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {row.paymentMethod ? (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: row.paymentMethod === 'QRIS' ? '#e0f2fe' : '#dcfce7',
                              color: row.paymentMethod === 'QRIS' ? '#0369a1' : '#166534',
                            }}
                          >
                            {row.paymentMethod}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {row.outcome === 'COMMITTED' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: '0.72rem' }}>
                            <CheckCircle2 size={12} /> Berhasil
                          </span>
                        )}
                        {row.outcome === 'ROLLED_BACK' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#fee2e2', color: '#991b1b', fontWeight: 700, fontSize: '0.72rem' }}>
                            <XCircle size={12} /> Gagal
                          </span>
                        )}
                        {row.outcome === 'REJECTED' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#fef3c7', color: '#92400e', fontWeight: 700, fontSize: '0.72rem' }}>
                            <AlertTriangle size={12} /> Ditolak
                          </span>
                        )}
                        {row.outcome === 'STARTED' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, background: '#e2e8f0', color: '#334155', fontWeight: 700, fontSize: '0.72rem' }}>
                            <Clock size={12} /> Diproses
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 280 }}>
                        {row.outcome === 'COMMITTED' ? (
                          <span style={{ fontSize: '0.74rem', color: '#15803d' }}>Tersimpan</span>
                        ) : row.outcome === 'STARTED' ? (
                          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>Sedang diproses</span>
                        ) : (
                          <div style={{ fontSize: '0.74rem', color: '#991b1b', wordBreak: 'break-word' }}>
                            {row.rollbackReason ?? 'Transaksi dibatalkan'}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Log Cards */}
        <div className="rep-mobile-only" style={{ padding: '10px 12px' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>Memuat log...</div>
          ) : !data || data.rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>Tidak ada log pada periode ini.</div>
          ) : (
            data.rows.map((row) => (
              <div key={row.id} className="rep-mcard">
                <div className="rep-mcard__top">
                  <div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: '#0f172a' }}>
                      {row.invoiceAttempt ?? '—'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                      {formatWibTime(row.createdAt)} · {row.employeeName ?? '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                      {row.grossAmount !== null ? formatRupiah(row.grossAmount) : '—'}
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 7px',
                        borderRadius: 99,
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        background:
                          row.outcome === 'COMMITTED'
                            ? '#dcfce7'
                            : row.outcome === 'ROLLED_BACK'
                              ? '#fee2e2'
                              : row.outcome === 'REJECTED'
                                ? '#fef3c7'
                                : '#e2e8f0',
                        color:
                          row.outcome === 'COMMITTED'
                            ? '#166534'
                            : row.outcome === 'ROLLED_BACK'
                              ? '#991b1b'
                              : row.outcome === 'REJECTED'
                                ? '#92400e'
                                : '#334155',
                      }}
                    >
                      {row.outcome === 'COMMITTED'
                        ? 'Berhasil'
                        : row.outcome === 'ROLLED_BACK'
                          ? 'Gagal'
                          : row.outcome === 'REJECTED'
                            ? 'Ditolak'
                            : 'Diproses'}
                    </span>
                  </div>
                </div>
                {row.rollbackReason && (
                  <div style={{ fontSize: '0.72rem', color: '#991b1b', paddingTop: 6, borderTop: '1px solid #f1f5f9' }}>
                    {row.rollbackReason}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {data && data.pagination.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              borderTop: '1px solid #e2e8f0',
              fontSize: '0.8rem',
            }}
          >
            <span style={{ color: '#64748b' }}>
              Halaman {data.pagination.page} dari {data.pagination.totalPages} (Total {data.pagination.total} log)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

