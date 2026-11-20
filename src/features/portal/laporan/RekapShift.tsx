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
  Copy,
  Check,
  Printer,
} from 'lucide-react';
import { formatRupiah } from './shared';
import type { PeriodKey as ReportPeriodKey } from '@/lib/finance/report';
import { useTableSelection } from '@/hooks/useTableSelection';
import { SelectAllCheckbox, SelectedRowsBar } from '@/components/admin/SelectedRowsBar';
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
  exportSelectedRowsToExcel,
  formatWibDateTime,
  sanitizeExcelText,
  styleBannerBlock,
  toSafeExcelNum,
  todayWibSlug,
} from '@/lib/utils/exportSelectedExcel';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PeriodKey = ReportPeriodKey;

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
  auditFlags?: string | null;
  notes?: string | null;
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
  auditFlags?: string | null;
  notes?: string | null;
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
  const selection = useTableSelection();

  // Mode filter: 'monthly' | 'daily' | 'range' | 'october' | 'november' | 'oct_nov' | 'all'
  const [filterMode, setFilterMode] = useState<
    'monthly' | 'daily' | 'range' | 'october' | 'november' | 'oct_nov' | 'all'
  >(propDateFrom && propDateTo ? 'range' : 'monthly');

  // Input states
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthWib);
  const [selectedDate, setSelectedDate] = useState<string>(propDateFrom || todayWib);
  const [rangeStart, setRangeStart] = useState<string>(propDateFrom || `${currentMonthWib}-01`);
  const [rangeEnd, setRangeEnd] = useState<string>(propDateTo || todayWib);

  // Filter tabel shift
  const [filterSesi, setFilterSesi] = useState<'Semua' | 'Pagi' | 'Siang'>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Data fetching states (derived loading untuk menghindari setState sinkron di dalam useEffect)
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadedState, setLoadedState] = useState<{
    key: string;
    data: PerShiftData | null;
    error: string;
  } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [copiedSlipKey, setCopiedSlipKey] = useState<string | null>(null);

  function computeGroupMemberBreakdown(g: ShiftTeamGroup) {
    const map = new Map<
      string,
      { fullName: string; nim: string; jabatan: string; hadir: number; telatMenit: number; nominal: number }
    >();
    for (const sess of g.sessions) {
      for (const p of sess.personnel) {
        const cur = map.get(p.employeeId) ?? {
          fullName: p.fullName,
          nim: p.nim,
          jabatan: p.jabatan,
          hadir: 0,
          telatMenit: 0,
          nominal: 0,
        };
        cur.hadir += 1;
        cur.telatMenit += p.lateMinutes || 0;
        cur.nominal += p.nominalBagiHasil || 0;
        map.set(p.employeeId, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.nominal - a.nominal || a.fullName.localeCompare(b.fullName));
  }

  function buildGroupSlipWaText(g: ShiftTeamGroup): string {
    const periodLabel = data?.range.label ?? '-';
    const members = computeGroupMemberBreakdown(g);
    const lines = [
      `SLIP GAJI KELOMPOK SHIFT - WIRAMART UNPERBA`,
      `Periode: ${periodLabel}`,
      `Kelompok: ${g.hari} ${g.sesi} (${g.waktuLabel} WIB)`,
      `Tanggal Shift: ${g.shiftTglSummary || '-'} (${g.totalShiftCount}x pertemuan)`,
      `Total Transaksi: ${g.totalTx} | Omzet: ${formatRupiah(g.totalOmzet)} | Laba Kotor: ${formatRupiah(g.totalLabaKotor)}`,
      `Total Upah Tim (50%): ${formatRupiah(g.upahBersih)}`,
      ``,
      `Rincian Per Anggota:`,
      ...members.map(
        (m, idx) =>
          `${idx + 1}. ${m.fullName} (${m.hadir}x hadir${m.telatMenit > 0 ? `, telat ${m.telatMenit} mnt` : ''}) = ${formatRupiah(m.nominal)}`,
      ),
    ];
    return lines.join('\n');
  }

  function buildAllShiftsWaText(): string {
    const periodLabel = data?.range.label ?? '-';
    const lines: string[] = [
      `REKAP GAJI BULANAN PER SHIFT - WIRAMART UNPERBA`,
      `Periode: ${periodLabel}`,
      `Total Pool Gaji Mahasiswa (50%): ${formatRupiah(data?.grandTotal.poolGaji ?? 0)}`,
      `========================================`,
    ];
    for (const g of filteredGroups) {
      const members = computeGroupMemberBreakdown(g);
      lines.push(`\n[${g.hari} ${g.sesi}] ${g.totalShiftCount}x shift | Total Tim: ${formatRupiah(g.upahBersih)}`);
      for (const m of members) {
        lines.push(`- ${m.fullName} (${m.hadir}x): ${formatRupiah(m.nominal)}`);
      }
    }
    if (data?.summaryPerEmployee && data.summaryPerEmployee.length > 0) {
      lines.push(`\n========================================`);
      lines.push(`TOTAL DITERIMA PER MAHASISWA (TERMASUK DOBEL SHIFT):`);
      data.summaryPerEmployee.forEach((emp, i) => {
        lines.push(`${i + 1}. ${emp.fullName} (${emp.totalHadir}x hadir): ${formatRupiah(emp.totalNominal)}`);
      });
    }
    return lines.join('\n');
  }

  async function handleCopySlip(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSlipKey(key);
      window.setTimeout(() => setCopiedSlipKey((prev) => (prev === key ? null : prev)), 2500);
    } catch {
      window.alert('Gagal menyalin teks ke clipboard browser.');
    }
  }

  function handlePrintGroupSlip(g: ShiftTeamGroup) {
    const periodLabel = data?.range.label ?? '-';
    const members = computeGroupMemberBreakdown(g);
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsHtml = members
      .map(
        (m, i) =>
          `<tr><td>${i + 1}</td><td>${esc(m.fullName)}</td><td>${esc(m.nim)}</td><td style="text-align:center">${m.hadir}x</td><td style="text-align:center">${m.telatMenit > 0 ? `${m.telatMenit} mnt` : 'Tepat'}</td><td style="text-align:right;font-weight:700">${esc(formatRupiah(m.nominal))}</td></tr>`,
      )
      .join('');
    const sessHtml = g.sessions
      .map(
        (s) =>
          `<tr><td>${esc(s.tanggal)}</td><td>${esc(formatTime(s.clockIn))} - ${s.clockOut ? esc(formatTime(s.clockOut)) : 'Aktif'}</td><td style="text-align:center">${s.txCount}</td><td style="text-align:right">${esc(formatRupiah(s.omzet))}</td><td style="text-align:right">${esc(formatRupiah(s.labaKotor))}</td><td style="text-align:right;font-weight:700">${esc(formatRupiah(s.upahBersih))}</td></tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Slip Gaji ${esc(g.hari)} ${esc(g.sesi)}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:24px;max-width:760px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;font-size:12px;color:#333}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px}th{background:#f1f5f9;text-align:left}.meta{display:flex;justify-content:space-between;margin:12px 0;padding:10px;border:1px solid #cbd5e1;font-size:12px}@media print{button{display:none}}</style></head><body><h1>SLIP GAJI KELOMPOK SHIFT - WIRAMART UNPERBA</h1><p>Periode: ${esc(periodLabel)} | Kelompok: ${esc(g.hari)} ${esc(g.sesi)} (${esc(g.waktuLabel)} WIB)</p><div class="meta"><div><strong>Jumlah Pertemuan:</strong> ${g.totalShiftCount}x</div><div><strong>Total Omzet:</strong> ${esc(formatRupiah(g.totalOmzet))}</div><div><strong>Laba Kotor:</strong> ${esc(formatRupiah(g.totalLabaKotor))}</div><div><strong>Total Upah Tim:</strong> ${esc(formatRupiah(g.upahBersih))}</div></div><h2 style="font-size:14px;margin-top:16px">Rincian Per Anggota</h2><table><thead><tr><th>No</th><th>Nama</th><th>NIM</th><th style="text-align:center">Hadir</th><th style="text-align:center">Disiplin</th><th style="text-align:right">Nominal</th></tr></thead><tbody>${rowsHtml}</tbody></table><h2 style="font-size:14px;margin-top:16px">Rincian Pertemuan Shift</h2><table><thead><tr><th>Tanggal</th><th>Jam</th><th style="text-align:center">Trx</th><th style="text-align:right">Omzet</th><th style="text-align:right">Laba Kotor</th><th style="text-align:right">Upah Shift</th></tr></thead><tbody>${sessHtml}</tbody></table><div style="margin-top:18px"><button onclick="window.print()">Cetak / Simpan PDF</button></div></body></html>`;
    const win = window.open('', '_blank', 'width=820,height=720');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filterMode === 'monthly') {
      params.set('month', selectedMonth);
    } else if (filterMode === 'daily') {
      params.set('date', selectedDate);
    } else if (filterMode === 'range') {
      params.set('dateFrom', rangeStart);
      params.set('dateTo', rangeEnd);
    } else {
      params.set('period', filterMode);
    }
    return params.toString();
  }, [filterMode, selectedMonth, selectedDate, rangeStart, rangeEnd]);

  const requestKey = `${queryString}:${refreshTick}`;
  const loading = !loadedState || loadedState.key !== requestKey;
  const data = loadedState?.data ?? null;
  const error = loadedState?.key === requestKey ? loadedState.error : '';

  const fetchData = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const key = requestKey;
    fetch(`/api/admin/laporan/per-shift?${queryString}`)
      .then(async (res) => {
        const json = (await res.json()) as {
          success?: boolean;
          data?: PerShiftData;
          error?: string;
        };
        if (!active) return;
        if (!res.ok || !json.success || !json.data) {
          setLoadedState({
            key,
            data: null,
            error: json.error ?? 'Gagal mengambil data laporan per shift',
          });
          return;
        }
        setLoadedState({ key, data: json.data, error: '' });
      })
      .catch((e: unknown) => {
        if (!active) return;
        setLoadedState({
          key,
          data: null,
          error: e instanceof Error ? e.message : 'Terjadi kesalahan jaringan.',
        });
      });
    return () => {
      active = false;
    };
  }, [queryString, requestKey]);

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
          auditFlags: s.auditFlags ?? null,
          notes: s.notes ?? null,
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

      // Hanya tampilkan hari kerja resmi Wiramart (Senin - Jumat)
      if (g.hari === 'Sabtu' || g.hari === 'Minggu') {
        continue;
      }

      // Jangan tampilkan grup kosong tanpa personel sah mahasiswa (misal shift testing murni)
      if (anggotaShift.length === 0) {
        continue;
      }

      const transferNote: string | undefined = undefined;

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

  const visibleGroupKeys = useMemo(
    () => filteredGroups.map((g) => g.groupKey),
    [filteredGroups],
  );
  const selectedGroups = useMemo(
    () => selection.getSelectedRows(filteredGroups, (g) => g.groupKey),
    [selection, filteredGroups],
  );
  const selectedTotals = useMemo(
    () =>
      selectedGroups.reduce(
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
        },
      ),
    [selectedGroups],
  );

  async function handleExportSelected(): Promise<void> {
    if (selectedGroups.length === 0) return;
    await exportSelectedRowsToExcel({
      filename: `rekap-shift-terpilih-${todayWibSlug()}.xlsx`,
      sheetName: 'Kelompok Shift Terpilih',
      title: `REKAP SHIFT TERPILIH (${selectedGroups.length} Kelompok Shift)`,
      subtitle: `Periode: ${data?.range.label ?? '-'} (${data?.range.startDate ?? ''} s/d ${data?.range.endDate ?? ''}) | Dicetak ${todayWibSlug()} WIB`,
      rows: selectedGroups,
      columns: [
        { header: 'Hari', key: 'hari', width: 12, format: 'text', aggregate: 'count', value: (g) => g.hari },
        { header: 'Sesi', key: 'sesi', width: 10, format: 'text', aggregate: 'none', value: (g) => g.sesi },
        { header: 'Waktu (WIB)', key: 'waktuLabel', width: 14, format: 'text', aggregate: 'none', value: (g) => g.waktuLabel },
        { header: 'Tanggal Shift', key: 'shiftTglSummary', width: 28, format: 'text', aggregate: 'none', value: (g) => g.shiftTglSummary },
        {
          header: 'Anggota Shift',
          key: 'anggota',
          width: 36,
          format: 'text',
          aggregate: 'none',
          value: (g) => g.anggotaShift.map((m) => m.fullName).join(', '),
        },
        { header: 'Personel Tim', key: 'totalPersonel', width: 14, format: 'integer', aggregate: 'sum', value: (g) => g.totalPersonel },
        { header: 'Jumlah Shift', key: 'totalShiftCount', width: 14, format: 'integer', aggregate: 'sum', value: (g) => g.totalShiftCount },
        { header: 'Transaksi', key: 'totalTx', width: 12, format: 'integer', aggregate: 'sum', value: (g) => g.totalTx },
        { header: 'Omzet', key: 'totalOmzet', width: 18, format: 'currency', aggregate: 'sum', value: (g) => g.totalOmzet },
        { header: 'Laba Kotor', key: 'totalLabaKotor', width: 18, format: 'currency', aggregate: 'sum', value: (g) => g.totalLabaKotor },
        { header: 'Upah Bersih (50%)', key: 'upahBersih', width: 20, format: 'currency', aggregate: 'sum', value: (g) => g.upahBersih },
      ],
    });
  }

  // Export Excel Profesional 5-Sheet (Standar Akuntansi Wiramart, Rumus Dinamis, Cetak A4)
  async function handleExportExcel() {
    if (!data || filteredGroups.length === 0) return;
    setExportLoading(true);
    try {
      const wb = await createWiramartWorkbook('Manager - Laporan Gaji & Shift');
      const printedWib = formatWibDateTime();
      const subtitlePeriod = `Periode: ${data.range.label} (${data.range.startDate} s/d ${data.range.endDate}) • Dicetak: ${printedWib} WIB`;

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 1: RINGKASAN FINANSIAL & PEDOMAN RUMUS
      // ─────────────────────────────────────────────────────────────────────
      const ws1 = wb.addWorksheet('Ringkasan Finansial');
      const cols1 = [
        { header: 'Pos Finansial', width: 34, align: 'left' as const },
        { header: 'Nilai (Rupiah / Satuan)', width: 24, align: 'right' as const },
        { header: 'Keterangan Sistem', width: 56, align: 'left' as const },
      ];
      cols1.forEach((c, i) => {
        ws1.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws1, {
        title: 'LAPORAN REKAPITULASI KEUANGAN & BAGI HASIL SHIFT — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • Skema Pembagian Hybrid 70% Kehadiran / 30% Kinerja`,
        endCol: cols1.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws1.getRow(3).height = 8;

      const r1Head = ws1.getRow(4);
      r1Head.height = 26;
      cols1.forEach((c, i) => {
        const cell = r1Head.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      const gtTx = Math.round(toSafeExcelNum(data.grandTotal.txCount));
      const gtOmzet = Math.round(toSafeExcelNum(data.grandTotal.omzet));
      const gtLabaKotor = Math.round(toSafeExcelNum(data.grandTotal.labaKotor));
      const gtBiayaOp = Math.round(toSafeExcelNum(data.grandTotal.biayaOperasional));
      const gtLabaOp = Math.round(
        toSafeExcelNum(data.grandTotal.labaOperasionalBersih ?? Math.max(0, gtLabaKotor - gtBiayaOp)),
      );
      const gtPoolGaji = Math.round(toSafeExcelNum(data.grandTotal.poolGaji));
      const gtKasToko = Math.round(toSafeExcelNum(data.grandTotal.labaBersihToko ?? gtPoolGaji));
      const gtDistributed = Math.round(toSafeExcelNum(data.grandTotal.totalDistributed ?? gtPoolGaji));
      const gtSisaPool = Math.round(toSafeExcelNum(data.grandTotal.sisaPool ?? gtPoolGaji - gtDistributed));

      const summaryRows: {
        pos: string;
        val: number | { formula: string; result: number };
        fmt: string;
        desc: string;
        highlight?: boolean;
      }[] = [
        { pos: 'Total Transaksi Kasir', val: gtTx, fmt: EXCEL_FMT.INT, desc: 'Jumlah transaksi sukses tercatat pada POS kasir' },
        { pos: 'Total Omzet Penjualan', val: gtOmzet, fmt: EXCEL_FMT.RUPIAH, desc: 'Total penerimaan kotor dari seluruh penjualan produk' },
        { pos: 'Laba Kotor Operasional', val: gtLabaKotor, fmt: EXCEL_FMT.RUPIAH, desc: 'Selisih harga jual terhadap HPP (Cost of Goods Sold)' },
        { pos: 'Beban Operasional Toko', val: gtBiayaOp, fmt: EXCEL_FMT.RUPIAH, desc: 'Biaya utilitas & operasional toko pada periode laporan' },
        { pos: 'Laba Bersih Operasional', val: { formula: 'MAX(0,B7-B8)', result: gtLabaOp }, fmt: EXCEL_FMT.RUPIAH, desc: 'Laba Kotor dikurangi Beban Operasional Toko', highlight: true },
        { pos: 'Alokasi Hak Mahasiswa (50%)', val: gtPoolGaji, fmt: EXCEL_FMT.RUPIAH, desc: 'Plafon total upah bagi hasil seluruh personel shift', highlight: true },
        { pos: 'Alokasi Kas Toko (50%)', val: gtKasToko, fmt: EXCEL_FMT.RUPIAH, desc: 'Bagian kas bersih toko untuk pengembangan unit usaha', highlight: true },
        { pos: 'Total Upah Terdistribusi', val: gtDistributed, fmt: EXCEL_FMT.RUPIAH, desc: 'Total upah bersih yang disalurkan kepada seluruh anggota' },
        { pos: 'Sisa Saldo Pool (Selisih)', val: { formula: 'B10-B12', result: gtSisaPool }, fmt: EXCEL_FMT.RUPIAH, desc: 'Metode Hamilton menjamin selisih pembulatan Rp 0 (zero-leakage)' },
      ];

      summaryRows.forEach((item, idx) => {
        const rowNum = 5 + idx;
        const r = ws1.getRow(rowNum);
        const cells: (string | number | { formula: string; result: number })[] = [item.pos, item.val, item.desc];
        cells.forEach((v, cIdx) => {
          const c = r.getCell(cIdx + 1);
          c.value = v;
          c.font = item.highlight ? EXCEL_FONT.BOLD : EXCEL_FONT.BODY;
          c.border = EXCEL_BORDER.THIN;
          c.alignment = {
            vertical: 'middle',
            horizontal: cIdx === 1 ? 'right' : 'left',
            wrapText: cIdx === 2,
          };
          if (cIdx === 1) c.numFmt = item.fmt;
          if (item.highlight) {
            c.fill = EXCEL_FILL.TOTAL;
          } else if (idx % 2 === 1) {
            c.fill = EXCEL_FILL.ZEBRA;
          }
        });
        r.height = calcWrapRowHeight([{ text: item.desc, width: cols1[2].width }], 21, 14);
      });

      const noteStartRow = 16;
      ws1.mergeCells(`A${noteStartRow}:C${noteStartRow}`);
      const noteTitle = ws1.getCell(`A${noteStartRow}`);
      noteTitle.value = 'PEDOMAN & FORMULA SISTEM PENGGAJIAN PER SHIFT WIRAMART';
      noteTitle.font = EXCEL_FONT.SECTION;
      noteTitle.fill = EXCEL_FILL.SECTION;
      noteTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      noteTitle.border = EXCEL_BORDER.THIN;
      ws1.getRow(noteStartRow).height = 24;

      const notesList = [
        { no: '1.', rule: 'Rasio Utama 50% : 50% (Paten)', detail: 'Laba Bersih Toko dibagi seimbang 50% untuk Kas Toko dan 50% untuk Plafon Upah Mahasiswa (Closed-Loop).' },
        { no: '2.', rule: 'Komposisi Pool Hybrid 70% / 30%', detail: '70% Alokasi Kehadiran dibagikan berdasarkan poin kedisiplinan hadir dan ketepatan waktu. 30% Bonus Produktivitas dibagikan proporsional sesuai laba kotor shift.' },
        { no: '3.', rule: 'Faktor Disiplin Waktu Kehadiran', detail: 'Hadir tepat waktu mendapat bobot 1,00 (100%). Keterlambatan dikenakan penalti poin proporsional sesuai durasi keterlambatan.' },
        { no: '4.', rule: 'Pembagian Internal Shift', detail: 'Upah yang dialokasikan ke tiap shift dibagikan kepada seluruh personel yang hadir berdasarkan bobot peran dan kedisiplinan.' },
        { no: '5.', rule: 'Distribusi Bulat Tanpa Residu (Hamilton)', detail: 'Seluruh alokasi rupiah dibulatkan menggunakan metode Largest Remainder (Hamilton) sehingga sisa saldo pool selalu Rp 0.' },
      ];

      const mergedDescWidth = cols1[1].width + cols1[2].width;
      notesList.forEach((n, idx) => {
        const rowNum = noteStartRow + 1 + idx;
        const r = ws1.getRow(rowNum);
        const label = `${n.no} ${n.rule}`;
        ws1.mergeCells(`B${rowNum}:C${rowNum}`);
        const cLabel = ws1.getCell(`A${rowNum}`);
        cLabel.value = label;
        cLabel.font = EXCEL_FONT.BOLD;
        cLabel.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cLabel.border = EXCEL_BORDER.THIN;

        const cDetail = ws1.getCell(`B${rowNum}`);
        cDetail.value = n.detail;
        cDetail.font = EXCEL_FONT.BODY;
        cDetail.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cDetail.border = EXCEL_BORDER.THIN;
        ws1.getCell(`C${rowNum}`).border = EXCEL_BORDER.THIN;

        if (idx % 2 === 1) {
          cLabel.fill = EXCEL_FILL.ZEBRA;
          cDetail.fill = EXCEL_FILL.ZEBRA;
        }
        r.height = calcWrapRowHeight(
          [
            { text: label, width: cols1[0].width },
            { text: n.detail, width: mergedDescWidth },
          ],
          21,
          14,
        );
      });

      applySheetLayout(ws1, { freezeRow: 4, orientation: 'landscape' });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 2: REKAP KELOMPOK SHIFT (DENGAN DETAIL UPAH PER ANGGOTA)
      // ─────────────────────────────────────────────────────────────────────
      const ws2 = wb.addWorksheet('Rekap Kelompok Shift');
      const cols2 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Hari', width: 12, align: 'center' as const },
        { header: 'Sesi', width: 10, align: 'center' as const },
        { header: 'Jam Kerja (WIB)', width: 15, align: 'center' as const },
        { header: 'Personel', width: 11, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Frekuensi Shift', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Transaksi', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Omzet (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Laba Kotor (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Upah Bersih (Rp)', width: 19, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Rata-Rata / Shift (Rp)', width: 20, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Rincian Pembagian Upah per Anggota', width: 56, align: 'left' as const },
      ];
      cols2.forEach((c, i) => {
        ws2.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws2, {
        title: 'REKAPITULASI UPAH PER KELOMPOK SHIFT RESMI — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • ${filteredGroups.length} Kelompok Kerja Aktif`,
        endCol: cols2.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws2.getRow(3).height = 8;

      const r2Header = ws2.getRow(4);
      r2Header.height = 26;
      cols2.forEach((c, i) => {
        const cell = r2Header.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      const groupStats = new Map<string, { memberNominals: Map<string, number> }>();
      for (const s of data.shifts) {
        const gKey = `${s.hari}-${s.sesi}`;
        const existing = groupStats.get(gKey) ?? { memberNominals: new Map<string, number>() };
        for (const p of s.personnel) {
          existing.memberNominals.set(
            p.fullName,
            (existing.memberNominals.get(p.fullName) ?? 0) + Math.round(toSafeExcelNum(p.nominalBagiHasil)),
          );
        }
        groupStats.set(gKey, existing);
      }

      filteredGroups.forEach((g, idx) => {
        const rowNum = 5 + idx;
        const r = ws2.getRow(rowNum);
        const shiftCount = Math.round(toSafeExcelNum(g.totalShiftCount));
        const upahG = Math.round(toSafeExcelNum(g.upahBersih));
        const avgPerMeeting = shiftCount > 0 ? Math.round(upahG / shiftCount) : 0;

        const gStat = groupStats.get(g.groupKey);
        const memberDetails: string[] = [];
        if (gStat && gStat.memberNominals.size > 0) {
          gStat.memberNominals.forEach((nominal, name) => {
            memberDetails.push(`${name} (Rp ${nominal.toLocaleString('id-ID')})`);
          });
        } else {
          g.anggotaShift.forEach((m) => {
            memberDetails.push(m.fullName);
          });
        }
        const detailKeterangan = sanitizeExcelText(memberDetails.join(', ')) || '—';

        const values: (string | number | { formula: string; result: number })[] = [
          idx + 1,
          sanitizeExcelText(g.hari),
          sanitizeExcelText(g.sesi),
          sanitizeExcelText(g.waktuLabel),
          Math.round(toSafeExcelNum(g.totalPersonel)),
          shiftCount,
          Math.round(toSafeExcelNum(g.totalTx)),
          Math.round(toSafeExcelNum(g.totalOmzet)),
          Math.round(toSafeExcelNum(g.totalLabaKotor)),
          upahG,
          { formula: `IF(F${rowNum}>0,ROUND(J${rowNum}/F${rowNum},0),0)`, result: avgPerMeeting },
          detailKeterangan,
        ];

        values.forEach((val, cIdx) => {
          const cell = r.getCell(cIdx + 1);
          const meta = cols2[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 11,
          };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        r.height = calcWrapRowHeight([{ text: detailKeterangan, width: cols2[11].width }], 22, 14);
      });

      const end2 = 5 + filteredGroups.length - 1;
      const tot2Num = end2 + 1;
      const r2Total = ws2.getRow(tot2Num);
      r2Total.height = 25;
      const sumMap2: Record<number, number> = {
        4: Math.round(toSafeExcelNum(tableTotals.totalPersonel)),
        5: Math.round(toSafeExcelNum(tableTotals.totalShiftCount)),
        6: Math.round(toSafeExcelNum(tableTotals.totalTx)),
        7: Math.round(toSafeExcelNum(tableTotals.totalOmzet)),
        8: Math.round(toSafeExcelNum(tableTotals.totalLabaKotor)),
        9: Math.round(toSafeExcelNum(tableTotals.upahBersih)),
      };
      const avgAll2 =
        tableTotals.totalShiftCount > 0
          ? Math.round(tableTotals.upahBersih / tableTotals.totalShiftCount)
          : 0;

      ws2.mergeCells(`B${tot2Num}:D${tot2Num}`);
      cols2.forEach((c, cIdx) => {
        const cell = r2Total.getCell(cIdx + 1);
        const colChar = colLetter(cIdx + 1);
        if (cIdx === 1) {
          cell.value = 'TOTAL KESELURUHAN';
        } else if (cIdx === 10) {
          cell.value = { formula: `IF(F${tot2Num}>0,ROUND(J${tot2Num}/F${tot2Num},0),0)`, result: avgAll2 };
        } else if (cIdx === 11) {
          cell.value = sanitizeExcelText(
            `Distribusi 50:50 terverifikasi — Total Hak Mahasiswa Rp ${Math.round(tableTotals.upahBersih).toLocaleString('id-ID')}`,
          );
        } else if (cIdx in sumMap2) {
          cell.value = { formula: `SUM(${colChar}5:${colChar}${end2})`, result: sumMap2[cIdx] };
        } else if (cIdx < 1 || cIdx > 3) {
          cell.value = '';
        }
        cell.font = EXCEL_FONT.BOLD;
        cell.fill = EXCEL_FILL.TOTAL;
        cell.border = EXCEL_BORDER.TOTAL;
        cell.alignment = {
          vertical: 'middle',
          horizontal: cIdx >= 1 && cIdx <= 3 ? 'center' : c.align,
        };
        if (c.fmt) cell.numFmt = c.fmt;
      });

      applySheetLayout(ws2, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: cols2.length } },
        orientation: 'landscape',
      });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 3: RINCIAN UPAH PER MAHASISWA
      // ─────────────────────────────────────────────────────────────────────
      const ws3 = wb.addWorksheet('Upah Mahasiswa');
      const cols3 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Nama Lengkap', width: 28, align: 'left' as const },
        { header: 'NIM', width: 15, align: 'center' as const },
        { header: 'Program Studi', width: 24, align: 'left' as const },
        { header: 'Jabatan / Peran', width: 22, align: 'left' as const },
        { header: 'Kehadiran', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Upah Diterima (Rp)', width: 21, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Tanda Tangan', width: 20, align: 'center' as const },
      ];
      cols3.forEach((c, i) => {
        ws3.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws3, {
        title: 'DAFTAR PENERIMAAN UPAH BAGI HASIL MAHASISWA — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • ${data.summaryPerEmployee.length} Personel Mahasiswa`,
        endCol: cols3.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws3.getRow(3).height = 8;

      const r3Header = ws3.getRow(4);
      r3Header.height = 26;
      cols3.forEach((c, i) => {
        const cell = r3Header.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      let totalHadirEmps = 0;
      let totalUpahEmps = 0;
      const sortedEmps = [...data.summaryPerEmployee].sort((a, b) => a.fullName.localeCompare(b.fullName));

      sortedEmps.forEach((emp, idx) => {
        const hadirN = Math.round(toSafeExcelNum(emp.totalHadir));
        const upahN = Math.round(toSafeExcelNum(emp.totalNominal));
        totalHadirEmps += hadirN;
        totalUpahEmps += upahN;

        const nameTxt = sanitizeExcelText(emp.fullName) || '—';
        const prodiTxt = sanitizeExcelText(emp.programStudi) || '—';
        const jabTxt = sanitizeExcelText(emp.jabatan) || '—';

        const r = ws3.getRow(5 + idx);
        const vals: (string | number)[] = [
          idx + 1,
          nameTxt,
          sanitizeExcelText(emp.nim) || '—',
          prodiTxt,
          jabTxt,
          hadirN,
          upahN,
          '',
        ];

        vals.forEach((val, cIdx) => {
          const cell = r.getCell(cIdx + 1);
          const meta = cols3[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 1 || cIdx === 3 || cIdx === 4,
          };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        r.height = calcWrapRowHeight(
          [
            { text: nameTxt, width: cols3[1].width },
            { text: prodiTxt, width: cols3[3].width },
            { text: jabTxt, width: cols3[4].width },
          ],
          22,
          14,
        );
      });

      if (sortedEmps.length > 0) {
        const end3 = 5 + sortedEmps.length - 1;
        const tot3Num = end3 + 1;
        const r3Total = ws3.getRow(tot3Num);
        r3Total.height = 25;
        ws3.mergeCells(`B${tot3Num}:D${tot3Num}`);

        cols3.forEach((c, cIdx) => {
          const cell = r3Total.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 1) {
            cell.value = 'TOTAL KESELURUHAN';
          } else if (cIdx === 4) {
            cell.value = `${sortedEmps.length} Mahasiswa`;
          } else if (cIdx === 5) {
            cell.value = { formula: `SUM(${colChar}5:${colChar}${end3})`, result: totalHadirEmps };
          } else if (cIdx === 6) {
            cell.value = { formula: `SUM(${colChar}5:${colChar}${end3})`, result: totalUpahEmps };
          } else if (cIdx !== 2 && cIdx !== 3) {
            cell.value = '';
          }
          cell.font = EXCEL_FONT.BOLD;
          cell.fill = EXCEL_FILL.TOTAL;
          cell.border = EXCEL_BORDER.TOTAL;
          cell.alignment = {
            vertical: 'middle',
            horizontal: cIdx >= 1 && cIdx <= 3 ? 'center' : c.align,
          };
          if (c.fmt) cell.numFmt = c.fmt;
        });
      }

      applySheetLayout(ws3, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: cols3.length } },
        orientation: 'landscape',
      });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 4: LOG SHIFT HARIAN (DENGAN RINCIAN PEMBAGIAN PER ORANG)
      // ─────────────────────────────────────────────────────────────────────
      const ws4 = wb.addWorksheet('Log Shift Harian');
      const cols4 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Tanggal', width: 13, align: 'center' as const },
        { header: 'Hari', width: 11, align: 'center' as const },
        { header: 'Sesi', width: 10, align: 'center' as const },
        { header: 'Kasir Bertugas', width: 25, align: 'left' as const },
        { header: 'Buka (WIB)', width: 12, align: 'center' as const },
        { header: 'Tutup (WIB)', width: 12, align: 'center' as const },
        { header: 'Transaksi', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Omzet (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Laba Kotor (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Upah Shift (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Personel', width: 11, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Rincian Pembagian Upah Personel Shift', width: 54, align: 'left' as const },
      ];
      cols4.forEach((c, i) => {
        ws4.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws4, {
        title: 'JURNAL LOG TRANSAKSI & RINCIAN HASIL OPERASIONAL SETIAP SHIFT — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • Total Pertemuan Shift: ${data.shifts.length} Shift`,
        endCol: cols4.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws4.getRow(3).height = 8;

      const r4Header = ws4.getRow(4);
      r4Header.height = 26;
      cols4.forEach((c, i) => {
        const cell = r4Header.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      let sum4Tx = 0;
      let sum4Omzet = 0;
      let sum4Laba = 0;
      let sum4Upah = 0;
      let sum4Pers = 0;

      data.shifts.forEach((s, idx) => {
        const inTime = s.clockIn
          ? new Date(s.clockIn).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'Asia/Jakarta',
            })
          : '—';
        const outTime = s.clockOut
          ? new Date(s.clockOut).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'Asia/Jakarta',
            })
          : 'Berjalan';

        const txN = Math.round(toSafeExcelNum(s.txCount));
        const omzN = Math.round(toSafeExcelNum(s.omzet));
        const labaN = Math.round(toSafeExcelNum(s.labaKotor));
        const gajiN = Math.round(
          toSafeExcelNum(s.gajiBersih !== undefined ? s.gajiBersih : s.personnelCount > 0 ? s.poolGaji : 0),
        );
        const persN = Math.round(toSafeExcelNum(s.personnelCount));

        sum4Tx += txN;
        sum4Omzet += omzN;
        sum4Laba += labaN;
        sum4Upah += gajiN;
        sum4Pers += persN;

        const personelList = sanitizeExcelText(
          s.personnel
            .map((p) => `${p.fullName}: Rp ${Math.round(toSafeExcelNum(p.nominalBagiHasil)).toLocaleString('id-ID')}`)
            .join(' | '),
        ) || 'Hanya Kasir';
        const kasirTxt = sanitizeExcelText(s.kasirName) || '—';

        const r = ws4.getRow(5 + idx);
        const vals: (string | number)[] = [
          idx + 1,
          sanitizeExcelText(s.tanggal) || '—',
          sanitizeExcelText(s.hari) || '—',
          sanitizeExcelText(s.sesi) || '—',
          kasirTxt,
          inTime,
          outTime,
          txN,
          omzN,
          labaN,
          gajiN,
          persN,
          personelList,
        ];

        vals.forEach((val, cIdx) => {
          const cell = r.getCell(cIdx + 1);
          const meta = cols4[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 4 || cIdx === 12,
          };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        r.height = calcWrapRowHeight(
          [
            { text: kasirTxt, width: cols4[4].width },
            { text: personelList, width: cols4[12].width },
          ],
          22,
          14,
        );
      });

      if (data.shifts.length > 0) {
        const end4 = 5 + data.shifts.length - 1;
        const tot4Num = end4 + 1;
        const r4Total = ws4.getRow(tot4Num);
        r4Total.height = 25;
        const sumMap4: Record<number, number> = {
          7: sum4Tx,
          8: sum4Omzet,
          9: sum4Laba,
          10: sum4Upah,
          11: sum4Pers,
        };
        ws4.mergeCells(`B${tot4Num}:D${tot4Num}`);

        cols4.forEach((c, cIdx) => {
          const cell = r4Total.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 1) {
            cell.value = 'TOTAL KESELURUHAN';
          } else if (cIdx === 4) {
            cell.value = `${data.shifts.length} Pertemuan Shift`;
          } else if (cIdx in sumMap4) {
            cell.value = { formula: `SUM(${colChar}5:${colChar}${end4})`, result: sumMap4[cIdx] };
          } else if (cIdx !== 2 && cIdx !== 3) {
            cell.value = '';
          }
          cell.font = EXCEL_FONT.BOLD;
          cell.fill = EXCEL_FILL.TOTAL;
          cell.border = EXCEL_BORDER.TOTAL;
          cell.alignment = {
            vertical: 'middle',
            horizontal: cIdx >= 1 && cIdx <= 3 ? 'center' : c.align,
          };
          if (c.fmt) cell.numFmt = c.fmt;
        });
      }

      applySheetLayout(ws4, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: cols4.length } },
        orientation: 'landscape',
      });

      // ─────────────────────────────────────────────────────────────────────
      // SHEET 5: RINCIAN AUDIT PER SHIFT & PERSONEL (PAYROLL MATRIX)
      // ─────────────────────────────────────────────────────────────────────
      const ws5 = wb.addWorksheet('Detail Shift & Personel');
      const cols5 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Tanggal', width: 13, align: 'center' as const },
        { header: 'Hari', width: 11, align: 'center' as const },
        { header: 'Sesi', width: 10, align: 'center' as const },
        { header: 'Nama Mahasiswa', width: 28, align: 'left' as const },
        { header: 'NIM', width: 14, align: 'center' as const },
        { header: 'Peran Tugas', width: 22, align: 'left' as const },
        { header: 'Status Kehadiran', width: 18, align: 'center' as const },
        { header: 'Bobot Poin', width: 13, align: 'right' as const, fmt: EXCEL_FMT.DEC2 },
        { header: 'Upah Bersih (Rp)', width: 21, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
      ];
      cols5.forEach((c, i) => {
        ws5.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws5, {
        title: 'RINCIAN MATRIKS AUDIT PEMBAGIAN UPAH PER SHIFT & PER PERSONEL — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • Transparansi Distribusi Upah Mahasiswa Berdasarkan Presensi & Kinerja`,
        endCol: cols5.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws5.getRow(3).height = 8;

      const r5Header = ws5.getRow(4);
      r5Header.height = 26;
      cols5.forEach((c, i) => {
        const cell = r5Header.getCell(i + 1);
        cell.value = c.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: c.align, wrapText: true };
      });

      let rowIdx5 = 5;
      let counter5 = 1;
      let grandTotalMatrixUpah = 0;

      for (const s of data.shifts) {
        for (const p of s.personnel) {
          const upahP = Math.round(toSafeExcelNum(p.nominalBagiHasil));
          grandTotalMatrixUpah += upahP;

          const r = ws5.getRow(rowIdx5);
          const lateStr = p.lateMinutes > 0 ? `Terlambat ${p.lateMinutes} mnt` : 'Hadir Tepat Waktu';
          const weightNum = toSafeExcelNum(p.totalWeight ?? 1) || 1;
          const nameTxt = sanitizeExcelText(p.fullName) || '—';
          const jabTxt = sanitizeExcelText(p.jabatan) || '—';

          const vals: (string | number)[] = [
            counter5,
            sanitizeExcelText(s.tanggal) || '—',
            sanitizeExcelText(s.hari) || '—',
            sanitizeExcelText(s.sesi) || '—',
            nameTxt,
            sanitizeExcelText(p.nim) || '—',
            jabTxt,
            lateStr,
            weightNum,
            upahP,
          ];

          const isZebra = counter5 % 2 === 0;
          vals.forEach((val, cIdx) => {
            const cell = r.getCell(cIdx + 1);
            const meta = cols5[cIdx];
            cell.value = val;
            cell.font = EXCEL_FONT.BODY;
            cell.border = EXCEL_BORDER.THIN;
            cell.alignment = {
              vertical: 'middle',
              horizontal: meta.align,
              wrapText: cIdx === 4 || cIdx === 6,
            };
            if (meta.fmt) cell.numFmt = meta.fmt;
            if (isZebra) cell.fill = EXCEL_FILL.ZEBRA;
          });

          r.height = calcWrapRowHeight(
            [
              { text: nameTxt, width: cols5[4].width },
              { text: jabTxt, width: cols5[6].width },
            ],
            21,
            14,
          );
          counter5++;
          rowIdx5++;
        }
      }

      if (counter5 > 1) {
        const end5 = rowIdx5 - 1;
        const r5Total = ws5.getRow(rowIdx5);
        r5Total.height = 25;
        ws5.mergeCells(`B${rowIdx5}:D${rowIdx5}`);

        cols5.forEach((c, cIdx) => {
          const cell = r5Total.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 1) {
            cell.value = 'TOTAL KESELURUHAN';
          } else if (cIdx === 4) {
            cell.value = `${counter5 - 1} Penugasan Personel Shift`;
          } else if (cIdx === 9) {
            cell.value = { formula: `SUM(${colChar}5:${colChar}${end5})`, result: grandTotalMatrixUpah };
          } else if (cIdx !== 2 && cIdx !== 3) {
            cell.value = '';
          }
          cell.font = EXCEL_FONT.BOLD;
          cell.fill = EXCEL_FILL.TOTAL;
          cell.border = EXCEL_BORDER.TOTAL;
          cell.alignment = {
            vertical: 'middle',
            horizontal: cIdx >= 1 && cIdx <= 3 ? 'center' : c.align,
          };
          if (c.fmt) cell.numFmt = c.fmt;
        });
      }

      applySheetLayout(ws5, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: cols5.length } },
        orientation: 'landscape',
      });

      await downloadWorkbookBlob(
        wb,
        `Laporan_Gaji_Wiramart_${data.range.startDate}_sd_${data.range.endDate}.xlsx`,
      );
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
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: 44, padding: '8px 14px' }}
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
            {(
              [
                { id: 'monthly', label: 'Per Bulan' },
                { id: 'daily', label: 'Per Tanggal' },
                { id: 'range', label: 'Rentang Bebas' },
                { id: 'october', label: 'Oktober' },
                { id: 'november', label: 'November' },
                { id: 'oct_nov', label: 'Oktober + November' },
                { id: 'all', label: 'Keseluruhan' },
              ] as const
            ).map((m) => {
              const isActive = filterMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFilterMode(m.id)}
                  style={{
                    minHeight: 44,
                    padding: '8px 14px',
                    borderRadius: 100,
                    border: isActive
                      ? '1.5px solid var(--color-primary, #166534)'
                      : '1.5px solid #e2e8f0',
                    background: isActive ? 'var(--color-primary, #166534)' : '#f8fafc',
                    color: isActive ? '#ffffff' : 'var(--color-text-muted, #475569)',
                    fontSize: '0.82rem',
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
            {filterMode === 'monthly' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="month"
                  value={selectedMonth}
                  max={currentMonthWib}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="form-input"
                  style={{
                    padding: '8px 12px',
                    fontSize: '1rem',
                    minHeight: 44,
                    width: 'auto',
                    minWidth: 165,
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
                        minHeight: 44,
                        padding: '8px 14px',
                        borderRadius: '99px',
                        border:
                          selectedMonth === m
                            ? '1.5px solid #166534'
                            : '1px solid var(--color-border)',
                        backgroundColor: selectedMonth === m ? '#16653415' : 'transparent',
                        color: selectedMonth === m ? '#166534' : 'var(--color-text-secondary)',
                        fontSize: '0.8rem',
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
                  style={{ minWidth: 44, minHeight: 44, padding: 0, justifyContent: 'center' }}
                  aria-label="Hari Sebelumnya"
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
                    padding: '8px 12px',
                    fontSize: '1rem',
                    minHeight: 44,
                    width: 'auto',
                    minWidth: 155,
                    fontWeight: 600,
                  }}
                  aria-label="Pilih Tanggal"
                />
                <button
                  type="button"
                  onClick={() => shiftDay(1)}
                  disabled={selectedDate >= todayWib}
                  className="btn btn-secondary btn-sm"
                  style={{ minWidth: 44, minHeight: 44, padding: 0, justifyContent: 'center' }}
                  aria-label="Hari Berikutnya"
                  title="Hari Berikutnya"
                >
                  <ChevronRight size={16} />
                </button>
                {selectedDate !== todayWib && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayWib)}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.8rem', minHeight: 44, padding: '8px 14px' }}
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
                  style={{ padding: '8px 12px', fontSize: '1rem', minHeight: 44, width: 'auto', minWidth: 150 }}
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
                  style={{ padding: '8px 12px', fontSize: '1rem', minHeight: 44, width: 'auto', minWidth: 150 }}
                  aria-label="Tanggal Akhir"
                />
              </div>
            )}

            {(filterMode === 'october' || filterMode === 'november' || filterMode === 'oct_nov' || filterMode === 'all') && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: '99px',
                  backgroundColor: 'hsl(142 76% 96%)',
                  color: 'hsl(142 64% 24%)',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                {data?.range
                  ? `Periode Aktif: ${data.range.label} (${data.range.startDate} s/d ${data.range.endDate})`
                  : 'Memuat riwayat operasional...'}
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
                  minHeight: 44,
                  padding: '8px 14px',
                  borderRadius: '99px',
                  border: active ? '1.5px solid #166534' : '1px solid var(--color-border)',
                  background: active ? '#f0fdf4' : '#ffffff',
                  color: active ? '#166534' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
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
              style={{ minHeight: 44, fontSize: '1rem' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleCopySlip('__ALL__', buildAllShiftsWaText())}
            disabled={filteredGroups.length === 0}
            className="btn btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: copiedSlipKey === '__ALL__' ? '#15803d' : '#ffffff',
              color: copiedSlipKey === '__ALL__' ? '#ffffff' : '#0f172a',
              border: '1px solid #cbd5e1',
              minHeight: 44,
              padding: '8px 14px',
              fontWeight: 700,
              fontSize: '0.82rem',
              borderRadius: '8px',
              cursor: filteredGroups.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {copiedSlipKey === '__ALL__' ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedSlipKey === '__ALL__' ? 'Rekap WA Tersalin' : 'Salin Rekap WA (Grup Karyawan)'}</span>
          </button>

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
              minHeight: 44,
              padding: '8px 16px',
              fontWeight: 700,
              fontSize: '0.82rem',
            }}
          >
            {exportLoading ? <Loader2 size={14} className="spin-icon" /> : <Download size={14} />}
            <span>Export Shift (.xlsx)</span>
          </button>
        </div>
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
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                        <th
                          scope="col"
                          style={{
                            padding: '11px 10px',
                            width: 38,
                            textAlign: 'center',
                          }}
                        >
                          <SelectAllCheckbox
                            checked={selection.allVisibleSelected(visibleGroupKeys)}
                            indeterminate={selection.someVisibleSelected(visibleGroupKeys)}
                            onChange={() => selection.toggleAll(visibleGroupKeys)}
                            ariaLabel="Pilih semua kelompok shift terlihat"
                          />
                        </th>
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
                        const isSelected = selection.isSelected(g.groupKey);

                        return (
                          <Fragment key={g.groupKey}>
                            <tr
                              onClick={() => toggleGroup(g.groupKey)}
                              style={{
                                borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                                backgroundColor: isSelected
                                  ? 'hsl(152 60% 96% / 0.7)'
                                  : isExpanded
                                    ? '#f0fdf4'
                                    : '#ffffff',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                              }}
                            >
                              <td
                                style={{ padding: '12px 10px', textAlign: 'center', width: 38 }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => selection.toggleRow(g.groupKey)}
                                  aria-label={`Pilih kelompok shift ${g.hari} ${g.sesi}`}
                                  style={{
                                    width: 16,
                                    height: 16,
                                    cursor: 'pointer',
                                    accentColor: 'var(--color-primary)',
                                    verticalAlign: 'middle',
                                  }}
                                />
                              </td>
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
                                    {g.transferNote}
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
                                <td colSpan={8} style={{ padding: '14px 20px' }}>
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
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                                      <button
                                        type="button"
                                        onClick={() => handleCopySlip(g.groupKey, buildGroupSlipWaText(g))}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '5px',
                                          padding: '7px 11px',
                                          borderRadius: '7px',
                                          border: '1px solid #cbd5e1',
                                          backgroundColor: copiedSlipKey === g.groupKey ? '#15803d' : '#ffffff',
                                          color: copiedSlipKey === g.groupKey ? '#ffffff' : '#0f172a',
                                          fontSize: '12px',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {copiedSlipKey === g.groupKey ? <Check size={13} /> : <Copy size={13} />}
                                        <span>{copiedSlipKey === g.groupKey ? 'Slip Tersalin' : 'Salin Slip WA'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handlePrintGroupSlip(g)}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '5px',
                                          padding: '7px 11px',
                                          borderRadius: '7px',
                                          border: '1px solid #166534',
                                          backgroundColor: '#f0fdf4',
                                          color: '#166534',
                                          fontSize: '12px',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        <Printer size={13} />
                                        <span>Cetak Slip</span>
                                      </button>
                                    </div>
                                  </div>

                                  {/* Sub-tabel Rincian Per Tanggal Shift */}
                                  <div
                                    style={{
                                      borderRadius: '8px',
                                      border: '1px solid #e2e8f0',
                                      overflowX: 'auto',
                                      WebkitOverflowScrolling: 'touch',
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
                          colSpan={4}
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
                  const isSelected = selection.isSelected(g.groupKey);

                  return (
                    <div
                      key={g.groupKey}
                      className="card"
                      style={{
                        borderRadius: '10px',
                        border: isSelected
                          ? '1.5px solid var(--color-primary)'
                          : isExpanded
                            ? '1.5px solid #166534'
                            : '1px solid var(--color-border)',
                        backgroundColor: isSelected ? 'hsl(152 60% 96% / 0.55)' : '#ffffff',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        onClick={() => toggleGroup(g.groupKey)}
                        style={{ padding: '12px', cursor: 'pointer' }}
                      >
                        {/* Baris 1: Checkbox + Shift Tgl (Hari) & Waktu Sesi */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '8px',
                            marginBottom: '6px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                            <label
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                minWidth: 44,
                                minHeight: 44,
                                margin: '-10px 0 -10px -10px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                flexShrink: 0,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => selection.toggleRow(g.groupKey)}
                                aria-label={`Pilih kelompok shift ${g.hari} ${g.sesi}`}
                                style={{
                                  width: 18,
                                  height: 18,
                                  cursor: 'pointer',
                                  accentColor: 'var(--color-primary)',
                                }}
                              />
                            </label>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                                Shift {g.hari}
                              </div>
                              <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
                                Tgl: {g.shiftTglSummary}
                              </div>
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
                            {g.transferNote}
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
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                  padding: '8px 10px',
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

              <div style={{ marginTop: 'var(--space-4)' }}>
                <SelectedRowsBar
                  selectedCount={selectedGroups.length}
                  itemLabel="kelompok shift"
                  metrics={[
                    { label: 'Total Personel', value: `${selectedTotals.totalPersonel} orang`, tone: 'default' },
                    { label: 'Total Shift', value: `${selectedTotals.totalShiftCount}x shift`, tone: 'info' },
                    { label: 'Transaksi', value: `${selectedTotals.totalTx.toLocaleString('id-ID')} tx`, tone: 'default' },
                    { label: 'Omzet', value: formatRupiah(selectedTotals.totalOmzet), tone: 'info' },
                    { label: 'Laba Kotor', value: formatRupiah(selectedTotals.totalLabaKotor), tone: 'success' },
                    { label: 'Upah Bersih (50%)', value: formatRupiah(selectedTotals.upahBersih), tone: 'primary' },
                  ]}
                  onExportExcel={handleExportSelected}
                  onClear={selection.clearSelection}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
