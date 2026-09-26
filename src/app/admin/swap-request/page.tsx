'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  ArrowLeftRight, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, ChevronRight, UserCheck, Filter, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
type SwapStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

type SwapRequest = {
  id: string;
  reason: string;
  status: SwapStatus;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requester: { fullName: string; nim: string; programStudi: string };
  fromSchedule: { dayOfWeek: string; slotStart: string; slotEnd: string; coordinatorName: string | null };
  toSchedule:   { dayOfWeek: string; slotStart: string; slotEnd: string; coordinatorName: string | null };
  reviewedByAdmin: { fullName: string } | null;
};

// ─── Status Config ─────────────────────────────────────────────
const STATUS_CFG: Record<SwapStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING:   { label: 'Menunggu',  color: 'hsl(38 90% 55%)',   icon: <Clock size={13} /> },
  APPROVED:  { label: 'Disetujui', color: 'var(--color-success)', icon: <CheckCircle2 size={13} /> },
  REJECTED:  { label: 'Ditolak',   color: 'var(--color-danger)',  icon: <XCircle size={13} /> },
  CANCELLED: { label: 'Dibatalkan',color: 'var(--color-text-muted)', icon: <X size={13} /> },
};

function SwapBadge({ status }: { status: SwapStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}44` }}>
      {c.icon} {c.label}
    </span>
  );
}

// ─── Review Modal ─────────────────────────────────────────────
function ReviewModal({
  swap,
  onClose,
  onSuccess,
}: {
  swap: SwapRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uid = useId();
  const [action, setAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [adminNote, setAdminNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/admin/swap-request/${swap.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: adminNote || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan'); return; }
      onSuccess(); onClose();
    } catch { setError('Kesalahan jaringan.'); }
    finally { setLoading(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--color-overlay)', backdropFilter: 'blur(4px)', animation: 'fade-in 0.2s ease' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)', padding: 'var(--space-6)', width: '100%', maxWidth: '480px', boxShadow: '0 24px 48px -12px hsl(0 0% 0% / 0.35)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-5)' }}>
          <div>
            <h2 id={`${uid}-title`} style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Review Pengajuan Swap</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>oleh {swap.requester.fullName}</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px' }}><X size={20} /></button>
        </div>

        {/* Swap Info */}
        <div style={{ background: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Dari</div>
            <div style={{ fontWeight: 700, color: 'var(--color-danger)', fontSize: '0.9rem' }}>{swap.fromSchedule.dayOfWeek}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{swap.fromSchedule.slotStart}–{swap.fromSchedule.slotEnd}</div>
          </div>
          <div style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
            <ArrowLeftRight size={20} />
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Ke</div>
            <div style={{ fontWeight: 700, color: 'var(--color-success)', fontSize: '0.9rem' }}>{swap.toSchedule.dayOfWeek}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{swap.toSchedule.slotStart}–{swap.toSchedule.slotEnd}</div>
          </div>
        </div>

        {/* Reason */}
        <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'hsl(210 100% 60% / 0.06)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid hsl(210 80% 60%)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Alasan</div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>{swap.reason}</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Action selector */}
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>Keputusan *</div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              {(['APPROVE', 'REJECT'] as const).map(a => (
                <label key={a} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', borderRadius: 'var(--radius-md)', border: `2px solid ${action === a ? (a === 'APPROVE' ? 'var(--color-success)' : 'var(--color-danger)') : 'var(--color-border)'}`, background: action === a ? (a === 'APPROVE' ? 'hsl(142 70% 45% / 0.1)' : 'hsl(0 70% 55% / 0.1)') : 'transparent', cursor: 'pointer', transition: 'all 0.15s', fontWeight: 700, fontSize: '0.875rem', color: action === a ? (a === 'APPROVE' ? 'var(--color-success)' : 'var(--color-danger)') : 'var(--color-text-muted)' }}>
                  <input type="radio" name="action" value={a} checked={action === a} onChange={() => setAction(a)} style={{ display: 'none' }} />
                  {a === 'APPROVE' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  {a === 'APPROVE' ? 'Setujui' : 'Tolak'}
                </label>
              ))}
            </div>
          </div>

          {/* Admin note */}
          <div>
            <label htmlFor={`${uid}-note`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
              Catatan Admin {action === 'REJECT' && <span style={{ color: 'var(--color-danger)' }}>*</span>}
            </label>
            <textarea id={`${uid}-note`} value={adminNote} onChange={e => setAdminNote(e.target.value)}
              placeholder={action === 'APPROVE' ? 'Opsional — misal: sudah berkoordinasi dengan koordinator' : 'Wajib — jelaskan alasan penolakan'}
              required={action === 'REJECT'} rows={3}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>

          {/* Warning for approve */}
          {action === 'APPROVE' && (
            <div style={{ display: 'flex', gap: '8px', padding: '10px 14px', background: 'hsl(38 90% 55% / 0.1)', border: '1px solid hsl(38 90% 55% / 0.3)', borderRadius: 'var(--radius-md)', color: 'hsl(38 90% 55%)', fontSize: '0.8rem', alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>Jika disetujui, jadwal <strong>{swap.fromSchedule.dayOfWeek}</strong> dan <strong>{swap.toSchedule.dayOfWeek}</strong> akan ditukar secara permanen dan attendance akan diperbarui otomatis.</span>
            </div>
          )}

          {error && (
            <div role="alert" style={{ display: 'flex', gap: '8px', padding: '10px 14px', background: 'hsl(0 70% 55% / 0.12)', border: '1px solid hsl(0 70% 55% / 0.3)', borderRadius: 'var(--radius-md)', color: 'hsl(0 70% 65%)', fontSize: '0.85rem', alignItems: 'center' }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 600 }}>Batal</button>
            <button type="submit" disabled={loading}
              style={{ flex: 2, padding: '10px', background: action === 'APPROVE' ? 'var(--color-success)' : 'var(--color-danger)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s' }}>
              {loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Memproses...</> : (action === 'APPROVE' ? <><CheckCircle2 size={15} /> Setujui Swap</> : <><XCircle size={15} /> Tolak Pengajuan</>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
const FILTER_OPTIONS: { label: string; value: string }[] = [
  { label: 'Menunggu', value: 'PENDING' },
  { label: 'Semua', value: 'ALL' },
  { label: 'Disetujui', value: 'APPROVED' },
  { label: 'Ditolak', value: 'REJECTED' },
];

export default function SwapRequestPage() {
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('PENDING');
  const [selected, setSelected] = useState<SwapRequest | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/swap-request?status=${filter}`);
      const json = await res.json();
      setRequests(json.data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1000px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-lg)', background: 'hsl(280 70% 65% / 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(280 70% 65%)' }}>
            <ArrowLeftRight size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>Pengajuan Swap Shift</h1>
              {pendingCount > 0 && filter === 'PENDING' && (
                <span style={{ background: 'var(--color-danger)', color: '#fff', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', minWidth: '20px', textAlign: 'center' }}>
                  {pendingCount}
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Review dan putuskan pengajuan pindah shift karyawan</p>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '4px', width: 'fit-content' }}>
        {FILTER_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setFilter(opt.value)}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.15s', background: filter === opt.value ? 'var(--color-primary)' : 'transparent', color: filter === opt.value ? '#fff' : 'var(--color-text-secondary)' }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-muted)' }} aria-live="polite" aria-busy="true">
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '8px' }} />
          <p style={{ margin: 0, fontSize: '0.875rem' }}>Memuat pengajuan...</p>
        </div>
      ) : requests.length === 0 ? (
        <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)' }}>
          <ArrowLeftRight size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <p style={{ margin: 0, fontWeight: 600 }}>Tidak ada pengajuan</p>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>
            {filter === 'PENDING' ? 'Semua pengajuan sudah diproses 🎉' : 'Tidak ada pengajuan dengan status ini'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {requests.map(r => (
            <div key={r.id} style={{ background: 'var(--color-surface)', border: `1px solid ${r.status === 'PENDING' ? 'hsl(38 90% 55% / 0.4)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-xl)', padding: 'var(--space-4) var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap', transition: 'box-shadow 0.15s', boxShadow: r.status === 'PENDING' ? '0 0 0 3px hsl(38 90% 55% / 0.08)' : 'none' }}>

              {/* Requester info */}
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '2px' }}>{r.requester.fullName}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{r.requester.nim} · {r.requester.programStudi}</div>
              </div>

              {/* Swap arrow */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: '0 0 auto' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Dari</div>
                  <div style={{ fontWeight: 700, color: 'var(--color-danger)', fontSize: '0.9rem' }}>{r.fromSchedule.dayOfWeek}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{r.fromSchedule.slotStart}–{r.fromSchedule.slotEnd}</div>
                </div>
                <ArrowLeftRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Ke</div>
                  <div style={{ fontWeight: 700, color: 'var(--color-success)', fontSize: '0.9rem' }}>{r.toSchedule.dayOfWeek}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{r.toSchedule.slotStart}–{r.toSchedule.slotEnd}</div>
                </div>
              </div>

              {/* Reason snippet */}
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 700, marginBottom: '2px', textTransform: 'uppercase' }}>Alasan</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{r.reason}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  {new Date(r.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>

              {/* Status + action */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: '0 0 auto' }}>
                <SwapBadge status={r.status} />
                {r.status === 'PENDING' && (
                  <button onClick={() => setSelected(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'var(--color-primary)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <UserCheck size={14} /> Review
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Modal */}
      {selected && (
        <ReviewModal
          swap={selected}
          onClose={() => setSelected(null)}
          onSuccess={fetchData}
        />
      )}
    </div>
  );
}
