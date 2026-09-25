'use client';
// =============================================================
// /admin/jadwal — Halaman Admin: Kelola Slot Jadwal Shift
// Fitur:
//   - Lihat semua slot per hari (terisi / kosong)
//   - Bebaskan slot (free) — karyawan bisa daftar ulang
//   - Pindah ke karyawan lain (reassign)
//   - Tukar slot dua karyawan (swap)
// =============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, UserX, UserCheck, ArrowLeftRight,
  CheckCircle, AlertCircle, Loader2, X, Search,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type SlotEntry = {
  id: string;
  orderInSlot: number;
  employeeId: string | null;
  employeeName: string | null;
  employeeNim: string | null;
  isFilled: boolean;
};

type SlotGroup = {
  slotStart: string;
  slotEnd: string;
  coordinatorName: string | null;
  entries: SlotEntry[];
  filledCount: number;
  totalCount: number;
};

type DayGroup = {
  dayOfWeek: string;
  slots: SlotGroup[];
};

type ModalState =
  | { type: 'free'; slot: SlotEntry; day: string; time: string }
  | { type: 'reassign'; slot: SlotEntry; day: string; time: string }
  | { type: 'swap'; slot: SlotEntry; day: string; time: string }
  | null;

type EmployeeOption = {
  id: string;
  fullName: string;
  nim: string;
  programStudi: string;
};

// ─────────────────────────────────────────────────────────────
// Modal Konfirmasi / Aksi
// ─────────────────────────────────────────────────────────────
function SlotModal({
  modal,
  onClose,
  onRefresh,
}: {
  modal: ModalState;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Reassign: cari karyawan
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmp, setLoadingEmp] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeOption | null>(null);
  // Swap: cari slot target
  const [schedule, setSchedule] = useState<DayGroup[]>([]);
  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);

  // Fetch karyawan untuk reassign
  const fetchEmployees = useCallback(async (q: string) => {
    if (!q.trim()) { setEmployees([]); return; }
    setLoadingEmp(true);
    try {
      const res = await fetch(`/api/admin/karyawan?q=${encodeURIComponent(q)}&limit=8`);
      const json = await res.json() as { success: boolean; data?: { employees: EmployeeOption[] } };
      if (json.success && json.data) setEmployees(json.data.employees);
    } finally { setLoadingEmp(false); }
  }, []);

  // Fetch jadwal untuk swap
  useEffect(() => {
    if (modal?.type === 'swap') {
      fetch('/api/publik/jadwal-slot')
        .then(r => r.json())
        .then((j: { success: boolean; data?: { schedule: DayGroup[] } }) => {
          if (j.success && j.data) setSchedule(j.data.schedule);
        });
    }
  }, [modal]);

  useEffect(() => {
    const t = setTimeout(() => { if (modal?.type === 'reassign') fetchEmployees(search); }, 350);
    return () => clearTimeout(t);
  }, [search, modal, fetchEmployees]);

  if (!modal) return null;

  async function handleAction() {
    if (!modal) return;
    setLoading(true);
    setResult(null);

    let body: Record<string, string>;
    if (modal.type === 'free') {
      body = { action: 'free' };
    } else if (modal.type === 'reassign') {
      if (!selectedEmp) return;
      body = { action: 'reassign', newEmployeeId: selectedEmp.id };
    } else {
      if (!targetSlotId) return;
      body = { action: 'swap', targetSlotId };
    }

    try {
      const res = await fetch(`/api/admin/jadwal/slot/${modal.slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; data?: { message: string }; error?: string };
      if (json.success) {
        setResult({ ok: true, msg: json.data?.message ?? 'Berhasil' });
        onRefresh();
        setTimeout(onClose, 1800);
      } else {
        setResult({ ok: false, msg: json.error ?? 'Gagal.' });
      }
    } catch {
      setResult({ ok: false, msg: 'Kesalahan jaringan.' });
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    modal.type === 'free' ||
    (modal.type === 'reassign' && !!selectedEmp) ||
    (modal.type === 'swap' && !!targetSlotId);

  const titles: Record<NonNullable<ModalState>['type'], string> = {
    free:     '🔓 Bebaskan Slot',
    reassign: '👤 Pindah ke Karyawan Lain',
    swap:     '🔄 Tukar Slot',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-6)', width: '100%', maxWidth: 460,
          boxShadow: 'var(--shadow-xl)', maxHeight: '80vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-lg)' }}>
              {titles[modal.type]}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {modal.day} · {modal.time}
              {modal.slot.employeeName && <> · <strong>{modal.slot.employeeName}</strong></>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* ── Free ── */}
        {modal.type === 'free' && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
            Slot <strong>{modal.slot.employeeName ?? '—'}</strong> akan dibebaskan.
            Slot menjadi <strong>kosong</strong> dan bisa didaftar kembali oleh karyawan lain.
          </div>
        )}

        {/* ── Reassign: cari karyawan ── */}
        {modal.type === 'reassign' && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Cari karyawan yang akan menempati slot ini:
            </p>
            <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                className="form-input"
                placeholder="Cari nama atau NIM..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
            </div>
            {loadingEmp && <div style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}><Loader2 size={12} className="spin-icon" style={{ display: 'inline' }} /> Mencari...</div>}
            {employees.map(emp => (
              <div
                key={emp.id}
                onClick={() => setSelectedEmp(emp)}
                style={{
                  padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                  border: selectedEmp?.id === emp.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  cursor: 'pointer', marginBottom: 'var(--space-2)',
                  background: selectedEmp?.id === emp.id ? 'var(--color-primary-light)' : 'transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{emp.fullName}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>NIM {emp.nim} · {emp.programStudi}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Swap: pilih slot target ── */}
        {modal.type === 'swap' && (
          <div style={{ marginBottom: 'var(--space-4)', maxHeight: 300, overflowY: 'auto' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Pilih slot yang ingin ditukar:
            </p>
            {schedule.map(day => (
              <div key={day.dayOfWeek}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)', padding: '2px var(--space-2)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)' }}>
                  {day.dayOfWeek}
                </div>
                {day.slots.map(slotGroup =>
                  slotGroup.entries
                    .filter(e => e.isFilled && e.id !== modal.slot.id)
                    .map(entry => (
                      <div
                        key={entry.id}
                        onClick={() => setTargetSlotId(entry.id)}
                        style={{
                          padding: 'var(--space-2) var(--space-3)',
                          border: targetSlotId === entry.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)', cursor: 'pointer',
                          marginBottom: 'var(--space-1)',
                          background: targetSlotId === entry.id ? 'var(--color-primary-light)' : 'transparent',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{entry.employeeName}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{day.dayOfWeek} · {slotGroup.slotStart}–{slotGroup.slotEnd}</div>
                        </div>
                        {targetSlotId === entry.id && <CheckCircle size={16} style={{ color: 'var(--color-primary)' }} />}
                      </div>
                    ))
                )}
              </div>
            ))}
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: result.ok ? 'var(--color-success-light)' : 'var(--color-error-light)', display: 'flex', gap: 8, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            {result.ok
              ? <CheckCircle size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              : <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />}
            <span style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{result.msg}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>Batal</button>
          <button
            onClick={handleAction}
            className={`btn ${modal.type === 'free' ? 'btn-danger' : 'btn-primary'}`}
            disabled={loading || !canSubmit}
            style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {loading
              ? <><Loader2 size={14} className="spin-icon" /> Memproses...</>
              : modal.type === 'free' ? '🔓 Bebaskan Slot'
              : modal.type === 'reassign' ? '✅ Pindahkan'
              : '🔄 Tukar Slot'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Slot Card
// ─────────────────────────────────────────────────────────────
function SlotCard({
  entry,
  day,
  time,
  onAction,
}: {
  entry: SlotEntry;
  day: string;
  time: string;
  onAction: (modal: ModalState) => void;
}) {
  if (entry.orderInSlot === 99) return null; // Skip koordinator

  return (
    <div style={{
      padding: 'var(--space-3)',
      borderRadius: 'var(--radius-md)',
      border: entry.isFilled ? '1px solid var(--color-border)' : '1.5px dashed var(--color-border)',
      background: entry.isFilled ? 'var(--color-surface)' : 'var(--color-surface-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
        {entry.isFilled ? (
          <CheckCircle size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px dashed var(--color-border)', flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: entry.isFilled ? 'var(--weight-semibold)' : 'var(--weight-normal)', color: entry.isFilled ? 'var(--color-text)' : 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entry.isFilled ? entry.employeeName : `Slot ${entry.orderInSlot} — kosong`}
          </div>
          {entry.employeeNim && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>NIM {entry.employeeNim}</div>
          )}
        </div>
      </div>

      {/* Admin actions — hanya jika slot terisi */}
      {entry.isFilled && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            title="Tukar slot dengan karyawan lain"
            onClick={() => onAction({ type: 'swap', slot: entry, day, time })}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 6px', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
          >
            <ArrowLeftRight size={12} />
          </button>
          <button
            title="Pindah ke karyawan lain"
            onClick={() => onAction({ type: 'reassign', slot: entry, day, time })}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 6px', cursor: 'pointer', color: 'var(--color-info)', display: 'flex', alignItems: 'center' }}
          >
            <UserCheck size={12} />
          </button>
          <button
            title="Bebaskan slot (kosongkan)"
            onClick={() => onAction({ type: 'free', slot: entry, day, time })}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 6px', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', alignItems: 'center' }}
          >
            <UserX size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function AdminJadwalPage() {
  const [schedule, setSchedule] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/publik/jadwal-slot');
      const json = await res.json() as { success: boolean; data?: { schedule: DayGroup[] } };
      if (json.success && json.data) setSchedule(json.data.schedule);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSchedule(); }, [fetchSchedule]);

  const totalSlots = schedule.flatMap(d => d.slots).flatMap(s => s.entries).filter(e => e.orderInSlot !== 99).length;
  const filledSlots = schedule.flatMap(d => d.slots).flatMap(s => s.entries).filter(e => e.orderInSlot !== 99 && e.isFilled).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
            Jadwal Shift
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Kelola slot mingguan — geser, pindah, atau bebaskan slot karyawan
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Progress */}
          {!loading && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'right' }}>
              <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>{filledSlots}</span> / {totalSlots} slot terisi
            </div>
          )}
          <button
            onClick={fetchSchedule}
            className="btn btn-secondary"
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ArrowLeftRight size={12} /> Tukar slot (swap)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UserCheck size={12} style={{ color: 'var(--color-info)' }} /> Pindah ke karyawan lain</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UserX size={12} style={{ color: 'var(--color-error)' }} /> Bebaskan slot</div>
      </div>

      {/* Schedule Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
          <Loader2 size={24} className="spin-icon" style={{ display: 'inline' }} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-5)' }}>
          {schedule.map(day => (
            <div key={day.dayOfWeek} className="card">
              <div className="card-header">
                <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                  {day.dayOfWeek}
                </h2>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {day.slots.map(slotGroup => {
                  const normalEntries = slotGroup.entries.filter(e => e.orderInSlot !== 99);
                  const koordinator = slotGroup.coordinatorName;
                  return (
                    <div key={`${slotGroup.slotStart}-${slotGroup.slotEnd}`}>
                      {/* Slot header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
                          {slotGroup.slotStart} – {slotGroup.slotEnd}
                        </div>
                        {koordinator && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 'var(--radius-full)' }}>
                            {koordinator}
                          </div>
                        )}
                      </div>
                      {/* Slot entries */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {normalEntries.map(entry => (
                          <SlotCard
                            key={entry.id}
                            entry={entry}
                            day={day.dayOfWeek}
                            time={`${slotGroup.slotStart}–${slotGroup.slotEnd}`}
                            onAction={setModal}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <SlotModal
        modal={modal}
        onClose={() => setModal(null)}
        onRefresh={fetchSchedule}
      />
    </div>
  );
}
