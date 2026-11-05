'use client';

/**
 * RekapShift — Laporan Gaji Per Shift Wiramart (Model A — Kelompok Shift)
 *
 * Kolom Utama Tabel (Padat):
 * 1. Waktu (Pagi 07:00–11:30 | Siang 11:30–15:00)
 * 2. Shift Tgl (Hari & daftar tanggal shift berjalan sesuai filter waktu)
 * 3. Anggota Shift (Daftar personel tim shift)
 * 4. Total Personel (Jumlah anggota tim)
 * 5. Berapa Kali Shift Total (Frekuensi shift pada periode terpilih)
 * 6. Upah Bersih (Total akumulasi bagi hasil 50% tim shift)
 * 7. Panah Detail (▼) -> Menyembunyikan rincian spesifik: Berapa Transaksi, Omzet, Laba Kotor, & rincian per tanggal.
 */

import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
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
  Download,
  Search,
  Wallet,
  Award,
  Receipt,
} from 'lucide-react';
import { formatRupiah } from './shared';

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
  penaltyPercent?: number;
  roleWeight?: number;
  sessionWeight?: number;
  totalWeight?: number;
  nominalBagiHasil: number;
};

export type ShiftRow = {
  shiftId: string;
  tanggal: string; // 'YYYY-MM-DD' WIB
  hari: string;    // 'Senin', 'Selasa', ...
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
  modalAwal?: number;
  actualCash?: number | null;
  expectedCash?: number;
  discrepancy?: number | null;
  shortageDeduction?: number;
  gajiBersih?: number;
  personnelCount: number;
  nominalPerOrang: number;
  personnel: AttendeeRow[];
};

export type ScheduleTeamMember = {
  employeeId: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
};

export type EmpSummary = {
  employeeId: string;
  fullName: string;
  nim: string;
  programStudi: string;
  jabatan: string;
  totalHadir: number;
  nominalShift?: number;
  tunjanganKetua?: number;
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
    biayaOperasional?: number;
    labaOperasionalBersih?: number;
    poolGaji: number;
    tunjanganKetua?: number;
    poolShiftMahasiswa?: number;
    txCount: number;
    totalDistributed?: number;
    sisaPool?: number;
    labaBersihToko?: number;
  };
  shifts: ShiftRow[];
  summaryPerEmployee: EmpSummary[];
  scheduleTeams?: Record<string, ScheduleTeamMember[]>;
  availableMonths?: string[];
};

export type RekapShiftProps = {
  period?: PeriodKey;
  dateFrom?: string;
  dateTo?: string;
};

type DailyShiftSession = {
  sessionKey: string;
  tanggal: string;
  hari: string;
  sesi: 'Pagi' | 'Siang';
  slotLabel: string;
  clockIn: string;
  clockOut: string | null;
  kasirName: string;
  txCount: number;
  omzet: number;
  labaKotor: number;
  modalAwal?: number;
  actualCash?: number | null;
  expectedCash?: number;
  discrepancy?: number | null;
  shortageDeduction?: number;
  upahBersih: number;
  personnel: AttendeeRow[];
};

type ShiftTeamGroup = {
  groupKey: string; // e.g. 'Senin-Pagi'
  hari: string;
  dayOrder: number;
  sesi: 'Pagi' | 'Siang';
  waktuLabel: string; // '07:00–11:30' | '11:30–15:00'
  shiftTglSummary: string;
  anggotaShift: { employeeId: string; fullName: string; nim: string; jabatan: string }[];
  totalPersonel: number;
  totalShiftCount: number;
  upahBersih: number;
  totalTx: number;
  totalOmzet: number;
  totalLabaKotor: number;
  transferNote?: string;
  sessions: DailyShiftSession[];
};

// ─── Helper Functions ────────────────────────────────────────────────────────

const HARI_ORDER: Record<string, number> = {
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  Jumat: 5,
  Sabtu: 6,
  Minggu: 7,
};

const BULAN_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN_SHORT[(m ?? 1) - 1] ?? ''} ${y}`;
}

function formatGroupedDates(dates: string[]): string {
  if (dates.length === 0) return '—';
  const sorted = [...dates].sort();
  if (sorted.length === 1) {
    return formatShortDate(sorted[0]!);
  }
  const byMonth = new Map<string, number[]>();
  for (const dt of sorted) {
    const [y, m, d] = dt.split('-').map(Number);
    const key = `${BULAN_SHORT[(m ?? 1) - 1] ?? ''} ${y}`;
    const list = byMonth.get(key) ?? [];
    if (d && !list.includes(d)) list.push(d);
    byMonth.set(key, list);
  }
  const parts: string[] = [];
  for (const [mLabel, days] of byMonth.entries()) {
    parts.push(`${days.join(', ')} ${mLabel}`);
  }
  return parts.join(' · ');
}

function getTodayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RekapShift({ dateFrom: propDateFrom, dateTo: propDateTo }: RekapShiftProps) {
  const todayWib = useMemo(() => getTodayWib(), []);
  const currentMonthWib = useMemo(() => todayWib.slice(0, 7), [todayWib]);

  // Mode filter: 'monthly' | 'daily' | 'range' | 'all'
  const [filterMode, setFilterMode] = useState<'monthly' | 'daily' | 'range' | 'all'>('monthly');

  // Input states
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthWib);
  const [selectedDate, setSelectedDate] = useState<string>(propDateFrom || todayWib);
  const [rangeStart, setRangeStart] = useState<string>(propDateFrom || `${currentMonthWib}-01`);
  const [rangeEnd, setRangeEnd] = useState<string>(propDateTo || todayWib);

  // Filter tabel shift
  const [filterSesi, setFilterSesi] = useState<'Semua' | 'Pagi' | 'Siang'>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Data fetching states
  const [data, setData] = useState<PerShiftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

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

  const shiftDay = (days: number) => {
    const d = new Date(selectedDate + 'T00:00:00+07:00');
    d.setDate(d.getDate() + days);
    const nextStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
    setSelectedDate(nextStr);
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  // ─── Bangun Kelompok Shift (Model A) ──────────────────────────────────────
  const allGroups = useMemo<ShiftTeamGroup[]>(() => {
    if (!data) return [];

    // 1. Konsolidasi shift pada tanggal & sesi yang sama (jika kasir buka-tutup >1x di sesi yang sama)
    const sessionMap = new Map<string, DailyShiftSession>();
    for (const s of data.shifts) {
      // Abaikan shift akun testing / pengelola / dosen (dedewar, testing) yang tidak memiliki personel mahasiswa sah
      const kName = (s.kasirName || '').toLowerCase();
      const kNim = (s.kasirNim || '').trim();
      const isExcluded =
        kName.includes('testing') ||
        kName.includes('dede') ||
        kNim === '02405050' ||
        kNim === '02405013' ||
        kNim === '02405021' ||
        kNim === '02405015' ||
        kNim === '02405016' ||
        kNim === '00000000';

      if (s.personnelCount === 0 && isExcluded) {
        continue;
      }
      const sKey = `${s.tanggal}-${s.sesi}`;
      const gaji = s.gajiBersih !== undefined ? s.gajiBersih : (s.personnelCount > 0 ? s.poolGaji : 0);
      const existing = sessionMap.get(sKey);
      if (!existing) {
        sessionMap.set(sKey, {
          sessionKey: sKey,
          tanggal: s.tanggal,
          hari: s.hari,
          sesi: s.sesi,
          slotLabel: s.slotLabel,
          clockIn: s.clockIn,
          clockOut: s.clockOut,
          kasirName: s.kasirName,
          txCount: s.txCount,
          omzet: s.omzet,
          labaKotor: s.labaKotor,
          modalAwal: s.modalAwal,
          actualCash: s.actualCash,
          expectedCash: s.expectedCash,
          discrepancy: s.discrepancy,
          shortageDeduction: s.shortageDeduction ?? 0,
          upahBersih: gaji,
          personnel: [...s.personnel],
        });
      } else {
        existing.txCount += s.txCount;
        existing.omzet += s.omzet;
        existing.labaKotor += s.labaKotor;
        existing.upahBersih += gaji;
        if (s.shortageDeduction) {
          existing.shortageDeduction = (existing.shortageDeduction ?? 0) + s.shortageDeduction;
        }
        if (s.discrepancy !== undefined && s.discrepancy !== null) {
          existing.discrepancy = (existing.discrepancy ?? 0) + s.discrepancy;
        }
        if (s.clockOut) existing.clockOut = s.clockOut;
        for (const p of s.personnel) {
          if (!existing.personnel.some((x) => x.employeeId === p.employeeId)) {
            existing.personnel.push(p);
          }
        }
      }
    }

    // 2. Kelompokkan per (Hari, Sesi) -> misal Senin-Pagi, Senin-Siang, Selasa-Pagi, dst.
    const groupMap = new Map<string, {
      hari: string;
      sesi: 'Pagi' | 'Siang';
      sessions: DailyShiftSession[];
    }>();

    for (const sess of sessionMap.values()) {
      const gKey = `${sess.hari}-${sess.sesi}`;
      const g = groupMap.get(gKey) ?? {
        hari: sess.hari,
        sesi: sess.sesi,
        sessions: [],
      };
      g.sessions.push(sess);
      groupMap.set(gKey, g);
    }

    const scheduleTeams = data.scheduleTeams ?? {};
    const builtGroups: ShiftTeamGroup[] = [];

    for (const [gKey, g] of groupMap.entries()) {
      g.sessions.sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));

      // Anggota Shift: utamakan dari Master Jadwal Shift resmi (4 orang per slot),
      // jika tidak ada di jadwal (misal shift Sabtu), ambil gabungan personel yang hadir di sesi tersebut.
      const scheduled = scheduleTeams[gKey] ?? [];
      const memberMap = new Map<string, { employeeId: string; fullName: string; nim: string; jabatan: string }>();

      for (const m of scheduled) {
        memberMap.set(m.employeeId, {
          employeeId: m.employeeId,
          fullName: m.fullName,
          nim: m.nim,
          jabatan: m.jabatan,
        });
      }

      if (memberMap.size === 0) {
        for (const sess of g.sessions) {
          for (const p of sess.personnel) {
            const pName = (p.fullName || '').toLowerCase();
            const pNim = (p.nim || '').trim();
            // Blacklist akun testing & dede waryanto
            if (
              pName.includes('testing') ||
              pName.includes('dede') ||
              pNim === '02405013' ||
              pNim === '02405021' ||
              pNim === '02405015' ||
              pNim === '02405016' ||
              pNim === '02405050' ||
              pNim === '00000000'
            ) {
              continue;
            }
            if (!memberMap.has(p.employeeId)) {
              memberMap.set(p.employeeId, {
                employeeId: p.employeeId,
                fullName: p.fullName,
                nim: p.nim,
                jabatan: p.jabatan,
              });
            }
          }
        }
      }

      const anggotaShift = Array.from(memberMap.values());
      const dates = g.sessions.map((x) => x.tanggal);

      // Jangan tampilkan grup kosong tanpa personel sah mahasiswa (misal shift testing murni)
      if (anggotaShift.length === 0) {
        continue;
      }

      let transferNote: string | undefined;
      if (g.hari === 'Minggu') {
        transferNote = 'Upah Rp 446.758 dibagi rata ke 7 mahasiswa sah (@ Rp 63.823) & dialihkan ke shift reguler';
      } else if (g.hari === 'Sabtu') {
        transferNote = 'Upah Rp 907 dialihkan ke shift reguler Meizin (Selasa Pagi)';
      } else if (gKey === 'Senin-Pagi') {
        transferNote = '+ Termasuk alokasi shift Minggu untuk Gita A. (Rp 63.823) & Liliyana (Rp 63.823)';
      } else if (gKey === 'Senin-Siang') {
        transferNote = '+ Termasuk alokasi shift Minggu untuk Lisa, Nazila, Zaiffah (@ Rp 63.823)';
      } else if (gKey === 'Selasa-Pagi') {
        transferNote = '+ Termasuk alokasi Sabtu untuk Meizin (Rp 907) & Minggu untuk Siska (Rp 63.823)';
      }

      builtGroups.push({
        groupKey: gKey,
        hari: g.hari,
        dayOrder: HARI_ORDER[g.hari] ?? 9,
        sesi: g.sesi,
        waktuLabel: g.sesi === 'Pagi' ? '07:00–11:30' : '11:30–15:00',
        shiftTglSummary: formatGroupedDates(dates),
        anggotaShift,
        totalPersonel: anggotaShift.length,
        totalShiftCount: g.sessions.length,
        upahBersih: g.sessions.reduce((s, x) => s + x.upahBersih, 0),
        totalTx: g.sessions.reduce((s, x) => s + x.txCount, 0),
        totalOmzet: g.sessions.reduce((s, x) => s + x.omzet, 0),
        totalLabaKotor: g.sessions.reduce((s, x) => s + x.labaKotor, 0),
        transferNote,
        sessions: g.sessions,
      });
    }

    builtGroups.sort((a, b) => {
      if (a.dayOrder !== b.dayOrder) return a.dayOrder - b.dayOrder;
      return a.sesi === 'Pagi' ? -1 : 1;
    });

    return builtGroups;
  }, [data]);

  // Filter kelompok shift berdasarkan Sesi & Search
  const filteredGroups = useMemo(() => {
    let list = allGroups;
    if (filterSesi !== 'Semua') {
      list = list.filter((g) => g.sesi === filterSesi);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.hari.toLowerCase().includes(q) ||
          g.sesi.toLowerCase().includes(q) ||
          g.shiftTglSummary.toLowerCase().includes(q) ||
          g.anggotaShift.some(
            (m) => m.fullName.toLowerCase().includes(q) || m.nim.toLowerCase().includes(q)
          ) ||
          g.sessions.some(
            (s) =>
              s.tanggal.includes(q) ||
              s.kasirName.toLowerCase().includes(q) ||
              s.personnel.some((p) => p.fullName.toLowerCase().includes(q))
          )
      );
    }
    return list;
  }, [allGroups, filterSesi, searchQuery]);

  const sesiCounts = useMemo(() => {
    return {
      semua: allGroups.length,
      pagi: allGroups.filter((g) => g.sesi === 'Pagi').length,
      siang: allGroups.filter((g) => g.sesi === 'Siang').length,
    };
  }, [allGroups]);

  const tableTotals = useMemo(() => {
    return filteredGroups.reduce(
      (acc, g) => {
        acc.totalPersonel += g.totalPersonel;
        acc.totalShiftCount += g.totalShiftCount;
        acc.upahBersih += g.upahBersih;
        acc.totalTx += g.totalTx;
        acc.totalOmzet += g.totalOmzet;
        acc.totalLabaKotor += g.totalLabaKotor;
        return acc;
      },
      {
        totalPersonel: 0,
        totalShiftCount: 0,
        upahBersih: 0,
        totalTx: 0,
        totalOmzet: 0,
        totalLabaKotor: 0,
      }
    );
  }, [filteredGroups]);

  // Export Excel sesuai 6 Kolom Tabel Kelompok Shift + Detail Transaksi
  async function handleExportExcel() {
    if (!data || filteredGroups.length === 0) return;
    setExportLoading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira — Wiramart UNPERBA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Laporan Gaji Per Shift');

      ws.mergeCells('A1:H1');
      const title = ws.getCell('A1');
      title.value = 'LAPORAN GAJI BAGI HASIL PER SHIFT — WIRAMART UNPERBA';
      title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 28;

      ws.mergeCells('A2:H2');
      const sub = ws.getCell('A2');
      sub.value = `Periode: ${data.range.label} | Total Upah Bersih Shift (50%): ${formatRupiah(tableTotals.upahBersih)} | Total Transaksi: ${tableTotals.totalTx} tx`;
      sub.font = { italic: true, size: 10, color: { argb: 'FF334155' } };
      sub.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(2).height = 20;

      ws.columns = [
        { key: 'waktu', width: 22 },
        { key: 'shiftTgl', width: 32 },
        { key: 'anggota', width: 48 },
        { key: 'personel', width: 16 },
        { key: 'kaliShift', width: 18 },
        { key: 'upahBersih', width: 20 },
        { key: 'tx', width: 16 },
        { key: 'omzet', width: 20 },
      ];

      const hRow = ws.getRow(4);
      hRow.values = [
        'Waktu',
        'Shift Tgl',
        'Anggota Shift',
        'Total Personel',
        'Total Shift',
        'Upah Bersih (Rp)',
        'Total Transaksi',
        'Total Omzet (Rp)',
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      hRow.height = 24;

      filteredGroups.forEach((g, idx) => {
        const row = ws.addRow({
          waktu: `${g.sesi} (${g.waktuLabel})`,
          shiftTgl: `${g.hari} — ${g.shiftTglSummary}`,
          anggota: g.anggotaShift.map((m) => m.fullName).join(', ') + (g.transferNote ? `\n[${g.transferNote}]` : ''),
          personel: `${g.totalPersonel} Orang`,
          kaliShift: `${g.totalShiftCount}x Shift`,
          upahBersih: g.upahBersih,
          tx: `${g.totalTx} tx`,
          omzet: g.totalOmzet,
        });
        row.getCell('upahBersih').numFmt = '"Rp "#,##0';
        row.getCell('omzet').numFmt = '"Rp "#,##0';
        if (idx % 2 === 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((c: any) => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          });
        }
      });

      const totalRow = ws.addRow({
        waktu: 'TOTAL KESELURUHAN',
        shiftTgl: `${filteredGroups.length} Kelompok Shift`,
        anggota: '',
        personel: `${tableTotals.totalPersonel} Orang`,
        kaliShift: `${tableTotals.totalShiftCount}x Shift`,
        upahBersih: tableTotals.upahBersih,
        tx: `${tableTotals.totalTx} tx`,
        omzet: tableTotals.totalOmzet,
      });
      totalRow.getCell('upahBersih').numFmt = '"Rp "#,##0';
      totalRow.getCell('omzet').numFmt = '"Rp "#,##0';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totalRow.eachCell((c: any) => {
        c.font = { bold: true, size: 11 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      });
      totalRow.height = 24;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Gaji_Per_Shift_Wiramart_${data.range.startDate}_sd_${data.range.endDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor Excel.');
    } finally {
      setExportLoading(false);
    }
  }

  const grandTotal = data?.grandTotal ?? {
    omzet: 0,
    labaKotor: 0,
    biayaOperasional: 0,
    labaOperasionalBersih: 0,
    poolGaji: 0,
    txCount: 0,
    totalDistributed: 0,
    sisaPool: 0,
    labaBersihToko: 0,
  };

  const margin =
    grandTotal.omzet > 0 ? Math.round((grandTotal.labaKotor / grandTotal.omzet) * 100) : 0;

  const availableMonths = useMemo(() => {
    const list =
      data?.availableMonths && data.availableMonths.length > 0
        ? data.availableMonths
        : ['2026-10', '2026-09', '2026-08'];
    return [...new Set(list)];
  }, [data]);

  return (
    <section
      aria-label="Laporan Gaji Bagi Hasil Per Shift Wiramart"
      style={{ marginBottom: 'var(--space-8)' }}
    >
      <style>{`
        .rs-kpi-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }
        .rs-desktop-table {
          display: block;
        }
        .rs-mobile-list {
          display: none;
        }
        .rs-toolbar-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 12px;
        }
        .rs-search-box {
          flex: 1 1 240px;
          max-width: 360px;
        }
        @media (max-width: 1100px) {
          .rs-kpi-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 768px) {
          .rs-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .rs-desktop-table {
            display: none;
          }
          .rs-mobile-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .rs-search-box {
            max-width: 100%;
            width: 100%;
            order: 3;
          }
        }
      `}</style>

      {/* ─────────────────────────────────────────────────────────────
          1. HEADER & FILTER PERIODE TOOLBAR
          ───────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '14px 16px',
          marginBottom: '14px',
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
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.12rem',
                fontWeight: 800,
                color: 'var(--color-text, #111827)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <TrendingUp size={20} style={{ color: '#166534', flexShrink: 0 }} />
              <span>Laporan Gaji Per Shift Wiramart — {data?.range.label ?? 'Memuat...'}</span>
            </h2>
            <p
              style={{
                color: 'var(--color-text-muted, #6b7280)',
                fontSize: '0.78rem',
                margin: '2px 0 0',
              }}
            >
              Rekapitulasi Upah Bersih per Kelompok Shift · Klik baris untuk melihat jumlah transaksi & rincian tanggal
            </p>
          </div>

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Muat ulang data"
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            <span>Segarkan</span>
          </button>
        </div>

        {/* Filter Mode & Controls */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
            paddingTop: '10px',
            borderTop: '1px solid var(--color-border-light, #f1f5f9)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              flexWrap: 'nowrap',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: 2,
              maxWidth: '100%',
            }}
          >
            {[
              { id: 'monthly', label: 'Per Bulan' },
              { id: 'daily', label: 'Per Tanggal' },
              { id: 'range', label: 'Rentang Bebas' },
              { id: 'all', label: 'Semua Waktu' },
            ].map((m) => {
              const isActive = filterMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFilterMode(m.id as typeof filterMode)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 100,
                    border: isActive
                      ? '1.5px solid var(--color-primary, #166534)'
                      : '1.5px solid #e2e8f0',
                    background: isActive ? 'var(--color-primary, #166534)' : '#f8fafc',
                    color: isActive ? '#ffffff' : 'var(--color-text-muted, #475569)',
                    fontSize: '0.78rem',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
            {filterMode === 'monthly' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="month"
                  value={selectedMonth}
                  max={currentMonthWib}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="form-input"
                  style={{
                    padding: '5px 8px',
                    fontSize: '0.8rem',
                    minHeight: 32,
                    width: '138px',
                    fontWeight: 600,
                  }}
                  aria-label="Pilih Bulan"
                />
                {availableMonths.map((m) => {
                  const [y, mm] = m.split('-');
                  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(
                    new Date(parseInt(y, 10), parseInt(mm, 10) - 1, 1)
                  );
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMonth(m)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '99px',
                        border:
                          selectedMonth === m
                            ? '1.5px solid #166534'
                            : '1px solid var(--color-border)',
                        backgroundColor: selectedMonth === m ? '#16653415' : 'transparent',
                        color: selectedMonth === m ? '#166534' : 'var(--color-text-secondary)',
                        fontSize: '0.75rem',
                        fontWeight: selectedMonth === m ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {monthName} {y}
                    </button>
                  );
                })}
              </div>
            )}

            {filterMode === 'daily' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => shiftDay(-1)}
                  className="btn btn-secondary btn-sm"
                  style={{ minWidth: 30, padding: '5px 7px' }}
                  title="Hari Sebelumnya"
                >
                  <ChevronLeft size={15} />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  max={todayWib}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="form-input"
                  style={{
                    padding: '5px 8px',
                    fontSize: '0.8rem',
                    minHeight: 32,
                    width: '135px',
                    fontWeight: 600,
                  }}
                  aria-label="Pilih Tanggal"
                />
                <button
                  type="button"
                  onClick={() => shiftDay(1)}
                  disabled={selectedDate >= todayWib}
                  className="btn btn-secondary btn-sm"
                  style={{ minWidth: 30, padding: '5px 7px' }}
                  title="Hari Berikutnya"
                >
                  <ChevronRight size={15} />
                </button>
                {selectedDate !== todayWib && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayWib)}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.75rem', padding: '4px 9px' }}
                  >
                    Hari Ini
                  </button>
                )}
              </div>
            )}

            {filterMode === 'range' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={rangeStart}
                  max={rangeEnd || todayWib}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="form-input"
                  style={{ padding: '5px 8px', fontSize: '0.8rem', minHeight: 32, width: '130px' }}
                  aria-label="Tanggal Mulai"
                />
                <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>s/d</span>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart}
                  max={todayWib}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="form-input"
                  style={{ padding: '5px 8px', fontSize: '0.8rem', minHeight: 32, width: '130px' }}
                  aria-label="Tanggal Akhir"
                />
              </div>
            )}

            {filterMode === 'all' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: '99px',
                  backgroundColor: '#f0fdf4',
                  color: '#166534',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                Seluruh Riwayat Operasional (Agustus – Oktober 2026)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. RINGKASAN EKSEKUTIF (KPI CARDS)
          ───────────────────────────────────────────────────────────── */}
      <div className="rs-kpi-grid">
        {[
          {
            icon: <ShoppingBag size={16} />,
            label: 'Transaksi',
            value: `${grandTotal.txCount.toLocaleString('id-ID')} tx`,
            color: '#4f46e5',
            sub: `${tableTotals.totalShiftCount}x shift berjalan`,
          },
          {
            icon: <DollarSign size={16} />,
            label: 'Total Omzet',
            value: formatRupiah(grandTotal.omzet),
            color: '#0284c7',
            sub: 'Penjualan produk',
          },
          {
            icon: <TrendingUp size={16} />,
            label: `Laba Kotor (${margin}%)`,
            value: formatRupiah(grandTotal.labaKotor),
            color: '#16a34a',
            sub: 'Selisih jual & HPP',
          },
          {
            icon: <Receipt size={16} />,
            label: 'Beban Toko',
            value: formatRupiah(grandTotal.biayaOperasional || 0),
            color: '#dc2626',
            sub: 'Paten Rp 50rb/bln',
          },
          {
            icon: <Award size={16} />,
            label: 'Total Upah Shift',
            value: formatRupiah(grandTotal.totalDistributed || 0),
            color: '#15803d',
            sub: `${allGroups.length} kelompok shift`,
          },
          {
            icon: <Wallet size={16} />,
            label: 'Kas Toko (50%)',
            value: formatRupiah(grandTotal.labaBersihToko || 0),
            color: '#4338ca',
            sub: 'Laba bersih toko',
          },
        ].map((c) => (
          <div
            key={c.label}
            className="card"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: '10px',
              backgroundColor: '#ffffff',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: c.color,
                marginBottom: '4px',
              }}
            >
              <div
                style={{
                  padding: '4px',
                  borderRadius: '6px',
                  backgroundColor: `${c.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {c.icon}
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.label}
              </span>
            </div>
            <div
              style={{
                fontWeight: 800,
                fontSize: '1rem',
                color: c.color,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {c.value}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '3px' }}>
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. TOOLBAR TABEL: FILTER SESI, PENCARIAN & EXPORT EXCEL
          ───────────────────────────────────────────────────────────── */}
      <div className="rs-toolbar-actions">
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {(
            [
              { key: 'Semua', label: `Semua Shift (${sesiCounts.semua})` },
              { key: 'Pagi', label: `Pagi (${sesiCounts.pagi})` },
              { key: 'Siang', label: `Siang (${sesiCounts.siang})` },
            ] as const
          ).map((item) => {
            const active = filterSesi === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilterSesi(item.key)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '99px',
                  border: active ? '1.5px solid #166534' : '1px solid var(--color-border)',
                  background: active ? '#f0fdf4' : '#ffffff',
                  color: active ? '#166534' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: active ? 700 : 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                {item.key === 'Pagi' && <Sun size={13} style={{ color: '#d97706' }} />}
                {item.key === 'Siang' && <Sunset size={13} style={{ color: '#4f46e5' }} />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="rs-search-box">
          <div className="form-input-icon" style={{ width: '100%' }}>
            <Search size={15} className="form-input-icon__icon" aria-hidden="true" />
            <input
              className="form-input form-input-icon__input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari hari, tanggal, atau nama anggota shift..."
              style={{ minHeight: 34, fontSize: '0.8rem' }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportExcel}
          disabled={exportLoading || filteredGroups.length === 0}
          className="btn btn-primary btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: '#166534',
            borderColor: '#166534',
            padding: '7px 14px',
            fontWeight: 700,
            fontSize: '0.78rem',
          }}
        >
          {exportLoading ? <Loader2 size={14} className="spin-icon" /> : <Download size={14} />}
          <span>Export Shift (.xlsx)</span>
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
            padding: '40px 20px',
            gap: '10px',
          }}
        >
          <Loader2 size={28} className="spin-icon" style={{ color: '#166534' }} />
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.85rem' }}>
            Memuat laporan gaji per shift Wiramart...
          </span>
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            backgroundColor: '#fee2e2',
            border: '1px solid #f87171',
            borderRadius: '8px',
            color: '#dc2626',
            fontSize: '0.85rem',
            marginBottom: '14px',
          }}
        >
          <AlertCircle size={18} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={fetchData} className="btn btn-secondary btn-sm">
            Coba Lagi
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. TABEL UTAMA: 6 KOLOM PADAT + DETAIL TRANSAKSI (▼)
          ───────────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <>
          {filteredGroups.length === 0 ? (
            <div
              className="card"
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--color-text-muted)',
              }}
            >
              <Clock size={36} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text)' }}>
                Tidak ada data shift pada filter waktu ini.
              </div>
              <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                Silakan pilih bulan atau tanggal lain yang memiliki riwayat operasional.
              </p>
            </div>
          ) : (
            <>
              {/* ── A. DESKTOP TABLE (6 KOLOM + PANAH ▼) ── */}
              <div
                className="card rs-desktop-table"
                style={{
                  overflow: 'hidden',
                  border: '1px solid var(--color-border)',
                  borderRadius: '10px',
                  backgroundColor: '#ffffff',
                }}
              >
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12.5px',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          backgroundColor: '#f8fafc',
                          borderBottom: '2px solid var(--color-border)',
                        }}
                      >
                        {[
                          { label: 'Waktu', align: 'left' },
                          { label: 'Shift Tgl', align: 'left' },
                          { label: 'Anggota Shift', align: 'left' },
                          { label: 'Total Personel', align: 'center' },
                          { label: 'Berapa Kali Shift Total', align: 'center' },
                          { label: 'Upah Bersih', align: 'right' },
                          { label: '', align: 'center' },
                        ].map((col, idx) => (
                          <th
                            key={col.label || idx}
                            style={{
                              padding: '11px 14px',
                              textAlign: col.align as 'left' | 'center' | 'right',
                              color: '#475569',
                              fontWeight: 700,
                              fontSize: '11px',
                              textTransform: 'uppercase',
                              letterSpacing: '0.03em',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGroups.map((g) => {
                        const isPagi = g.sesi === 'Pagi';
                        const isExpanded = !!expandedGroups[g.groupKey];

                        return (
                          <Fragment key={g.groupKey}>
                            <tr
                              onClick={() => toggleGroup(g.groupKey)}
                              style={{
                                borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                                backgroundColor: isExpanded ? '#f0fdf4' : '#ffffff',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease',
                              }}
                            >
                              {/* 1. Waktu */}
                              <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '4px 10px',
                                    borderRadius: '99px',
                                    fontSize: '11.5px',
                                    fontWeight: 800,
                                    backgroundColor: isPagi ? '#fef3c7' : '#e0e7ff',
                                    color: isPagi ? '#b45309' : '#4338ca',
                                  }}
                                >
                                  {isPagi ? <Sun size={13} /> : <Sunset size={13} />}
                                  <span>{g.sesi}</span>
                                </span>
                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: '#64748b',
                                    fontWeight: 600,
                                    marginTop: '3px',
                                    paddingLeft: '4px',
                                  }}
                                >
                                  {g.waktuLabel} WIB
                                </div>
                              </td>

                              {/* 2. Shift Tgl */}
                              <td style={{ padding: '12px 14px', minWidth: '170px', maxWidth: '250px' }}>
                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                                  Shift {g.hari}
                                </div>
                                <div
                                  style={{
                                    fontSize: '11.5px',
                                    color: '#475569',
                                    marginTop: '2px',
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {g.shiftTglSummary}
                                </div>
                              </td>

                              {/* 3. Anggota Shift */}
                              <td style={{ padding: '12px 14px', minWidth: '260px', maxWidth: '400px' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                  {g.anggotaShift.map((m) => (
                                    <span
                                      key={m.employeeId}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        padding: '3px 9px',
                                        borderRadius: '6px',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        backgroundColor: '#f8fafc',
                                        color: '#1e293b',
                                        border: '1px solid #e2e8f0',
                                      }}
                                      title={`${m.fullName} (${m.nim}) — ${m.jabatan}`}
                                    >
                                      {m.fullName}
                                    </span>
                                  ))}
                                </div>
                                {g.transferNote && (
                                  <div
                                    style={{
                                      marginTop: '6px',
                                      fontSize: '11px',
                                      color: g.hari === 'Minggu' || g.hari === 'Sabtu' ? '#0369a1' : '#15803d',
                                      backgroundColor: g.hari === 'Minggu' || g.hari === 'Sabtu' ? '#f0f9ff' : '#f0fdf4',
                                      border: `1px solid ${g.hari === 'Minggu' || g.hari === 'Sabtu' ? '#bae6fd' : '#bbf7d0'}`,
                                      borderRadius: '6px',
                                      padding: '3px 8px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      lineHeight: 1.3,
                                    }}
                                  >
                                    ℹ️ {g.transferNote}
                                  </div>
                                )}
                              </td>

                              {/* 4. Total Personel */}
                              <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 10px',
                                    borderRadius: '99px',
                                    backgroundColor: '#f1f5f9',
                                    color: '#334155',
                                    fontWeight: 700,
                                    fontSize: '12px',
                                  }}
                                >
                                  <Users size={12} />
                                  {g.totalPersonel} Orang
                                </span>
                              </td>

                              {/* 5. Berapa Kali Shift Total */}
                              <td style={{ padding: '12px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 11px',
                                    borderRadius: '99px',
                                    backgroundColor: '#e0e7ff',
                                    color: '#4338ca',
                                    fontWeight: 800,
                                    fontSize: '12px',
                                  }}
                                >
                                  <Clock size={12} />
                                  {g.totalShiftCount}x Shift
                                </span>
                              </td>

                              {/* 6. Upah Bersih */}
                              <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '4px 12px',
                                    borderRadius: '8px',
                                    backgroundColor: g.upahBersih > 0 ? '#dcfce7' : '#f1f5f9',
                                    color: g.upahBersih > 0 ? '#15803d' : '#94a3b8',
                                    fontWeight: 800,
                                    fontSize: '13.5px',
                                  }}
                                >
                                  {formatRupiah(g.upahBersih)}
                                </span>
                              </td>

                              {/* 7. Panah Detail (▼) */}
                              <td style={{ padding: '12px 14px', textAlign: 'center', width: '44px' }}>
                                <button
                                  type="button"
                                  aria-label="Lihat rincian transaksi shift"
                                  aria-expanded={isExpanded}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleGroup(g.groupKey);
                                  }}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    backgroundColor: isExpanded ? '#166534' : '#ffffff',
                                    color: isExpanded ? '#ffffff' : '#475569',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </button>
                              </td>
                            </tr>

                            {/* ── KOTAK RINCIAN SPESIFIK (TERSEMBUNYI DI BALIK PANAH ▼) ── */}
                            {isExpanded && (
                              <tr style={{ borderBottom: '2px solid #cbd5e1', backgroundColor: '#f8fafc' }}>
                                <td colSpan={7} style={{ padding: '14px 20px' }}>
                                  {/* Ringkasan Spesifik Transaksi Kelompok Shift */}
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                                      gap: '10px',
                                      marginBottom: '12px',
                                      padding: '10px 14px',
                                      backgroundColor: '#ffffff',
                                      borderRadius: '8px',
                                      border: '1px solid #e2e8f0',
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Total Transaksi Shift Ini
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#4f46e5' }}>
                                        {g.totalTx.toLocaleString('id-ID')} Transaksi
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Total Omzet Shift Ini
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0284c7' }}>
                                        {formatRupiah(g.totalOmzet)}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Total Laba Kotor Shift Ini
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>
                                        {formatRupiah(g.totalLabaKotor)}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Rata-rata Upah per Pertemuan
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#15803d' }}>
                                        {formatRupiah(
                                          g.totalShiftCount > 0
                                            ? Math.round(g.upahBersih / g.totalShiftCount)
                                            : 0
                                        )}{' '}
                                        / shift
                                      </div>
                                    </div>
                                  </div>

                                  {/* Sub-tabel Rincian Per Tanggal Shift */}
                                  <div
                                    style={{
                                      borderRadius: '8px',
                                      border: '1px solid #e2e8f0',
                                      overflow: 'hidden',
                                      backgroundColor: '#ffffff',
                                    }}
                                  >
                                    <table
                                      style={{
                                        width: '100%',
                                        borderCollapse: 'collapse',
                                        fontSize: '12px',
                                      }}
                                    >
                                      <thead>
                                        <tr
                                          style={{
                                            backgroundColor: '#f1f5f9',
                                            borderBottom: '1px solid #e2e8f0',
                                          }}
                                        >
                                          <th style={{ padding: '8px 12px', textAlign: 'center', width: '40px', color: '#475569' }}>
                                            #
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#475569' }}>
                                            Tanggal Shift
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#475569' }}>
                                            Jam Buka – Tutup
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#475569' }}>
                                            Kasir & Catatan Kehadiran
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'center', color: '#475569' }}>
                                            Berapa Transaksi
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>
                                            Omzet
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>
                                            Laba Kotor
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'center', color: '#475569' }}>
                                            Selisih Laci
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>
                                            Upah Bersih
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {g.sessions.map((sess, sIdx) => (
                                          <tr
                                            key={sess.sessionKey}
                                            style={{
                                              borderBottom:
                                                sIdx < g.sessions.length - 1
                                                  ? '1px solid #f1f5f9'
                                                  : 'none',
                                            }}
                                          >
                                            <td style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b' }}>
                                              {sIdx + 1}
                                            </td>
                                            <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>
                                              {sess.hari}, {formatShortDate(sess.tanggal)}
                                            </td>
                                            <td style={{ padding: '8px 12px', color: '#475569' }}>
                                              {formatTime(sess.clockIn)} –{' '}
                                              {sess.clockOut ? formatTime(sess.clockOut) : 'Aktif'} WIB
                                            </td>
                                            <td style={{ padding: '8px 12px', color: '#334155' }}>
                                              <span style={{ fontWeight: 600 }}>Kasir: {sess.kasirName}</span>
                                              {sess.personnel.some((p) => p.lateMinutes > 0) && (
                                                <span style={{ marginLeft: '6px', color: '#d97706', fontSize: '11px', fontWeight: 600 }}>
                                                  (Telat:{' '}
                                                  {sess.personnel
                                                    .filter((p) => p.lateMinutes > 0)
                                                    .map((p) => `${p.fullName} +${p.lateMinutes}m`)
                                                    .join(', ')}
                                                  )
                                                </span>
                                              )}
                                            </td>
                                            <td
                                              style={{
                                                padding: '8px 12px',
                                                textAlign: 'center',
                                                fontWeight: 700,
                                                color: '#4f46e5',
                                              }}
                                            >
                                              {sess.txCount} tx
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0f172a' }}>
                                              {formatRupiah(sess.omzet)}
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0284c7', fontWeight: 600 }}>
                                              {formatRupiah(sess.labaKotor)}
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                              {sess.shortageDeduction && sess.shortageDeduction > 0 ? (
                                                <span
                                                  style={{
                                                    display: 'inline-flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    padding: '2px 8px',
                                                    borderRadius: '6px',
                                                    backgroundColor: '#fef2f2',
                                                    border: '1px solid #fecaca',
                                                    color: '#dc2626',
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                  }}
                                                >
                                                  <span>-{formatRupiah(sess.shortageDeduction)}</span>
                                                  <span style={{ fontSize: '9px', fontWeight: 600 }}>Potong Tekor</span>
                                                </span>
                                              ) : sess.discrepancy !== undefined && sess.discrepancy !== null ? (
                                                sess.discrepancy > 2000 ? (
                                                  <span
                                                    style={{
                                                      padding: '2px 8px',
                                                      borderRadius: '6px',
                                                      backgroundColor: '#eff6ff',
                                                      border: '1px solid #bfdbfe',
                                                      color: '#2563eb',
                                                      fontSize: '11px',
                                                      fontWeight: 700,
                                                    }}
                                                  >
                                                    +{formatRupiah(sess.discrepancy)}
                                                  </span>
                                                ) : (
                                                  <span
                                                    style={{
                                                      padding: '2px 8px',
                                                      borderRadius: '6px',
                                                      backgroundColor: '#f0fdf4',
                                                      border: '1px solid #bbf7d0',
                                                      color: '#16a34a',
                                                      fontSize: '11px',
                                                      fontWeight: 600,
                                                    }}
                                                  >
                                                    Klop (Rp 0)
                                                  </span>
                                                )
                                              ) : (
                                                <span style={{ color: '#94a3b8', fontSize: '11px' }}>—</span>
                                              )}
                                            </td>
                                            <td
                                              style={{
                                                padding: '8px 12px',
                                                textAlign: 'right',
                                                fontWeight: 800,
                                                color: '#15803d',
                                              }}
                                            >
                                              {formatRupiah(sess.upahBersih)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
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
                        <td
                          colSpan={3}
                          style={{
                            padding: '12px 14px',
                            fontWeight: 800,
                            fontSize: '12.5px',
                            color: '#0f172a',
                          }}
                        >
                          TOTAL KESELURUHAN ({filteredGroups.length} Kelompok Shift · {tableTotals.totalTx} Transaksi)
                        </td>
                        <td
                          style={{
                            padding: '12px 14px',
                            textAlign: 'center',
                            fontWeight: 800,
                            color: '#334155',
                          }}
                        >
                          {tableTotals.totalPersonel} Orang
                        </td>
                        <td
                          style={{
                            padding: '12px 14px',
                            textAlign: 'center',
                            fontWeight: 800,
                            color: '#4338ca',
                          }}
                        >
                          {tableTotals.totalShiftCount}x Shift
                        </td>
                        <td
                          style={{
                            padding: '12px 14px',
                            textAlign: 'right',
                            fontWeight: 800,
                            fontSize: '14px',
                            color: '#15803d',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatRupiah(tableTotals.upahBersih)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* ── B. MOBILE HP COMPACT CARDS (<= 768px) ── */}
              <div className="rs-mobile-list">
                {filteredGroups.map((g) => {
                  const isPagi = g.sesi === 'Pagi';
                  const isExpanded = !!expandedGroups[g.groupKey];

                  return (
                    <div
                      key={g.groupKey}
                      className="card"
                      style={{
                        borderRadius: '10px',
                        border: isExpanded
                          ? '1.5px solid #166534'
                          : '1px solid var(--color-border)',
                        backgroundColor: '#ffffff',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        onClick={() => toggleGroup(g.groupKey)}
                        style={{ padding: '12px', cursor: 'pointer' }}
                      >
                        {/* Baris 1: Shift Tgl (Hari) & Waktu Sesi */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '8px',
                            marginBottom: '6px',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                              Shift {g.hari}
                            </div>
                            <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
                              Tgl: {g.shiftTglSummary}
                            </div>
                          </div>

                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 9px',
                              borderRadius: '99px',
                              fontSize: '11px',
                              fontWeight: 800,
                              backgroundColor: isPagi ? '#fef3c7' : '#e0e7ff',
                              color: isPagi ? '#b45309' : '#4338ca',
                              flexShrink: 0,
                            }}
                          >
                            {isPagi ? <Sun size={11} /> : <Sunset size={11} />}
                            <span>
                              {g.sesi} ({g.waktuLabel})
                            </span>
                          </span>
                        </div>

                        {/* Baris 2: Anggota Shift */}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '4px',
                            marginBottom: '10px',
                          }}
                        >
                          {g.anggotaShift.map((m) => (
                            <span
                              key={m.employeeId}
                              style={{
                                padding: '2px 7px',
                                borderRadius: '5px',
                                fontSize: '10.5px',
                                fontWeight: 600,
                                backgroundColor: '#f1f5f9',
                                color: '#1e293b',
                              }}
                            >
                              {m.fullName}
                            </span>
                          ))}
                        </div>
                        {g.transferNote && (
                          <div
                            style={{
                              marginBottom: '8px',
                              fontSize: '10.5px',
                              color: g.hari === 'Minggu' || g.hari === 'Sabtu' ? '#0369a1' : '#15803d',
                              backgroundColor: g.hari === 'Minggu' || g.hari === 'Sabtu' ? '#f0f9ff' : '#f0fdf4',
                              border: `1px solid ${g.hari === 'Minggu' || g.hari === 'Sabtu' ? '#bae6fd' : '#bbf7d0'}`,
                              borderRadius: '6px',
                              padding: '3px 8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              lineHeight: 1.3,
                            }}
                          >
                            ℹ️ {g.transferNote}
                          </div>
                        )}

                        {/* Baris 3: Total Personel | Berapa Kali Shift | Upah Bersih + Panah ▼ */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '0.9fr 0.9fr 1.2fr auto',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 600 }}>
                              Total Personel
                            </div>
                            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#0f172a' }}>
                              {g.totalPersonel} Orang
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 600 }}>
                              Total Shift
                            </div>
                            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#4338ca' }}>
                              {g.totalShiftCount}x Shift
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '9.5px', color: '#166534', fontWeight: 700 }}>
                              Upah Bersih
                            </div>
                            <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#15803d' }}>
                              {formatRupiah(g.upahBersih)}
                            </div>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              backgroundColor: isExpanded ? '#166534' : '#e2e8f0',
                              color: isExpanded ? '#ffffff' : '#334155',
                            }}
                          >
                            {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          </div>
                        </div>
                      </div>

                      {/* Rincian Transaksi Tersembunyi di Mobile HP */}
                      {isExpanded && (
                        <div
                          style={{
                            padding: '10px 12px 12px',
                            backgroundColor: '#f8fafc',
                            borderTop: '1px solid #e2e8f0',
                          }}
                        >
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr 1fr',
                              gap: '6px',
                              marginBottom: '8px',
                              padding: '7px 9px',
                              backgroundColor: '#ffffff',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              fontSize: '11px',
                            }}
                          >
                            <div>
                              <div style={{ fontSize: '9.5px', color: '#64748b' }}>Transaksi</div>
                              <div style={{ fontWeight: 800, color: '#4f46e5' }}>{g.totalTx} tx</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '9.5px', color: '#64748b' }}>Total Omzet</div>
                              <div style={{ fontWeight: 700, color: '#0284c7' }}>
                                {formatRupiah(g.totalOmzet)}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '9.5px', color: '#64748b' }}>Laba Kotor</div>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>
                                {formatRupiah(g.totalLabaKotor)}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {g.sessions.map((sess, idx) => (
                              <div
                                key={sess.sessionKey}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '6px 9px',
                                  borderRadius: '6px',
                                  backgroundColor: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '11px',
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 700, color: '#0f172a' }}>
                                    #{idx + 1} · {formatShortDate(sess.tanggal)} ({sess.txCount} tx)
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#64748b' }}>
                                    Kasir: {sess.kasirName} · Omzet {formatRupiah(sess.omzet)}
                                    {sess.shortageDeduction && sess.shortageDeduction > 0 ? (
                                      <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: '6px' }}>
                                        · Tekor -{formatRupiah(sess.shortageDeduction)} (Potong)
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <div style={{ fontWeight: 800, color: '#15803d', fontSize: '11.5px' }}>
                                  {formatRupiah(sess.upahBersih)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Footer Total di Mobile */}
                <div
                  className="card"
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    backgroundColor: '#f0fdf4',
                    border: '1.5px solid #86efac',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#166534' }}>
                      TOTAL ({filteredGroups.length} Kelompok · {tableTotals.totalShiftCount}x Shift)
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#15803d' }}>
                      {tableTotals.totalTx} Transaksi · Omzet {formatRupiah(tableTotals.totalOmzet)}
                    </div>
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#15803d' }}>
                    {formatRupiah(tableTotals.upahBersih)}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
