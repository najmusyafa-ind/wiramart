'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  ClipboardList, Search, CheckCircle2, XCircle, Clock, AlertTriangle,
  UserCheck, UserX, CalendarDays, ChevronLeft, ChevronRight, Loader2, X,
  Download,
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
// Mapping JS getDay() → nama hari sesuai enum DB
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
  // Semua jadwal diambil dari API, lalu difilter client-side berdasarkan hari
  const [allSchedules, setAllSchedules] = useState<{ id: string; dayOfWeek: string; slotStart: string; slotEnd: string; employeeId: string }[]>([]);
  const [form, setForm] = useState({ employeeId: '', scheduleId: '', status: 'IJIN' as 'IJIN' | 'TIDAK_HADIR', notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Hitung nama hari dari prop `date` (YYYY-MM-DD)
  const hariTerpilih = JS_DAY_TO_ENUM[new Date(date + 'T00:00:00').getDay()] ?? '';

  // Filter jadwal: sesuai hari + sesuai karyawan (jika sudah dipilih)
  const schedules = allSchedules.filter(s => {
    if (s.dayOfWeek !== hariTerpilih) return false;
    if (form.employeeId && s.employeeId !== form.employeeId) return false;
    return true;
  });

  useEffect(() => {
    fetch('/api/admin/karyawan').then(r => r.json()).then(j => setEmployees(j.data ?? []));
    // Ambil jadwal dengan employee info agar bisa filter per karyawan
    // Endpoint publik mengembalikan data grouped; kita flatten jadi flat list schedule
    fetch('/api/publik/jadwal-slot')
      .then(r => r.json())
      .then(j => {
        // Response: { schedule: DayGroup[] } — flatten entries ke flat list
        type RawEntry = { id: string; orderInSlot: number; employeeId: string | null; employeeName: string | null; employeeNim: string | null; isFilled: boolean };
        type RawSlot  = { slotStart: string; slotEnd: string; coordinatorName: string | null; entries: RawEntry[]; filledCount: number; totalCount: number };
        type RawDay   = { dayOfWeek: string; dayOrder: number; slots: RawSlot[] };
        const schedule: RawDay[] = j.data?.schedule ?? [];
        const flat: { id: string; dayOfWeek: string; slotStart: string; slotEnd: string; employeeId: string }[] = [];
        for (const day of schedule) {
          for (const slot of day.slots) {
            for (const entry of slot.entries) {
              if (entry.employeeId) { // hanya slot yang sudah diisi (ada kasir)
                flat.push({ id: entry.id, dayOfWeek: day.dayOfWeek, slotStart: slot.slotStart, slotEnd: slot.slotEnd, employeeId: entry.employeeId });
              }
            }
          }
        }
        setAllSchedules(flat);
      });
  }, []);

  // Ketika karyawan diganti → reset jadwal
  function handleEmpChange(empId: string) {
    setForm(f => ({ ...f, employeeId: empId, scheduleId: '' }));
  }

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

        {/* Info tanggal + hari */}
        <div style={{ margin: '0 0 var(--space-4)', padding: '8px 12px', background: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', color: 'var(--color-text-secondary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <CalendarDays size={14} aria-hidden="true" />
          <span>Tanggal: <strong style={{ color: 'var(--color-text-primary)' }}>{date}</strong></span>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', background: 'var(--color-primary)', color: '#fff', padding: '2px 8px', borderRadius: '999px', fontWeight: 600 }}>{hariTerpilih}</span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label htmlFor={`${uid}-emp`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Karyawan *</label>
            <select id={`${uid}-emp`} value={form.employeeId} onChange={e => handleEmpChange(e.target.value)} required
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              <option value="">-- Pilih Karyawan --</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.fullName} ({e.nim})</option>)}
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-sched`} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
              Jadwal <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>— hari {hariTerpilih}{form.employeeId ? ', karyawan terpilih' : ''}</span> *
            </label>
            <select id={`${uid}-sched`} value={form.scheduleId} onChange={e => setForm(f => ({ ...f, scheduleId: e.target.value }))} required
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              <option value="">{schedules.length === 0 ? '-- Tidak ada jadwal untuk hari ini --' : '-- Pilih Jadwal --'}</option>
              {schedules.map(s => <option key={s.id} value={s.id}>{s.dayOfWeek} {s.slotStart}–{s.slotEnd}</option>)}
            </select>
            {schedules.length === 0 && hariTerpilih && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginTop: '4px' }}>
                Tidak ada jadwal {hariTerpilih}. Admin perlu setup jadwal dulu di menu Jadwal Shift.
              </p>
            )}
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
  // Export state
  // Export state — mode bisa 'month' atau 'range'
  const [exportMode, setExportMode]     = useState<'month' | 'range'>('month');
  const [exportMonth, setExportMonth]   = useState(today.slice(0, 7)); // 'YYYY-MM'
  const [exportStart, setExportStart]   = useState(today.slice(0, 8) + '01'); // awal bulan ini
  const [exportEnd, setExportEnd]       = useState(today);
  const [exportLoading, setExportLoading] = useState(false);

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

  // ─── Export Absensi ke Excel (Bulanan atau Range Bebas) ─────
  async function handleExportAbsensi() {
    setExportLoading(true);
    try {
      // Tentukan URL query berdasarkan mode
      const queryUrl = exportMode === 'month'
        ? `/api/admin/absensi?month=${exportMonth}&limit=500`
        : `/api/admin/absensi?startDate=${exportStart}&endDate=${exportEnd}&limit=500`;

      const res = await fetch(queryUrl);
      const json = await res.json() as { success?: boolean; data?: AttendanceRecord[] };
      const allRecords: AttendanceRecord[] = json.data ?? [];

      if (allRecords.length === 0) {
        alert('Tidak ada data absensi untuk periode yang dipilih.');
        return;
      }

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira — Rekap Absensi';
      wb.created = new Date();

      // Label periode
      const periodeLabel = exportMode === 'month'
        ? (() => {
            const [yr, mo] = exportMonth.split('-').map(Number);
            return new Date(yr ?? 2026, (mo ?? 1) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
          })()
        : `${new Date(exportStart + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })} s/d ${new Date(exportEnd + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`;

      // ── Sheet 1: Detail Absensi ───────────────────────────────
      const ws = wb.addWorksheet('Detail Absensi');
      const COL_COUNT = 10;
      ws.mergeCells(`A1:J1`);
      const titleCell = ws.getCell('A1');
      titleCell.value = `REKAP ABSENSI WIRAMART — ${periodeLabel.toUpperCase()}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titleCellAny = titleCell as any;
      titleCellAny.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      titleCellAny.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      titleCellAny.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 28;

      ws.mergeCells(`A2:J2`);
      const subCell = ws.getCell('A2');
      subCell.value = `Dicetak: ${new Date().toLocaleString('id-ID')} | UKM Kewirausahaan Universitas Perwira Purbalingga`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subCellAny = subCell as any;
      subCellAny.font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
      subCellAny.alignment = { horizontal: 'center' };

      ws.columns = [
        { key: 'no',       width: 5 },
        { key: 'nama',     width: 28 },
        { key: 'nim',      width: 16 },
        { key: 'prodi',    width: 22 },
        { key: 'jabatan',  width: 14 },
        { key: 'tanggal',  width: 14 },
        { key: 'hari',     width: 12 },
        { key: 'jamMasuk', width: 12 },
        { key: 'terlambat',width: 22 },
        { key: 'status',   width: 14 },
      ];

      const hRow = ws.getRow(3);
      hRow.values = ['No', 'Nama Lengkap', 'NIM', 'Program Studi', 'Jabatan', 'Tanggal', 'Hari', 'Jam Masuk', 'Terlambat (mnt)', 'Status'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF93C5FD' } } };
      });
      hRow.height = 28;

      const statusLabel: Record<string, string> = {
        HADIR: 'Hadir', TELAT: 'Telat', IJIN: 'Ijin',
        TIDAK_HADIR: 'Tidak Hadir', PENGGANTI: 'Pengganti',
      };
      const statusColor: Record<string, string> = {
        HADIR: 'FF16A34A', TELAT: 'FFD97706', IJIN: 'FF2563EB',
        TIDAK_HADIR: 'FFDC2626', PENGGANTI: 'FF7C3AED',
      };

      allRecords.forEach((r, idx) => {
        const clockInStr = r.clockInActual
          ? new Date(r.clockInActual).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          : '—';
        const dateStr = new Date(r.attendanceDate + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const hariStr = new Date(r.attendanceDate + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long' });

        const row = ws.addRow([
          idx + 1, r.employee.fullName, r.employee.nim, r.employee.programStudi,
          r.employee.jabatan, dateStr, hariStr, clockInStr,
          r.lateMinutes > 0 ? r.lateMinutes : 0,
          statusLabel[r.status] ?? r.status,
        ]);
        if (idx % 2 === 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((cell: any) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
        }
        const statusCell = row.getCell(COL_COUNT);
        const clr = statusColor[r.status] ?? 'FF374151';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (statusCell as any).font = { bold: true, color: { argb: clr }, size: 9 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row.eachCell((cell: any) => { cell.alignment = { vertical: 'middle', wrapText: false }; });
        row.height = 20;
      });

      // ── Sheet 2: Ringkasan per Karyawan (ditingkatkan) ────────
      const ws2 = wb.addWorksheet('Ringkasan per Karyawan');
      ws2.columns = [
        { key: 'nama',          width: 30 },
        { key: 'nim',           width: 16 },
        { key: 'prodi',         width: 22 },
        { key: 'jabatan',       width: 14 },
        { key: 'totalShift',    width: 13 },
        { key: 'hadir',         width: 10 },
        { key: 'telat',         width: 10 },
        { key: 'ijin',          width: 10 },
        { key: 'bolos',         width: 10 },
        { key: 'persen',        width: 14 },
        { key: 'menitTelat',    width: 18 },
      ];

      const hRow2 = ws2.getRow(1);
      hRow2.values = ['Nama Lengkap', 'NIM', 'Program Studi', 'Jabatan', 'Total Shift', 'Hadir', 'Telat', 'Ijin', 'Bolos', '% Kehadiran', 'Total Menit Telat'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow2.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      hRow2.height = 24;

      // Group by employee
      const byEmp = new Map<string, { rec: AttendanceRecord; counts: Record<string, number>; menit: number }>();
      allRecords.forEach(r => {
        if (!byEmp.has(r.employee.id)) byEmp.set(r.employee.id, { rec: r, counts: {}, menit: 0 });
        const e = byEmp.get(r.employee.id)!;
        e.counts[r.status] = (e.counts[r.status] ?? 0) + 1;
        e.menit += r.lateMinutes ?? 0;
      });

      let rowIdx2 = 0;
      byEmp.forEach(({ rec, counts, menit }) => {
        const hadirCount  = (counts['HADIR'] ?? 0) + (counts['PENGGANTI'] ?? 0);
        const telatCount  = counts['TELAT'] ?? 0;
        const ijinCount   = counts['IJIN'] ?? 0;
        const bolosCount  = counts['TIDAK_HADIR'] ?? 0;
        const totalShift  = hadirCount + telatCount + ijinCount + bolosCount;
        // % Kehadiran = (hadir + telat + pengganti) / total × 100
        const pctHadir    = totalShift > 0 ? Math.round(((hadirCount + telatCount) / totalShift) * 100) : 0;

        const row = ws2.addRow([
          rec.employee.fullName, rec.employee.nim, rec.employee.programStudi, rec.employee.jabatan,
          totalShift, hadirCount, telatCount, ijinCount, bolosCount,
          `${pctHadir}%`,
          menit,
        ]);

        if (rowIdx2 % 2 === 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((cell: any) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } }; });
        }
        // Warna merah jika bolos > 2
        if (bolosCount > 2) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (row.getCell('nama') as any).font = { bold: true, color: { argb: 'FFDC2626' } };
        }
        row.height = 20;
        rowIdx2++;
      });

      // Footer baris total Sheet 2
      const totalRow = ws2.addRow(['TOTAL', '', '', '',
        allRecords.length, // total baris shift
        allRecords.filter(r => r.status === 'HADIR' || r.status === 'PENGGANTI').length,
        allRecords.filter(r => r.status === 'TELAT').length,
        allRecords.filter(r => r.status === 'IJIN').length,
        allRecords.filter(r => r.status === 'TIDAK_HADIR').length,
        '', ''
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totalRow.eachCell((cell: any) => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      });

      // Download
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = exportMode === 'month' ? exportMonth : `${exportStart}_sd_${exportEnd}`;
      a.download = `Absensi-Wiramart-${suffix}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Gagal export: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setExportLoading(false);
    }
  }

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
      {/* Date Navigator + Actions — mobile-first layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {/* Row 1: Date navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '4px' }}>
            <button
              onClick={() => shiftDate(-1)} aria-label="Hari sebelumnya"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: '8px 10px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', minWidth: 40, minHeight: 40, justifyContent: 'center' }}
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="date" value={selectedDate} max={today}
              onChange={e => setSelectedDate(e.target.value)}
              aria-label="Pilih tanggal"
              style={{ background: 'none', border: 'none', color: 'var(--color-text-primary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', padding: '4px', minHeight: 40 }}
            />
            <button
              onClick={() => shiftDate(1)} disabled={isToday} aria-label="Hari berikutnya"
              style={{ background: 'none', border: 'none', cursor: isToday ? 'not-allowed' : 'pointer', color: isToday ? 'var(--color-text-muted)' : 'var(--color-text-secondary)', padding: '8px 10px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', opacity: isToday ? 0.4 : 1, minWidth: 40, minHeight: 40, justifyContent: 'center' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{displayDate}</span>
          {!isToday && (
            <button
              onClick={() => setSelectedDate(today)}
              style={{ padding: '8px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600, minHeight: 40 }}
            >
              Hari Ini
            </button>
          )}
        </div>

        {/* Row 2: Action buttons — full width on mobile, flex-end on desktop */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Export Excel — dengan toggle mode Bulan / Range Bebas */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', padding: '8px 12px',
            flex: '1 1 auto', minWidth: 260,
          }}>
            {/* Toggle mode */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Export absensi:</span>
              {(['month', 'range'] as const).map(m => (
                <button key={m} onClick={() => setExportMode(m)}
                  style={{
                    padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)', border: '1px solid',
                    borderColor: exportMode === m ? 'var(--color-primary)' : 'var(--color-border)',
                    background: exportMode === m ? 'var(--color-primary)' : 'transparent',
                    color: exportMode === m ? '#fff' : 'var(--color-text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {m === 'month' ? '📅 Per Bulan' : '📆 Range Bebas'}
                </button>
              ))}
            </div>
            {/* Input sesuai mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {exportMode === 'month' ? (
                <input
                  id="export-month"
                  type="month"
                  value={exportMonth}
                  max={today.slice(0, 7)}
                  onChange={e => setExportMonth(e.target.value)}
                  style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', color: 'var(--color-text-primary)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', flex: 1, minWidth: 0 }}
                />
              ) : (
                <>
                  <input
                    type="date"
                    value={exportStart}
                    max={exportEnd || today}
                    onChange={e => setExportStart(e.target.value)}
                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', color: 'var(--color-text-primary)', fontSize: '0.8rem', cursor: 'pointer', flex: 1, minWidth: 0 }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>s/d</span>
                  <input
                    type="date"
                    value={exportEnd}
                    min={exportStart}
                    max={today}
                    onChange={e => setExportEnd(e.target.value)}
                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', color: 'var(--color-text-primary)', fontSize: '0.8rem', cursor: 'pointer', flex: 1, minWidth: 0 }}
                  />
                </>
              )}
              <button
                id="btn-export-absensi"
                onClick={handleExportAbsensi}
                disabled={exportLoading || (exportMode === 'month' ? !exportMonth : !exportStart || !exportEnd)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', background: 'hsl(140 60% 35%)',
                  border: 'none', borderRadius: 'var(--radius-md)', color: '#fff',
                  cursor: exportLoading ? 'wait' : 'pointer', fontWeight: 700,
                  fontSize: '0.8rem', opacity: exportLoading ? 0.7 : 1,
                  minHeight: 40, whiteSpace: 'nowrap',
                }}
              >
                {exportLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                {exportLoading ? 'Memproses...' : 'Export Excel'}
              </button>
            </div>
          </div>

          {/* Input Manual */}
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 18px', background: 'var(--color-primary)',
              border: 'none', borderRadius: 'var(--radius-md)', color: '#fff',
              cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
              minHeight: 40, whiteSpace: 'nowrap', flex: '0 0 auto',
            }}
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
