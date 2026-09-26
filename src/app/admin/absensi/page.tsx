'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  ClipboardList, Search, CheckCircle2, XCircle, Clock, AlertTriangle,
  UserCheck, UserX, CalendarDays, ChevronLeft, ChevronRight, Loader2, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
type AttendanceStatus = 'HADIR' | 'TELAT' | 'IJIN' | 'TIDAK_HADIR' | 'PENGGANTI';

type AttendanceRecord = {
  id: string;
  attendanceDate: string;
  status: AttendanceStatus;
  lateMinutes: number;
  clockInActual: string | null;
  clockOutActual: string | null;
  notes: string | null;
  employee: { id: string; fullName: string; nim: string; programStudi: string; jabatan: string };
  schedule: { dayOfWeek: string; slotStart: string; slotEnd: string; coordinatorName: string | null };
};

// ─── Status Badge ─────────────────────────────────────────────
const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string; icon: React.ReactNode }> = {
  HADIR:       { label: 'Hadir',       color: 'var(--color-success)',  icon: <CheckCircle2 size={13} /> },
  TELAT:       { label: 'Telat',       color: 'hsl(38 90% 55%)',       icon: <Clock size={13} /> },
  IJIN:        { label: 'Ijin',        color: 'hsl(210 80% 60%)',      icon: <UserCheck size={13} /> },
  TIDAK_HADIR: { label: 'Tidak Hadir', color: 'var(--color-danger)',   icon: <UserX size={13} /> },
  PENGGANTI:   { label: 'Pengganti',   color: 'hsl(280 70% 65%)',      icon: <CalendarDays size={13} /> },
};

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem',
        fontWeight: 600, letterSpacing: '0.02em',
        background: `${cfg.color}22`, color: cfg.color,
        border: `1px solid ${cfg.color}44`,
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Modal Input Manual ───────────────────────────────────────
function ManualInputModal({
  onClose,
  onSuccess,
  date,
}: {
  onClose: () => void;
  onSuccess: () => void;
  date: string;
}) {
  const uid = useId();
  const [employees, setEmployees] = useState<{ id: string; fullName: string; nim: string }[]>([]);
  const [schedules, setSchedules] = useState<{ id: string; dayOfWeek: string; slotStart: string; slotEnd: string }[]>([]);
  const [form, setForm] = useState({ employeeId: '', scheduleId: '', status: 'IJIN' as 'IJIN' | 'TIDAK_HADIR', notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/karyawan').then(r => r.json()).then(j => setEmployees(j.data ?? []));
    fetch('/api/admin/jadwal').then(r => r.json()).then(j => setSchedules(j.data ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employeeId || !form.scheduleId) { setError('Pilih karyawan dan jadwal.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/absensi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, attendanceDate: date }),
      });
      const json = await res.json();
      if (!res.ok) { setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan'); return; }
      onSuccess(); onClose();
    } catch { setError('Kesalahan jaringan.'); }
    finally { setLoading(false); }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)', backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)', animation: 'fade-in 0.2s ease',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--color-border)', padding: 'var(--space-6)',
        width: '100%', maxWidth: '440px',
        boxShadow: '0 24px 48px -12px hsl(0 0% 0% / 0.35)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
          <h2 id={`${uid}-title`} style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            Input Absensi Manual
          </h2>
          <button onClick={onClose} aria-label="Tutup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: '0 0 var(--space-4)', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
          Tanggal: <strong style={{ color: 'var(--color-text-primary)' }}>{date}</strong>
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label htmlFor={`${uid}-emp`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Karyawan *</label>
            <select id={`${uid}-emp`} value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} required
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              <option value="">-- Pilih Karyawan --</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.fullName} ({e.nim})</option>)}
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-sched`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Jadwal *</label>
            <select id={`${uid}-sched`} value={form.scheduleId} onChange={e => setForm(f => ({ ...f, scheduleId: e.target.value }))} required
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              <option value="">-- Pilih Jadwal --</option>
              {schedules.map(s => <option key={s.id} value={s.id}>{s.dayOfWeek} {s.slotStart}–{s.slotEnd}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-status`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Status *</label>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              {(['IJIN', 'TIDAK_HADIR'] as const).map(s => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '8px 14px', borderRadius: 'var(--radius-md)', border: `2px solid ${form.status === s ? STATUS_CONFIG[s].color : 'var(--color-border)'}`, background: form.status === s ? `${STATUS_CONFIG[s].color}18` : 'transparent', flex: 1, justifyContent: 'center', transition: 'border-color 0.15s, background 0.15s' }}>
                  <input type="radio" name="status" value={s} checked={form.status === s} onChange={() => setForm(f => ({ ...f, status: s }))} style={{ display: 'none' }} />
                  <span style={{ color: STATUS_CONFIG[s].color }}>{STATUS_CONFIG[s].icon}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: STATUS_CONFIG[s].color }}>{STATUS_CONFIG[s].label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={`${uid}-notes`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Catatan (opsional)</label>
            <textarea id={`${uid}-notes`} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Alasan ijin, keterangan khusus..." rows={3}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>

          {error && (
            <div role="alert" style={{ display: 'flex', gap: '8px', padding: '10px 14px', background: 'hsl(0 70% 55% / 0.12)', border: '1px solid hsl(0 70% 55% / 0.3)', borderRadius: 'var(--radius-md)', color: 'hsl(0 70% 65%)', fontSize: '0.85rem', alignItems: 'center' }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 600 }}>Batal</button>
            <button type="submit" disabled={loading} style={{ flex: 2, padding: '10px', background: 'var(--color-primary)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: loading ? 0.7 : 1 }}>
              {loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Menyimpan...</> : 'Simpan Absensi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function AbsensiPage() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [selectedDate, setSelectedDate] = useState(today);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [showModal, setShowModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/absensi?date=${selectedDate}`);
      const json = await res.json();
      setRecords(json.data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Navigate date
  const shiftDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }));
  };

  // Filter
  const filtered = records.filter(r =>
    searchQ === '' ||
    r.employee.fullName.toLowerCase().includes(searchQ.toLowerCase()) ||
    r.employee.nim.includes(searchQ),
  );

  // Summary
  const summary = {
    hadir:       records.filter(r => r.status === 'HADIR').length,
    telat:       records.filter(r => r.status === 'TELAT').length,
    ijin:        records.filter(r => r.status === 'IJIN').length,
    tidakHadir:  records.filter(r => r.status === 'TIDAK_HADIR').length,
    pengganti:   records.filter(r => r.status === 'PENGGANTI').length,
  };

  const isToday = selectedDate === today;
  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-lg)', background: 'hsl(210 80% 60% / 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(210 80% 65%)' }}>
            <ClipboardList size={20} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>Rekap Absensi</h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Pantau kehadiran karyawan kasir harian</p>
          </div>
        </div>
      </div>

      {/* Date Navigator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '6px' }}>
          <button onClick={() => shiftDate(-1)} aria-label="Hari sebelumnya" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '6px 10px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center' }}>
            <ChevronLeft size={18} />
          </button>
          <input
            type="date" value={selectedDate} max={today}
            onChange={e => setSelectedDate(e.target.value)}
            aria-label="Pilih tanggal"
            style={{ background: 'none', border: 'none', color: 'var(--color-text-primary)', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', padding: '4px' }}
          />
          <button onClick={() => shiftDate(1)} disabled={isToday} aria-label="Hari berikutnya" style={{ background: 'none', border: 'none', cursor: isToday ? 'not-allowed' : 'pointer', color: isToday ? 'var(--color-text-muted)' : 'var(--color-text-secondary)', padding: '6px 10px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', opacity: isToday ? 0.4 : 1 }}>
            <ChevronRight size={18} />
          </button>
        </div>
        <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{displayDate}</span>
        {!isToday && (
          <button onClick={() => setSelectedDate(today)} style={{ padding: '6px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
            Hari Ini
          </button>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={() => setShowModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: 'var(--color-primary)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem' }}
          >
            <UserX size={16} /> Input Manual
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {([
          { key: 'hadir', label: 'Hadir', val: summary.hadir, color: 'var(--color-success)' },
          { key: 'telat', label: 'Telat', val: summary.telat, color: 'hsl(38 90% 55%)' },
          { key: 'ijin',  label: 'Ijin',  val: summary.ijin,  color: 'hsl(210 80% 60%)' },
          { key: 'tidakHadir', label: 'Bolos', val: summary.tidakHadir, color: 'var(--color-danger)' },
          { key: 'pengganti',  label: 'Pengganti', val: summary.pengganti, color: 'hsl(280 70% 65%)' },
        ] as const).map(item => (
          <div key={item.key} style={{ background: 'var(--color-surface)', border: `1px solid ${item.color}33`, borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', textAlign: 'center', borderTop: `3px solid ${item.color}` }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.val}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px', fontWeight: 600 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 'var(--space-4)', maxWidth: '360px' }}>
        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} aria-hidden="true" />
        <input
          type="search" value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="Cari nama atau NIM..."
          style={{ width: '100%', padding: '10px 12px 10px 38px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem', boxSizing: 'border-box' }}
        />
      </div>

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-muted)' }} aria-live="polite" aria-busy="true">
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '8px' }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>Memuat data absensi...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <ClipboardList size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
            <p style={{ margin: 0, fontWeight: 600 }}>Belum ada data absensi</p>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>{searchQ ? 'Coba kata kunci lain' : 'Kasir belum login hari ini, atau belum ada jadwal yang disetup'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Karyawan', 'NIM / Prodi', 'Jadwal', 'Clock In', 'Keterlambatan', 'Status', 'Catatan'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--color-border-subtle, var(--color-border))' : 'none', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-elevated)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '13px 16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{r.employee.fullName}</td>
                    <td style={{ padding: '13px 16px', color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>
                      <div>{r.employee.nim}</div>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>{r.employee.programStudi}</div>
                    </td>
                    <td style={{ padding: '13px 16px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                      {r.schedule.dayOfWeek} {r.schedule.slotStart}–{r.schedule.slotEnd}
                    </td>
                    <td style={{ padding: '13px 16px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.82rem' }}>
                      {r.clockInActual ? new Date(r.clockInActual).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      {r.lateMinutes > 0 ? (
                        <span style={{ color: 'hsl(38 90% 55%)', fontWeight: 600, fontSize: '0.82rem' }}>+{r.lateMinutes} mnt</span>
                      ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ padding: '13px 16px', color: 'var(--color-text-muted)', fontSize: '0.8rem', maxWidth: '180px' }}>
                      {r.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ManualInputModal
          date={selectedDate}
          onClose={() => setShowModal(false)}
          onSuccess={fetchData}
        />
      )}
    </div>
  );
}
