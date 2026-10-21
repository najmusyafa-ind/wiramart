'use client';

/**
 * RekapShift — Laporan Keuangan & Bagi Hasil Per Shift (Khusus Manager / Dosen)
 *
 * Fitur:
 * 1. Filter Fleksibel: Per Bulan, Per Tanggal (Harian), Rentang Kustom, Semua Data
 * 2. TABEL GAJI BAGI HASIL — SEMUA MAHASISWA (Data Produksi Real-Time)
 *    - Peringkat perolehan, search NIM/Nama, status audit, export Excel (.xlsx)
 * 3. DATA GAJI PER SHIFT (Pagi 07:00-11:30 & Siang 11:30-15:00)
 *    - Expandable detail daftar hadir mahasiswa dan hak bagi hasil per shift
 * 4. Executive Metric Cards: Omzet, Laba Kotor, Pool 50%, Terdistribusi, Sisa Toko
 *
 * Formula Laba:
 * SUM(subtotal_sell - subtotal_cost) dari snapshot item (audit-proof)
 */

import { useState, useEffect, useCallback, useId, useMemo } from 'react';
import {
  Sun,
  Sunset,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Users,
  TrendingUp,
  DollarSign,
  ShoppingBag,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  Star,
  BadgeCheck,
  Calendar,
  Download,
  Search,
  Wallet,
  Award,
  Layers,
  Sparkles,
} from 'lucide-react';
import { formatRupiah, formatTanggalWib } from './shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'semi_annual';

export type AttendeeRow = {
  employeeId: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  status: string;
  lateMinutes: number;
  nominalBagiHasil: number;
};

export type ShiftRow = {
  shiftId: string;
  tanggal: string; // 'YYYY-MM-DD' WIB
  hari: string; // 'Senin', 'Selasa', ...
  sesi: 'Pagi' | 'Siang';
  slotLabel: string;
  clockIn: string;
  clockOut: string | null;
  kasirName: string;
  kasirNim: string;
  txCount: number;
  omzet: number;
  labaKotor: number;
  poolGaji: number;
  personnelCount: number;
  nominalPerOrang: number;
  personnel: AttendeeRow[];
};

export type EmpSummary = {
  employeeId: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  totalHadir: number;
  totalNominal: number;
};

export type PerShiftData = {
  range: {
    startDate: string;
    endDate: string;
    label: string;
    period?: string;
  };
  grandTotal: {
    omzet: number;
    labaKotor: number;
    poolGaji: number;
    txCount: number;
    totalDistributed?: number;
    sisaPool?: number;
  };
  shifts: ShiftRow[];
  summaryPerEmployee: EmpSummary[];
  availableMonths?: string[];
};

export type RekapShiftProps = {
  period?: PeriodKey;
  dateFrom?: string;
  dateTo?: string;
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getTodayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function MarginBadge({ laba, omzet }: { laba: number; omzet: number }) {
  const pct = omzet > 0 ? Math.round((laba / omzet) * 100) : 0;
  const color = pct >= 20 ? '#10b981' : pct >= 10 ? '#f59e0b' : '#ef4444';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '99px',
        fontSize: '11px',
        fontWeight: 700,
        backgroundColor: color + '20',
        color,
        letterSpacing: '0.02em',
      }}
    >
      Margin {pct}%
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    HADIR: { label: 'Hadir', color: '#16a34a', bg: '#dcfce7' },
    TELAT: { label: 'Telat', color: '#d97706', bg: '#fef3c7' },
    PENGGANTI: { label: 'Ganti', color: '#6366f1', bg: '#e0e7ff' },
    TIDAK_HADIR: { label: 'Alpha', color: '#dc2626', bg: '#fee2e2' },
    IJIN: { label: 'Izin', color: '#8b5cf6', bg: '#ede9fe' },
  };
  const s = map[status] ?? { label: status, color: '#6b7280', bg: '#f3f4f6' };
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: '99px',
        fontSize: '11px',
        fontWeight: 700,
        backgroundColor: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Shift Card Sub-component ────────────────────────────────────────────────

function ShiftCard({ shift }: { shift: ShiftRow }) {
  const [expanded, setExpanded] = useState(false);
  const isPagi = shift.sesi === 'Pagi';
  const accentColor = isPagi ? '#d97706' : '#4f46e5';
  const hasProfit = shift.labaKotor > 0;

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg, 10px)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-surface, #ffffff)',
        boxShadow: expanded
          ? '0 6px 20px -4px rgba(0,0,0,0.08)'
          : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header Shift Card */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3, 12px)',
          padding: '12px 16px',
          backgroundColor: expanded ? `${accentColor}0a` : 'transparent',
          borderBottom: expanded ? '1px solid var(--color-border)' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
          flexWrap: 'wrap',
        }}
        onClick={() => setExpanded((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((p) => !p);
          }
        }}
        aria-expanded={expanded}
      >
        {/* Sesi badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: isPagi ? '#fef3c7' : '#e0e7ff',
            color: accentColor,
            padding: '4px 12px',
            borderRadius: '99px',
            fontSize: '12px',
            fontWeight: 800,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {isPagi ? <Sun size={13} /> : <Sunset size={13} />}
          <span>
            {shift.sesi} · {shift.slotLabel}
          </span>
        </div>

        {/* Tanggal & Hari */}
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: '0.92rem',
              color: 'var(--color-text, #111827)',
            }}
          >
            {shift.hari}, {formatTanggalWib(shift.tanggal).replace(/^[A-Za-z]+, /, '')}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--color-text-muted, #6b7280)',
              marginTop: '2px',
            }}
          >
            Kasir: <strong>{shift.kasirName}</strong> ({shift.kasirNim}) &nbsp;· Buka:{' '}
            {formatTime(shift.clockIn)}
            {shift.clockOut ? ` · Tutup: ${formatTime(shift.clockOut)}` : ' · (Aktif)'}
          </div>
        </div>

        {/* Ringkasan Finansial Shift */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4, 16px)',
            alignItems: 'center',
            flexShrink: 0,
            marginLeft: 'auto',
          }}
        >
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #6b7280)' }}>
              {shift.txCount} tx
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>
              {formatRupiah(shift.omzet)}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #6b7280)' }}>
              Laba Bersih
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: '0.9rem',
                color: hasProfit ? '#16a34a' : '#dc2626',
              }}
            >
              {formatRupiah(shift.labaKotor)}
            </div>
          </div>

          <MarginBadge laba={shift.labaKotor} omzet={shift.omzet} />

          {/* Badge Personel Hadir */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 10px',
              borderRadius: '99px',
              fontSize: '12px',
              fontWeight: 700,
              backgroundColor: shift.personnelCount > 0 ? '#dcfce7' : '#f3f4f6',
              color: shift.personnelCount > 0 ? '#15803d' : '#6b7280',
            }}
          >
            <Users size={12} />
            {shift.personnelCount} orang
          </div>

          <div style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </div>
        </div>
      </div>

      {/* Expanded Content: Detail Personel Hadir */}
      {expanded && (
        <div style={{ padding: '16px 20px', backgroundColor: 'var(--color-surface-alt, #fafafa)' }}>
          {/* Card Alokasi Bagi Hasil */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              marginBottom: '14px',
              padding: '12px 16px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                Pool Bagi Hasil (50% Paten)
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#16a34a' }}>
                {formatRupiah(shift.poolGaji)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                Mahasiswa Hadir Presensi
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-text)' }}>
                {shift.personnelCount} Orang
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                Hak Gaji Per Orang
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: accentColor }}>
                {formatRupiah(shift.nominalPerOrang)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                Kas Laba Toko (50%)
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#4f46e5' }}>
                {formatRupiah(Math.max(0, shift.labaKotor - shift.poolGaji))}
              </div>
            </div>
          </div>

          {/* Tabel Mahasiswa Hadir di Shift Ini */}
          {shift.personnel.length > 0 ? (
            <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', backgroundColor: '#ffffff' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--color-border)' }}>
                    {['#', 'Nama Mahasiswa', 'NIM', 'Program Studi', 'Jabatan', 'Status', 'Telat', 'Hak Bagi Hasil'].map((h, i) => (
                      <th
                        key={h}
                        style={{
                          textAlign: i >= 5 ? 'center' : i === 7 ? 'right' : 'left',
                          padding: '8px 12px',
                          color: '#475569',
                          fontWeight: 700,
                          fontSize: '11px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shift.personnel.map((p, idx) => (
                    <tr
                      key={p.employeeId + shift.shiftId + idx}
                      style={{
                        borderBottom: idx < shift.personnel.length - 1 ? '1px solid #f1f5f9' : 'none',
                      }}
                    >
                      <td style={{ padding: '9px 12px', color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--color-text)' }}>
                        {p.fullName}
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace', color: '#64748b' }}>
                        {p.nim}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{p.programStudi}</td>
                      <td style={{ padding: '9px 12px', color: '#475569', fontWeight: 500 }}>{p.jabatan}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                        <StatusBadge status={p.status} />
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', color: p.lateMinutes > 0 ? '#d97706' : '#94a3b8' }}>
                        {p.lateMinutes > 0 ? `+${p.lateMinutes}m` : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: '13px' }}>
                        {formatRupiah(p.nominalBagiHasil)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '16px',
                color: 'var(--color-text-muted)',
                fontSize: '13px',
                backgroundColor: '#ffffff',
                borderRadius: '6px',
                border: '1px dashed var(--color-border)',
              }}
            >
              ⚠ Tidak ada catatan absensi mahasiswa yang terhubung untuk shift ini. Pool bagi hasil disimpan di kas toko.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RekapShift({ period: initialPeriod, dateFrom: propDateFrom, dateTo: propDateTo }: RekapShiftProps) {
  const uid = useId();
  const todayWib = useMemo(() => getTodayWib(), []);
  const currentMonthWib = useMemo(() => todayWib.slice(0, 7), [todayWib]);

  // Mode filter: 'monthly' | 'daily' | 'range' | 'all'
  const [filterMode, setFilterMode] = useState<'monthly' | 'daily' | 'range' | 'all'>('monthly');

  // Input states
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthWib);
  const [selectedDate, setSelectedDate] = useState<string>(propDateFrom || todayWib);
  const [rangeStart, setRangeStart] = useState<string>(propDateFrom || `${currentMonthWib}-01`);
  const [rangeEnd, setRangeEnd] = useState<string>(propDateTo || todayWib);

  // Tab utama RekapShift: 'mahasiswa' | 'shift'
  const [mainTab, setMainTab] = useState<'mahasiswa' | 'shift'>('mahasiswa');
  const [filterSesi, setFilterSesi] = useState<'Semua' | 'Pagi' | 'Siang'>('Semua');
  const [searchMahasiswa, setSearchMahasiswa] = useState('');
  const [searchKasir, setSearchKasir] = useState('');

  // Data fetching states
  const [data, setData] = useState<PerShiftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();

      if (filterMode === 'monthly') {
        params.set('month', selectedMonth);
      } else if (filterMode === 'daily') {
        params.set('date', selectedDate);
      } else if (filterMode === 'range') {
        params.set('dateFrom', rangeStart);
        params.set('dateTo', rangeEnd);
      } else if (filterMode === 'all') {
        params.set('period', 'semi_annual');
      }

      const res = await fetch(`/api/admin/laporan/per-shift?${params.toString()}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: PerShiftData;
        error?: string;
      };

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Gagal mengambil data laporan per shift');
      }
      setData(json.data!);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  }, [filterMode, selectedMonth, selectedDate, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Shortcut geser tanggal harian
  const shiftDay = (days: number) => {
    const d = new Date(selectedDate + 'T00:00:00+07:00');
    d.setDate(d.getDate() + days);
    const nextStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
    setSelectedDate(nextStr);
  };

  // Export Excel Slip Gaji Mahasiswa
  async function handleExportExcel() {
    if (!data || data.summaryPerEmployee.length === 0) return;
    setExportLoading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira — Wiramart UNPERBA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Gaji Bagi Hasil Mahasiswa');

      // Title header
      ws.mergeCells('A1:G1');
      const title = ws.getCell('A1');
      title.value = 'TABEL GAJI BAGI HASIL — SEMUA MAHASISWA (WIRAMART UNPERBA)';
      title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 30;

      ws.mergeCells('A2:G2');
      const sub = ws.getCell('A2');
      sub.value = `Periode: ${data.range.label} | Total Pool Gaji 50%: ${formatRupiah(data.grandTotal.poolGaji)} | Terdistribusi: ${formatRupiah(data.grandTotal.totalDistributed || 0)}`;
      sub.font = { italic: true, size: 10, color: { argb: 'FF334155' } };
      sub.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(2).height = 22;

      // Columns
      ws.columns = [
        { key: 'no', width: 6 },
        { key: 'nama', width: 30 },
        { key: 'nim', width: 16 },
        { key: 'prodi', width: 22 },
        { key: 'jabatan', width: 18 },
        { key: 'hadir', width: 14 },
        { key: 'nominal', width: 24 },
      ];

      const hRow = ws.getRow(4);
      hRow.values = ['No', 'Nama Mahasiswa', 'NIM', 'Program Studi', 'Jabatan Utama', 'Shift Hadir', 'Hak Bagi Hasil (Rp)'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      hRow.height = 24;

      data.summaryPerEmployee.forEach((emp, idx) => {
        const row = ws.addRow({
          no: idx + 1,
          nama: emp.fullName,
          nim: emp.nim,
          prodi: emp.programStudi,
          jabatan: emp.jabatan,
          hadir: `${emp.totalHadir} shift`,
          nominal: emp.totalNominal,
        });
        row.getCell('nominal').numFmt = '"Rp "#,##0';
        if (idx % 2 === 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((c: any) => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          });
        }
      });

      // Total Row
      const totalRow = ws.addRow({
        no: '',
        nama: 'TOTAL GAJI DIDISTRIBUSIKAN',
        nim: '',
        prodi: '',
        jabatan: '',
        hadir: `${data.summaryPerEmployee.reduce((s, e) => s + e.totalHadir, 0)} shift`,
        nominal: data.summaryPerEmployee.reduce((s, e) => s + e.totalNominal, 0),
      });
      totalRow.getCell('nominal').numFmt = '"Rp "#,##0';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totalRow.eachCell((c: any) => {
        c.font = { bold: true, size: 11 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      });
      totalRow.height = 24;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Gaji_Bagi_Hasil_Wiramart_${data.range.startDate}_sd_${data.range.endDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor Excel.');
    } finally {
      setExportLoading(false);
    }
  }

  // Filtered lists
  const filteredEmployees = useMemo(() => {
    if (!data) return [];
    const q = searchMahasiswa.trim().toLowerCase();
    if (!q) return data.summaryPerEmployee;
    return data.summaryPerEmployee.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.nim.toLowerCase().includes(q) ||
        e.programStudi.toLowerCase().includes(q) ||
        e.jabatan.toLowerCase().includes(q)
    );
  }, [data, searchMahasiswa]);

  const filteredShifts = useMemo(() => {
    if (!data) return [];
    let list = data.shifts;
    if (filterSesi !== 'Semua') {
      list = list.filter((s) => s.sesi === filterSesi);
    }
    const q = searchKasir.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.kasirName.toLowerCase().includes(q) ||
          s.kasirNim.toLowerCase().includes(q) ||
          s.tanggal.includes(q) ||
          s.hari.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, filterSesi, searchKasir]);

  const grandTotal = data?.grandTotal ?? {
    omzet: 0,
    labaKotor: 0,
    poolGaji: 0,
    txCount: 0,
    totalDistributed: 0,
    sisaPool: 0,
  };

  const margin = grandTotal.omzet > 0 ? Math.round((grandTotal.labaKotor / grandTotal.omzet) * 100) : 0;

  // Available months quick buttons
  const availableMonths = useMemo(() => {
    const list = data?.availableMonths && data.availableMonths.length > 0
      ? data.availableMonths
      : ['2026-10', '2026-09', '2026-08'];
    return [...new Set(list)];
  }, [data]);

  return (
    <section aria-label="Rekapitulasi Gaji dan Bagi Hasil Per Shift" style={{ marginBottom: 'var(--space-8)' }}>
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER & INTERACTIVE FILTER TOOLBAR (PER TANGGAL & BULAN)
          ───────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          marginBottom: 'var(--space-5, 20px)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 12px)',
          backgroundColor: 'var(--color-surface, #ffffff)',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05))',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '14px',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: 'var(--color-text, #111827)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <TrendingUp size={22} style={{ color: '#4f46e5' }} />
              Laporan Gaji Bagi Hasil — {data?.range.label ?? 'Memuat...'}
            </h2>
            <p style={{ color: 'var(--color-text-muted, #6b7280)', fontSize: '0.82rem', margin: '3px 0 0' }}>
              Formula Audit-Proof (50% dari Laba Bersih Snapshot Item) · Akun Manager & Dosen
            </p>
          </div>

          {/* Quick Refresh Button */}
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Muat ulang data dari database"
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            <span>Segarkan</span>
          </button>
        </div>

        {/* ── Toolbar Pengaturan Filter Periode ── */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            paddingTop: '12px',
            borderTop: '1px solid var(--color-border-light, #f1f5f9)',
          }}
        >
          {/* Mode Tabs: Bulan / Tanggal / Range / Semua */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--color-surface-alt, #f1f5f9)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
            }}
          >
            {[
              { id: 'monthly', label: '📅 Per Bulan' },
              { id: 'daily', label: '📆 Per Tanggal' },
              { id: 'range', label: '🗓️ Rentang Bebas' },
              { id: 'all', label: '🌐 Semua Waktu' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setFilterMode(m.id as typeof filterMode)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '0.8rem',
                  fontWeight: filterMode === m.id ? 700 : 500,
                  backgroundColor: filterMode === m.id ? 'var(--color-primary, #166534)' : 'transparent',
                  color: filterMode === m.id ? '#ffffff' : 'var(--color-text-muted, #475569)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Controls Khusus Berdasarkan Mode Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
            {/* MODE A: PER BULAN */}
            {filterMode === 'monthly' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="month"
                  value={selectedMonth}
                  max={currentMonthWib}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="form-input"
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.82rem',
                    minHeight: 34,
                    width: '145px',
                    fontWeight: 600,
                  }}
                  aria-label="Pilih Bulan Rekapan Gaji"
                />

                {/* Quick Month Buttons */}
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Bulan:</span>
                {availableMonths.map((m) => {
                  const [y, mm] = m.split('-');
                  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(
                    new Date(parseInt(y), parseInt(mm) - 1, 1)
                  );
                  const isCurrent = m === currentMonthWib;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMonth(m)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '99px',
                        border: selectedMonth === m ? '2px solid #166534' : '1px solid var(--color-border)',
                        backgroundColor: selectedMonth === m ? '#16653415' : 'transparent',
                        color: selectedMonth === m ? '#166534' : 'var(--color-text-secondary)',
                        fontSize: '0.78rem',
                        fontWeight: selectedMonth === m ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {monthName} {y} {isCurrent && '(Berjalan)'}
                    </button>
                  );
                })}
              </div>
            )}

            {/* MODE B: PER TANGGAL (HARIAN) */}
            {filterMode === 'daily' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => shiftDay(-1)}
                  className="btn btn-secondary btn-sm"
                  style={{ minWidth: 32, padding: '6px 8px' }}
                  title="Hari Sebelumnya"
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  max={todayWib}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="form-input"
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.82rem',
                    minHeight: 34,
                    width: '140px',
                    fontWeight: 600,
                  }}
                  aria-label="Pilih Tanggal Rekapan Gaji"
                />
                <button
                  type="button"
                  onClick={() => shiftDay(1)}
                  disabled={selectedDate >= todayWib}
                  className="btn btn-secondary btn-sm"
                  style={{ minWidth: 32, padding: '6px 8px' }}
                  title="Hari Berikutnya"
                >
                  <ChevronRight size={16} />
                </button>
                {selectedDate !== todayWib && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayWib)}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                  >
                    Hari Ini
                  </button>
                )}
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', marginLeft: 4 }}>
                  {formatTanggalWib(selectedDate)}
                </span>
              </div>
            )}

            {/* MODE C: RENTANG BEBAS */}
            {filterMode === 'range' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={rangeStart}
                  max={rangeEnd || todayWib}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="form-input"
                  style={{ padding: '6px 8px', fontSize: '0.82rem', minHeight: 34, width: '135px' }}
                  aria-label="Tanggal Mulai"
                />
                <span style={{ color: 'var(--color-text-muted)' }}>s/d</span>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart}
                  max={todayWib}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="form-input"
                  style={{ padding: '6px 8px', fontSize: '0.82rem', minHeight: 34, width: '135px' }}
                  aria-label="Tanggal Akhir"
                />
                <button
                  type="button"
                  onClick={fetchData}
                  className="btn btn-primary btn-sm"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  Terapkan
                </button>
              </div>
            )}

            {/* MODE D: SEMUA DATA */}
            {filterMode === 'all' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 12px',
                    borderRadius: '99px',
                    backgroundColor: '#e0e7ff',
                    color: '#4338ca',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                  }}
                >
                  <Sparkles size={12} /> Menampilkan seluruh transaksi historis (Agustus – Oktober 2026)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. EXECUTIVE SUMMARY METRICS (GRAND TOTAL CARDS)
          ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 'var(--space-3, 12px)',
          marginBottom: 'var(--space-5, 20px)',
        }}
      >
        {[
          {
            icon: <ShoppingBag size={18} />,
            label: 'Total Transaksi',
            value: `${grandTotal.txCount.toLocaleString('id-ID')} tx`,
            color: '#4f46e5',
            sub: `${data?.shifts.length ?? 0} shift aktif`,
          },
          {
            icon: <DollarSign size={18} />,
            label: 'Total Omzet Kasir',
            value: formatRupiah(grandTotal.omzet),
            color: '#0284c7',
            sub: 'Hasil penjualan produk',
          },
          {
            icon: <TrendingUp size={18} />,
            label: `Laba Kotor (${margin}%)`,
            value: formatRupiah(grandTotal.labaKotor),
            color: grandTotal.labaKotor >= 0 ? '#16a34a' : '#dc2626',
            sub: 'Basis pembagian bagi hasil',
          },
          {
            icon: <Users size={18} />,
            label: 'Pool Bagi Hasil (50%)',
            value: formatRupiah(grandTotal.poolGaji),
            color: '#d97706',
            sub: 'Hak seluruh mahasiswa hadir',
          },
          {
            icon: <Award size={18} />,
            label: 'Sudah Didistribusikan',
            value: formatRupiah(grandTotal.totalDistributed || 0),
            color: '#16a34a',
            sub: `${data?.summaryPerEmployee.length ?? 0} mahasiswa menerima`,
          },
          {
            icon: <Wallet size={18} />,
            label: 'Laba Bersih Toko',
            value: formatRupiah(Math.max(0, grandTotal.labaKotor - (grandTotal.totalDistributed || 0))),
            color: '#6366f1',
            sub: 'Kas toko (termasuk selisih)',
          },
        ].map((c) => (
          <div
            key={c.label}
            className="card"
            style={{
              padding: '14px 16px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 10px)',
              backgroundColor: '#ffffff',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: c.color,
                marginBottom: '6px',
              }}
            >
              <div
                style={{
                  padding: '6px',
                  borderRadius: '8px',
                  backgroundColor: `${c.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {c.icon}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                {c.label}
              </span>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', color: c.color, lineHeight: 1.2 }}>
              {c.value}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. TABS: TABEL GAJI MAHASISWA vs DATA GAJI PER SHIFT
          ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px',
          borderBottom: '2px solid var(--color-border)',
          paddingBottom: '2px',
        }}
        role="tablist"
        aria-label="Tampilan Laporan"
      >
        <button
          type="button"
          role="tab"
          id="tab-mahasiswa"
          aria-selected={mainTab === 'mahasiswa'}
          onClick={() => setMainTab('mahasiswa')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            borderBottom: mainTab === 'mahasiswa' ? '3px solid #166534' : '3px solid transparent',
            background: mainTab === 'mahasiswa' ? '#f0fdf4' : 'transparent',
            color: mainTab === 'mahasiswa' ? '#166534' : 'var(--color-text-muted)',
            fontWeight: mainTab === 'mahasiswa' ? 800 : 600,
            fontSize: '0.92rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <Award size={18} />
          <span>TABEL GAJI BAGI HASIL — SEMUA MAHASISWA ({data?.summaryPerEmployee.length ?? 0})</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-pershift"
          aria-selected={mainTab === 'shift'}
          onClick={() => setMainTab('shift')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            borderBottom: mainTab === 'shift' ? '3px solid #4f46e5' : '3px solid transparent',
            background: mainTab === 'shift' ? '#eef2ff' : 'transparent',
            color: mainTab === 'shift' ? '#4f46e5' : 'var(--color-text-muted)',
            fontWeight: mainTab === 'shift' ? 800 : 600,
            fontSize: '0.92rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <Clock size={18} />
          <span>DATA GAJI PER SHIFT ({data?.shifts.length ?? 0} Shift)</span>
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          4. LOADING & ERROR STATES
          ───────────────────────────────────────────────────────────── */}
      {loading && (
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 24px',
            gap: '12px',
          }}
        >
          <Loader2 size={32} className="spin-icon" style={{ color: '#166534' }} />
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.9rem' }}>
            Memuat data laporan produksi dan bagi hasil mahasiswa…
          </span>
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 18px',
            backgroundColor: '#fee2e2',
            border: '1px solid #f87171',
            borderRadius: '8px',
            color: '#dc2626',
            fontSize: '0.9rem',
            marginBottom: '16px',
          }}
        >
          <AlertCircle size={20} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={fetchData} className="btn btn-secondary btn-sm">
            Coba Lagi
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. TAB CONTENT 1: TABEL GAJI BAGI HASIL MAHASISWA
          ───────────────────────────────────────────────────────────── */}
      {!loading && !error && mainTab === 'mahasiswa' && (
        <div>
          {/* Header Action & Search Mahasiswa */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 280px', maxWidth: '420px' }}>
              <div className="form-input-icon" style={{ width: '100%' }}>
                <Search size={16} className="form-input-icon__icon" aria-hidden="true" />
                <input
                  className="form-input form-input-icon__input"
                  type="search"
                  value={searchMahasiswa}
                  onChange={(e) => setSearchMahasiswa(e.target.value)}
                  placeholder="Cari nama mahasiswa, NIM, atau prodi..."
                  style={{ minHeight: 38, fontSize: '0.85rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={exportLoading || filteredEmployees.length === 0}
                className="btn btn-primary btn-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: '#166534',
                  borderColor: '#166534',
                  padding: '8px 16px',
                  fontWeight: 700,
                }}
              >
                {exportLoading ? (
                  <Loader2 size={16} className="spin-icon" />
                ) : (
                  <Download size={16} />
                )}
                <span>📥 Export Rekap Gaji (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Banner Informasi Formula Bagi Hasil */}
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              padding: '10px 16px',
              fontSize: '12px',
              color: '#166534',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <BadgeCheck size={16} style={{ flexShrink: 0 }} />
            <span>
              <strong>Metodologi Paten Wiramart:</strong> 50% Laba Kotor tiap shift dibagikan rata kepada seluruh personel
              yang hadir (status <code>HADIR</code>, <code>TELAT</code>, atau <code>PENGGANTI</code>). Mahasiswa yang tidak hadir (Alpha/Ijin) otomatis Rp 0.
            </span>
          </div>

          {filteredEmployees.length === 0 ? (
            <div
              className="card"
              style={{
                textAlign: 'center',
                padding: '48px 20px',
                color: 'var(--color-text-muted)',
              }}
            >
              <Users size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                Belum ada data bagi hasil mahasiswa pada periode ini.
              </div>
              <p style={{ fontSize: '0.85rem', marginTop: '6px' }}>
                Silakan ganti filter periode ke <strong>&quot;Per Bulan&quot;</strong> (misal: Oktober 2026 atau September 2026) untuk melihat rekapitulasi gaji yang lengkap.
              </p>
            </div>
          ) : (
            <div
              className="card"
              style={{
                overflow: 'hidden',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg, 10px)',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr
                      style={{
                        backgroundColor: '#f8fafc',
                        borderBottom: '2px solid var(--color-border)',
                      }}
                    >
                      {['Peringkat', 'Nama Mahasiswa', 'NIM', 'Program Studi', 'Jabatan Utama', 'Shift Hadir', 'Hak Bagi Hasil (Rp)', 'Status'].map(
                        (h, idx) => (
                          <th
                            key={h}
                            style={{
                              padding: '12px 14px',
                              textAlign: idx >= 5 && idx <= 7 ? 'center' : idx === 6 ? 'right' : 'left',
                              color: '#475569',
                              fontWeight: 700,
                              fontSize: '11px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp, idx) => {
                      const isTop3 = idx < 3 && emp.totalNominal > 0;
                      return (
                        <tr
                          key={emp.employeeId}
                          style={{
                            borderBottom: '1px solid var(--color-border-light, #f1f5f9)',
                            backgroundColor:
                              idx === 0
                                ? '#fefce8'
                                : idx === 1
                                ? '#f8fafc'
                                : idx === 2
                                ? '#fff7ed'
                                : 'transparent',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          {/* Peringkat / Medali */}
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: '#64748b', textAlign: 'center' }}>
                            {idx === 0 ? (
                              <span title="Juara 1 Perolehan Bagi Hasil">🥇 #1</span>
                            ) : idx === 1 ? (
                              <span title="Juara 2">🥈 #2</span>
                            ) : idx === 2 ? (
                              <span title="Juara 3">🥉 #3</span>
                            ) : (
                              `#${idx + 1}`
                            )}
                          </td>

                          {/* Nama Mahasiswa */}
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--color-text)' }}>
                            {emp.fullName}
                          </td>

                          {/* NIM */}
                          <td style={{ padding: '12px 14px', fontFamily: 'monospace', color: '#475569', fontSize: '12px' }}>
                            {emp.nim}
                          </td>

                          {/* Program Studi */}
                          <td style={{ padding: '12px 14px', color: '#64748b' }}>{emp.programStudi}</td>

                          {/* Jabatan */}
                          <td style={{ padding: '12px 14px', color: '#334155', fontWeight: 500 }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                backgroundColor: '#f1f5f9',
                                fontSize: '11px',
                                fontWeight: 600,
                              }}
                            >
                              {emp.jabatan}
                            </span>
                          </td>

                          {/* Shift Hadir */}
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                backgroundColor: '#e0e7ff',
                                color: '#4338ca',
                                padding: '3px 10px',
                                borderRadius: '99px',
                                fontWeight: 800,
                                fontSize: '12px',
                              }}
                            >
                              <Clock size={11} />
                              {emp.totalHadir} shift
                            </span>
                          </td>

                          {/* Hak Gaji Bagi Hasil */}
                          <td
                            style={{
                              padding: '12px 14px',
                              textAlign: 'right',
                              fontWeight: 800,
                              fontSize: '0.98rem',
                              color: emp.totalNominal > 0 ? '#16a34a' : '#94a3b8',
                            }}
                          >
                            {formatRupiah(emp.totalNominal)}
                          </td>

                          {/* Status Audit */}
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            {emp.totalNominal > 0 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#15803d',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                <BadgeCheck size={14} /> Terverifikasi
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '11px' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr
                      style={{
                        borderTop: '2px solid var(--color-border)',
                        backgroundColor: '#f8fafc',
                      }}
                    >
                      <td colSpan={5} style={{ padding: '14px 16px', fontWeight: 800, fontSize: '0.92rem' }}>
                        TOTAL POOL GAJI DIDISTRIBUSIKAN ({filteredEmployees.length} Mahasiswa)
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 800 }}>
                        {filteredEmployees.reduce((s, e) => s + e.totalHadir, 0)} shift
                      </td>
                      <td
                        style={{
                          padding: '14px 16px',
                          textAlign: 'right',
                          fontWeight: 800,
                          fontSize: '1.1rem',
                          color: '#16a34a',
                        }}
                      >
                        {formatRupiah(filteredEmployees.reduce((s, e) => s + e.totalNominal, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          6. TAB CONTENT 2: DATA GAJI PER SHIFT (PAGI & SIANG)
          ───────────────────────────────────────────────────────────── */}
      {!loading && !error && mainTab === 'shift' && (
        <div>
          {/* Filter Sesi & Search Kasir */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            {/* Filter Sesi buttons */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {(['Semua', 'Pagi', 'Siang'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterSesi(s)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '99px',
                    border: filterSesi === s ? '2px solid #4f46e5' : '1px solid var(--color-border)',
                    background: filterSesi === s ? '#4f46e515' : 'transparent',
                    color: filterSesi === s ? '#4f46e5' : 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: filterSesi === s ? 700 : 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {s === 'Pagi' && <Sun size={14} />}
                  {s === 'Siang' && <Sunset size={14} />}
                  <span>{s === 'Semua' ? 'Semua Shift' : `Shift ${s}`}</span>
                </button>
              ))}
            </div>

            {/* Search Kasir */}
            <div style={{ width: '260px' }}>
              <input
                className="form-input"
                type="search"
                value={searchKasir}
                onChange={(e) => setSearchKasir(e.target.value)}
                placeholder="Cari kasir atau hari..."
                style={{ minHeight: 36, fontSize: '0.82rem' }}
              />
            </div>
          </div>

          {filteredShifts.length === 0 ? (
            <div
              className="card"
              style={{
                textAlign: 'center',
                padding: '48px 20px',
                color: 'var(--color-text-muted)',
              }}
            >
              <Clock size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                Tidak ada data shift pada filter ini.
              </div>
              <p style={{ fontSize: '0.85rem', marginTop: '6px' }}>
                Coba ubah tanggal atau pilih bulan yang memiliki data transaksi di bagian atas filter.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredShifts.map((s) => (
                <ShiftCard key={s.shiftId} shift={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
