'use client';

// =============================================================
// Wiramart v2.0 — /admin/pesanan-online
// Antrian pesanan online: verifikasi bayar → konfirmasi → assign runner → proses.
// Auth dijaga di API (requireAdmin) + layout admin. Auto-refresh 20 dtk saat tab terlihat.
// =============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  MessageCircle,
  ShieldCheck,
  Inbox,
  AlertCircle,
  Clock,
  MapPin,
  CreditCard,
  UserCheck,
  Image as ImageIcon,
  ExternalLink,
  X,
  PackageCheck,
  User,
} from 'lucide-react';

type Status =
  | 'WAITING_PAYMENT_VERIFICATION'
  | 'WAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

interface Row {
  id: string;
  orderNumber: string;
  status: Status;
  deliveryType: 'PICKUP' | 'DELIVERY';
  deliveryFloor: number | null;
  roomDetail: string | null;
  deliveryNote: string | null;
  paymentMethod: 'QRIS' | 'TRANSFER';
  paymentReference: string | null;
  paymentProofUrl?: string | null;
  assignedCsId?: string | null;
  csName?: string | null;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  createdAt: string;
  expiredAt: string | null;
  rejectedReason: string | null;
  cancelledReason: string | null;
  buyerName: string;
  buyerNim: string;
  buyerWhatsapp: string;
  items: Array<{ id: string; productName: string; quantity: number; subtotal: number }>;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  nim: string;
  isActive: boolean;
}

type AdminActionBody =
  | { action: 'verify' }
  | { action: 'confirm' }
  | { action: 'proses' }
  | { action: 'reject'; reason: string }
  | { action: 'assign-cs'; csEmployeeId: string };

const TABS = [
  { key: 'todo', label: 'Perlu Tindakan', statuses: ['WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION'] },
  { key: 'doing', label: 'Diproses', statuses: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] },
  { key: 'done', label: 'Selesai', statuses: ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'] },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const STATUS_CONFIG: Record<Status, { text: string; badgeClass: string }> = {
  WAITING_PAYMENT_VERIFICATION: { text: 'Verifikasi Bayar', badgeClass: 'badge-warning' },
  WAITING_CONFIRMATION: { text: 'Menunggu Konfirmasi', badgeClass: 'badge-warning' },
  CONFIRMED: { text: 'Dikonfirmasi', badgeClass: 'badge-info' },
  PREPARING: { text: 'Disiapkan', badgeClass: 'badge-info' },
  OUT_FOR_DELIVERY: { text: 'Diantar', badgeClass: 'badge-info' },
  COMPLETED: { text: 'Selesai', badgeClass: 'badge-success' },
  CANCELLED: { text: 'Dibatalkan', badgeClass: 'badge-neutral' },
  REJECTED: { text: 'Ditolak', badgeClass: 'badge-error' },
  EXPIRED: { text: 'Kedaluwarsa', badgeClass: 'badge-neutral' },
};

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const floorLabel = (f: number | null) => (f === 99 ? 'Auditorium' : f ? `Lantai ${f}` : '-');

function ago(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} mnt lalu`;
  return `${Math.floor(m / 60)} jam lalu`;
}

function minutesLeft(iso: string | null): number | null {
  return iso ? Math.floor((new Date(iso).getTime() - Date.now()) / 60000) : null;
}

export default function PesananOnlinePage() {
  const [tab, setTab] = useState<TabKey>('todo');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  // Runner / CS assignment & Bukti Transfer preview
  const [karyawanList, setKaryawanList] = useState<EmployeeOption[]>([]);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [selectedCsId, setSelectedCsId] = useState<string>('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Load daftar karyawan aktif sekali saat mount untuk opsi assignment runner
  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await fetch('/api/admin/karyawan', { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success && Array.isArray(json.data)) {
          setKaryawanList(json.data.filter((k: EmployeeOption) => k.isActive));
        }
      } catch {
        // Abaikan kegagalan jaringan sesaat
      }
    }
    loadEmployees();
  }, []);

  const load = useCallback(async () => {
    const statuses = TABS.find((t) => t.key === tab)!.statuses.join(',');
    try {
      const res = await fetch(`/api/admin/pesanan-online?status=${statuses}&limit=50`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(typeof json?.error === 'string' ? json.error : 'Gagal memuat pesanan.');
        return;
      }
      setRows(json.data.orders as Row[]);
      setError(null);
    } catch {
      setError('Koneksi bermasalah. Mencoba lagi otomatis...');
    }
  }, [tab]);

  useEffect(() => {
    setRows(null);
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, body: AdminActionBody) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pesanan-online/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(typeof json?.error === 'string' ? json.error : 'Aksi gagal.');
      } else {
        setRejectId(null);
        setReason('');
        setAssignId(null);
        setSelectedCsId('');
      }
      await load(); // selalu sinkron: status bisa berubah oleh admin/runner lain
    } finally {
      setBusyId(null);
    }
  }

  function onConfirm(r: Row) {
    const list = r.items.map((i) => `• ${i.productName} × ${i.quantity}`).join('\n');
    if (window.confirm(`Konfirmasi #${r.orderNumber}?\n\nStok akan LANGSUNG berkurang:\n${list}`)) {
      act(r.id, { action: 'confirm' });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Pesanan Online</h1>
          <p className="page-subtitle">Kelola dan proses antrean pemesanan delivery / pickup kampus</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn btn-secondary"
          aria-label="Muat ulang daftar pesanan"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <RefreshCw size={14} className={rows === null ? 'spin-icon' : ''} />
          <span>Muat ulang</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <div role="tablist" aria-label="Filter pesanan" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontWeight: 600 }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
            background: 'var(--color-error-light)',
            color: 'var(--color-error)',
            fontSize: 'var(--text-sm)',
            border: '1px solid var(--color-error)',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Content states */}
      {rows === null ? (
        <div className="card">
          <div className="empty-state" aria-busy="true">
            <Loader2 size={32} className="spin-icon" style={{ color: 'var(--color-primary)', margin: '0 auto' }} />
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Memuat daftar pesanan online...
            </p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Inbox size={42} aria-hidden="true" style={{ margin: '0 auto var(--space-2)', opacity: 0.35 }} />
            <p style={{ margin: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', textAlign: 'center' }}>
              Tidak ada pesanan di tab ini
            </p>
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Pesanan online baru dari pembeli akan muncul secara otomatis.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {rows.map((r) => {
            const st = STATUS_CONFIG[r.status];
            const left = minutesLeft(r.expiredAt);
            const waiting = r.status === 'WAITING_PAYMENT_VERIFICATION' || r.status === 'WAITING_CONFIRMATION';
            const busy = busyId === r.id;
            const reasonText = r.status === 'REJECTED' ? r.rejectedReason : r.status === 'CANCELLED' ? r.cancelledReason : null;

            return (
              <article
                key={r.id}
                className="card card-body"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  borderLeft: `4px solid ${
                    r.status === 'WAITING_PAYMENT_VERIFICATION' || r.status === 'WAITING_CONFIRMATION'
                      ? 'var(--color-warning)'
                      : r.status === 'CONFIRMED' || r.status === 'PREPARING' || r.status === 'OUT_FOR_DELIVERY'
                      ? 'var(--color-info)'
                      : r.status === 'COMPLETED'
                      ? 'var(--color-success)'
                      : 'var(--color-border)'
                  }`,
                }}
              >
                {/* Card Header */}
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
                      #{r.orderNumber}
                    </span>
                    <span
                      className={`badge ${r.deliveryType === 'DELIVERY' ? 'badge-primary' : 'badge-neutral'}`}
                      style={{ fontSize: 'var(--text-xs)' }}
                    >
                      {r.deliveryType === 'DELIVERY' ? 'Delivery' : 'Pickup'}
                    </span>
                    {waiting && left !== null && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 'var(--text-xs)',
                          color: left <= 5 ? 'var(--color-error)' : 'var(--color-text-muted)',
                        }}
                      >
                        <Clock size={12} />
                        {left > 0 ? `Sisa ${left} mnt` : 'Lewat batas waktu'}
                      </span>
                    )}
                  </div>
                  <span className={`badge ${st.badgeClass}`}>{st.text}</span>
                </header>

                {/* Buyer & Delivery details */}
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', display: 'grid', gap: 4 }}>
                  <div>
                    <strong style={{ color: 'var(--color-text)' }}>{r.buyerName}</strong> · NIM {r.buyerNim} · {ago(r.createdAt)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    <span>
                      {r.deliveryType === 'DELIVERY' ? `Antar ke ${floorLabel(r.deliveryFloor)} · Ruang ${r.roomDetail ?? '-'}` : 'Ambil sendiri (Lantai 1)'}
                      {r.deliveryNote ? ` · “${r.deliveryNote}”` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CreditCard size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      <span>
                        Metode: {r.paymentMethod}
                        {r.paymentMethod === 'TRANSFER' && r.paymentReference ? ` · Ref: ${r.paymentReference}` : ''}
                      </span>
                    </div>

                    {/* Bukti Transfer badge / tombol lihat foto */}
                    {r.paymentMethod === 'TRANSFER' && (
                      <>
                        {r.paymentProofUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewImage(r.paymentProofUrl!)}
                            className="btn btn-secondary btn-sm"
                            style={{
                              padding: '2px 8px',
                              fontSize: 'var(--text-xs)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'var(--color-primary-light)',
                              color: 'var(--color-primary)',
                              borderColor: 'var(--color-primary)',
                            }}
                          >
                            <ImageIcon size={12} />
                            <span>Lihat Bukti Transfer</span>
                          </button>
                        ) : (
                          <span
                            className="badge badge-warning"
                            style={{ fontSize: '11px', padding: '2px 6px' }}
                          >
                            Belum upload bukti
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Items list */}
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 'var(--text-sm)', display: 'grid', gap: 4 }}>
                    {r.items.map((i) => (
                      <li key={i.id} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text)' }}>
                        <span>
                          {i.productName} <span style={{ color: 'var(--color-text-muted)' }}>× {i.quantity}</span>
                        </span>
                        <span style={{ fontWeight: 500 }}>{rp(i.subtotal)}</span>
                      </li>
                    ))}
                    <li
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 'var(--weight-bold)',
                        borderTop: '1px dashed var(--color-border)',
                        paddingTop: 6,
                        marginTop: 4,
                        color: 'var(--color-text)',
                      }}
                    >
                      <span>Total {r.deliveryFee > 0 ? `(termasuk ongkir ${rp(r.deliveryFee)})` : ''}</span>
                      <span style={{ color: 'var(--color-primary)' }}>{rp(r.totalAmount)}</span>
                    </li>
                  </ul>
                </div>

                {reasonText && (
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                    Alasan: {reasonText}
                  </p>
                )}

                {/* Actions Footer */}
                <footer style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', paddingTop: 2 }}>
                  <a
                    href={`https://wa.me/${r.buyerWhatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <MessageCircle size={14} />
                    <span>WA Pembeli</span>
                  </a>

                  {/* WAITING_PAYMENT_VERIFICATION: Verifikasi Bayar */}
                  {r.status === 'WAITING_PAYMENT_VERIFICATION' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(r.id, { action: 'verify' })}
                      className="btn btn-sm"
                      style={{
                        background: 'var(--color-info)',
                        color: '#fff',
                        border: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {busy ? <Loader2 size={14} className="spin-icon" /> : <ShieldCheck size={14} />}
                      <span>Verifikasi Bayar</span>
                    </button>
                  )}

                  {/* WAITING_CONFIRMATION: Konfirmasi Pesanan */}
                  {r.status === 'WAITING_CONFIRMATION' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onConfirm(r)}
                      className="btn btn-primary btn-sm"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {busy ? <Loader2 size={14} className="spin-icon" /> : <CheckCircle2 size={14} />}
                      <span>Konfirmasi</span>
                    </button>
                  )}

                  {/* CONFIRMED: Assign Runner & Proses */}
                  {r.status === 'CONFIRMED' && (
                    <>
                      {r.deliveryType === 'DELIVERY' ? (
                        <>
                          {r.assignedCsId ? (
                            <>
                              <span
                                className="badge badge-info"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 30 }}
                              >
                                <User size={12} />
                                <span>Runner: {r.csName ?? 'Ditugaskan'}</span>
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setAssignId(assignId === r.id ? null : r.id);
                                  setSelectedCsId(r.assignedCsId ?? '');
                                }}
                                className="btn btn-secondary btn-sm"
                              >
                                Ganti Runner
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => act(r.id, { action: 'proses' })}
                                className="btn btn-primary btn-sm"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              >
                                {busy ? <Loader2 size={14} className="spin-icon" /> : <PackageCheck size={14} />}
                                <span>Mulai Siapkan (Proses)</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setAssignId(assignId === r.id ? null : r.id);
                                setSelectedCsId('');
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            >
                              {busy ? <Loader2 size={14} className="spin-icon" /> : <UserCheck size={14} />}
                              <span>Tugaskan Runner</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => act(r.id, { action: 'proses' })}
                          className="btn btn-primary btn-sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          {busy ? <Loader2 size={14} className="spin-icon" /> : <PackageCheck size={14} />}
                          <span>Siapkan Pesanan</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Tombol Tolak untuk status menunggu */}
                  {waiting && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRejectId(rejectId === r.id ? null : r.id);
                        setReason('');
                      }}
                      className="btn btn-danger btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <XCircle size={14} />
                      <span>Tolak</span>
                    </button>
                  )}
                </footer>

                {/* Inline Form Assign Runner */}
                {assignId === r.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!selectedCsId) return;
                      act(r.id, { action: 'assign-cs', csEmployeeId: selectedCsId });
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-3)',
                      background: 'var(--color-surface-muted)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <label
                      htmlFor={`cs-${r.id}`}
                      className="form-label"
                      style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', margin: 0 }}
                    >
                      Pilih Petugas / Runner Pengantaran <span style={{ color: 'var(--color-error)' }}>*</span>
                    </label>
                    <select
                      id={`cs-${r.id}`}
                      className="form-input"
                      value={selectedCsId}
                      onChange={(e) => setSelectedCsId(e.target.value)}
                      required
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      <option value="">-- Pilih Staf / Mahasiswa Magang --</option>
                      {karyawanList.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.fullName} (NIM: {k.nim})
                        </option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignId(null);
                          setSelectedCsId('');
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={busy || !selectedCsId}
                        className="btn btn-primary btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        {busy ? <Loader2 size={14} className="spin-icon" /> : <UserCheck size={14} />}
                        <span>Simpan Penugasan</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Inline Form Reject */}
                {rejectId === r.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(r.id, { action: 'reject', reason: reason.trim() });
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-3)',
                      background: 'var(--color-surface-muted)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <label
                      htmlFor={`rj-${r.id}`}
                      className="form-label"
                      style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', margin: 0 }}
                    >
                      Alasan penolakan (dikirim ke pembeli) <span style={{ color: 'var(--color-error)' }}>*</span>
                    </label>
                    <textarea
                      id={`rj-${r.id}`}
                      className="form-input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={10}
                      maxLength={500}
                      required
                      rows={2}
                      placeholder="min. 10 karakter, mis. bukti transfer tidak sesuai nominal"
                      style={{ fontSize: 'var(--text-sm)', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectId(null);
                          setReason('');
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={busy || reason.trim().length < 10}
                        className="btn btn-danger btn-sm"
                      >
                        {busy ? <Loader2 size={14} className="spin-icon" /> : null}
                        <span>Tolak Pesanan</span>
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Global Preview Modal untuk Bukti Transfer */}
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bukti Transfer"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: 9999,
            display: 'grid',
            placeItems: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setPreviewImage(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              maxWidth: 500,
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)' }}>
                Bukti Transfer
              </h3>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="btn btn-secondary btn-sm"
                style={{ padding: 4 }}
                aria-label="Tutup preview"
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-surface-muted)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                maxHeight: '65vh',
              }}
            >
              <img
                src={previewImage}
                alt="Bukti Transfer"
                style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <a
                href={previewImage}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
              >
                <ExternalLink size={14} />
                <span>Buka Ukuran Penuh</span>
              </a>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="btn btn-primary btn-sm"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
