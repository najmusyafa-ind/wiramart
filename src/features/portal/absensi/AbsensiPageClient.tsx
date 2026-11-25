'use client';

import { useState, useEffect, useCallback, useId, useMemo } from 'react';
import {
  ClipboardList,
  Search,
  CheckCircle2,
  Clock,
  UserCheck,
  UserX,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  Award,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  Plus,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Users,
} from 'lucide-react';
import BagiHasilTab from './BagiHasilTab';
import { useAdmin } from '@/features/portal/PortalLayoutClient';
import {
  EXCEL_BORDER,
  EXCEL_FILL,
  EXCEL_FMT,
  EXCEL_FONT,
  applySheetLayout,
  calcWrapRowHeight,
  colLetter,
  createWiramartWorkbook,
  downloadWorkbookBlob,
  formatWibDateTime,
  sanitizeExcelText,
  styleBannerBlock,
  toSafeExcelNum,
} from '@/lib/utils/exportSelectedExcel';

// ─── Types ────────────────────────────────────────────────────
type AttendanceStatus = 'HADIR' | 'TELAT' | 'IJIN' | 'TIDAK_HADIR' | 'PENGGANTI';

type AttendanceRecord = {
  id: string;
  attendanceDate: string;
  status: AttendanceStatus;
  lateMinutes: number;
  clockInActual: string | null;
  clockOutActual: string | null;
  roleTask?: string | null;
  verificationSource?: string | null;
  isSubstitute?: boolean;
  notes: string | null;
  employee: { id: string; fullName: string; nim: string; programStudi: string; jabatan: string };
  schedule: { dayOfWeek: string; slotStart: string; slotEnd: string; coordinatorName: string | null };
};

type EmployeeDisciplineSummary = {
  employeeId: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  totalShift: number;
  hadir: number;
  telat: number;
  totalLateMinutes: number;
  ijin: number;
  tidakHadir: number;
  pengganti: number;
  persenKehadiran: number;
  skorDisiplin: number;
  statusDisiplin: 'SANGAT_DISIPLIN' | 'DISIPLIN' | 'CUKUP' | 'PERLU_PERHATIAN';
};

type ApiSummary = {
  totalRecords: number;
  hadir: number;
  telat: number;
  totalLateMinutes: number;
  ijin: number;
  tidakHadir: number;
  pengganti: number;
  avgKehadiran: number;
  avgDisiplin: number;
};

type PeriodMode = 'daily' | 'month' | 'last_month' | 'range' | 'all';

type ScheduleFlat = {
  id: string;
  dayOfWeek: string;
  slotStart: string;
  slotEnd: string;
  employeeId: string;
  sesi: 'Pagi' | 'Siang';
};

const ROLE_TASK_OPTIONS = ['Kasir', 'Admin Shift', 'Gudang', 'CS Pelayan'] as const;

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string; icon: React.ReactNode }> = {
  HADIR:       { label: 'Hadir',       color: '#16a34a', icon: <CheckCircle2 size={13} /> },
  TELAT:       { label: 'Telat',       color: '#d97706', icon: <Clock size={13} /> },
  IJIN:        { label: 'Ijin',        color: '#2563eb', icon: <UserCheck size={13} /> },
  TIDAK_HADIR: { label: 'Tidak Hadir', color: '#dc2626', icon: <UserX size={13} /> },
  PENGGANTI:   { label: 'Pengganti',   color: '#7c3aed', icon: <CalendarDays size={13} /> },
};

const SOURCE_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  MANUAL_CROSSCHECK: { label: 'Buku Manual', bg: '#eff6ff', color: '#1d4ed8' },
  KIOSK:             { label: 'Kiosk',       bg: '#f0fdf4', color: '#15803d' },
  LOGIN_AUTO:        { label: 'Login POS',   bg: '#f8fafc', color: '#475569' },
  SWAP_APPROVED:     { label: 'Tukar Shift', bg: '#f5f3ff', color: '#6d28d9' },
};

const JS_DAY_TO_ENUM: Record<number, string> = {
  0: 'MINGGU',
  1: 'SENIN',
  2: 'SELASA',
  3: 'RABU',
  4: 'KAMIS',
  5: 'JUMAT',
  6: 'SABTU',
};

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.HADIR;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.74rem',
        fontWeight: 600,
        backgroundColor: `${cfg.color}15`,
        color: cfg.color,
        border: `1px solid ${cfg.color}35`,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function SourcePill({ source }: { source?: string | null }) {
  if (!source || !SOURCE_LABELS[source]) return null;
  const meta = SOURCE_LABELS[source];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '0.66rem',
        fontWeight: 600,
        backgroundColor: meta.bg,
        color: meta.color,
        border: '1px solid rgba(15, 23, 42, 0.08)',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

// ─── Modal Input & Crosscheck Buku Manual (Single + Massal 1 Tanggal) ────────
function ManualInputModal({
  onClose,
  onSuccess,
  defaultDate,
  today,
}: {
  onClose: () => void;
  onSuccess: () => void;
  defaultDate: string;
  today: string;
}) {
  const uid = useId();
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [attendanceDate, setAttendanceDate] = useState(defaultDate || today);
  const [employees, setEmployees] = useState<{ id: string; fullName: string; nim: string; jabatan?: string }[]>([]);
  const [allSchedules, setAllSchedules] = useState<ScheduleFlat[]>([]);

  // Single-mode form
  const [employeeId, setEmployeeId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('HADIR');
  const [lateMinutes, setLateMinutes] = useState('0');
  const [roleTask, setRoleTask] = useState<string>('Kasir');
  const [clockInTime, setClockInTime] = useState('');
  const [notes, setNotes] = useState('');

  // Bulk-mode form (Centang Massal 1 Tanggal untuk crosscheck buku)
  const [bulkSesi, setBulkSesi] = useState<'Pagi' | 'Siang'>('Siang');
  const [bulkStatus, setBulkStatus] = useState<'HADIR' | 'PENGGANTI'>('HADIR');
  const [bulkNote, setBulkNote] = useState('Crosscheck buku manual');
  const [bulkSearch, setBulkSearch] = useState('');
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hariTerpilih = useMemo(() => {
    const dt = new Date(`${attendanceDate}T12:00:00Z`);
    return JS_DAY_TO_ENUM[dt.getUTCDay()] ?? 'SENIN';
  }, [attendanceDate]);

  useEffect(() => {
    fetch('/api/admin/karyawan')
      .then((r) => r.json())
      .then((j) => {
        const list = (j.data ?? []) as { id: string; fullName: string; nim: string; jabatan?: string }[];
        setEmployees(list.sort((a, b) => a.fullName.localeCompare(b.fullName)));
      })
      .catch(() => {});

    fetch('/api/publik/jadwal-slot')
      .then((r) => r.json())
      .then((j) => {
        type RawEntry = { id: string; orderInSlot: number; employeeId: string | null };
        type RawSlot = { slotStart: string; slotEnd: string; entries: RawEntry[] };
        type RawDay = { dayOfWeek: string; slots: RawSlot[] };
        const schedule: RawDay[] = j.data?.schedule ?? [];
        const flat: ScheduleFlat[] = [];
        for (const day of schedule) {
          for (const slot of day.slots) {
            const hour = parseInt(slot.slotStart.split(':')[0] ?? '7', 10);
            const sesi: 'Pagi' | 'Siang' = hour >= 11 ? 'Siang' : 'Pagi';
            for (const entry of slot.entries) {
              if (entry.employeeId) {
                flat.push({
                  id: entry.id,
                  dayOfWeek: day.dayOfWeek,
                  slotStart: slot.slotStart,
                  slotEnd: slot.slotEnd,
                  employeeId: entry.employeeId,
                  sesi,
                });
              }
            }
          }
        }
        setAllSchedules(flat);
      })
      .catch(() => {});
  }, []);

  // Schedules for the chosen day (deduped by sesi when employee has no exact slot, e.g., Pengganti / Badal)
  const daySchedules = useMemo(
    () => allSchedules.filter((s) => s.dayOfWeek === hariTerpilih),
    [allSchedules, hariTerpilih],
  );

  const singleScheduleOptions = useMemo(() => {
    const exact = employeeId ? daySchedules.filter((s) => s.employeeId === employeeId) : [];
    if (exact.length > 0) return exact;
    // Fallback: tampilkan 1 slot Pagi & 1 slot Siang pada hari terpilih (untuk Pengganti/Badal atau jadwal berubah)
    const bySesi = new Map<string, ScheduleFlat>();
    for (const s of daySchedules) {
      if (!bySesi.has(s.sesi)) bySesi.set(s.sesi, s);
    }
    if (bySesi.size > 0) return Array.from(bySesi.values());
    // Jika hari Sabtu/Minggu tidak ada jadwal, tampilkan 1 slot Pagi & 1 slot Siang referensi
    const fallback = new Map<string, ScheduleFlat>();
    for (const s of allSchedules) {
      if (!fallback.has(s.sesi)) fallback.set(s.sesi, s);
    }
    return Array.from(fallback.values());
  }, [daySchedules, allSchedules, employeeId]);

  const scheduledForBulkSession = useMemo(() => {
    const ids = new Set<string>();
    for (const s of daySchedules) {
      if (s.sesi === bulkSesi) ids.add(s.employeeId);
    }
    return ids;
  }, [daySchedules, bulkSesi]);

  const sortedBulkEmployees = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    const filtered = q
      ? employees.filter((e) => e.fullName.toLowerCase().includes(q) || e.nim.includes(q))
      : employees;
    return [...filtered].sort((a, b) => {
      const aSched = scheduledForBulkSession.has(a.id) ? 0 : 1;
      const bSched = scheduledForBulkSession.has(b.id) ? 0 : 1;
      if (aSched !== bSched) return aSched - bSched;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [employees, bulkSearch, scheduledForBulkSession]);

  function toggleBulkEmp(id: string) {
    setSelectedEmpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectScheduledTeam() {
    setSelectedEmpIds(Array.from(scheduledForBulkSession));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'single') {
      const effectiveScheduleId = scheduleId || singleScheduleOptions[0]?.id || '';
      if (!employeeId || !effectiveScheduleId) {
        setError('Pilih nama mahasiswa dan slot shift terlebih dahulu.');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/admin/absensi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId,
            scheduleId: effectiveScheduleId,
            attendanceDate,
            status,
            lateMinutes: status === 'TELAT' ? Math.max(0, parseInt(lateMinutes || '0', 10) || 0) : 0,
            roleTask,
            clockInTime: clockInTime || undefined,
            notes: notes.trim() || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan presensi.');
          return;
        }
        onSuccess();
        onClose();
      } catch {
        setError('Kesalahan jaringan saat menyimpan presensi.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Bulk mode
    if (selectedEmpIds.length === 0) {
      setError('Centang minimal 1 nama mahasiswa.');
      return;
    }
    const fallbackSlot =
      daySchedules.find((s) => s.sesi === bulkSesi) ??
      allSchedules.find((s) => s.sesi === bulkSesi);
    if (!fallbackSlot) {
      setError('Slot jadwal sesi tidak ditemukan.');
      return;
    }

    const entries = selectedEmpIds.map((empId) => {
      const ownSlot = daySchedules.find((s) => s.employeeId === empId && s.sesi === bulkSesi);
      return {
        employeeId: empId,
        scheduleId: ownSlot?.id ?? fallbackSlot.id,
        attendanceDate,
        status: ownSlot ? bulkStatus : 'PENGGANTI',
        lateMinutes: 0,
        roleTask: 'Kasir',
        clockInTime: bulkSesi === 'Siang' ? '11:30' : '07:30',
        notes: bulkNote.trim() || 'Crosscheck buku manual',
      };
    });

    setLoading(true);
    try {
      const res = await fetch('/api/admin/absensi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan presensi massal.');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('Kesalahan jaringan saat menyimpan presensi massal.');
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
        padding: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid var(--color-border)',
          padding: '20px',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h2 id={`${uid}-title`} style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
              Input & Crosscheck Buku Absensi
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '2px 0 0' }}>
              Catat kehadiran susulan, pengganti, ijin, atau cocokkan buku manual.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              width: 32,
              height: 32,
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#475569',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Mode Switcher */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px',
            backgroundColor: '#f1f5f9',
            padding: '4px',
            borderRadius: '10px',
            marginBottom: '14px',
          }}
        >
          <button
            type="button"
            onClick={() => { setMode('single'); setError(''); }}
            style={{
              padding: '8px 10px',
              borderRadius: '7px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 700,
              backgroundColor: mode === 'single' ? '#ffffff' : 'transparent',
              color: mode === 'single' ? '#166534' : '#475569',
              boxShadow: mode === 'single' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            Input 1 Orang
          </button>
          <button
            type="button"
            onClick={() => { setMode('bulk'); setError(''); }}
            style={{
              padding: '8px 10px',
              borderRadius: '7px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 700,
              backgroundColor: mode === 'bulk' ? '#ffffff' : 'transparent',
              color: mode === 'bulk' ? '#166534' : '#475569',
              boxShadow: mode === 'bulk' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            Centang Massal 1 Tanggal
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#b91c1c',
              fontSize: '0.8rem',
              marginBottom: '12px',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Tanggal Shift */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                Tanggal Shift
              </label>
              <input
                type="date"
                value={attendanceDate}
                max={today}
                onChange={(e) => {
                  setAttendanceDate(e.target.value);
                  setScheduleId('');
                }}
                className="form-input"
                style={{ width: '100%', minHeight: 38, fontWeight: 600 }}
                required
              />
            </div>
            <div
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                fontSize: '0.78rem',
                fontWeight: 700,
                color: '#334155',
              }}
            >
              Hari {hariTerpilih}
            </div>
          </div>

          {mode === 'single' ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                  Nama Mahasiswa
                </label>
                <select
                  value={employeeId}
                  onChange={(e) => {
                    setEmployeeId(e.target.value);
                    setScheduleId('');
                  }}
                  className="form-input"
                  style={{ width: '100%', minHeight: 38 }}
                  required
                >
                  <option value="">-- Pilih Mahasiswa --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.nim})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                  Sesi Shift ({hariTerpilih})
                </label>
                <select
                  value={scheduleId || singleScheduleOptions[0]?.id || ''}
                  onChange={(e) => setScheduleId(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', minHeight: 38 }}
                  required
                >
                  {singleScheduleOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      Shift {s.sesi} ({s.slotStart} - {s.slotEnd} WIB)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
                  Status Kehadiran
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                  {(['HADIR', 'TELAT', 'PENGGANTI', 'IJIN', 'TIDAK_HADIR'] as const).map((st) => {
                    const active = status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatus(st)}
                        style={{
                          padding: '7px 8px',
                          borderRadius: '8px',
                          border: active ? '2px solid #166534' : '1px solid #cbd5e1',
                          backgroundColor: active ? '#f0fdf4' : '#ffffff',
                          color: active ? '#166534' : '#334155',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {STATUS_CONFIG[st].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(status === 'HADIR' || status === 'TELAT' || status === 'PENGGANTI') && (
                <div style={{ display: 'grid', gridTemplateColumns: status === 'TELAT' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                      Tugas Shift
                    </label>
                    <select
                      value={roleTask}
                      onChange={(e) => setRoleTask(e.target.value)}
                      className="form-input"
                      style={{ width: '100%', minHeight: 36, fontSize: '0.8rem' }}
                    >
                      {ROLE_TASK_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                      Jam Masuk (Opsional)
                    </label>
                    <input
                      type="time"
                      value={clockInTime}
                      onChange={(e) => setClockInTime(e.target.value)}
                      className="form-input"
                      style={{ width: '100%', minHeight: 36, fontSize: '0.8rem' }}
                    />
                  </div>
                  {status === 'TELAT' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: '4px', color: '#b45309' }}>
                        Telat (Menit)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={480}
                        value={lateMinutes}
                        onChange={(e) => setLateMinutes(e.target.value)}
                        className="form-input"
                        style={{ width: '100%', minHeight: 36, fontSize: '0.8rem', fontWeight: 700 }}
                        required
                      />
                    </div>
                  )}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                  Catatan
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Sesuai buku absensi 30 Sep / Pengganti shift"
                  className="form-input"
                  style={{ width: '100%', minHeight: 38 }}
                />
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                    Sesi Shift
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {(['Pagi', 'Siang'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setBulkSesi(s)}
                        style={{
                          padding: '8px',
                          borderRadius: '8px',
                          border: bulkSesi === s ? '2px solid #166534' : '1px solid #cbd5e1',
                          backgroundColor: bulkSesi === s ? '#f0fdf4' : '#ffffff',
                          color: bulkSesi === s ? '#166534' : '#334155',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {s} {s === 'Pagi' ? '(07:30)' : '(11:30)'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                    Status Default
                  </label>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as 'HADIR' | 'PENGGANTI')}
                    className="form-input"
                    style={{ width: '100%', minHeight: 38, fontSize: '0.8rem' }}
                  >
                    <option value="HADIR">Hadir Tepat</option>
                    <option value="PENGGANTI">Pengganti (Badal)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="search"
                  value={bulkSearch}
                  onChange={(e) => setBulkSearch(e.target.value)}
                  placeholder="Cari nama mahasiswa..."
                  className="form-input"
                  style={{ flex: 1, minWidth: 160, minHeight: 34, fontSize: '0.8rem' }}
                />
                {scheduledForBulkSession.size > 0 && (
                  <button
                    type="button"
                    onClick={selectScheduledTeam}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.74rem', padding: '6px 10px' }}
                  >
                    Pilih Tim Jadwal ({scheduledForBulkSession.size})
                  </button>
                )}
              </div>

              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  backgroundColor: '#f8fafc',
                }}
              >
                {sortedBulkEmployees.map((emp) => {
                  const checked = selectedEmpIds.includes(emp.id);
                  const isScheduled = scheduledForBulkSession.has(emp.id);
                  return (
                    <label
                      key={emp.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '7px 10px',
                        borderRadius: '8px',
                        backgroundColor: checked ? '#f0fdf4' : '#ffffff',
                        border: checked ? '1px solid #86efac' : '1px solid #e2e8f0',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBulkEmp(emp.id)}
                          style={{ width: 16, height: 16, accentColor: '#166534' }}
                        />
                        <span>{emp.fullName}</span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                          {emp.nim}
                        </span>
                      </span>
                      {isScheduled && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '99px',
                            backgroundColor: '#dcfce7',
                            color: '#166534',
                          }}
                        >
                          Tim Jadwal
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                  Catatan Crosscheck
                </label>
                <input
                  type="text"
                  value={bulkNote}
                  onChange={(e) => setBulkNote(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', minHeight: 36, fontSize: '0.8rem' }}
                />
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Batal
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <Loader2 size={14} className="spin-icon" />
              ) : mode === 'bulk' ? (
                `Simpan ${selectedEmpIds.length} Orang`
              ) : (
                'Simpan Presensi'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Koreksi Log Absensi (PATCH / DELETE) ──────────────────────────────
function EditAttendanceModal({
  record,
  onClose,
  onSuccess,
}: {
  record: AttendanceRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uid = useId();
  const [status, setStatus] = useState<AttendanceStatus>(record.status);
  const [lateMinutes, setLateMinutes] = useState(String(record.lateMinutes ?? 0));
  const [roleTask, setRoleTask] = useState(record.roleTask || 'Kasir');
  const [notes, setNotes] = useState(record.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/absensi/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          lateMinutes: status === 'TELAT' ? Math.max(0, parseInt(lateMinutes || '0', 10) || 0) : 0,
          roleTask,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : 'Gagal memperbarui catatan.');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('Kesalahan jaringan saat menyimpan koreksi.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Hapus log presensi ${record.employee.fullName} pada ${record.attendanceDate}?`)) {
      return;
    }
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/absensi/${record.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : 'Gagal menghapus catatan.');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('Kesalahan jaringan saat menghapus catatan.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-edit`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid var(--color-border)',
          padding: '20px',
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div>
            <h2 id={`${uid}-edit`} style={{ fontSize: '1.02rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
              Koreksi Data Presensi
            </h2>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '2px 0 0' }}>
              {record.employee.fullName} · {record.attendanceDate} ({record.schedule.slotStart}-{record.schedule.slotEnd})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              width: 30,
              height: 30,
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#475569',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.78rem', marginBottom: '10px', fontWeight: 600 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
              Status Kehadiran
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
              {(['HADIR', 'TELAT', 'PENGGANTI', 'IJIN', 'TIDAK_HADIR'] as const).map((st) => {
                const active = status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatus(st)}
                    style={{
                      padding: '7px 6px',
                      borderRadius: '8px',
                      border: active ? '2px solid #166534' : '1px solid #cbd5e1',
                      backgroundColor: active ? '#f0fdf4' : '#ffffff',
                      color: active ? '#166534' : '#334155',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {STATUS_CONFIG[st].label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: status === 'TELAT' ? '1fr 1fr' : '1fr', gap: '8px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
                Tugas Shift
              </label>
              <select
                value={roleTask}
                onChange={(e) => setRoleTask(e.target.value)}
                className="form-input"
                style={{ width: '100%', minHeight: 36, fontSize: '0.8rem' }}
              >
                {ROLE_TASK_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {status === 'TELAT' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, marginBottom: '4px', color: '#b45309' }}>
                  Menit Terlambat
                </label>
                <input
                  type="number"
                  min={0}
                  max={480}
                  value={lateMinutes}
                  onChange={(e) => setLateMinutes(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', minHeight: 36, fontSize: '0.8rem', fontWeight: 700 }}
                />
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, marginBottom: '4px', color: '#334155' }}>
              Catatan / Alasan Koreksi
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Koreksi jam shift siang 11:30 sesuai buku manual"
              className="form-input"
              style={{ width: '100%', minHeight: '64px', fontSize: '0.8rem' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving || deleting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid #fecaca',
                backgroundColor: '#fef2f2',
                color: '#dc2626',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {deleting ? <Loader2 size={13} className="spin-icon" /> : <Trash2 size={13} />}
              Hapus
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={saving || deleting}>
                Batal
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || deleting}>
                {saving ? <Loader2 size={14} className="spin-icon" /> : 'Simpan Koreksi'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

type AttendanceQueryParams = {
  periodMode: PeriodMode;
  selectedDate: string;
  selectedMonth: string;
  rangeStart: string;
  rangeEnd: string;
};

type AttendanceFetchResult =
  | {
      ok: true;
      records: AttendanceRecord[];
      summaryByEmployee: EmployeeDisciplineSummary[];
      summary: ApiSummary | null;
      availableMonths: string[];
      rangeLabel: string;
    }
  | {
      ok: false;
      error: string;
    };

function buildAttendanceUrl({
  periodMode,
  selectedDate,
  selectedMonth,
  rangeStart,
  rangeEnd,
}: AttendanceQueryParams): string {
  let url = '/api/admin/absensi?';
  if (periodMode === 'daily') {
    url += `date=${selectedDate}`;
  } else if (periodMode === 'month') {
    url += `period=month&month=${selectedMonth}`;
  } else if (periodMode === 'last_month') {
    url += 'period=last_month';
  } else if (periodMode === 'range') {
    url += `period=range&startDate=${rangeStart}&endDate=${rangeEnd}`;
  } else if (periodMode === 'all') {
    url += 'period=all_time';
  }
  return url;
}

async function requestAttendanceData(
  params: AttendanceQueryParams,
  signal?: AbortSignal,
): Promise<AttendanceFetchResult> {
  const res = await fetch(buildAttendanceUrl(params), { signal });
  const json = await res.json();
  if (!res.ok || !json.success) {
    return {
      ok: false,
      error:
        typeof json?.error === 'string'
          ? json.error
          : `Gagal memuat data absensi (HTTP ${res.status}).`,
    };
  }

  const rawRecords: AttendanceRecord[] = Array.isArray(json.data)
    ? json.data
    : (json.data?.records ?? []);
  return {
    ok: true,
    records: rawRecords,
    summaryByEmployee: json.data?.summaryByEmployee ?? [],
    summary: json.data?.summary ?? null,
    availableMonths: json.data?.availableMonths ?? [],
    rangeLabel: json.data?.range?.label ?? '',
  };
}

// ─── Main Absensi Page Component ──────────────────────────────
export default function AbsensiPage() {
  const { isManager } = useAdmin();
  // Navigation tab: 'absensi' (Admin Shift & Manager) vs 'bagi_hasil' (eksklusif Manager)
  const [activeTab, setActiveTab] = useState<'absensi' | 'bagi_hasil'>('absensi');

  // Sub-view in Absensi: 'summary' (Rekap Disiplin) vs 'logs' (Log Presensi)
  const [subView, setSubView] = useState<'summary' | 'logs'>('summary');

  const today = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
    [],
  );

  // Filter Mode State
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [rangeStart, setRangeStart] = useState('2026-09-01');
  const [rangeEnd, setRangeEnd] = useState(today);
  const [searchQ, setSearchQ] = useState('');

  // Data States
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summaryByEmployee, setSummaryByEmployee] = useState<EmployeeDisciplineSummary[]>([]);
  const [apiSummary, setApiSummary] = useState<ApiSummary | null>(null);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [rangeLabel, setRangeLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);

  const applyAttendanceResult = useCallback((result: AttendanceFetchResult) => {
    if (!result.ok) {
      setRecords([]);
      setSummaryByEmployee([]);
      setApiSummary(null);
      setLoadError(result.error);
      return;
    }

    setRecords(result.records);
    setSummaryByEmployee(result.summaryByEmployee);
    setApiSummary(result.summary);
    if (result.availableMonths.length > 0) setAvailableMonths(result.availableMonths);
    setRangeLabel(result.rangeLabel);
  }, []);

  const startFilterTransition = (applyFilter: () => void) => {
    setLoading(true);
    setLoadError(null);
    applyFilter();
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await requestAttendanceData({
        periodMode,
        selectedDate,
        selectedMonth,
        rangeStart,
        rangeEnd,
      });
      applyAttendanceResult(result);
    } catch {
      setLoadError('Koneksi ke server gagal saat memuat data absensi.');
    } finally {
      setLoading(false);
    }
  }, [periodMode, selectedDate, selectedMonth, rangeStart, rangeEnd, applyAttendanceResult]);

  useEffect(() => {
    const controller = new AbortController();

    requestAttendanceData(
      { periodMode, selectedDate, selectedMonth, rangeStart, rangeEnd },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          applyAttendanceResult(result);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setLoadError('Koneksi ke server gagal saat memuat data absensi.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [periodMode, selectedDate, selectedMonth, rangeStart, rangeEnd, applyAttendanceResult]);

  const shiftDate = (days: number) => {
    const d = new Date(`${selectedDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    startFilterTransition(() => {
      setSelectedDate(d.toISOString().slice(0, 10));
    });
  };

  const filteredRecords = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.nim.includes(q) ||
        r.attendanceDate.includes(q) ||
        (r.employee.programStudi && r.employee.programStudi.toLowerCase().includes(q)),
    );
  }, [records, searchQ]);

  const filteredSummary = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return summaryByEmployee;
    return summaryByEmployee.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.nim.includes(q) ||
        (e.programStudi && e.programStudi.toLowerCase().includes(q)),
    );
  }, [summaryByEmployee, searchQ]);

  const summary = useMemo(() => {
    if (apiSummary) {
      return {
        hadir: apiSummary.hadir,
        telat: apiSummary.telat,
        totalLateMinutes: apiSummary.totalLateMinutes,
        ijin: apiSummary.ijin,
        tidakHadir: apiSummary.tidakHadir,
        pengganti: apiSummary.pengganti,
        avgDisiplin: apiSummary.avgDisiplin,
      };
    }
    return {
      hadir: records.filter((r) => r.status === 'HADIR').length,
      telat: records.filter((r) => r.status === 'TELAT').length,
      totalLateMinutes: records.reduce((s, r) => s + (r.lateMinutes > 0 ? r.lateMinutes : 0), 0),
      ijin: records.filter((r) => r.status === 'IJIN').length,
      tidakHadir: records.filter((r) => r.status === 'TIDAK_HADIR').length,
      pengganti: records.filter((r) => r.status === 'PENGGANTI').length,
      avgDisiplin: 100,
    };
  }, [apiSummary, records]);

  async function handleExportExcel() {
    if (records.length === 0 && summaryByEmployee.length === 0) {
      alert('Tidak ada data absensi untuk diekspor.');
      return;
    }
    setExportLoading(true);
    try {
      const wb = await createWiramartWorkbook('Portal - Rekap Absensi & Kedisiplinan');
      const periodText = rangeLabel || today;
      const printedWib = formatWibDateTime();

      const ws1 = wb.addWorksheet('Rekap Disiplin');
      const cols1 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Nama Lengkap', width: 26, align: 'left' as const },
        { header: 'NIM', width: 14, align: 'center' as const },
        { header: 'Program Studi', width: 22, align: 'left' as const },
        { header: 'Total Shift', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Hadir Tepat', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Terlambat (Kali)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Total Telat (Mnt)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Izin / Alpa', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Kehadiran (%)', width: 14, align: 'right' as const, fmt: EXCEL_FMT.PCT },
        { header: 'Skor Disiplin (%)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.PCT },
      ];
      cols1.forEach((c, i) => {
        ws1.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws1, {
        title: 'REKAPITULASI ABSENSI & DISIPLIN — WIRAMART UNPERBA',
        subtitle: `Periode: ${periodText} · ${summaryByEmployee.length} Personel · Dicetak: ${printedWib} WIB`,
        endCol: cols1.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws1.getRow(3).height = 8;

      const h1 = ws1.getRow(4);
      h1.height = 26;
      cols1.forEach((c, i) => {
        const cell = h1.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      let sumShift = 0;
      let sumHadir = 0;
      let sumTelat = 0;
      let sumLateMins = 0;
      let sumAlpa = 0;
      let sumPctHadir = 0;
      let sumSkor = 0;

      summaryByEmployee.forEach((e, idx) => {
        const row = ws1.getRow(5 + idx);
        const shiftN = Math.round(toSafeExcelNum(e.totalShift));
        const hadirN = Math.round(toSafeExcelNum(e.hadir));
        const telatN = Math.round(toSafeExcelNum(e.telat));
        const lateMinsN = Math.round(toSafeExcelNum(e.totalLateMinutes));
        const alpaN = Math.round(toSafeExcelNum(e.ijin + e.tidakHadir));
        const pctHadirN = toSafeExcelNum(e.persenKehadiran);
        const skorN = toSafeExcelNum(e.skorDisiplin);

        sumShift += shiftN;
        sumHadir += hadirN;
        sumTelat += telatN;
        sumLateMins += lateMinsN;
        sumAlpa += alpaN;
        sumPctHadir += pctHadirN;
        sumSkor += skorN;

        const nameTxt = sanitizeExcelText(e.fullName) || '—';
        const nimTxt = sanitizeExcelText(e.nim) || '—';
        const prodiTxt = sanitizeExcelText(e.programStudi) || '—';

        const rowValues: (string | number)[] = [
          idx + 1, nameTxt, nimTxt, prodiTxt, shiftN, hadirN, telatN, lateMinsN, alpaN, pctHadirN, skorN,
        ];
        rowValues.forEach((val, cIdx) => {
          const cell = row.getCell(cIdx + 1);
          const meta = cols1[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = { vertical: 'middle', horizontal: meta.align, wrapText: cIdx === 1 || cIdx === 3 };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        row.height = calcWrapRowHeight(
          [{ text: nameTxt, width: cols1[1].width }, { text: prodiTxt, width: cols1[3].width }],
          21,
          14,
        );
      });

      if (summaryByEmployee.length > 0) {
        const end1 = 5 + summaryByEmployee.length - 1;
        const tot1 = ws1.getRow(end1 + 1);
        tot1.height = 24;
        const avgHadir = Number((sumPctHadir / summaryByEmployee.length).toFixed(1));
        const avgSkor = Number((sumSkor / summaryByEmployee.length).toFixed(1));
        const sumMap1: Record<number, number> = { 4: sumShift, 5: sumHadir, 6: sumTelat, 7: sumLateMins, 8: sumAlpa };
        cols1.forEach((c, cIdx) => {
          const cell = tot1.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 1) cell.value = `TOTAL / RATA-RATA (${summaryByEmployee.length} Personel)`;
          else if (cIdx in sumMap1) cell.value = { formula: `SUM(${colChar}5:${colChar}${end1})`, result: sumMap1[cIdx] };
          else if (cIdx === 9) cell.value = { formula: `AVERAGE(${colChar}5:${colChar}${end1})`, result: avgHadir };
          else if (cIdx === 10) cell.value = { formula: `AVERAGE(${colChar}5:${colChar}${end1})`, result: avgSkor };
          else cell.value = '';
          cell.font = EXCEL_FONT.BOLD;
          cell.fill = EXCEL_FILL.TOTAL;
          cell.border = EXCEL_BORDER.TOTAL;
          cell.alignment = { vertical: 'middle', horizontal: c.align };
          if (c.fmt) cell.numFmt = c.fmt;
        });
      }

      applySheetLayout(ws1, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: cols1.length } },
        orientation: 'landscape',
      });

      const ws2 = wb.addWorksheet('Log Presensi');
      const cols2 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Tanggal', width: 13, align: 'center' as const },
        { header: 'Nama Lengkap', width: 26, align: 'left' as const },
        { header: 'NIM', width: 14, align: 'center' as const },
        { header: 'Jadwal Shift', width: 20, align: 'left' as const },
        { header: 'Jam Masuk (WIB)', width: 15, align: 'center' as const },
        { header: 'Telat (Mnt)', width: 13, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Status', width: 14, align: 'center' as const },
        { header: 'Catatan', width: 34, align: 'left' as const },
      ];
      cols2.forEach((c, i) => {
        ws2.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws2, {
        title: 'LOG PRESENSI SHIFT — WIRAMART UNPERBA',
        subtitle: `Periode: ${periodText} · ${records.length} Catatan · Dicetak: ${printedWib} WIB`,
        endCol: cols2.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws2.getRow(3).height = 8;

      const h2 = ws2.getRow(4);
      h2.height = 26;
      cols2.forEach((c, i) => {
        const cell = h2.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      let sumRecordLate = 0;
      records.forEach((r, idx) => {
        const row = ws2.getRow(5 + idx);
        const lateN = Math.max(0, Math.round(toSafeExcelNum(r.lateMinutes)));
        sumRecordLate += lateN;
        const clockInStr = r.clockInActual
          ? new Date(r.clockInActual).toLocaleTimeString('id-ID', {
              timeZone: 'Asia/Jakarta',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          : '—';
        const nameTxt = sanitizeExcelText(r.employee.fullName) || '—';
        const shiftTxt = sanitizeExcelText(`${r.schedule.dayOfWeek} ${r.schedule.slotStart}-${r.schedule.slotEnd}`) || '—';
        const noteTxt = sanitizeExcelText(r.notes) || '—';

        const rowValues: (string | number)[] = [
          idx + 1,
          sanitizeExcelText(r.attendanceDate) || '—',
          nameTxt,
          sanitizeExcelText(r.employee.nim) || '—',
          shiftTxt,
          clockInStr,
          lateN,
          sanitizeExcelText(r.status) || '—',
          noteTxt,
        ];
        rowValues.forEach((val, cIdx) => {
          const cell = row.getCell(cIdx + 1);
          const meta = cols2[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = { vertical: 'middle', horizontal: meta.align, wrapText: cIdx === 2 || cIdx === 4 || cIdx === 8 };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        row.height = calcWrapRowHeight(
          [{ text: nameTxt, width: cols2[2].width }, { text: noteTxt, width: cols2[8].width }],
          21,
          14,
        );
      });

      if (records.length > 0) {
        const end2 = 5 + records.length - 1;
        const tot2 = ws2.getRow(end2 + 1);
        tot2.height = 24;
        cols2.forEach((c, cIdx) => {
          const cell = tot2.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 2) cell.value = `TOTAL (${records.length} Catatan)`;
          else if (cIdx === 6) cell.value = { formula: `SUM(${colChar}5:${colChar}${end2})`, result: sumRecordLate };
          else cell.value = '';
          cell.font = EXCEL_FONT.BOLD;
          cell.fill = EXCEL_FILL.TOTAL;
          cell.border = EXCEL_BORDER.TOTAL;
          cell.alignment = { vertical: 'middle', horizontal: c.align };
          if (c.fmt) cell.numFmt = c.fmt;
        });
      }

      applySheetLayout(ws2, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: cols2.length } },
        orientation: 'landscape',
      });

      await downloadWorkbookBlob(wb, `Rekap_Absensi_Wiramart_${today}.xlsx`);
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor data absensi ke Excel.');
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <div className="page-container">
      <style>{`
        .abs-desktop { display: block; }
        .abs-mobile { display: none; }
        @media (max-width: 768px) {
          .abs-desktop { display: none; }
          .abs-mobile { display: flex; flex-direction: column; gap: 10px; }
        }
      `}</style>

      {/* ── Page Header ────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: '14px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '1.35rem', fontWeight: 800 }}>
            {activeTab === 'absensi' ? 'Absensi Karyawan' : 'Bagi Hasil 50:50'}
          </h1>
          <p className="page-subtitle" style={{ fontSize: '0.82rem' }}>
            {activeTab === 'absensi'
              ? 'Rekap kehadiran, keterlambatan, dan crosscheck buku manual.'
              : 'Pembagian laba 50% per kelompok shift berdasarkan kehadiran dan laba.'}
          </p>
        </div>
        {activeTab === 'absensi' && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, minHeight: 40 }}
          >
            <Plus size={15} aria-hidden="true" /> Input & Crosscheck Buku
          </button>
        )}
      </div>

      {/* ── Main Tab Switcher (Terbuka untuk Manager & Admin Shift) ── */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '14px',
          borderBottom: '2px solid var(--color-border)',
          paddingBottom: '8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('absensi')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.84rem',
            backgroundColor: activeTab === 'absensi' ? '#166534' : 'transparent',
            color: activeTab === 'absensi' ? '#ffffff' : 'var(--color-text-secondary)',
            transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <ClipboardList size={15} />
          <span>Absensi & Disiplin</span>
        </button>

        {isManager && (
          <button
            type="button"
            onClick={() => setActiveTab('bagi_hasil')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.84rem',
              backgroundColor: activeTab === 'bagi_hasil' ? '#166534' : 'transparent',
              color: activeTab === 'bagi_hasil' ? '#ffffff' : 'var(--color-text-secondary)',
              transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <Award size={15} />
            <span>Bagi Hasil 50:50</span>
          </button>
        )}
      </div>

      {isManager && activeTab === 'bagi_hasil' ? (
        <BagiHasilTab />
      ) : (
        <>
          {/* ── Formula Ringkas Banner ─────────────────────────────── */}
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldCheck size={20} color="#166534" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '0.8rem', color: '#166534', lineHeight: 1.45 }}>
                <strong>Rumus Bagi Hasil 50:50 (Per Shift):</strong> 50% Kehadiran Tim · 50% Laba Shift · Pembagian utuh per kelompok shift (tidak dipecah per nama) · Shift Pagi 07:30 (batas 08:00), Siang 11:30 (batas 12:00) · Toleransi 30 menit; lewat batas -3% per blok 5 menit, maks 50%.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('bagi_hasil')}
              className="btn btn-sm btn-secondary"
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#166534',
                borderColor: '#bbf7d0',
                backgroundColor: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              Buka Bagi Hasil <ArrowRight size={13} />
            </button>
          </div>

          {/* ── Filter Toolbar ─────────────────────────────────────── */}
          <div
            className="card"
            style={{
              padding: '12px 14px',
              marginBottom: '14px',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              backgroundColor: '#ffffff',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {(
                  [
                    { mode: 'month', label: 'Per Bulan' },
                    { mode: 'last_month', label: 'Bulan Lalu' },
                    { mode: 'daily', label: 'Per Tanggal' },
                    { mode: 'range', label: 'Rentang Tanggal' },
                    { mode: 'all', label: 'Semua Waktu' },
                  ] as const
                ).map(({ mode, label }) => {
                  const active = periodMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        if (mode !== periodMode) startFilterTransition(() => setPeriodMode(mode));
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '99px',
                        border: active ? '1.5px solid #166534' : '1px solid var(--color-border)',
                        backgroundColor: active ? '#166534' : '#f8fafc',
                        color: active ? '#ffffff' : 'var(--color-text-secondary)',
                        fontSize: '0.76rem',
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                disabled={exportLoading || records.length === 0}
                className="btn btn-secondary btn-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                  fontSize: '0.76rem',
                }}
              >
                {exportLoading ? <Loader2 size={13} className="spin-icon" /> : <Download size={13} />}
                Export Excel
              </button>
            </div>

            <div
              style={{
                marginTop: '10px',
                paddingTop: '10px',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              {periodMode === 'daily' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => shiftDate(-1)}
                    className="btn btn-secondary btn-sm"
                    style={{ minWidth: 32, padding: '4px 6px' }}
                    title="Hari Sebelumnya"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    max={today}
                    onChange={(e) => startFilterTransition(() => setSelectedDate(e.target.value))}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 32, width: '138px', fontWeight: 600 }}
                  />
                  <button
                    type="button"
                    onClick={() => shiftDate(1)}
                    disabled={selectedDate >= today}
                    className="btn btn-secondary btn-sm"
                    style={{ minWidth: 32, padding: '4px 6px' }}
                    title="Hari Berikutnya"
                  >
                    <ChevronRight size={14} />
                  </button>
                  {selectedDate !== today && (
                    <button
                      type="button"
                      onClick={() => startFilterTransition(() => setSelectedDate(today))}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                    >
                      Hari Ini
                    </button>
                  )}
                </div>
              )}

              {periodMode === 'month' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <input
                    type="month"
                    value={selectedMonth}
                    max={today.slice(0, 7)}
                    onChange={(e) => startFilterTransition(() => setSelectedMonth(e.target.value))}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 32, width: '138px', fontWeight: 600 }}
                  />
                  {availableMonths.map((m) => {
                    const [y, mm] = m.split('-');
                    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(
                      new Date(parseInt(y, 10), parseInt(mm, 10) - 1, 1),
                    );
                    const isSel = selectedMonth === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          if (m !== selectedMonth) startFilterTransition(() => setSelectedMonth(m));
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '99px',
                          border: isSel ? '1.5px solid #166534' : '1px solid var(--color-border)',
                          backgroundColor: isSel ? '#16653415' : 'transparent',
                          color: isSel ? '#166534' : 'var(--color-text-secondary)',
                          fontSize: '0.75rem',
                          fontWeight: isSel ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {monthName} {y}
                      </button>
                    );
                  })}
                </div>
              )}

              {periodMode === 'last_month' && (
                <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 700, backgroundColor: '#f0fdf4', padding: '4px 10px', borderRadius: '6px' }}>
                  Periode: {rangeLabel}
                </span>
              )}

              {periodMode === 'range' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={rangeStart}
                    max={rangeEnd || today}
                    onChange={(e) => startFilterTransition(() => setRangeStart(e.target.value))}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 32, width: '132px', fontWeight: 600 }}
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>s/d</span>
                  <input
                    type="date"
                    value={rangeEnd}
                    min={rangeStart}
                    max={today}
                    onChange={(e) => startFilterTransition(() => setRangeEnd(e.target.value))}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 32, width: '132px', fontWeight: 600 }}
                  />
                </div>
              )}

              {periodMode === 'all' && (
                <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 700, backgroundColor: '#f0fdf4', padding: '4px 10px', borderRadius: '6px' }}>
                  Semua riwayat presensi
                </span>
              )}
            </div>
          </div>

          {/* ── KPI Summary Cards ─────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
              gap: '8px',
              marginBottom: '14px',
            }}
          >
            {[
              { label: 'Hadir Tepat', val: summary.hadir, color: '#16a34a', sub: 'Tanpa potongan' },
              { label: 'Terlambat', val: summary.telat, color: '#d97706', sub: `${summary.totalLateMinutes} mnt total` },
              { label: 'Ijin / Sakit', val: summary.ijin, color: '#2563eb', sub: 'Tercatat' },
              { label: 'Tidak Hadir', val: summary.tidakHadir, color: '#dc2626', sub: 'Alpa' },
              { label: 'Pengganti', val: summary.pengganti, color: '#7c3aed', sub: 'Badal / Tukar' },
              { label: 'Rata Disiplin', val: `${summary.avgDisiplin}%`, color: '#4338ca', sub: 'Skor tim' },
            ].map((c) => (
              <div
                key={c.label}
                className="card"
                style={{
                  padding: '10px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px',
                  backgroundColor: '#ffffff',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: c.color, lineHeight: 1.1 }}>
                  {c.val}
                </div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                  {c.label}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  {c.sub}
                </div>
              </div>
            ))}
          </div>

          {/* ── Sub-View Selector & Search Bar ─────────────────────── */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                backgroundColor: '#f1f5f9',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid var(--color-border)',
              }}
            >
              <button
                type="button"
                onClick={() => setSubView('summary')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: subView === 'summary' ? 700 : 500,
                  backgroundColor: subView === 'summary' ? '#ffffff' : 'transparent',
                  color: subView === 'summary' ? '#166534' : 'var(--color-text-secondary)',
                  boxShadow: subView === 'summary' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <Users size={13} />
                <span>Rekap Per Orang ({summaryByEmployee.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSubView('logs')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: subView === 'logs' ? 700 : 500,
                  backgroundColor: subView === 'logs' ? '#ffffff' : 'transparent',
                  color: subView === 'logs' ? '#166534' : 'var(--color-text-secondary)',
                  boxShadow: subView === 'logs' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <ClipboardList size={13} />
                <span>Log Harian & Koreksi ({records.length})</span>
              </button>
            </div>

            <div className="form-input-icon" style={{ maxWidth: '300px', flex: '1 1 200px' }}>
              <Search size={15} className="form-input-icon__icon" aria-hidden="true" />
              <input
                className="form-input form-input-icon__input"
                type="search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Cari nama, NIM, atau tanggal..."
                style={{ minHeight: 36, fontSize: '0.82rem' }}
              />
            </div>
          </div>

          {loadError && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                marginBottom: '14px',
                borderRadius: '10px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={16} />
              <span>{loadError}</span>
            </div>
          )}

          {/* ── Data Area ────────────────────────────────────────── */}
          {loading ? (
            <div className="card" style={{ padding: '36px 16px', textAlign: 'center' }}>
              <Loader2 size={24} className="spin-icon" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--color-text-secondary)' }}>
                Memuat data absensi...
              </p>
            </div>
          ) : subView === 'summary' ? (
            filteredSummary.length === 0 ? (
              <div className="card" style={{ padding: '36px 16px', textAlign: 'center' }}>
                <ClipboardList size={30} style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <p style={{ fontWeight: 600, margin: 0 }}>Belum ada data absensi pada periode ini.</p>
              </div>
            ) : (
              <>
                <div
                  className="table-wrapper abs-desktop"
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: '10px',
                    overflowX: 'auto',
                  }}
                >
                  <table className="table" style={{ fontSize: '0.8rem', width: '100%' }}>
                    <thead style={{ backgroundColor: '#f8fafc' }}>
                      <tr>
                        <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                        <th>Nama</th>
                        <th>NIM / Prodi</th>
                        <th style={{ textAlign: 'center' }}>Shift</th>
                        <th style={{ textAlign: 'center' }}>Tepat</th>
                        <th style={{ textAlign: 'center' }}>Telat</th>
                        <th style={{ textAlign: 'center' }}>Ijin / Alpa</th>
                        <th style={{ textAlign: 'center' }}>Hadir</th>
                        <th style={{ textAlign: 'center' }}>Disiplin</th>
                        <th style={{ textAlign: 'center' }}>Bagi Hasil</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSummary.map((e, idx) => {
                        const isHigh = e.skorDisiplin >= 95;
                        const isMed = e.skorDisiplin >= 80 && e.skorDisiplin < 95;
                        return (
                          <tr key={e.employeeId}>
                            <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                            <td>
                              <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>{e.fullName}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{e.jabatan}</div>
                            </td>
                            <td>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{e.nim}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{e.programStudi}</div>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{e.totalShift}x</td>
                            <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 700 }}>{e.hadir + e.pengganti}</td>
                            <td style={{ textAlign: 'center' }}>
                              {e.telat > 0 ? (
                                <span style={{ color: '#d97706', fontWeight: 700 }}>
                                  {e.telat}x <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>({e.totalLateMinutes} mnt)</span>
                                </span>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)' }}>0</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {e.ijin + e.tidakHadir > 0 ? (
                                <span style={{ color: e.tidakHadir > 0 ? '#dc2626' : '#2563eb', fontWeight: 600 }}>
                                  {e.ijin + e.tidakHadir}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)' }}>0</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{e.persenKehadiran}%</td>
                            <td style={{ textAlign: 'center' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '2px 8px',
                                  borderRadius: '99px',
                                  fontSize: '0.74rem',
                                  fontWeight: 800,
                                  backgroundColor: isHigh ? '#dcfce7' : isMed ? '#e0f2fe' : '#fef3c7',
                                  color: isHigh ? '#166534' : isMed ? '#0369a1' : '#b45309',
                                }}
                              >
                                <TrendingUp size={11} /> {e.skorDisiplin}%
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => setActiveTab('bagi_hasil')}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #166534',
                                  backgroundColor: '#f0fdf4',
                                  color: '#166534',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                <span>Gaji</span>
                                <ArrowRight size={11} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards: Rekap Per Orang */}
                <div className="abs-mobile">
                  {filteredSummary.map((e) => (
                    <div
                      key={e.employeeId}
                      className="card"
                      style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--color-border)', backgroundColor: '#ffffff' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a' }}>{e.fullName}</div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {e.nim} · {e.programStudi}
                          </div>
                        </div>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '99px',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            backgroundColor: e.skorDisiplin >= 95 ? '#dcfce7' : '#fef3c7',
                            color: e.skorDisiplin >= 95 ? '#166534' : '#b45309',
                          }}
                        >
                          {e.skorDisiplin}%
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #f1f5f9', textAlign: 'center', fontSize: '0.72rem' }}>
                        <div>
                          <div style={{ color: '#64748b' }}>Shift</div>
                          <div style={{ fontWeight: 800 }}>{e.totalShift}x</div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b' }}>Tepat</div>
                          <div style={{ fontWeight: 800, color: '#16a34a' }}>{e.hadir + e.pengganti}</div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b' }}>Telat</div>
                          <div style={{ fontWeight: 800, color: e.telat > 0 ? '#d97706' : '#64748b' }}>{e.telat}x</div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b' }}>Ijin/Alpa</div>
                          <div style={{ fontWeight: 800, color: e.tidakHadir > 0 ? '#dc2626' : '#64748b' }}>{e.ijin + e.tidakHadir}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : filteredRecords.length === 0 ? (
            <div className="card" style={{ padding: '36px 16px', textAlign: 'center' }}>
              <ClipboardList size={30} style={{ margin: '0 auto 8px', opacity: 0.35 }} />
              <p style={{ fontWeight: 600, margin: 0 }}>Tidak ada log presensi yang cocok.</p>
            </div>
          ) : (
            <>
              <div
                className="table-wrapper abs-desktop"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px',
                  overflowX: 'auto',
                }}
              >
                <table className="table" style={{ fontSize: '0.8rem', width: '100%' }}>
                  <thead style={{ backgroundColor: '#f8fafc' }}>
                    <tr>
                      <th>Tanggal</th>
                      <th>Nama</th>
                      <th>Jadwal Shift</th>
                      <th>Jam Masuk</th>
                      <th>Telat</th>
                      <th>Status</th>
                      <th>Sumber & Catatan</th>
                      <th style={{ textAlign: 'center', width: '90px' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <div>{r.attendanceDate}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{r.schedule.dayOfWeek}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>{r.employee.fullName}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {r.employee.nim}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.76rem' }}>
                          {r.schedule.slotStart} - {r.schedule.slotEnd}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>
                          {r.clockInActual
                            ? new Date(r.clockInActual).toLocaleTimeString('id-ID', {
                                timeZone: 'Asia/Jakarta',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            : '—'}
                        </td>
                        <td>
                          {r.lateMinutes > 0 ? (
                            <span style={{ color: '#d97706', fontWeight: 700, fontSize: '0.76rem' }}>
                              +{r.lateMinutes} mnt
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem', maxWidth: '240px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: r.notes ? '3px' : 0 }}>
                            <SourcePill source={r.verificationSource} />
                            {r.roleTask && (
                              <span style={{ fontSize: '0.68rem', color: '#334155', fontWeight: 600 }}>
                                {r.roleTask}
                              </span>
                            )}
                          </div>
                          {r.notes && <div>{r.notes}</div>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => setEditingRecord(r)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 9px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              color: '#0f172a',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            <Pencil size={12} /> Koreksi
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards: Log Harian & Koreksi */}
              <div className="abs-mobile">
                {filteredRecords.map((r) => (
                  <div
                    key={r.id}
                    className="card"
                    style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--color-border)', backgroundColor: '#ffffff' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#0f172a' }}>{r.employee.fullName}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          {r.attendanceDate} · {r.schedule.slotStart}-{r.schedule.slotEnd}
                        </div>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                        Masuk:{' '}
                        <strong>
                          {r.clockInActual
                            ? new Date(r.clockInActual).toLocaleTimeString('id-ID', {
                                timeZone: 'Asia/Jakarta',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            : '—'}
                        </strong>
                        {r.lateMinutes > 0 && (
                          <span style={{ color: '#d97706', fontWeight: 700 }}> (+{r.lateMinutes} mnt)</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingRecord(r)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          color: '#0f172a',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <Pencil size={12} /> Koreksi
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {showModal && (
            <ManualInputModal
              defaultDate={selectedDate}
              today={today}
              onClose={() => setShowModal(false)}
              onSuccess={fetchData}
            />
          )}

          {editingRecord && (
            <EditAttendanceModal
              record={editingRecord}
              onClose={() => setEditingRecord(null)}
              onSuccess={fetchData}
            />
          )}
        </>
      )}
    </div>
  );
}
