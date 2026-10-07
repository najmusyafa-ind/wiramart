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
  TIDAK_HADIR: { label: 'Tidak Hadir', color: 'var(--color-error)',    icon: <UserX size={13} /> },
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 id={`${uid}-title`} style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
            Input Absensi Manual
          </h2>
          <button onClick={onClose} aria-label="Tutup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>

        {/* Info tanggal + hari */}
        <div style={{ margin: '0 0 var(--space-4)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <CalendarDays size={14} aria-hidden="true" />
          <span>Tanggal: <strong style={{ color: 'var(--color-text)' }}>{date}</strong></span>
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '2px 8px', borderRadius: 'var(--radius-full)', fontWeight: 'var(--weight-bold)' }}>{hariTerpilih}</span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor={`${uid}-emp`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>Karyawan *</label>
            <select id={`${uid}-emp`} className="form-input form-select" value={form.employeeId} onChange={e => handleEmpChange(e.target.value)} required>
              <option value="">-- Pilih Karyawan --</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.fullName} ({e.nim})</option>)}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor={`${uid}-sched`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
              Jadwal Shift <span style={{ color: 'var(--color-text-muted)', fontWeight: 'normal' }}>— hari {hariTerpilih}{form.employeeId ? ', kasir terpilih' : ''}</span> *
            </label>
            <select id={`${uid}-sched`} className="form-input form-select" value={form.scheduleId} onChange={e => setForm(f => ({ ...f, scheduleId: e.target.value }))} required>
              <option value="">{schedules.length === 0 ? '-- Tidak ada jadwal untuk hari ini --' : '-- Pilih Jadwal --'}</option>
              {schedules.map(s => <option key={s.id} value={s.id}>{s.dayOfWeek} {s.slotStart}–{s.slotEnd}</option>)}
            </select>
            {schedules.length === 0 && hariTerpilih && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', marginTop: '4px', margin: 0 }}>
                Tidak ada jadwal {hariTerpilih}. Setup jadwal terlebih dahulu di menu Jadwal Shift.
              </p>
            )}
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor={`${uid}-status`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>Status Kehadiran *</label>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              {(['IJIN', 'TIDAK_HADIR'] as const).map(s => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setForm(f => ({ ...f, status: s }))}
                  className={`btn ${form.status === s ? (s === 'IJIN' ? 'btn-primary' : 'btn-danger') : 'btn-secondary'}`}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
                >
                  <span>{STATUS_CONFIG[s].icon}</span>
                  <span>{STATUS_CONFIG[s].label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor={`${uid}-notes`} className="form-label" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>Catatan (opsional)</label>
            <textarea id={`${uid}-notes`} className="form-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Alasan ijin, keterangan khusus sakit/kuliah..." rows={2} style={{ resize: 'vertical' }} />
          </div>

          {error && (
            <div role="alert" style={{ display: 'flex', gap: 8, padding: 'var(--space-2) var(--space-3)', background: 'var(--color-error-light)', border: '1px solid var(--color-error)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 'var(--text-xs)', alignItems: 'center' }}>
              <AlertTriangle size={14} aria-hidden="true" /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>Batal</button>
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
              {loading ? <><Loader2 size={16} className="spin-icon" /> Menyimpan...</> : 'Simpan Absensi'}
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
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Rekap Absensi Karyawan</h1>
          <p className="page-subtitle">Pantau kehadiran, keterlambatan, dan status shift kasir harian</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <UserX size={16} aria-hidden="true" /> Input Manual
        </button>
      </div>

      {/* Date Navigator + Action Toolbar */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div
          className="card-body"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
          }}
        >
          {/* Left: Date Navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: 'var(--color-surface-alt)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '2px',
              }}
            >
              <button
                onClick={() => shiftDate(-1)}
                className="btn btn-sm btn-secondary"
                aria-label="Hari sebelumnya"
                style={{ padding: '6px 8px', minWidth: 32, minHeight: 32, border: 'none', background: 'transparent' }}
              >
                <ChevronLeft size={16} />
              </button>
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  minHeight: 32,
                  border: 'none',
                  background: 'transparent',
                  padding: '0 var(--space-2)',
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
                aria-label="Pilih tanggal absensi"
              />
              <button
                onClick={() => shiftDate(1)}
                disabled={isToday}
                className="btn btn-sm btn-secondary"
                aria-label="Hari berikutnya"
                style={{ padding: '6px 8px', minWidth: 32, minHeight: 32, border: 'none', background: 'transparent', opacity: isToday ? 0.3 : 1 }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
              {displayDate}
            </span>
            {!isToday && (
              <button
                onClick={() => setSelectedDate(today)}
                className="btn btn-sm btn-secondary"
              >
                Hari Ini
              </button>
            )}
          </div>

          {/* Right: Export Excel Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-flex',
                background: 'var(--color-surface-alt)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '2px',
              }}
            >
              {(['month', 'range'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setExportMode(m)}
                  className={`btn btn-sm ${exportMode === m ? 'btn-primary' : 'btn-secondary'}`}
                  style={{
                    padding: '4px 10px',
                    fontSize: 'var(--text-xs)',
                    border: 'none',
                    background: exportMode === m ? 'var(--color-primary)' : 'transparent',
                    color: exportMode === m ? '#fff' : 'var(--color-text-secondary)',
                  }}
                >
                  {m === 'month' ? 'Per Bulan' : 'Range Bebas'}
                </button>
              ))}
            </div>

            {exportMode === 'month' ? (
              <input
                id="export-month"
                type="month"
                value={exportMonth}
                max={today.slice(0, 7)}
                onChange={(e) => setExportMonth(e.target.value)}
                className="form-input"
                style={{ minHeight: 36, padding: '4px 8px', fontSize: 'var(--text-xs)', width: '135px' }}
                aria-label="Pilih bulan untuk export"
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <input
                  type="date"
                  value={exportStart}
                  max={exportEnd || today}
                  onChange={(e) => setExportStart(e.target.value)}
                  className="form-input"
                  style={{ minHeight: 36, padding: '4px 6px', fontSize: 'var(--text-xs)', width: '120px' }}
                  aria-label="Tanggal mulai export"
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>–</span>
                <input
                  type="date"
                  value={exportEnd}
                  min={exportStart}
                  max={today}
                  onChange={(e) => setExportEnd(e.target.value)}
                  className="form-input"
                  style={{ minHeight: 36, padding: '4px 6px', fontSize: 'var(--text-xs)', width: '120px' }}
                  aria-label="Tanggal akhir export"
                />
              </div>
            )}

            <button
              id="btn-export-absensi"
              onClick={handleExportAbsensi}
              disabled={exportLoading || (exportMode === 'month' ? !exportMonth : !exportStart || !exportEnd)}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', whiteSpace: 'nowrap', minHeight: 36 }}
            >
              {exportLoading ? <Loader2 size={14} className="spin-icon" /> : <Download size={14} />}
              Export Excel
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-5)',
        }}
      >
        {([
          { key: 'hadir', label: 'Hadir Tepat', val: summary.hadir, color: 'var(--color-success)', bg: 'var(--color-success-light)' },
          { key: 'telat', label: 'Terlambat', val: summary.telat, color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
          { key: 'ijin',  label: 'Ijin / Sakit', val: summary.ijin, color: 'var(--color-info)', bg: 'var(--color-info-light)' },
          { key: 'tidakHadir', label: 'Tidak Hadir', val: summary.tidakHadir, color: 'var(--color-error)', bg: 'var(--color-error-light)' },
          { key: 'pengganti', label: 'Shift Pengganti', val: summary.pengganti, color: 'hsl(280 70% 65%)', bg: 'hsl(280 70% 65% / 0.1)' },
        ] as const).map((item) => (
          <div
            key={item.key}
            className="stat-card"
            style={{
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: item.color }} />
            <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-extrabold)', color: item.color, lineHeight: 1 }}>
              {item.val}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)', fontWeight: 'var(--weight-medium)' }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="form-input-icon" style={{ maxWidth: '360px', flex: '1 1 260px' }}>
          <Search size={16} className="form-input-icon__icon" aria-hidden="true" />
          <input
            className="form-input form-input-icon__input"
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Cari kasir atau NIM..."
            style={{ minHeight: 40 }}
          />
        </div>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          Menampilkan {filtered.length} dari {records.length} data
        </span>
      </div>

      {/* Table */}
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
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', textAlign: 'center' }}>Memuat data absensi...</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
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
            <ClipboardList size={36} aria-hidden="true" style={{ margin: '0 auto var(--space-3)', opacity: 0.35 }} />
            <p style={{ margin: 0, fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', textAlign: 'center' }}>
              Belum ada data absensi
            </p>
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              {searchQ ? 'Tidak ada hasil yang cocok dengan kata kunci pencarian.' : 'Kasir belum melakukan clock in hari ini, atau belum ada jadwal terdaftar.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table" style={{ fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr>
                <th scope="col">Karyawan</th>
                <th scope="col">NIM / Prodi</th>
                <th scope="col">Jadwal Shift</th>
                <th scope="col">Clock In</th>
                <th scope="col">Keterlambatan</th>
                <th scope="col">Status</th>
                <th scope="col">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                    {r.employee.fullName}
                  </td>
                  <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                    <div>{r.employee.nim}</div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>{r.employee.programStudi}</div>
                  </td>
                  <td style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {r.schedule.dayOfWeek} {r.schedule.slotStart}–{r.schedule.slotEnd}
                  </td>
                  <td style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                    {r.clockInActual ? new Date(r.clockInActual).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td>
                    {r.lateMinutes > 0 ? (
                      <span style={{ color: 'var(--color-warning)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
                        +{r.lateMinutes} mnt
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', maxWidth: '200px' }}>
                    {r.notes ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
