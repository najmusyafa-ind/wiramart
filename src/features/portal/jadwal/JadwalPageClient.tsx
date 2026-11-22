'use client';
// =============================================================
// /admin/jadwal — Halaman Admin: Kelola Slot Jadwal Shift
// Fitur:
// - Lihat semua slot per hari (terisi / kosong)
// - Bebaskan slot (free) — karyawan bisa daftar ulang
// - Pindah ke karyawan lain (reassign)
// - Tukar slot dua karyawan (swap)
// =============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, UserX, UserCheck, ArrowLeftRight,
  CheckCircle, AlertCircle, Loader2, X, Search, Trash2, Plus,
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
  const [forceMove, setForceMove] = useState(true);
  // Swap: cari slot target
  const [schedule, setSchedule] = useState<DayGroup[]>([]);
  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);

  // Fetch karyawan untuk reassign
  const fetchEmployees = useCallback(async (q: string) => {
    setLoadingEmp(true);
    try {
      const url = q.trim()
        ? `/api/admin/karyawan?q=${encodeURIComponent(q.trim())}&limit=12`
        : `/api/admin/karyawan?limit=12`;
      const res = await fetch(url);
      const json = await res.json() as { success: boolean; data?: unknown };
      if (json.success && json.data) {
        const rawList = Array.isArray(json.data)
          ? json.data
          : Array.isArray((json.data as { employees?: unknown })?.employees)
          ? (json.data as { employees: unknown[] }).employees
          : [];

        const validEmployees: EmployeeOption[] = (rawList as Array<Record<string, unknown>>).map((item) => ({
          id: String(item.id ?? ''),
          fullName: String(item.fullName || item.name || ''),
          nim: String(item.nim || ''),
          programStudi: String(item.programStudi || ''),
        }));

        setEmployees(validEmployees);
      } else {
        setEmployees([]);
      }
    } catch {
      setEmployees([]);
    } finally {
      setLoadingEmp(false);
    }
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
    if (modal?.type === 'reassign') {
      const t = setTimeout(() => { fetchEmployees(search); }, 300);
      return () => clearTimeout(t);
    }
  }, [search, modal, fetchEmployees]);

  if (!modal) return null;

  async function handleAction() {
    if (!modal) return;
    setLoading(true);
    setResult(null);

    let body: Record<string, string | boolean>;
    if (modal.type === 'free') {
      body = { action: 'free' };
    } else if (modal.type === 'reassign') {
      if (!selectedEmp) return;
      body = { action: 'reassign', newEmployeeId: selectedEmp.id, forceMove };
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

  const selectedTargetEntry = (schedule || [])
    .flatMap(d => d.slots || [])
    .flatMap(s => s.entries || [])
    .find(e => e.id === targetSlotId);
  const selectedTargetIsEmpty = Boolean(selectedTargetEntry && !selectedTargetEntry.isFilled);

  const canSubmit =
    modal.type === 'free' ||
    (modal.type === 'reassign' && !!selectedEmp) ||
    (modal.type === 'swap' && !!targetSlotId);

  const titles: Record<NonNullable<ModalState>['type'], string> = {
    free: 'Bebaskan Slot',
    reassign: modal.slot.isFilled ? 'Ganti / Pindah Karyawan' : 'Tugaskan Karyawan ke Slot Kosong',
    swap: 'Tukar / Pindah Slot',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(var(--space-3) + env(safe-area-inset-top, 0px)) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom, 0px))',
    }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-5)',
          paddingBottom: 'calc(var(--space-5) + env(safe-area-inset-bottom, 0px))',
          width: '100%', maxWidth: 460,
          boxShadow: 'var(--shadow-xl)', maxHeight: '90dvh', overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 'var(--space-4)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-lg)' }}>
              {titles[modal.type]}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {modal.day} · {modal.time}
              {modal.slot.employeeName && <> · <strong>{modal.slot.employeeName}</strong></>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)',
              minWidth: 44, minHeight: 44, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, borderRadius: 'var(--radius-md)',
            }}
          >
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
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                className="form-input"
                aria-label="Cari nama atau NIM karyawan"
                placeholder="Cari nama atau NIM..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 36, fontSize: 'var(--text-base)', minHeight: 44 }}
              />
            </div>
            {loadingEmp ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                <Loader2 size={16} className="spin-icon" style={{ margin: '0 auto 6px' }} />
                <span>Memuat daftar karyawan...</span>
              </div>
            ) : !employees || employees.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)' }}>
                {search.trim() ? 'Tidak ada karyawan yang cocok dengan pencarian.' : 'Belum ada data karyawan aktif.'}
              </div>
            ) : (
              (employees || []).map(emp => (
                <button
                  type="button"
                  key={emp.id}
                  onClick={() => setSelectedEmp(emp)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', minHeight: 48,
                    border: selectedEmp?.id === emp.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    cursor: 'pointer', marginBottom: 'var(--space-2)',
                    background: selectedEmp?.id === emp.id ? 'var(--color-primary-light)' : 'transparent',
                    transition: 'background-color 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  <span style={{ display: 'block', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{emp.fullName}</span>
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>NIM {emp.nim} · {emp.programStudi}</span>
                </button>
              ))
            )}
            {selectedEmp && (
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
                fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)',
                marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={forceMove}
                  onChange={e => setForceMove(e.target.checked)}
                  style={{ width: 18, height: 18, flexShrink: 0 }}
                />
                <span>Pindahkan otomatis jika karyawan sudah memiliki jadwal shift di hari lain</span>
              </label>
            )}
          </div>
        )}

        {/* ── Swap: pilih slot target (termasuk slot kosong & dibagi per-shift) ── */}
        {modal.type === 'swap' && (
          <div style={{ marginBottom: 'var(--space-4)', maxHeight: '45dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Pilih slot target (tukar posisi atau pindah ke slot kosong):
            </p>
            {schedule.map(day => (
              <div key={day.dayOfWeek} style={{ marginBottom: 'var(--space-3)' }}>
                {/* Header Hari */}
                <div style={{
                  fontSize: '0.75rem', fontWeight: 'var(--weight-bold)',
                  color: 'var(--color-text-secondary)',
                  padding: '4px var(--space-2)',
                  background: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--space-2)',
                }}>
                  {day.dayOfWeek}
                </div>

                {day.slots.map(slotGroup => {
                  const entries = slotGroup.entries.filter(e => e.orderInSlot !== 99 && e.id !== modal.slot.id);
                  if (entries.length === 0) return null;

                  const isPagi = slotGroup.slotStart < '11:00';
                  const shiftLabel = isPagi
                    ? `Shift Pagi (${slotGroup.slotStart}–${slotGroup.slotEnd})`
                    : `Shift Siang (${slotGroup.slotStart}–${slotGroup.slotEnd})`;

                  return (
                    <div key={`${day.dayOfWeek}-${slotGroup.slotStart}`} style={{ marginBottom: 'var(--space-2)', paddingLeft: 'var(--space-2)' }}>
                      {/* Sub-header Shift */}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: '0.72rem', fontWeight: 'var(--weight-semibold)',
                        color: 'var(--color-primary)',
                        padding: '2px 0',
                        marginBottom: 'var(--space-1)',
                      }}>
                        <span>{shiftLabel}</span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                          {slotGroup.filledCount}/{slotGroup.totalCount} terisi
                        </span>
                      </div>

                      {/* List Slot */}
                      {entries.map(entry => {
                        const isSelected = targetSlotId === entry.id;
                        const isEmpty = !entry.isFilled;

                        return (
                          <button
                            type="button"
                            key={entry.id}
                            onClick={() => setTargetSlotId(entry.id)}
                            style={{
                              width: '100%', textAlign: 'left',
                              padding: 'var(--space-2) var(--space-3)', minHeight: 48,
                              border: isSelected
                                ? '2px solid var(--color-primary)'
                                : isEmpty
                                ? '1.5px dashed var(--color-success, #10b981)'
                                : '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-md)',
                              cursor: 'pointer',
                              marginBottom: 'var(--space-1)',
                              background: isSelected
                                ? 'var(--color-primary-light)'
                                : isEmpty
                                ? 'var(--color-success-light, rgba(16, 185, 129, 0.08))'
                                : 'transparent',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              transition: 'background-color 0.15s ease, border-color 0.15s ease',
                            }}
                          >
                            <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
                              {isEmpty ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{
                                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                    background: 'var(--color-success, #10b981)', flexShrink: 0,
                                  }} />
                                  <span style={{ display: 'block' }}>
                                    <span style={{
                                      display: 'block',
                                      fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                                      color: 'var(--color-success, #059669)',
                                    }}>
                                      Slot {entry.orderInSlot} — Kosong (Pindah ke sini)
                                    </span>
                                    <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                                      {day.dayOfWeek} · {slotGroup.slotStart}–{slotGroup.slotEnd}
                                    </span>
                                  </span>
                                </span>
                              ) : (
                                <span style={{ display: 'block' }}>
                                  <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                                    {entry.employeeName}
                                  </span>
                                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                    {entry.employeeNim ? `NIM ${entry.employeeNim} · ` : ''}Slot {entry.orderInSlot} (Tukar posisi)
                                  </span>
                                </span>
                              )}
                            </span>
                            {isSelected && <CheckCircle size={16} style={{ color: 'var(--color-primary)', flexShrink: 0, marginLeft: 8 }} />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
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
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1, minWidth: 100, minHeight: 44 }}>Batal</button>
          <button
            type="button"
            onClick={handleAction}
            className={`btn ${modal.type === 'free' ? 'btn-danger' : 'btn-primary'}`}
            disabled={loading || !canSubmit}
            style={{ flex: 2, minWidth: 160, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {loading
              ? <><Loader2 size={14} className="spin-icon" /> Memproses...</>
              : modal.type === 'free' ? 'Bebaskan Slot'
              : modal.type === 'reassign' ? (modal.slot.isFilled ? 'Pindahkan' : 'Tugaskan ke Slot')
              : selectedTargetIsEmpty ? 'Pindah ke Slot Kosong'
              : 'Tukar Posisi'}
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
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 130, flex: '1 1 130px' }}>
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

      {/* Admin actions */}
      {entry.isFilled ? (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            title="Tukar slot dengan karyawan lain"
            aria-label={`Tukar slot ${entry.employeeName ?? ''}`}
            onClick={() => onAction({ type: 'swap', slot: entry, day, time })}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', minWidth: 44, minHeight: 44, padding: 0, cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowLeftRight size={15} />
          </button>
          <button
            type="button"
            title="Pindah ke karyawan lain"
            aria-label={`Pindah slot ${entry.employeeName ?? ''} ke karyawan lain`}
            onClick={() => onAction({ type: 'reassign', slot: entry, day, time })}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', minWidth: 44, minHeight: 44, padding: 0, cursor: 'pointer', color: 'var(--color-info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <UserCheck size={15} />
          </button>
          <button
            type="button"
            title="Bebaskan slot (kosongkan)"
            aria-label={`Bebaskan slot ${entry.employeeName ?? ''}`}
            onClick={() => onAction({ type: 'free', slot: entry, day, time })}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', minWidth: 44, minHeight: 44, padding: 0, cursor: 'pointer', color: 'var(--color-error)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <UserX size={15} />
          </button>
        </div>
      ) : (
        <div style={{ flexShrink: 0 }}>
          <button
            type="button"
            title="Tugaskan karyawan ke slot kosong ini"
            onClick={() => onAction({ type: 'reassign', slot: entry, day, time })}
            className="btn btn-secondary"
            style={{
              padding: '8px 14px', minHeight: 44, fontSize: 'var(--text-xs)',
              display: 'flex', alignItems: 'center', gap: 4,
              borderColor: 'var(--color-primary)', color: 'var(--color-primary)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            <Plus size={14} /> Isi Slot
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
async function requestJadwalSchedule(signal?: AbortSignal): Promise<DayGroup[] | null> {
  const res = await fetch('/api/publik/jadwal-slot', { signal });
  const json = await res.json() as { success: boolean; data?: { schedule: DayGroup[] } };
  return json.success && json.data ? json.data.schedule : null;
}

export default function AdminJadwalPage() {
  const [schedule, setSchedule] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const nextSchedule = await requestJadwalSchedule();
      if (nextSchedule) setSchedule(nextSchedule);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    requestJadwalSchedule(controller.signal)
      .then((nextSchedule) => {
        if (!controller.signal.aborted && nextSchedule) {
          setSchedule(nextSchedule);
        }
      })
      .catch(() => { /* silent on abort/network error */ })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {/* Progress */}
          {!loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>{filledSlots}</span>
                {' / '}{totalSlots} slot terisi
              </div>
              {/* Progress bar global */}
              <div style={{ width: 160, maxWidth: '100%', height: 6, background: 'var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0}%`,
                  background: filledSlots === totalSlots
                    ? 'var(--color-success)'
                    : filledSlots / totalSlots >= 0.75
                      ? 'var(--color-warning, hsl(38,92%,50%))'
                      : 'var(--color-primary)',
                  borderRadius: 999,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={fetchSchedule}
            className="btn btn-secondary"
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 'var(--space-5)' }}>
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
                  const filledCount = normalEntries.filter(e => e.isFilled).length;

                  async function handleDeleteGroup() {
                    const label = `${slotGroup.slotStart}-${slotGroup.slotEnd}`;
                    if (!confirm(
                      `Hapus shift ${day.dayOfWeek} ${label}?\n\n` +
                      `Ini akan menghapus ${normalEntries.length} slot secara permanen.\n` +
                      `Pastikan semua slot kosong sebelum menghapus.`
                    )) return;

                    const res = await fetch('/api/admin/jadwal/slot-group', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        dayOfWeek: day.dayOfWeek,
                        slotStart: slotGroup.slotStart,
                        slotEnd: slotGroup.slotEnd,
                      }),
                    });
                    const json = await res.json() as { data?: { message?: string }; error?: string };
                    if (!res.ok) {
                      alert('Gagal hapus: ' + (json.error ?? 'Error tidak diketahui'));
                    } else {
                      alert(json.data?.message ?? 'Shift berhasil dihapus.');
                      fetchSchedule();
                    }
                  }

                  return (
                    <div key={`${slotGroup.slotStart}-${slotGroup.slotEnd}`}>
                      {/* Slot header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--space-2)' }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
                          {slotGroup.slotStart} – {slotGroup.slotEnd}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {koordinator && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 'var(--radius-full)' }}>
                              {koordinator}
                            </div>
                          )}
                          {/* Badge kapasitas */}
                          {(() => {
                            const filled = normalEntries.filter(e => e.isFilled).length;
                            const total = normalEntries.length;
                            const isFull = filled === total;
                            const isAlmost = !isFull && filled / total >= 0.75;
                            const bg = isFull ? 'hsl(0,72%,95%)' : isAlmost ? 'hsl(38,92%,92%)' : 'hsl(145,55%,92%)';
                            const color = isFull ? 'hsl(0,72%,40%)' : isAlmost ? 'hsl(38,92%,32%)' : 'hsl(145,55%,28%)';
                            return (
                              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', background: bg, color, padding: '1px 8px', borderRadius: 'var(--radius-full)' }}>
                                {filled}/{total}
                              </div>
                            );
                          })()}
                          {/* Tombol hapus slot group — hanya jika semua slot kosong */}
                          {filledCount === 0 && (
                            <button
                              type="button"
                              onClick={handleDeleteGroup}
                              title={`Hapus shift ${slotGroup.slotStart}-${slotGroup.slotEnd}`}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'hsl(0 70% 55%)', minWidth: 44, minHeight: 44, padding: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                opacity: 0.75, borderRadius: 'var(--radius-sm)',
                              }}
                              aria-label={`Hapus shift ${day.dayOfWeek} ${slotGroup.slotStart}-${slotGroup.slotEnd}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Mini progress bar */}
                      {(() => {
                        const filled = normalEntries.filter(e => e.isFilled).length;
                        const total = normalEntries.length;
                        return total > 0 ? (
                          <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 999, marginBottom: 'var(--space-2)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.round((filled / total) * 100)}%`,
                              background: filled === total
                                ? 'hsl(0,72%,50%)'
                                : filled / total >= 0.75
                                  ? 'hsl(38,92%,50%)'
                                  : 'var(--color-success)',
                              borderRadius: 999,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                        ) : null;
                      })()}
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
