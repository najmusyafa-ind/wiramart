'use client';

import { useState, useEffect, useCallback, useId, useMemo } from 'react';
import {
  ClipboardList, Search, CheckCircle2, Clock,
  UserCheck, UserX, CalendarDays, ChevronLeft, ChevronRight, Loader2,
  Download, Award, ArrowRight, ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import BagiHasilTab from './BagiHasilTab';
import { useAdmin } from '../AdminLayoutClient';

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

// ─── Status Badge ─────────────────────────────────────────────
const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string; icon: React.ReactNode }> = {
  HADIR:       { label: 'Hadir',       color: '#16a34a', icon: <CheckCircle2 size={13} /> },
  TELAT:       { label: 'Telat',       color: '#d97706', icon: <Clock size={13} /> },
  IJIN:        { label: 'Ijin',        color: '#2563eb', icon: <UserCheck size={13} /> },
  TIDAK_HADIR: { label: 'Tidak Hadir', color: '#dc2626', icon: <UserX size={13} /> },
  PENGGANTI:   { label: 'Pengganti',   color: '#7c3aed', icon: <CalendarDays size={13} /> },
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
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: `${cfg.color}15`,
        color: cfg.color,
        border: `1px solid ${cfg.color}35`,
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Modal Input Manual ───────────────────────────────────────
const JS_DAY_TO_ENUM: Record<number, string> = {
  0: 'MINGGU', 1: 'SENIN', 2: 'SELASA', 3: 'RABU',
  4: 'KAMIS',  5: 'JUMAT', 6: 'SABTU',
};

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
  const [allSchedules, setAllSchedules] = useState<{ id: string; dayOfWeek: string; slotStart: string; slotEnd: string; employeeId: string }[]>([]);
  const [form, setForm] = useState({ employeeId: '', scheduleId: '', status: 'IJIN' as 'IJIN' | 'TIDAK_HADIR', notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hariTerpilih = JS_DAY_TO_ENUM[new Date(date + 'T00:00:00').getDay()] ?? '';

  const schedules = allSchedules.filter((s) => {
    if (s.dayOfWeek !== hariTerpilih) return false;
    if (form.employeeId && s.employeeId !== form.employeeId) return false;
    return true;
  });

  useEffect(() => {
    fetch('/api/admin/karyawan').then((r) => r.json()).then((j) => setEmployees(j.data ?? []));
    fetch('/api/publik/jadwal-slot')
      .then((r) => r.json())
      .then((j) => {
        type RawEntry = { id: string; orderInSlot: number; employeeId: string | null; employeeName: string | null; employeeNim: string | null; isFilled: boolean };
        type RawSlot  = { slotStart: string; slotEnd: string; coordinatorName: string | null; entries: RawEntry[]; filledCount: number; totalCount: number };
        type RawDay   = { dayOfWeek: string; dayOrder: number; slots: RawSlot[] };
        const schedule: RawDay[] = j.data?.schedule ?? [];
        const flat: { id: string; dayOfWeek: string; slotStart: string; slotEnd: string; employeeId: string }[] = [];
        for (const day of schedule) {
          for (const slot of day.slots) {
            for (const entry of slot.entries) {
              if (entry.employeeId) {
                flat.push({ id: entry.id, dayOfWeek: day.dayOfWeek, slotStart: slot.slotStart, slotEnd: slot.slotEnd, employeeId: entry.employeeId });
              }
            }
          }
        }
        setAllSchedules(flat);
      });
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
        padding: 'var(--space-4)', backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#ffffff', borderRadius: '12px',
          border: '1px solid var(--color-border)', padding: '24px',
          width: '100%', maxWidth: '440px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
        }}
      >
        <h2 id={`${uid}-title`} style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px' }}>
          Input Manual Presensi Kasir
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
          Khusus pencatatan Ijin atau Tidak Hadir untuk tanggal <strong>{date}</strong>.
        </p>

        {error && (
          <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#b91c1c', fontSize: '0.8rem', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>
              Nama Kasir / Mahasiswa
            </label>
            <select
              value={form.employeeId}
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value, scheduleId: '' }))}
              className="form-input"
              style={{ width: '100%' }}
              required
            >
              <option value="">— Pilih Kasir —</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.nim})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>
              Jadwal Shift ({hariTerpilih})
            </label>
            <select
              value={form.scheduleId}
              onChange={(e) => setForm((f) => ({ ...f, scheduleId: e.target.value }))}
              className="form-input"
              style={{ width: '100%' }}
              required
              disabled={!form.employeeId}
            >
              <option value="">— Pilih Slot Jadwal —</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>{s.slotStart} – {s.slotEnd} ({s.dayOfWeek})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>
              Status
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['IJIN', 'TIDAK_HADIR'] as const).map((st) => (
                <label key={st} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', border: form.status === st ? '2px solid #166534' : '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', backgroundColor: form.status === st ? '#f0fdf4' : '#fff' }}>
                  <input
                    type="radio"
                    name="status"
                    checked={form.status === st}
                    onChange={() => setForm((f) => ({ ...f, status: st }))}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{st === 'IJIN' ? 'Ijin / Sakit' : 'Tidak Hadir (Alpa)'}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '4px' }}>
              Keterangan / Alasan
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Contoh: Sakit dengan surat dokter / Ijin praktikum kuliah"
              className="form-input"
              style={{ width: '100%', minHeight: '60px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Batal
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader2 size={14} className="spin-icon" /> : 'Simpan Presensi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Absensi Page Component ──────────────────────────────
export default function AbsensiPage() {
  const { isManager } = useAdmin();

  // Navigation tab: 'absensi' vs 'bagi_hasil' (Alokasi 50% Paten)
  const [activeTab, setActiveTab] = useState<'absensi' | 'bagi_hasil'>('absensi');

  // Sub-view in Absensi: 'summary' (Rekap Disiplin Mahasiswa) vs 'logs' (Detail Log Shift)
  const [subView, setSubView] = useState<'summary' | 'logs'>('summary');

  const today = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()),
    [],
  );

  // Filter Mode State
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [rangeStart, setRangeStart] = useState('2026-10-01');
  const [rangeEnd, setRangeEnd] = useState(today);
  const [searchQ, setSearchQ] = useState('');

  // Data States
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summaryByEmployee, setSummaryByEmployee] = useState<EmployeeDisciplineSummary[]>([]);
  const [apiSummary, setApiSummary] = useState<ApiSummary | null>(null);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [rangeLabel, setRangeLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
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

      const res = await fetch(url);
      const json = await res.json();
      const rawRecords: AttendanceRecord[] = Array.isArray(json.data)
        ? json.data
        : (json.data?.records ?? []);
      const empSummary: EmployeeDisciplineSummary[] = json.data?.summaryByEmployee ?? [];
      const sum: ApiSummary | null = json.data?.summary ?? null;
      const months: string[] = json.data?.availableMonths ?? [];
      const label: string = json.data?.range?.label ?? '';

      setRecords(rawRecords);
      setSummaryByEmployee(empSummary);
      setApiSummary(sum);
      if (months.length > 0) setAvailableMonths(months);
      if (label) setRangeLabel(label);
    } catch {
      // silent fallback
    } finally {
      setLoading(false);
    }
  }, [periodMode, selectedDate, selectedMonth, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Navigate single date
  const shiftDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }));
  };

  // Filtered lists by search
  const filteredRecords = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.nim.includes(q) ||
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

  // Executive summary counts
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

  // Export Excel
  async function handleExportExcel() {
    if (records.length === 0 && summaryByEmployee.length === 0) {
      alert('Tidak ada data absensi untuk diekspor.');
      return;
    }
    setExportLoading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira — Wiramart UNPERBA';
      wb.created = new Date();

      // Sheet 1: Rekap Disiplin Mahasiswa
      const ws1 = wb.addWorksheet('Rekap Disiplin & Gaji');
      ws1.mergeCells('A1:J1');
      const t1 = ws1.getCell('A1');
      t1.value = `REKAP KEDISIPLINAN ABSENSI & KINERJA GAJI — ${rangeLabel.toUpperCase()}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t1 as any).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t1 as any).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t1 as any).alignment = { horizontal: 'center', vertical: 'middle' };
      ws1.getRow(1).height = 26;

      ws1.columns = [
        { key: 'no', width: 6 },
        { key: 'nama', width: 28 },
        { key: 'nim', width: 14 },
        { key: 'prodi', width: 20 },
        { key: 'totalShift', width: 12 },
        { key: 'hadir', width: 12 },
        { key: 'telat', width: 18 },
        { key: 'alpa', width: 12 },
        { key: 'pctHadir', width: 14 },
        { key: 'skorDisiplin', width: 16 },
      ];

      const h1 = ws1.getRow(3);
      h1.values = ['No', 'Nama Mahasiswa', 'NIM', 'Prodi', 'Total Shift', 'Hadir Tepat', 'Telat (x & mnt)', 'Ijin / Alpa', '% Kehadiran', '% Skor Disiplin'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      h1.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      h1.height = 22;

      summaryByEmployee.forEach((e, idx) => {
        ws1.addRow({
          no: idx + 1,
          nama: e.fullName,
          nim: e.nim,
          prodi: e.programStudi,
          totalShift: `${e.totalShift}x`,
          hadir: e.hadir,
          telat: e.telat > 0 ? `${e.telat}x (${e.totalLateMinutes} mnt)` : '0',
          alpa: e.ijin + e.tidakHadir,
          pctHadir: `${e.persenKehadiran}%`,
          skorDisiplin: `${e.skorDisiplin}%`,
        });
      });

      // Sheet 2: Detail Log Presensi
      const ws2 = wb.addWorksheet('Log Presensi Shift');
      ws2.mergeCells('A1:I1');
      const t2 = ws2.getCell('A1');
      t2.value = `LOG PRESENSI SHIFT DETAIL — ${rangeLabel.toUpperCase()}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t2 as any).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t2 as any).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t2 as any).alignment = { horizontal: 'center', vertical: 'middle' };
      ws2.getRow(1).height = 26;

      ws2.columns = [
        { key: 'no', width: 6 },
        { key: 'tanggal', width: 14 },
        { key: 'nama', width: 26 },
        { key: 'nim', width: 14 },
        { key: 'shift', width: 18 },
        { key: 'clockIn', width: 12 },
        { key: 'telat', width: 14 },
        { key: 'status', width: 14 },
        { key: 'catatan', width: 30 },
      ];

      const h2 = ws2.getRow(3);
      h2.values = ['No', 'Tanggal', 'Nama Mahasiswa', 'NIM', 'Jadwal Shift', 'Clock In', 'Keterlambatan', 'Status', 'Catatan'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      h2.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      h2.height = 22;

      records.forEach((r, idx) => {
        ws2.addRow({
          no: idx + 1,
          tanggal: r.attendanceDate,
          nama: r.employee.fullName,
          nim: r.employee.nim,
          shift: `${r.schedule.dayOfWeek} ${r.schedule.slotStart}–${r.schedule.slotEnd}`,
          clockIn: r.clockInActual ? new Date(r.clockInActual).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—',
          telat: r.lateMinutes > 0 ? `+${r.lateMinutes} mnt` : '—',
          status: r.status,
          catatan: r.notes ?? '—',
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Rekap_Absensi_Disiplin_Wiramart_${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor data absensi ke Excel.');
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <div className="page-container">
      {/* ── Page Header ────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '1.4rem', fontWeight: 800 }}>
            {activeTab === 'absensi' ? 'Rekap Absensi & Kedisiplinan Karyawan' : 'Alokasi Bagi Hasil 50% Karyawan'}
          </h1>
          <p className="page-subtitle" style={{ fontSize: '0.85rem' }}>
            {activeTab === 'absensi'
              ? 'Pantau kehadiran, akumulasi keterlambatan, dan skor kedisiplinan yang menentukan porsi upah mahasiswa'
              : 'Perhitungan transparan pembagian laba harian untuk tim shift toko (Closed-Loop 50:50)'}
          </p>
        </div>
        {activeTab === 'absensi' && (
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
          >
            <UserX size={15} aria-hidden="true" /> Input Manual (Ijin/Alpa)
          </button>
        )}
      </div>

      {/* ── Main Tab Switcher ──────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px',
          borderBottom: '2px solid var(--color-border)',
          paddingBottom: '8px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('absensi')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.85rem',
            backgroundColor: activeTab === 'absensi' ? '#166534' : 'transparent',
            color: activeTab === 'absensi' ? '#ffffff' : 'var(--color-text-secondary)',
            transition: 'all 0.15s ease',
          }}
        >
          <ClipboardList size={16} />
          <span>📋 Rekap Presensi & Kedisiplinan</span>
        </button>

        {isManager && (
          <button
            type="button"
            onClick={() => setActiveTab('bagi_hasil')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
              backgroundColor: activeTab === 'bagi_hasil' ? '#166534' : 'transparent',
              color: activeTab === 'bagi_hasil' ? '#ffffff' : 'var(--color-text-secondary)',
              transition: 'all 0.15s ease',
            }}
          >
            <Award size={16} />
            <span>💰 Rekap Gaji Bagi Hasil (50% Paten)</span>
          </button>
        )}
      </div>

      {activeTab === 'bagi_hasil' && isManager ? (
        <BagiHasilTab />
      ) : (
        <>
          {/* ── FinOps Transparency Banner ────────────────────────── */}
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldCheck size={24} color="#166534" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534' }}>
                  Korelasi Absensi ke Bagi Hasil 50% Wiramart (Closed-Loop)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#15803d', lineHeight: 1.4 }}>
                  Gaji dibagi berdasarkan akumulasi poin: <strong>Bobot Peran × Bobot Durasi (Pagi 1.25x vs Siang 1.0x) × Faktor Disiplin Waktu</strong>. Toleransi telat 5 menit; telat di atasnya dipotong 3% per 5 menit keterlambatan (maks 50%).
                </div>
              </div>
            </div>
            {isManager && (
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
                Buka Rekap Gaji <ArrowRight size={13} />
              </button>
            )}
          </div>

          {/* ── Integrated Filter Toolbar ─────────────────────────── */}
          <div
            className="card"
            style={{
              padding: '12px 16px',
              marginBottom: '16px',
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
              {/* Left: Mode Switcher Pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {(
                  [
                    { mode: 'month', label: 'Per Bulan' },
                    { mode: 'last_month', label: 'Bulan Lalu' },
                    { mode: 'daily', label: 'Per Tanggal' },
                    { mode: 'range', label: 'Rentang Bebas' },
                    { mode: 'all', label: 'Semua Waktu' },
                  ] as const
                ).map(({ mode, label }) => {
                  const active = periodMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPeriodMode(mode)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '99px',
                        border: active ? '1.5px solid #166534' : '1px solid var(--color-border)',
                        backgroundColor: active ? '#166534' : '#f8fafc',
                        color: active ? '#ffffff' : 'var(--color-text-secondary)',
                        fontSize: '0.75rem',
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Right: Export Excel Button */}
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
                  fontSize: '0.75rem',
                }}
              >
                {exportLoading ? <Loader2 size={13} className="spin-icon" /> : <Download size={13} />}
                Export Excel (.xlsx)
              </button>
            </div>

            {/* Sub-controls based on period mode */}
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
                    style={{ minWidth: 28, padding: '4px 6px' }}
                    title="Hari Sebelumnya"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    max={today}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 30, width: '135px', fontWeight: 600 }}
                  />
                  <button
                    type="button"
                    onClick={() => shiftDate(1)}
                    disabled={selectedDate >= today}
                    className="btn btn-secondary btn-sm"
                    style={{ minWidth: 28, padding: '4px 6px' }}
                    title="Hari Berikutnya"
                  >
                    <ChevronRight size={14} />
                  </button>
                  {selectedDate !== today && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(today)}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem', padding: '3px 8px' }}
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
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 30, width: '135px', fontWeight: 600 }}
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
                        onClick={() => setSelectedMonth(m)}
                        style={{
                          padding: '3px 10px',
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
                  📌 Periode Terpilih: {rangeLabel}
                </span>
              )}

              {periodMode === 'range' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={rangeStart}
                    max={rangeEnd || today}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 30, width: '130px', fontWeight: 600 }}
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>s/d</span>
                  <input
                    type="date"
                    value={rangeEnd}
                    min={rangeStart}
                    max={today}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 30, width: '130px', fontWeight: 600 }}
                  />
                </div>
              )}

              {periodMode === 'all' && (
                <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 700, backgroundColor: '#f0fdf4', padding: '4px 10px', borderRadius: '6px' }}>
                  🌐 Menampilkan seluruh riwayat presensi operasional (Agustus – Sekarang)
                </span>
              )}
            </div>
          </div>

          {/* ── KPI Summary Cards ─────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '10px',
              marginBottom: '16px',
            }}
          >
            {[
              { label: 'Hadir Tepat', val: summary.hadir, color: '#16a34a', sub: 'Tanpa potongan' },
              { label: 'Terlambat', val: summary.telat, color: '#d97706', sub: `${summary.totalLateMinutes} mnt akumulasi` },
              { label: 'Ijin / Sakit', val: summary.ijin, color: '#2563eb', sub: 'Tercatat admin' },
              { label: 'Tidak Hadir', val: summary.tidakHadir, color: '#dc2626', sub: 'Alpa tanpa ijin' },
              { label: 'Shift Pengganti', val: summary.pengganti, color: '#7c3aed', sub: 'Swap disetujui' },
              { label: 'Rata-rata Disiplin', val: `${summary.avgDisiplin}%`, color: '#4338ca', sub: 'Skor ketepatan tim' },
            ].map((c) => (
              <div
                key={c.label}
                className="card"
                style={{
                  padding: '10px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px',
                  backgroundColor: '#ffffff',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: c.color, lineHeight: 1.1 }}>
                  {c.val}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: '4px' }}>
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
            {/* Sub-view toggle */}
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
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: subView === 'summary' ? 700 : 500,
                  backgroundColor: subView === 'summary' ? '#ffffff' : 'transparent',
                  color: subView === 'summary' ? '#166534' : 'var(--color-text-secondary)',
                  boxShadow: subView === 'summary' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                📊 Rekap Disiplin & Performa Mahasiswa ({summaryByEmployee.length})
              </button>
              <button
                type="button"
                onClick={() => setSubView('logs')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: subView === 'logs' ? 700 : 500,
                  backgroundColor: subView === 'logs' ? '#ffffff' : 'transparent',
                  color: subView === 'logs' ? '#166534' : 'var(--color-text-secondary)',
                  boxShadow: subView === 'logs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                📝 Detail Log Presensi Shift ({records.length})
              </button>
            </div>

            {/* Search Box */}
            <div className="form-input-icon" style={{ maxWidth: '320px', flex: '1 1 200px' }}>
              <Search size={15} className="form-input-icon__icon" aria-hidden="true" />
              <input
                className="form-input form-input-icon__input"
                type="search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Cari nama mahasiswa atau NIM..."
                style={{ minHeight: 34, fontSize: '0.8rem' }}
              />
            </div>
          </div>

          {/* ── Table Area ────────────────────────────────────────── */}
          {loading ? (
            <div className="card" style={{ padding: '40px 16px', textAlign: 'center' }}>
              <Loader2 size={24} className="spin-icon" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                Memuat data presensi dan performa mahasiswa...
              </p>
            </div>
          ) : subView === 'summary' ? (
            /* TABEL REKAP DISIPLIN PER MAHASISWA */
            filteredSummary.length === 0 ? (
              <div className="card" style={{ padding: '40px 16px', textAlign: 'center' }}>
                <ClipboardList size={32} style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <p style={{ fontWeight: 600, margin: 0 }}>Belum ada data presensi mahasiswa pada periode ini.</p>
              </div>
            ) : (
              <div className="table-wrapper" style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                <table className="table" style={{ fontSize: '0.8rem', width: '100%' }}>
                  <thead style={{ backgroundColor: '#f8fafc' }}>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                      <th>Mahasiswa</th>
                      <th>NIM / Prodi</th>
                      <th style={{ textAlign: 'center' }}>Total Shift</th>
                      <th style={{ textAlign: 'center' }}>Hadir Tepat</th>
                      <th style={{ textAlign: 'center' }}>Terlambat</th>
                      <th style={{ textAlign: 'center' }}>Ijin / Alpa</th>
                      <th style={{ textAlign: 'center' }}>% Kehadiran</th>
                      <th style={{ textAlign: 'center' }}>% Skor Disiplin</th>
                      <th style={{ textAlign: 'center' }}>Status Disiplin</th>
                      {isManager && <th style={{ textAlign: 'center' }}>Bagi Hasil 50%</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSummary.map((e, idx) => {
                      const isHigh = e.skorDisiplin >= 95;
                      const isMed = e.skorDisiplin >= 80 && e.skorDisiplin < 95;
                      const isLow = e.skorDisiplin < 80;
                      const badgeColor = isHigh ? '#16a34a' : isMed ? '#0284c7' : '#d97706';

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
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{e.totalShift}x</td>
                          <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>{e.hadir}</td>
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
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                backgroundColor: isHigh ? '#dcfce7' : isMed ? '#e0f2fe' : '#fef3c7',
                                color: isHigh ? '#166534' : isMed ? '#0369a1' : '#b45309',
                              }}
                            >
                              <TrendingUp size={11} /> {e.skorDisiplin}%
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                backgroundColor: `${badgeColor}15`,
                                color: badgeColor,
                                border: `1px solid ${badgeColor}35`,
                              }}
                            >
                              {e.statusDisiplin.replace('_', ' ')}
                            </span>
                          </td>
                          {isManager && (
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => setActiveTab('bagi_hasil')}
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #166534',
                                  backgroundColor: '#f0fdf4',
                                  color: '#166534',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                Lihat Gaji ➔
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* TABEL DETAIL LOG PRESENSI */
            filteredRecords.length === 0 ? (
              <div className="card" style={{ padding: '40px 16px', textAlign: 'center' }}>
                <ClipboardList size={32} style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <p style={{ fontWeight: 600, margin: 0 }}>Tidak ada log presensi yang cocok.</p>
              </div>
            ) : (
              <div className="table-wrapper" style={{ border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                <table className="table" style={{ fontSize: '0.8rem', width: '100%' }}>
                  <thead style={{ backgroundColor: '#f8fafc' }}>
                    <tr>
                      <th>Tanggal & Hari</th>
                      <th>Karyawan</th>
                      <th>NIM / Prodi</th>
                      <th>Jadwal Shift</th>
                      <th>Clock In</th>
                      <th>Keterlambatan</th>
                      <th>Status</th>
                      <th>Catatan / Peran</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <div>{r.attendanceDate}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{r.schedule.dayOfWeek}</div>
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                          {r.employee.fullName}
                        </td>
                        <td style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                          <div>{r.employee.nim}</div>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>{r.employee.programStudi}</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                          {r.schedule.slotStart}–{r.schedule.slotEnd}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                          {r.clockInActual ? new Date(r.clockInActual).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td>
                          {r.lateMinutes > 0 ? (
                            <span style={{ color: '#d97706', fontWeight: 700, fontSize: '0.75rem' }}>
                              +{r.lateMinutes} mnt
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem', maxWidth: '220px' }}>
                          {r.notes ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Modal Input Manual */}
          {showModal && (
            <ManualInputModal
              date={selectedDate}
              onClose={() => setShowModal(false)}
              onSuccess={fetchData}
            />
          )}
        </>
      )}
    </div>
  );
}
