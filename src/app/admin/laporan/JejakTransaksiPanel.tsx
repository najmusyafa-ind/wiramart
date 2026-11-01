'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ShieldAlert,
  Database,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { formatRupiah } from './shared';

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

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    setForbidden(false);
    try {
      const sp = new URLSearchParams();
      if (dateFrom) sp.set('dateFrom', dateFrom);
      if (dateTo) sp.set('dateTo', dateTo);
      if (outcome) sp.set('outcome', outcome);
      if (employeeId) sp.set('employeeId', employeeId);
      sp.set('page', String(page));
      sp.set('limit', '50');

      const res = await fetch(`/api/admin/laporan/jejak-transaksi?${sp.toString()}`);
      const json = (await res.json()) as { success?: boolean; data?: ApiResponse; error?: string };

      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok || !json.success || !json.data) {
        setError(json.error ?? 'Gagal memuat jejak transaksi');
        return;
      }
      setData(json.data);
      if (!dateFrom && json.data.range.dateFrom) setDateFrom(json.data.range.dateFrom);
      if (!dateTo && json.data.range.dateTo) setDateTo(json.data.range.dateTo);
    } catch {
      setError('Gagal menghubungi server.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, outcome, employeeId, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (forbidden) {
    return (
      <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <ShieldAlert size={36} style={{ color: '#dc2626', margin: '0 auto 12px' }} />
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>
          Akses Khusus Manager (Dosen)
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
          Jejak Audit Transaksi TCL (COMMIT / ROLLBACK) hanya dapat diakses oleh akun Manager.
        </p>
      </div>
    );
  }

  const summary = data?.summary ?? { COMMITTED: 0, ROLLED_BACK: 0, STARTED: 0, REJECTED: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Banner Alur TCL sesuai materi kuliah */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          background: 'linear-gradient(135deg, #f8fafc 0%, #f0fdf4 100%)',
          border: '1px solid #bbf7d0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <Database size={16} style={{ color: '#15803d' }} />
          <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#14532d' }}>
            Alur Pengamanan Transaksi Data (Praktek TCL PostgreSQL)
          </span>
          <span
            style={{
              fontSize: '0.72rem',
              padding: '2px 8px',
              borderRadius: 99,
              background: '#dcfce7',
              color: '#166534',
              fontWeight: 600,
            }}
          >
            Tabel: public.transaction_logs
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            fontSize: '0.78rem',
            color: '#334155',
          }}
        >
          <span style={{ padding: '4px 10px', borderRadius: 6, background: '#e2e8f0', fontWeight: 600 }}>
            1. START TRANSACTION (Log: STARTED)
          </span>
          <ArrowRight size={14} />
          <span style={{ padding: '4px 10px', borderRadius: 6, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>
            2. DML: INSERT tx &amp; UPDATE stok
          </span>
          <ArrowRight size={14} />
          <span style={{ padding: '4px 10px', borderRadius: 6, background: '#fef9c3', color: '#854d0e', fontWeight: 600 }}>
            3. SELECT Verifikasi Guard (stock_qty &ge; qty)
          </span>
          <ArrowRight size={14} />
          <span style={{ padding: '4px 10px', borderRadius: 6, background: '#dcfce7', color: '#166534', fontWeight: 700 }}>
            4a. COMMIT (Permanen)
          </span>
          <span>/</span>
          <span style={{ padding: '4px 10px', borderRadius: 6, background: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
            4b. ROLLBACK (Batal Atomik)
          </span>
        </div>
      </div>

      {/* Ringkasan Kartu Status */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        <button
          type="button"
          onClick={() => { setOutcome(outcome === 'COMMITTED' ? '' : 'COMMITTED'); setPage(1); }}
          className="card"
          style={{
            padding: '14px 16px',
            textAlign: 'left',
            cursor: 'pointer',
            border: outcome === 'COMMITTED' ? '2px solid #16a34a' : '1px solid #bbf7d0',
            background: '#f0fdf4',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534' }}>COMMITTED (BERHASIL)</span>
            <CheckCircle2 size={18} style={{ color: '#16a34a' }} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#14532d', marginTop: 4 }}>
            {summary.COMMITTED.toLocaleString('id-ID')}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#15803d' }}>Tersimpan permanen di DB</div>
        </button>

        <button
          type="button"
          onClick={() => { setOutcome(outcome === 'ROLLED_BACK' ? '' : 'ROLLED_BACK'); setPage(1); }}
          className="card"
          style={{
            padding: '14px 16px',
            textAlign: 'left',
            cursor: 'pointer',
            border: outcome === 'ROLLED_BACK' ? '2px solid #dc2626' : '1px solid #fecaca',
            background: '#fef2f2',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b' }}>ROLLED_BACK (GAGAL DB)</span>
            <XCircle size={18} style={{ color: '#dc2626' }} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#7f1d1d', marginTop: 4 }}>
            {summary.ROLLED_BACK.toLocaleString('id-ID')}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#b91c1c' }}>Dibatalkan atomik oleh PostgreSQL</div>
        </button>

        <button
          type="button"
          onClick={() => { setOutcome(outcome === 'REJECTED' ? '' : 'REJECTED'); setPage(1); }}
          className="card"
          style={{
            padding: '14px 16px',
            textAlign: 'left',
            cursor: 'pointer',
            border: outcome === 'REJECTED' ? '2px solid #d97706' : '1px solid #fde68a',
            background: '#fffbeb',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e' }}>REJECTED (PRA-TX)</span>
            <AlertTriangle size={18} style={{ color: '#d97706' }} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#78350f', marginTop: 4 }}>
            {summary.REJECTED.toLocaleString('id-ID')}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#b45309' }}>Ditolak guard sebelum BEGIN</div>
        </button>

        <button
          type="button"
          onClick={() => { setOutcome(outcome === 'STARTED' ? '' : 'STARTED'); setPage(1); }}
          className="card"
          style={{
            padding: '14px 16px',
            textAlign: 'left',
            cursor: 'pointer',
            border: outcome === 'STARTED' ? '2px solid #475569' : '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>STARTED (MENGGANTUNG)</span>
            <Clock size={18} style={{ color: '#64748b' }} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b', marginTop: 4 }}>
            {summary.STARTED.toLocaleString('id-ID')}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Sedang berjalan / terputus</div>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Dari Tanggal
            </label>
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Sampai Tanggal
            </label>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Status TCL
            </label>
            <select
              className="input"
              value={outcome}
              onChange={(e) => { setOutcome(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px' }}
            >
              <option value="">Semua Status</option>
              <option value="COMMITTED">COMMITTED</option>
              <option value="ROLLED_BACK">ROLLED_BACK</option>
              <option value="REJECTED">REJECTED</option>
              <option value="STARTED">STARTED</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Kasir
            </label>
            <select
              className="input"
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); setPage(1); }}
              style={{ fontSize: '0.82rem', padding: '6px 10px', minWidth: 160 }}
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
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34 }}
          >
            <RefreshCw size={14} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Tabel Jejak Transaksi */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Mulai (START)</th>
                <th style={{ padding: '10px 12px' }}>Selesai (END)</th>
                <th style={{ padding: '10px 12px' }}>Invoice</th>
                <th style={{ padding: '10px 12px' }}>Kasir</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Item / Total</th>
                <th style={{ padding: '10px 12px' }}>Metode</th>
                <th style={{ padding: '10px 12px' }}>Hasil TCL</th>
                <th style={{ padding: '10px 12px' }}>Bukti DB / Alasan Gagal</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                    Memuat jejak transaksi...
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                    Tidak ada log transaksi pada filter yang dipilih.
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
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Percobaan #{row.attemptNumber}</div>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ color: '#334155' }}>{formatWibTime(row.finishedAt)}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          Durasi: {calcDurationMs(row.createdAt, row.finishedAt)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>
                        {row.invoiceAttempt ?? <span style={{ color: '#94a3b8' }}>— (pra-tx)</span>}
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
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 9px',
                              borderRadius: 99,
                              background: '#dcfce7',
                              color: '#166534',
                              fontWeight: 700,
                              fontSize: '0.72rem',
                            }}
                          >
                            <CheckCircle2 size={12} /> COMMITTED
                          </span>
                        )}
                        {row.outcome === 'ROLLED_BACK' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 9px',
                              borderRadius: 99,
                              background: '#fee2e2',
                              color: '#991b1b',
                              fontWeight: 700,
                              fontSize: '0.72rem',
                            }}
                          >
                            <XCircle size={12} /> ROLLED_BACK
                          </span>
                        )}
                        {row.outcome === 'REJECTED' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 9px',
                              borderRadius: 99,
                              background: '#fef3c7',
                              color: '#92400e',
                              fontWeight: 700,
                              fontSize: '0.72rem',
                            }}
                          >
                            <AlertTriangle size={12} /> REJECTED
                          </span>
                        )}
                        {row.outcome === 'STARTED' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 9px',
                              borderRadius: 99,
                              background: '#e2e8f0',
                              color: '#334155',
                              fontWeight: 700,
                              fontSize: '0.72rem',
                            }}
                          >
                            <Clock size={12} /> STARTED
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 300 }}>
                        {row.outcome === 'COMMITTED' ? (
                          <div style={{ fontSize: '0.74rem', color: '#15803d', fontFamily: 'monospace' }}>
                            tx_id: {row.transactionId ? `${row.transactionId.slice(0, 8)}...` : 'tersimpan'}
                          </div>
                        ) : (
                          <div>
                            {row.failedStep && (
                              <span
                                style={{
                                  display: 'inline-block',
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: '#fee2e2',
                                  color: '#991b1b',
                                  marginBottom: 3,
                                }}
                              >
                                Step: {row.failedStep}
                              </span>
                            )}
                            <div style={{ fontSize: '0.74rem', color: '#991b1b', wordBreak: 'break-word' }}>
                              {row.rollbackReason ?? '—'}
                            </div>
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

