'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  ArrowLeftRight, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, UserCheck, X, PlusCircle, MessageSquare,
} from 'lucide-react';

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Types ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
type SwapStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

type SwapRequest = {
  id: string;
  reason: string;
  status: SwapStatus;
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  peerApprovedAt?: string | null;
  requester: { fullName: string; nim: string; programStudi: string };
  peer?: { fullName: string; nim: string } | null;
  fromSchedule: { dayOfWeek: string; slotStart: string; slotEnd: string; coordinatorName: string | null };
  toSchedule:   { dayOfWeek: string; slotStart: string; slotEnd: string; coordinatorName: string | null };
  reviewedByAdmin: { fullName: string } | null;
};

type FlatSlot = {
  id: string;
  dayOfWeek: string;
  slotStart: string;
  slotEnd: string;
  employeeId: string | null;
  employeeName: string | null;
};

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Status Config ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
const STATUS_CFG: Record<SwapStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING:   { label: 'Menunggu',  color: 'hsl(38 90% 55%)',   icon: <Clock size={13} /> },
  APPROVED:  { label: 'Disetujui', color: 'var(--color-success)', icon: <CheckCircle2 size={13} /> },
  REJECTED:  { label: 'Ditolak',   color: 'var(--color-error)',   icon: <XCircle size={13} /> },
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

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Tambah Manual Modal ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
function TambahManualModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uid = useId();
  const [slots, setSlots]             = useState<FlatSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [fromId, setFromId]           = useState('');
  const [toId, setToId]               = useState('');
  const [reason, setReason]           = useState('');
  const [adminNote, setAdminNote]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  // Fetch semua slot jadwal (flatten dari publik endpoint)
  useEffect(() => {
    fetch('/api/publik/jadwal-slot')
      .then(r => r.json())
      .then(j => {
        type RawEntry = { id: string; orderInSlot: number; employeeId: string | null; employeeName: string | null; isFilled: boolean };
        type RawSlot  = { slotStart: string; slotEnd: string; entries: RawEntry[] };
        type RawDay   = { dayOfWeek: string; slots: RawSlot[] };
        const schedule: RawDay[] = j.data?.schedule ?? [];
        const flat: FlatSlot[] = [];
        for (const day of schedule) {
          for (const slot of day.slots) {
            for (const entry of slot.entries) {
              flat.push({
                id: entry.id,
                dayOfWeek: day.dayOfWeek,
                slotStart: slot.slotStart,
                slotEnd: slot.slotEnd,
                employeeId: entry.employeeId,
                employeeName: entry.employeeName,
              });
            }
          }
        }
        setSlots(flat);
      })
      .catch(() => setError('Gagal memuat jadwal'))
      .finally(() => setSlotsLoading(false));
  }, []);

  const fromSlot = slots.find(s => s.id === fromId);
  const toSlot   = slots.find(s => s.id === toId);

  // Slot Asal: hanya yang TERISI (ada kasir assigned) — tidak bisa swap slot kosong
  const filledSlots = slots.filter(s => s.employeeName !== null);

  // Slot Tujuan: hanya yang terisi juga (swap = tukar 2 orang), kecuali slot asal itu sendiri
  const toOptions = filledSlots.filter(s => s.id !== fromId);

  // Group by dayOfWeek untuk optgroup
  type GroupedSlots = Record<string, FlatSlot[]>;
  const groupFrom: GroupedSlots = {};
  for (const s of filledSlots) {
    if (!groupFrom[s.dayOfWeek]) groupFrom[s.dayOfWeek] = [];
    groupFrom[s.dayOfWeek]!.push(s);
  }
  const groupTo: GroupedSlots = {};
  for (const s of toOptions) {
    if (!groupTo[s.dayOfWeek]) groupTo[s.dayOfWeek] = [];
    groupTo[s.dayOfWeek]!.push(s);
  }
  const dayOrder = ['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId || !toId) { setError('Pilih slot asal dan tujuan.'); return; }
    if (fromId === toId)  { setError('Slot asal dan tujuan tidak boleh sama.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/swap-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromScheduleId: fromId, toScheduleId: toId, reason, adminNote: adminNote || undefined }),
      });
      const json = await res.json() as { success: boolean; error?: string; data?: { message: string } };
      if (!res.ok) { setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan'); return; }
      onSuccess(); onClose();
    } catch { setError('Kesalahan jaringan.'); }
    finally { setLoading(false); }
  }

  function slotLabel(s: FlatSlot) {
    const name = s.employeeName ? ` - ${s.employeeName}` : ' - (Kosong)';
    return `${s.dayOfWeek} ${s.slotStart} - ${s.slotEnd}${name}`;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
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
        animation: 'fade-in 0.2s ease',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          padding: 'var(--space-6)',
          width: '100%',
          maxWidth: '520px',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
          <div>
            <h2 id={`${uid}-title`} style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
              Tambah Tukar Shift Manual
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Input pertukaran shift setelah konfirmasi via WhatsApp. Langsung disetujui.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* WA notice */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-success-light)',
            border: '1px solid var(--color-success)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-success)',
            fontSize: 'var(--text-xs)',
            marginBottom: 'var(--space-4)',
            alignItems: 'flex-start',
          }}
        >
          <MessageSquare size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>
            Kasir sudah mengkonfirmasi tukar shift via <strong>WhatsApp</strong>. Sistem akan langsung memperbarui jadwal kedua kasir.
          </span>
        </div>

        {slotsLoading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
            <Loader2 size={24} className="spin-icon" style={{ marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 'var(--text-xs)' }}>Memuat jadwal...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Slot asal */}
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-from`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                Slot Asal <span style={{ color: 'var(--color-error)' }}>*</span>
                <span style={{ fontWeight: 'normal', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                  (jadwal kasir yang minta pindah)
                </span>
              </label>
              <select
                id={`${uid}-from`}
                className="form-input form-select"
                value={fromId}
                onChange={(e) => {
                  setFromId(e.target.value);
                  if (e.target.value === toId) setToId('');
                }}
                required
              >
                <option value="">-- Pilih slot asal --</option>
                {dayOrder.filter((d) => groupFrom[d]).map((day) => (
                  <optgroup key={day} label={day}>
                    {groupFrom[day]!.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.slotStart} - {s.slotEnd} | {s.employeeName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Slot tujuan */}
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-to`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                Slot Tujuan <span style={{ color: 'var(--color-error)' }}>*</span>
                <span style={{ fontWeight: 'normal', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                  (jadwal kasir yang akan ditukar)
                </span>
              </label>
              <select
                id={`${uid}-to`}
                className="form-input form-select"
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                required
              >
                <option value="">-- Pilih slot tujuan --</option>
                {dayOrder.filter((d) => groupTo[d]).map((day) => (
                  <optgroup key={day} label={day}>
                    {groupTo[day]!.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.slotStart} - {s.slotEnd} | {s.employeeName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Preview swap */}
            {fromSlot && toSlot && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-surface-alt)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase' }}>
                    Dari
                  </div>
                  <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
                    {fromSlot.dayOfWeek}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text)' }}>
                    {fromSlot.slotStart} - {fromSlot.slotEnd}
                  </div>
                  {fromSlot.employeeName && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {fromSlot.employeeName}
                    </div>
                  )}
                </div>
                <ArrowLeftRight size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden="true" />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase' }}>
                    Ke
                  </div>
                  <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-success)', fontSize: 'var(--text-sm)' }}>
                    {toSlot.dayOfWeek}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text)' }}>
                    {toSlot.slotStart} - {toSlot.slotEnd}
                  </div>
                  {toSlot.employeeName && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {toSlot.employeeName}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Alasan */}
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-reason`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                Alasan Tukar <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              <textarea
                id={`${uid}-reason`}
                className="form-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contoh: Ada jadwal praktikum kuliah, sudah konfirmasi tukar dengan rekan..."
                required
                minLength={5}
                rows={2}
                style={{ resize: 'vertical' }}
              />
            </div>

            {/* Catatan admin */}
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor={`${uid}-note`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                Catatan Admin <span style={{ fontWeight: 'normal', color: 'var(--color-text-muted)' }}>(opsional)</span>
              </label>
              <input
                id={`${uid}-note`}
                type="text"
                className="form-input"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Contoh: Sudah dikonfirmasi via WA kedua belah pihak"
              />
            </div>

            {error && (
              <div role="alert" style={{ display: 'flex', gap: 8, padding: 'var(--space-2) var(--space-3)', background: 'var(--color-error-light)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 'var(--text-xs)', alignItems: 'center' }}>
                <AlertTriangle size={14} aria-hidden="true" /> {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
                Batal
              </button>
              <button
                type="submit"
                disabled={loading || !fromId || !toId || reason.length < 5}
                className="btn btn-primary"
                style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
              >
                {loading ? <><Loader2 size={16} className="spin-icon" /> Memproses...</> : <><CheckCircle2 size={16} /> Simpan &amp; Setujui</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Review Modal
// ─────────────────────────────────────────────────────────────
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
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/swap-request/${swap.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, adminNote: adminNote || undefined }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) { setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan'); return; }
      onSuccess();
      onClose();
    } catch {
      setError('Kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
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
        animation: 'fade-in 0.2s ease',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          padding: 'var(--space-6)',
          width: '100%',
          maxWidth: '480px',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
          <div>
            <h2 id={`${uid}-title`} style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
              Review Pengajuan Swap
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Diajukan oleh {swap.requester.fullName} ({swap.requester.nim})
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Swap Info */}
        <div
          style={{
            background: 'var(--color-surface-alt)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', marginBottom: 2 }}>
              Dari
            </div>
            <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
              {swap.fromSchedule.dayOfWeek}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text)' }}>
              {swap.fromSchedule.slotStart} – {swap.fromSchedule.slotEnd}
            </div>
          </div>
          <ArrowLeftRight size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden="true" />
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)', marginBottom: 2 }}>
              Ke
            </div>
            <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-success)', fontSize: 'var(--text-sm)' }}>
              {swap.toSchedule.dayOfWeek}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text)' }}>
              {swap.toSchedule.slotStart} – {swap.toSchedule.slotEnd}
            </div>
          </div>
        </div>

        {/* Reason */}
        <div
          style={{
            marginBottom: 'var(--space-4)',
            padding: 'var(--space-3)',
            background: 'var(--color-info-light)',
            borderRadius: 'var(--radius-md)',
            borderLeft: '3px solid var(--color-info)',
          }}
        >
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-info)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', marginBottom: 2 }}>
            Alasan Pemohon
          </div>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{swap.reason}</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Action selector */}
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 'var(--space-2)' }}>
              Keputusan Admin *
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              {(['APPROVE', 'REJECT'] as const).map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setAction(a)}
                  className={`btn ${action === a ? (a === 'APPROVE' ? 'btn-primary' : 'btn-danger') : 'btn-secondary'}`}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
                >
                  {a === 'APPROVE' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  {a === 'APPROVE' ? 'Setujui' : 'Tolak'}
                </button>
              ))}
            </div>
          </div>

          {/* Admin note */}
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor={`${uid}-note`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
              Catatan Admin {action === 'REJECT' && <span style={{ color: 'var(--color-error)' }}>*</span>}
            </label>
            <textarea
              id={`${uid}-note`}
              className="form-input"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder={action === 'APPROVE' ? 'Opsional — misal: sudah dikonfirmasi dengan koordinator' : 'Wajib — jelaskan alasan penolakan swap'}
              required={action === 'REJECT'}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>

          {action === 'APPROVE' && (
            <div style={{ display: 'flex', gap: 8, padding: 'var(--space-2) var(--space-3)', background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent-text)', fontSize: 'var(--text-xs)', alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span>Jika disetujui, jadwal kasir <strong>{swap.fromSchedule.dayOfWeek}</strong> dan <strong>{swap.toSchedule.dayOfWeek}</strong> akan langsung ditukar secara permanen.</span>
            </div>
          )}

          {error && (
            <div role="alert" style={{ display: 'flex', gap: 8, padding: 'var(--space-2) var(--space-3)', background: 'var(--color-error-light)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 'var(--text-xs)', alignItems: 'center' }}>
              <AlertTriangle size={14} aria-hidden="true" /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`btn ${action === 'APPROVE' ? 'btn-primary' : 'btn-danger'}`}
              style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
            >
              {loading ? (
                <><Loader2 size={16} className="spin-icon" /> Memproses...</>
              ) : action === 'APPROVE' ? (
                <><CheckCircle2 size={16} /> Setujui Swap</>
              ) : (
                <><XCircle size={16} /> Tolak Pengajuan</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
const FILTER_OPTIONS: { label: string; value: string }[] = [
  { label: 'Menunggu', value: 'PENDING' },
  { label: 'Semua', value: 'ALL' },
  { label: 'Disetujui', value: 'APPROVED' },
  { label: 'Ditolak', value: 'REJECTED' },
];

export default function SwapRequestPage() {
  const [requests, setRequests]     = useState<SwapRequest[]>([]);
  const [loading, setLoading]       = useState(false);
  const [filter, setFilter]         = useState('PENDING');
  const [selected, setSelected]     = useState<SwapRequest | null>(null);
  const [showManual, setShowManual] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/swap-request?status=${filter}`);
      const json = await res.json() as { data?: SwapRequest[] };
      setRequests(json.data ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="page-title">Riwayat Tukar Shift</h1>
            {pendingCount > 0 && filter === 'PENDING' && (
              <span className="badge badge-warning" style={{ fontSize: 'var(--text-xs)' }}>
                {pendingCount} Menunggu
              </span>
            )}
          </div>
          <p className="page-subtitle">Review pengajuan kasir dan catat permohonan tukar jadwal shift</p>
        </div>

        {/* Tombol Tambah Manual */}
        <button
          id="btn-tambah-swap-manual"
          onClick={() => setShowManual(true)}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <PlusCircle size={16} aria-hidden="true" /> Tambah Manual
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <div
            role="group"
            aria-label="Pilih filter status pengajuan"
            style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
          >
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`btn btn-sm ${filter === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={filter === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="card">
          <div
            className="empty-state"
            aria-live="polite"
            aria-busy="true"
            style={{
              padding: 'var(--space-12) var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              width: '100%',
            }}
          >
            <Loader2 size={28} className="spin-icon" style={{ opacity: 1, margin: '0 auto var(--space-3)' }} />
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', textAlign: 'center' }}>Memuat pengajuan tukar shift...</p>
          </div>
        </div>
      ) : requests.length === 0 ? (
        <div className="card">
          <div
            className="empty-state"
            style={{
              padding: 'var(--space-12) var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              width: '100%',
            }}
          >
            <ArrowLeftRight size={36} aria-hidden="true" style={{ margin: '0 auto var(--space-3)', opacity: 0.35 }} />
            <p style={{ margin: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', textAlign: 'center' }}>
              Tidak ada pengajuan tukar shift
            </p>
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              {filter === 'PENDING'
                ? 'Semua permohonan tukar shift kasir telah diproses.'
                : 'Belum ada data pengajuan untuk kategori filter ini.'}
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {requests.map((r) => (
            <div
              key={r.id}
              className="card"
              style={{
                borderLeft: r.status === 'PENDING' ? '3px solid var(--color-warning)' : '1px solid var(--color-border)',
                boxShadow: r.status === 'PENDING' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <div
                className="card-body"
                style={{
                  padding: 'var(--space-4) var(--space-5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-4)',
                  flexWrap: 'wrap',
                }}
              >
                {/* 1. Pemohon & Rekan */}
                <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
                  <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>
                    {r.requester.fullName}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    NIM: {r.requester.nim} • {r.requester.programStudi}
                  </div>
                  {r.peer && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-primary)', marginTop: 4, fontWeight: 500 }}>
                      Tukar dg: <strong>{r.peer.fullName}</strong>
                      {r.peerApprovedAt ? (
                        <span style={{ color: 'var(--color-success)', marginLeft: 6, fontWeight: 600 }}>
                          ✔ Rekan Setuju
                        </span>
                      ) : (
                        <span style={{ color: 'hsl(38 92% 40%)', marginLeft: 6, fontWeight: 600 }}>
                          ⏳ Menunggu Rekan
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Alur Swap */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    background: 'var(--color-surface-alt)',
                    padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)' }}>
                      Dari
                    </div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>
                      {r.fromSchedule.dayOfWeek}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                      {r.fromSchedule.slotStart}–{r.fromSchedule.slotEnd}
                    </div>
                  </div>

                  <ArrowLeftRight size={14} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 'var(--weight-bold)' }}>
                      Ke
                    </div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>
                      {r.toSchedule.dayOfWeek}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                      {r.toSchedule.slotStart}–{r.toSchedule.slotEnd}
                    </div>
                  </div>
                </div>

                {/* 3. Alasan */}
                <div style={{ flex: '1 1 200px', minWidth: '160px' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase' }}>
                    Alasan
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '220px',
                    }}
                    title={r.reason}
                  >
                    {r.reason}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Diajukan: {new Date(r.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>

                {/* 4. Status Badge & Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <SwapBadge status={r.status} />
                  {r.status === 'PENDING' && (
                    <button
                      onClick={() => setSelected(r)}
                      className="btn btn-sm btn-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', whiteSpace: 'nowrap' }}
                    >
                      <UserCheck size={14} aria-hidden="true" /> Review
                    </button>
                  )}
                </div>
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

      {/* Tambah Manual Modal */}
      {showManual && (
        <TambahManualModal
          onClose={() => setShowManual(false)}
          onSuccess={() => {
            fetchData();
            setFilter('APPROVED');
          }}
        />
      )}
    </div>
  );
}
