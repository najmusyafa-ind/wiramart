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
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  Download,
  Search,
  Copy,
  Check,
  Printer,
  Package,
  ShieldAlert,
  X,
  RotateCcw,
  FileText,
  Calendar,
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

export type ShiftCashMovementDetail = {
  id: string;
  movementType: string;
  category: string;
  amount: number;
  notes: string;
  isGraceCorrection: boolean;
  employeeName: string | null;
  createdAt: string;
};

export type ConsignmentDaySummary = {
  settledCount: number;
  openCount: number;
  totalPayout: number;
  totalDiscrepancyQty: number;
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
  unitsSold?: number;
  omzet: number;
  labaKotor: number;
  poolGaji: number;
  modalAwal?: number;
  cashSales?: number;
  cashOut?: number;
  cashIn?: number;
  actualCash?: number | null;
  expectedCash?: number;
  discrepancy?: number | null;
  shortageStatus?: string;
  shortageGraceUntil?: string | null;
  shortageOverrideReason?: string | null;
  shortageDeduction?: number;
  gajiBersih?: number;
  auditFlags?: string | null;
  notes?: string | null;
  cashMovements?: ShiftCashMovementDetail[];
  consignmentSummary?: ConsignmentDaySummary | null;
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
    totalUnitsSold?: number;
    totalShortageDeduction?: number;
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
  externalViewMode?: 'groups' | 'daily_combined';
};

type DailyShiftSession = {
  sessionKey: string;
  shiftId: string;
  tanggal: string;
  hari: string;
  sesi: 'Pagi' | 'Siang';
  slotLabel: string;
  clockIn: string;
  clockOut: string | null;
  kasirName: string;
  txCount: number;
  unitsSold: number;
  omzet: number;
  labaKotor: number;
  modalAwal?: number;
  cashSales: number;
  cashOut: number;
  cashIn: number;
  actualCash?: number | null;
  expectedCash?: number;
  discrepancy?: number | null;
  shortageStatus: string;
  shortageGraceUntil: string | null;
  shortageOverrideReason: string | null;
  shortageDeduction: number;
  upahBersih: number;
  auditFlags?: string | null;
  notes?: string | null;
  cashMovements: ShiftCashMovementDetail[];
  consignmentSummary: ConsignmentDaySummary | null;
  personnel: AttendeeRow[];
};

type ShiftTeamGroup = {
  groupKey: string; // e.g. 'Senin-Pagi'
  hari: string;
  dayOrder: number;
  sesi: 'Pagi' | 'Siang';
  waktuLabel: string; // '07:30–11:30' | '11:30–15:00'
  shiftTglSummary: string;
  anggotaShift: { employeeId: string; fullName: string; nim: string; jabatan: string }[];
  totalPersonel: number;
  totalShiftCount: number;
  upahBersih: number;
  totalTx: number;
  totalUnitsSold: number;
  totalOmzet: number;
  totalLabaKotor: number;
  totalShortageDeduction: number;
  transferNote?: string;
  sessions: DailyShiftSession[];
};

const CASH_CATEGORY_LABELS: Record<string, string> = {
  BAYAR_TITIPAN: 'Bayar Titipan',
  SETOR_OWNER: 'Diambil Bu Dyah',
  BELANJA_STOK: 'Bayar Supplier',
  OPERASIONAL: 'Operasional',
  UANG_TIP: 'Uang Tip',
  TUKAR_RECEH: 'Tukar Receh',
  TAMBAH_MODAL: 'Tambah Modal',
  LAINNYA: 'Lainnya',
};

function formatCashCategory(cat: string): string {
  return CASH_CATEGORY_LABELS[cat] ?? cat.replace(/_/g, ' ');
}

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

export default function RekapShift({ dateFrom: propDateFrom, dateTo: propDateTo, externalViewMode }: RekapShiftProps) {
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

  // Filter tabel shift & mode tampilan
  const [internalViewMode, setInternalViewMode] = useState<'groups' | 'daily_combined'>('groups');
  const viewMode = externalViewMode ?? internalViewMode;
  const [filterSesi, setFilterSesi] = useState<'Semua' | 'Pagi' | 'Siang'>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [slipPreviewGroup, setSlipPreviewGroup] = useState<ShiftTeamGroup | null>(null);

  // Data fetching states (derived loading untuk menghindari setState sinkron di dalam useEffect)
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadedState, setLoadedState] = useState<{
    key: string;
    data: PerShiftData | null;
    error: string;
  } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [copiedSlipKey, setCopiedSlipKey] = useState<string | null>(null);
  const [expandedCashSessions, setExpandedCashSessions] = useState<Record<string, boolean>>({});
  const [overrideTarget, setOverrideTarget] = useState<{
    shiftId: string;
    tanggal: string;
    sesi: string;
    mode: 'CANCEL_DEDUCTION' | 'RESTORE_DEDUCTION';
    amount: number;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  function toggleCashSession(sessionKey: string) {
    setExpandedCashSessions((prev) => ({ ...prev, [sessionKey]: !prev[sessionKey] }));
  }

  async function handleSubmitOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideTarget) return;
    if (overrideReason.trim().length < 5) {
      setOverrideError('Alasan wajib diisi minimal 5 karakter.');
      return;
    }
    setOverrideSubmitting(true);
    setOverrideError('');
    try {
      const res = await fetch(`/api/admin/shifts/${overrideTarget.shiftId}/shortage-override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: overrideTarget.mode,
          reason: overrideReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setOverrideError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan keputusan.');
        return;
      }
      setOverrideTarget(null);
      setOverrideReason('');
      fetchData();
    } catch {
      setOverrideError('Kesalahan jaringan saat memproses override.');
    } finally {
      setOverrideSubmitting(false);
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
          shiftId: s.shiftId,
          tanggal: s.tanggal,
          hari: s.hari,
          sesi: s.sesi,
          slotLabel: s.slotLabel,
          clockIn: s.clockIn,
          clockOut: s.clockOut,
          kasirName: s.kasirName,
          txCount: s.txCount,
          unitsSold: s.unitsSold ?? 0,
          omzet: s.omzet,
          labaKotor: s.labaKotor,
          modalAwal: s.modalAwal,
          cashSales: s.cashSales ?? 0,
          cashOut: s.cashOut ?? 0,
          cashIn: s.cashIn ?? 0,
          actualCash: s.actualCash,
          expectedCash: s.expectedCash,
          discrepancy: s.discrepancy,
          shortageStatus: s.shortageStatus ?? 'NONE',
          shortageGraceUntil: s.shortageGraceUntil ?? null,
          shortageOverrideReason: s.shortageOverrideReason ?? null,
          shortageDeduction: s.shortageDeduction ?? 0,
          upahBersih: gaji,
          auditFlags: s.auditFlags ?? null,
          notes: s.notes ?? null,
          cashMovements: [...(s.cashMovements ?? [])],
          consignmentSummary: s.consignmentSummary ?? null,
          personnel: [...s.personnel],
        });
      } else {
        existing.txCount += s.txCount;
        existing.unitsSold += s.unitsSold ?? 0;
        existing.omzet += s.omzet;
        existing.labaKotor += s.labaKotor;
        existing.cashSales += s.cashSales ?? 0;
        existing.cashOut += s.cashOut ?? 0;
        existing.cashIn += s.cashIn ?? 0;
        existing.upahBersih += gaji;
        if (s.shortageDeduction) {
          existing.shortageDeduction = (existing.shortageDeduction ?? 0) + s.shortageDeduction;
        }
        if (s.shortageStatus && s.shortageStatus !== 'NONE') {
          existing.shortageStatus = s.shortageStatus;
          existing.shortageGraceUntil = s.shortageGraceUntil ?? null;
          existing.shortageOverrideReason = s.shortageOverrideReason ?? null;
        }
        if (s.cashMovements?.length) {
          existing.cashMovements.push(...s.cashMovements);
        }
        if (s.consignmentSummary && !existing.consignmentSummary) {
          existing.consignmentSummary = s.consignmentSummary;
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

      // Anggota Shift: utamakan personel yang BENAR-BENAR hadir pada sesi periode ini
      // agar tabel ringkasan dan isi Slip Gaji 100% sinkron (tidak keliru menampilkan
      // nama jadwal baru pada shift historis / shift badal seperti Kamis Pagi 19 Nov).
      // Fallback ke Master Jadwal hanya jika sesi tidak memiliki catatan personel sama sekali.
      const scheduled = scheduleTeams[gKey] ?? [];
      const memberMap = new Map<string, { employeeId: string; fullName: string; nim: string; jabatan: string }>();

      for (const sess of g.sessions) {
        for (const p of sess.personnel) {
          const pName = (p.fullName || '').toLowerCase();
          const pNim = (p.nim || '').trim();
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

      if (memberMap.size === 0) {
        for (const m of scheduled) {
          memberMap.set(m.employeeId, {
            employeeId: m.employeeId,
            fullName: m.fullName,
            nim: m.nim,
            jabatan: m.jabatan,
          });
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
        waktuLabel: g.sesi === 'Pagi' ? '07:30–11:30' : '11:30–15:00',
        shiftTglSummary: formatGroupedDates(dates),
        anggotaShift,
        totalPersonel: anggotaShift.length,
        totalShiftCount: g.sessions.length,
        upahBersih: g.sessions.reduce((s, x) => s + x.upahBersih, 0),
        totalTx: g.sessions.reduce((s, x) => s + x.txCount, 0),
        totalUnitsSold: g.sessions.reduce((s, x) => s + x.unitsSold, 0),
        totalOmzet: g.sessions.reduce((s, x) => s + x.omzet, 0),
        totalLabaKotor: g.sessions.reduce((s, x) => s + x.labaKotor, 0),
        totalShortageDeduction: g.sessions.reduce((s, x) => s + x.shortageDeduction, 0),
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

  const groupByKey = useMemo(() => {
    const map = new Map<string, ShiftTeamGroup>();
    for (const g of allGroups) {
      map.set(g.groupKey, g);
    }
    return map;
  }, [allGroups]);

  // Ringkasan Perbandingan & Gabungan Shift Pagi + Shift Siang (Omzet, Absen, Gaji)
  const pagiSiangSummary = useMemo(() => {
    const makeBucket = () => ({
      shiftCount: 0,
      txCount: 0,
      unitsSold: 0,
      omzet: 0,
      labaKotor: 0,
      upahBersih: 0,
      totalHadir: 0,
      totalTelat: 0,
    });
    const pagi = makeBucket();
    const siang = makeBucket();

    for (const g of allGroups) {
      const target = g.sesi === 'Pagi' ? pagi : siang;
      target.shiftCount += g.totalShiftCount;
      target.txCount += g.totalTx;
      target.unitsSold += g.totalUnitsSold;
      target.omzet += g.totalOmzet;
      target.labaKotor += g.totalLabaKotor;
      target.upahBersih += g.upahBersih;
      for (const sess of g.sessions) {
        target.totalHadir += sess.personnel.length;
        target.totalTelat += sess.personnel.filter((p) => p.lateMinutes > 0).length;
      }
    }

    const gabungan = {
      shiftCount: pagi.shiftCount + siang.shiftCount,
      txCount: pagi.txCount + siang.txCount,
      unitsSold: pagi.unitsSold + siang.unitsSold,
      omzet: pagi.omzet + siang.omzet,
      labaKotor: pagi.labaKotor + siang.labaKotor,
      upahBersih: pagi.upahBersih + siang.upahBersih,
      totalHadir: pagi.totalHadir + siang.totalHadir,
      totalTelat: pagi.totalTelat + siang.totalTelat,
    };

    return { pagi, siang, gabungan };
  }, [allGroups]);

  // Tabel Harian Gabungan Pagi + Siang (per tanggal, menampilkan omzet, absen hadir, dan gaji per shift)
  const dailyCombinedRows = useMemo(() => {
    const byDate = new Map<
      string,
      {
        tanggal: string;
        hari: string;
        pagi: DailyShiftSession | null;
        siang: DailyShiftSession | null;
      }
    >();

    for (const g of allGroups) {
      for (const sess of g.sessions) {
        const cur = byDate.get(sess.tanggal) ?? {
          tanggal: sess.tanggal,
          hari: sess.hari,
          pagi: null,
          siang: null,
        };
        if (sess.sesi === 'Pagi') {
          cur.pagi = sess;
        } else {
          cur.siang = sess;
        }
        byDate.set(sess.tanggal, cur);
      }
    }

    const q = searchQuery.trim().toLowerCase();
    return Array.from(byDate.values())
      .map((row) => ({
        ...row,
        totalOmzet: (row.pagi?.omzet ?? 0) + (row.siang?.omzet ?? 0),
        totalLabaKotor: (row.pagi?.labaKotor ?? 0) + (row.siang?.labaKotor ?? 0),
        totalTx: (row.pagi?.txCount ?? 0) + (row.siang?.txCount ?? 0),
        totalUnits: (row.pagi?.unitsSold ?? 0) + (row.siang?.unitsSold ?? 0),
        totalHadir: (row.pagi?.personnel.length ?? 0) + (row.siang?.personnel.length ?? 0),
        totalUpah: (row.pagi?.upahBersih ?? 0) + (row.siang?.upahBersih ?? 0),
      }))
      .filter((row) => {
        if (!q) return true;
        return (
          row.tanggal.includes(q) ||
          row.hari.toLowerCase().includes(q) ||
          (row.pagi?.personnel.some((p) => p.fullName.toLowerCase().includes(q)) ?? false) ||
          (row.siang?.personnel.some((p) => p.fullName.toLowerCase().includes(q)) ?? false) ||
          (row.pagi?.kasirName.toLowerCase().includes(q) ?? false) ||
          (row.siang?.kasirName.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  }, [allGroups, searchQuery]);

  const dailyCombinedTotals = useMemo(() => {
    return dailyCombinedRows.reduce(
      (acc, r) => {
        acc.pagiOmzet += r.pagi?.omzet ?? 0;
        acc.pagiUpah += r.pagi?.upahBersih ?? 0;
        acc.pagiHadir += r.pagi?.personnel.length ?? 0;
        acc.siangOmzet += r.siang?.omzet ?? 0;
        acc.siangUpah += r.siang?.upahBersih ?? 0;
        acc.siangHadir += r.siang?.personnel.length ?? 0;
        acc.totalOmzet += r.totalOmzet;
        acc.totalUpah += r.totalUpah;
        acc.totalHadir += r.totalHadir;
        acc.totalTx += r.totalTx;
        return acc;
      },
      {
        pagiOmzet: 0,
        pagiUpah: 0,
        pagiHadir: 0,
        siangOmzet: 0,
        siangUpah: 0,
        siangHadir: 0,
        totalOmzet: 0,
        totalUpah: 0,
        totalHadir: 0,
        totalTx: 0,
      },
    );
  }, [dailyCombinedRows]);

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

  function computeGroupTeamAttendance(g: ShiftTeamGroup) {
    const map = new Map<
      string,
      { fullName: string; nim: string; jabatan: string; hadir: number; telatCount: number; telatMenit: number }
    >();
    for (const sess of g.sessions) {
      for (const p of sess.personnel) {
        const cur = map.get(p.employeeId) ?? {
          fullName: p.fullName,
          nim: p.nim,
          jabatan: p.jabatan,
          hadir: 0,
          telatCount: 0,
          telatMenit: 0,
        };
        cur.hadir += 1;
        const mins = p.lateMinutes || 0;
        if (mins > 0) {
          cur.telatCount += 1;
          cur.telatMenit += mins;
        }
        map.set(p.employeeId, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.hadir - a.hadir || a.fullName.localeCompare(b.fullName));
  }

  function formatDisiplinText(telatCount: number, telatMenit: number): string {
    if (telatCount <= 0 || telatMenit <= 0) return 'Tepat Waktu';
    return `${telatCount}x Telat (${telatMenit} mnt)`;
  }

  function buildGroupSlipWaText(g: ShiftTeamGroup): string {
    const periodLabel = data?.range.label ?? '-';
    const members = computeGroupTeamAttendance(g);
    const lines = [
      `SLIP GAJI SHIFT — WIRAMART UNPERBA`,
      `Shift ${g.hari} ${g.sesi} (${g.waktuLabel} WIB)`,
      `Periode: ${periodLabel} (${g.totalShiftCount}x pertemuan)`,
      `Omzet: ${formatRupiah(g.totalOmzet)} · Laba: ${formatRupiah(g.totalLabaKotor)}`,
      ...(g.totalShortageDeduction > 0
        ? [`Potong Tekor: -${formatRupiah(g.totalShortageDeduction)}`]
        : []),
      `TOTAL GAJI SHIFT: ${formatRupiah(g.upahBersih)} (utuh untuk kelompok)`,
      ``,
      `Absensi Tim:`,
      ...members.map(
        (m, idx) =>
          `${idx + 1}. ${m.fullName} — ${m.hadir}x hadir (${formatDisiplinText(m.telatCount, m.telatMenit)})`,
      ),
      ``,
      `Rincian Per Tanggal:`,
      ...g.sessions.map(
        (s) =>
          `• ${formatShortDate(s.tanggal)}: Omzet ${formatRupiah(s.omzet)} -> Upah ${formatRupiah(s.upahBersih)}${s.shortageDeduction > 0 ? ` (tekor -${formatRupiah(s.shortageDeduction)})` : ''}`,
      ),
    ];
    return lines.join('\n');
  }

  function buildAllShiftsWaText(): string {
    const periodLabel = data?.range.label ?? '-';
    const lines: string[] = [
      `REKAP GAJI PER SHIFT - WIRAMART UNPERBA`,
      `Periode: ${periodLabel}`,
      `Skema: Pembagian Utuh Per Shift (50% Kehadiran Tim · 50% Laba Shift)`,
      `Total Pool Gaji Mahasiswa (50%): ${formatRupiah(data?.grandTotal.totalDistributed ?? data?.grandTotal.poolGaji ?? 0)}`,
      `========================================`,
    ];
    for (const g of filteredGroups) {
      const members = computeGroupTeamAttendance(g);
      const memberSummary =
        members.length > 0
          ? members.map((m) => `${m.fullName} (${m.hadir}x)`).join(', ')
          : g.anggotaShift.map((m) => m.fullName).join(', ') || '-';
      lines.push(`\n[${g.hari} ${g.sesi}] ${g.totalShiftCount}x shift | Omzet ${formatRupiah(g.totalOmzet)}`);
      lines.push(`Total Upah Shift: ${formatRupiah(g.upahBersih)}${g.totalShortageDeduction > 0 ? ` (potong tekor -${formatRupiah(g.totalShortageDeduction)})` : ''}`);
      lines.push(`Tim Hadir: ${memberSummary}`);
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

  function buildPrintableSlipBodyHtml(g: ShiftTeamGroup): string {
    const periodLabel = data?.range.label ?? '-';
    const members = computeGroupTeamAttendance(g);
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsHtml = members
      .map(
        (m, i) =>
          `<tr><td>${i + 1}</td><td>${esc(m.fullName)}</td><td>${esc(m.nim)}</td><td style="text-align:center">${m.hadir}x</td><td style="text-align:center">${esc(formatDisiplinText(m.telatCount, m.telatMenit))}</td></tr>`,
      )
      .join('');
    const sessHtml = g.sessions
      .map(
        (s) =>
          `<tr><td>${esc(s.tanggal)}</td><td>${esc(formatTime(s.clockIn))} - ${s.clockOut ? esc(formatTime(s.clockOut)) : 'Aktif'}</td><td style="text-align:center">${s.txCount} tx / ${s.unitsSold} pcs</td><td style="text-align:right">${esc(formatRupiah(s.omzet))}</td><td style="text-align:right">${esc(formatRupiah(s.labaKotor))}</td><td style="text-align:right;color:${s.shortageDeduction > 0 ? '#dc2626' : '#64748b'}">${s.shortageDeduction > 0 ? `-${esc(formatRupiah(s.shortageDeduction))}` : 'Rp 0'}</td><td style="text-align:right;font-weight:700">${esc(formatRupiah(s.upahBersih))}</td></tr>`,
      )
      .join('');
    return `<div class="slip-page"><h1>SLIP GAJI PER SHIFT - WIRAMART UNPERBA</h1><p>Periode: ${esc(periodLabel)} | Kelompok Shift: <strong>${esc(g.hari)} ${esc(g.sesi)}</strong> (${esc(g.waktuLabel)} WIB)</p><p>Skema: Pembagian Gaji Utuh Per Shift (50% Kehadiran Tim · 50% Laba Shift · Tanpa Pemecahan Per Nama)</p><div class="meta"><div><strong>Jumlah Pertemuan:</strong><br/>${g.totalShiftCount}x Shift</div><div><strong>Total Omzet:</strong><br/>${esc(formatRupiah(g.totalOmzet))}</div><div><strong>Laba Kotor:</strong><br/>${esc(formatRupiah(g.totalLabaKotor))}</div><div><strong>Total Upah Shift:</strong><br/><span style="font-size:15px;font-weight:800;color:#15803d">${esc(formatRupiah(g.upahBersih))}</span></div></div><h2 style="font-size:14px;margin-top:16px">Rincian Pertemuan &amp; Upah Shift</h2><table><thead><tr><th>Tanggal</th><th>Jam</th><th style="text-align:center">Trx / Unit</th><th style="text-align:right">Omzet</th><th style="text-align:right">Laba Kotor</th><th style="text-align:right">Potong Tekor</th><th style="text-align:right">Upah Shift</th></tr></thead><tbody>${sessHtml}</tbody></table><h2 style="font-size:14px;margin-top:16px">Daftar Absensi Tim Shift</h2><table><thead><tr><th>No</th><th>Nama</th><th>NIM</th><th style="text-align:center">Hadir</th><th style="text-align:center">Disiplin</th></tr></thead><tbody>${rowsHtml}</tbody></table><div class="sig"><div class="sig-box"><div>Diserahkan oleh,<br/>Pengelola Wiramart UNPERBA</div><div class="sig-line">Tanda Tangan &amp; Nama Terang</div></div><div class="sig-box"><div>Diterima utuh untuk kelompok,<br/>Perwakilan Shift ${esc(g.hari)} ${esc(g.sesi)}</div><div class="sig-line">Tanda Tangan &amp; Nama Terang</div></div></div></div>`;
  }

  function handlePrintGroupSlip(g: ShiftTeamGroup) {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Slip Gaji Shift ${esc(g.hari)} ${esc(g.sesi)}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:24px;max-width:780px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;font-size:12px;color:#333}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px}th{background:#f1f5f9;text-align:left}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0;padding:10px;border:1px solid #cbd5e1;font-size:12px}.sig{margin-top:28px;display:flex;justify-content:space-between;font-size:12px}.sig-box{width:240px;text-align:center}.sig-line{margin-top:52px;border-top:1px solid #334155;padding-top:4px}@media print{button{display:none}}</style></head><body>${buildPrintableSlipBodyHtml(g)}<div style="margin-top:18px"><button onclick="window.print()">Cetak / Simpan PDF</button></div></body></html>`;
    const win = window.open('', '_blank', 'width=840,height=740');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  function handlePrintAllSlips() {
    if (filteredGroups.length === 0) return;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pagesHtml = filteredGroups.map((g) => buildPrintableSlipBodyHtml(g)).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Semua Slip Gaji Per Shift - ${esc(data?.range.label ?? '')}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:20px;max-width:780px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;font-size:12px;color:#333}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px}th{background:#f1f5f9;text-align:left}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0;padding:10px;border:1px solid #cbd5e1;font-size:12px}.sig{margin-top:24px;display:flex;justify-content:space-between;font-size:12px}.sig-box{width:240px;text-align:center}.sig-line{margin-top:48px;border-top:1px solid #334155;padding-top:4px}.slip-page{padding-bottom:24px;margin-bottom:28px;border-bottom:2px dashed #cbd5e1;page-break-after:always}.slip-page:last-child{border-bottom:none;page-break-after:auto}@media print{.no-print{display:none}.slip-page{border-bottom:none;margin-bottom:0;padding-bottom:0}}</style></head><body><div class="no-print" style="margin-bottom:16px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;display:flex;justify-content:space-between;align-items:center"><span><strong>${filteredGroups.length} Slip Gaji Per Shift</strong> siap cetak (1 halaman per shift).</span><button onclick="window.print()" style="padding:8px 16px;background:#166534;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">Cetak / Simpan Semua PDF</button></div>${pagesHtml}</body></html>`;
    const win = window.open('', '_blank', 'width=860,height=760');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

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
        title: 'LAPORAN KEUANGAN & BAGI HASIL SHIFT — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • Rumus 50% Kehadiran / 50% Laba · Peran Sama Rata (1,0)`,
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
        { no: '1.', rule: 'Rasio Utama 50% : 50% (Closed-Loop)', detail: 'Laba Operasional Bersih dibagi 50% untuk Kas Toko dan 50% untuk Pool Upah Shift Mahasiswa.' },
        { no: '2.', rule: 'Komposisi Antar-Shift 50% / 50%', detail: '50% dibagi berdasarkan kehadiran dan ketepatan waktu tim shift; 50% dibagi proporsional berdasarkan laba kotor shift.' },
        { no: '3.', rule: 'Disiplin Waktu & Toleransi 30 Menit', detail: 'Shift Pagi 07:30 (batas 08:00), Siang 11:30 (batas 12:00). Keterlambatan dihitung setelah batas toleransi: -3% per blok 5 menit (maks 50%).' },
        { no: '4.', rule: 'Pembagian Utuh Per Shift & Audit Selisih Kas', detail: 'Gaji diserahkan utuh kepada masing-masing kelompok shift tanpa pemecahan nominal per nama. Selisih kurang > Rp 2.000 menjadi peringatan audit untuk dicek Admin Shift/Pengelola (tidak otomatis memotong gaji sebelum dikonfirmasi).' },
        { no: '5.', rule: 'Pembulatan Bulat (Hamilton)', detail: 'Distribusi rupiah antar-shift dibulatkan dengan metode Largest Remainder (Hamilton) sehingga sisa pembulatan selalu Rp 0.' },
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
      // SHEET 2: REKAP GAJI PER SHIFT (UTUH PER KELOMPOK SHIFT — TANPA PER NAMA)
      // ─────────────────────────────────────────────────────────────────────
      const ws2 = wb.addWorksheet('Rekap Gaji Per Shift');
      const cols2 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Hari', width: 12, align: 'center' as const },
        { header: 'Sesi', width: 10, align: 'center' as const },
        { header: 'Jam Kerja (WIB)', width: 15, align: 'center' as const },
        { header: 'Jml Anggota', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Frekuensi Shift', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Transaksi', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Unit Laku (pcs)', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Omzet (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Laba Kotor (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Potongan Tekor (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Total Upah Shift (Rp)', width: 20, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Rata-Rata / Shift (Rp)', width: 20, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Anggota Tim Shift (Kehadiran)', width: 46, align: 'left' as const },
        { header: 'Tanda Tangan Perwakilan', width: 22, align: 'center' as const },
      ];
      cols2.forEach((c, i) => {
        ws2.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws2, {
        title: 'REKAPITULASI GAJI UTUH PER KELOMPOK SHIFT — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • ${filteredGroups.length} Kelompok Shift (Pembagian Utuh Per Shift, Bukan Per Nama)`,
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

      let sum2Units = 0;
      let sum2Shortage = 0;

      filteredGroups.forEach((g, idx) => {
        const rowNum = 5 + idx;
        const r = ws2.getRow(rowNum);
        const shiftCount = Math.round(toSafeExcelNum(g.totalShiftCount));
        const unitsG = Math.round(toSafeExcelNum(g.totalUnitsSold));
        const shortageG = Math.round(toSafeExcelNum(g.totalShortageDeduction));
        const upahG = Math.round(toSafeExcelNum(g.upahBersih));
        const avgPerMeeting = shiftCount > 0 ? Math.round(upahG / shiftCount) : 0;
        sum2Units += unitsG;
        sum2Shortage += shortageG;

        const members = computeGroupTeamAttendance(g);
        const memberDetails =
          members.length > 0
            ? members.map((m) => `${m.fullName} (${m.hadir}x${m.telatMenit > 0 ? `, telat ${m.telatMenit}m` : ''})`)
            : g.anggotaShift.map((m) => m.fullName);
        const detailTim = sanitizeExcelText(memberDetails.join(', ')) || '—';

        const values: (string | number | { formula: string; result: number })[] = [
          idx + 1,
          sanitizeExcelText(g.hari),
          sanitizeExcelText(g.sesi),
          sanitizeExcelText(g.waktuLabel),
          Math.round(toSafeExcelNum(g.totalPersonel)),
          shiftCount,
          Math.round(toSafeExcelNum(g.totalTx)),
          unitsG,
          Math.round(toSafeExcelNum(g.totalOmzet)),
          Math.round(toSafeExcelNum(g.totalLabaKotor)),
          shortageG,
          upahG,
          { formula: `IF(F${rowNum}>0,ROUND(L${rowNum}/F${rowNum},0),0)`, result: avgPerMeeting },
          detailTim,
          '',
        ];

        values.forEach((val, cIdx) => {
          const cell = r.getCell(cIdx + 1);
          const meta = cols2[cIdx];
          cell.value = val;
          cell.font = cIdx === 11 ? EXCEL_FONT.BOLD : EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 13,
          };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        r.height = calcWrapRowHeight([{ text: detailTim, width: cols2[13].width }], 24, 14);
      });

      const end2 = 5 + filteredGroups.length - 1;
      const tot2Num = end2 + 1;
      const r2Total = ws2.getRow(tot2Num);
      r2Total.height = 25;
      const sumMap2: Record<number, number> = {
        4: Math.round(toSafeExcelNum(tableTotals.totalPersonel)),
        5: Math.round(toSafeExcelNum(tableTotals.totalShiftCount)),
        6: Math.round(toSafeExcelNum(tableTotals.totalTx)),
        7: sum2Units,
        8: Math.round(toSafeExcelNum(tableTotals.totalOmzet)),
        9: Math.round(toSafeExcelNum(tableTotals.totalLabaKotor)),
        10: sum2Shortage,
        11: Math.round(toSafeExcelNum(tableTotals.upahBersih)),
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
        } else if (cIdx === 12) {
          cell.value = { formula: `IF(F${tot2Num}>0,ROUND(L${tot2Num}/F${tot2Num},0),0)`, result: avgAll2 };
        } else if (cIdx === 13) {
          cell.value = sanitizeExcelText(
            `Total Upah Per Shift: Rp ${Math.round(tableTotals.upahBersih).toLocaleString('id-ID')}`,
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
      // SHEET 3: LOG PERTEMUAN SHIFT (AUDIT KAS LACI & UPAH PER SHIFT)
      // ─────────────────────────────────────────────────────────────────────
      const ws3 = wb.addWorksheet('Log Pertemuan Shift');
      const cols3 = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Tanggal', width: 13, align: 'center' as const },
        { header: 'Hari', width: 11, align: 'center' as const },
        { header: 'Sesi', width: 10, align: 'center' as const },
        { header: 'Kasir Bertugas', width: 24, align: 'left' as const },
        { header: 'Buka (WIB)', width: 11, align: 'center' as const },
        { header: 'Tutup (WIB)', width: 11, align: 'center' as const },
        { header: 'Trx', width: 9, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Unit (pcs)', width: 11, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Omzet (Rp)', width: 17, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Laba Kotor (Rp)', width: 17, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Modal Awal (Rp)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Kas Keluar (Rp)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Fisik Laci (Rp)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Potong Tekor (Rp)', width: 16, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Upah Shift (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Anggota Hadir (Kehadiran & Disiplin)', width: 44, align: 'left' as const },
      ];
      cols3.forEach((c, i) => {
        ws3.getColumn(i + 1).width = c.width;
      });

      styleBannerBlock(ws3, {
        title: 'JURNAL LOG PERTEMUAN, AUDIT KAS & UPAH PER SHIFT — WIRAMART UNPERBA',
        subtitle: `${subtitlePeriod} • Total Pertemuan Shift: ${data.shifts.length} Shift`,
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

      let sum3Tx = 0;
      let sum3Units = 0;
      let sum3Omzet = 0;
      let sum3Laba = 0;
      let sum3Shortage = 0;
      let sum3Upah = 0;

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
        const unitsN = Math.round(toSafeExcelNum(s.unitsSold ?? 0));
        const omzN = Math.round(toSafeExcelNum(s.omzet));
        const labaN = Math.round(toSafeExcelNum(s.labaKotor));
        const modalN = Math.round(toSafeExcelNum(s.modalAwal ?? 100_000));
        const cashOutN = Math.round(toSafeExcelNum(s.cashOut ?? 0));
        const actualCashVal =
          s.actualCash !== null && s.actualCash !== undefined ? Math.round(toSafeExcelNum(s.actualCash)) : '—';
        const shortageN = Math.round(toSafeExcelNum(s.shortageDeduction ?? 0));
        const gajiN = Math.round(
          toSafeExcelNum(s.gajiBersih !== undefined ? s.gajiBersih : s.personnelCount > 0 ? s.poolGaji : 0),
        );

        sum3Tx += txN;
        sum3Units += unitsN;
        sum3Omzet += omzN;
        sum3Laba += labaN;
        sum3Shortage += shortageN;
        sum3Upah += gajiN;

        const personelList = sanitizeExcelText(
          s.personnel
            .map((p) => (p.lateMinutes > 0 ? `${p.fullName} (telat ${p.lateMinutes}m)` : p.fullName))
            .join(', '),
        ) || 'Hanya Kasir';
        const kasirTxt = sanitizeExcelText(s.kasirName) || '—';

        const r = ws3.getRow(5 + idx);
        const vals: (string | number)[] = [
          idx + 1,
          sanitizeExcelText(s.tanggal) || '—',
          sanitizeExcelText(s.hari) || '—',
          sanitizeExcelText(s.sesi) || '—',
          kasirTxt,
          inTime,
          outTime,
          txN,
          unitsN,
          omzN,
          labaN,
          modalN,
          cashOutN,
          actualCashVal,
          shortageN,
          gajiN,
          personelList,
        ];

        vals.forEach((val, cIdx) => {
          const cell = r.getCell(cIdx + 1);
          const meta = cols3[cIdx];
          cell.value = val;
          cell.font = cIdx === 15 ? EXCEL_FONT.BOLD : EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 4 || cIdx === 16,
          };
          if (meta.fmt && typeof val === 'number') cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        r.height = calcWrapRowHeight(
          [
            { text: kasirTxt, width: cols3[4].width },
            { text: personelList, width: cols3[16].width },
          ],
          22,
          14,
        );
      });

      if (data.shifts.length > 0) {
        const end3 = 5 + data.shifts.length - 1;
        const tot3Num = end3 + 1;
        const r3Total = ws3.getRow(tot3Num);
        r3Total.height = 25;
        const sumMap3: Record<number, number> = {
          7: sum3Tx,
          8: sum3Units,
          9: sum3Omzet,
          10: sum3Laba,
          14: sum3Shortage,
          15: sum3Upah,
        };
        ws3.mergeCells(`B${tot3Num}:D${tot3Num}`);

        cols3.forEach((c, cIdx) => {
          const cell = r3Total.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 1) {
            cell.value = 'TOTAL KESELURUHAN';
          } else if (cIdx === 4) {
            cell.value = `${data.shifts.length} Pertemuan Shift`;
          } else if (cIdx in sumMap3) {
            cell.value = { formula: `SUM(${colChar}5:${colChar}${end3})`, result: sumMap3[cIdx] };
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

      await downloadWorkbookBlob(
        wb,
        `Laporan_Gaji_Per_Shift_Wiramart_${data.range.startDate}_sd_${data.range.endDate}.xlsx`,
      );
    } catch (e) {
      console.error(e);
      alert('Gagal mengekspor Excel.');
    } finally {
      setExportLoading(false);
    }
  }

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
                fontSize: '1.05rem',
                fontWeight: 800,
                color: 'var(--color-text, #111827)',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <TrendingUp size={18} style={{ color: '#166534', flexShrink: 0 }} />
              <span>Shift &amp; Slip Gaji — {data?.range.label ?? 'Memuat...'}</span>
            </h2>
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
          <div className="rep-chip-bar" style={{ maxWidth: '100%' }}>
            {(
              [
                { id: 'monthly', label: 'Bulanan' },
                { id: 'daily', label: 'Harian' },
                { id: 'october', label: 'Oktober' },
                { id: 'november', label: 'November' },
                { id: 'all', label: 'Semua' },
                { id: 'range', label: 'Tanggal' },
              ] as const
            ).map((m) => {
              const isActive = filterMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFilterMode(m.id)}
                  className={`rep-chip${isActive ? ' active' : ''}`}
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
          2. RINGKASAN SHIFT PAGI, SHIFT SIANG & TOTAL GABUNGAN
          ───────────────────────────────────────────────────────────── */}
      {!loading && !error && allGroups.length > 0 && (
        <div className="rep-kpi-grid rep-kpi-grid--3">
          {[
            {
              title: 'Shift Pagi',
              jam: '07:30–11:30',
              icon: <Sun size={15} />,
              accent: '#d97706',
              omzet: pagiSiangSummary.pagi.omzet,
              upah: pagiSiangSummary.pagi.upahBersih,
              hadir: pagiSiangSummary.pagi.totalHadir,
              telat: pagiSiangSummary.pagi.totalTelat,
              shiftCount: pagiSiangSummary.pagi.shiftCount,
              txCount: pagiSiangSummary.pagi.txCount,
            },
            {
              title: 'Shift Siang',
              jam: '11:30–15:00',
              icon: <Sunset size={15} />,
              accent: '#4f46e5',
              omzet: pagiSiangSummary.siang.omzet,
              upah: pagiSiangSummary.siang.upahBersih,
              hadir: pagiSiangSummary.siang.totalHadir,
              telat: pagiSiangSummary.siang.totalTelat,
              shiftCount: pagiSiangSummary.siang.shiftCount,
              txCount: pagiSiangSummary.siang.txCount,
            },
            {
              title: 'Total (Pagi + Siang)',
              jam: `${pagiSiangSummary.gabungan.shiftCount}x shift`,
              icon: <TrendingUp size={15} />,
              accent: '#15803d',
              omzet: pagiSiangSummary.gabungan.omzet,
              upah: pagiSiangSummary.gabungan.upahBersih,
              hadir: pagiSiangSummary.gabungan.totalHadir,
              telat: pagiSiangSummary.gabungan.totalTelat,
              shiftCount: pagiSiangSummary.gabungan.shiftCount,
              txCount: pagiSiangSummary.gabungan.txCount,
            },
          ].map((box) => (
            <div
              key={box.title}
              className="rep-kpi"
              style={{ borderLeft: `3px solid ${box.accent}` }}
            >
              <div className="rep-kpi__top">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.76rem', fontWeight: 700, color: '#0f172a' }}>
                  <span style={{ color: box.accent }}>{box.icon}</span>
                  {box.title}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{box.jam}</span>
              </div>

              <div className="rep-kpi__val" style={{ marginTop: 2 }}>
                {formatRupiah(box.omzet)}
              </div>
              <div className="rep-kpi__sub">
                {box.txCount.toLocaleString('id-ID')} tx · {box.shiftCount}x shift
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  paddingTop: 7,
                  marginTop: 4,
                  borderTop: '1px solid #f1f5f9',
                  fontSize: '0.74rem',
                }}
              >
                <span style={{ fontWeight: 600, color: '#334155' }}>
                  Absen {box.hadir}
                  {box.telat > 0 && <span style={{ color: '#b45309' }}> ({box.telat} telat)</span>}
                </span>
                <span style={{ fontWeight: 800, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>
                  Gaji {formatRupiah(box.upah)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. TOOLBAR TABEL: FILTER SESI, PENCARIAN & AKSI
          ───────────────────────────────────────────────────────────── */}
      <div className="rs-toolbar-actions">
        <div className="rep-chip-bar" style={{ maxWidth: '100%' }}>
          {!externalViewMode && (
            <div role="tablist" aria-label="Mode tampilan rekap shift" className="rep-seg" style={{ marginRight: 4 }}>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'groups'}
                onClick={() => setInternalViewMode('groups')}
                className={`rep-seg-btn${viewMode === 'groups' ? ' active' : ''}`}
              >
                <FileText size={13} />
                <span>Slip Gaji Shift</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'daily_combined'}
                onClick={() => setInternalViewMode('daily_combined')}
                className={`rep-seg-btn${viewMode === 'daily_combined' ? ' active' : ''}`}
              >
                <Calendar size={13} />
                <span>Harian Pagi+Siang</span>
              </button>
            </div>
          )}

          {viewMode === 'groups' &&
            (
              [
                { key: 'Semua', label: `Semua (${sesiCounts.semua})` },
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
                  className={`rep-chip${active ? ' active' : ''}`}
                >
                  {item.key === 'Pagi' && <Sun size={13} style={{ color: active ? '#fde68a' : '#d97706' }} />}
                  {item.key === 'Siang' && <Sunset size={13} style={{ color: active ? '#c7d2fe' : '#4f46e5' }} />}
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
            onClick={handlePrintAllSlips}
            disabled={filteredGroups.length === 0}
            className="btn btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#f0fdf4',
              color: '#166534',
              border: '1px solid #86efac',
              minHeight: 44,
              padding: '8px 13px',
              fontWeight: 700,
              fontSize: '0.8rem',
              borderRadius: '8px',
              cursor: filteredGroups.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <Printer size={14} />
            <span>Cetak Semua Slip</span>
          </button>

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
              padding: '8px 13px',
              fontWeight: 700,
              fontSize: '0.8rem',
              borderRadius: '8px',
              cursor: filteredGroups.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {copiedSlipKey === '__ALL__' ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedSlipKey === '__ALL__' ? 'Rekap Tersalin' : 'Salin Rekap WA'}</span>
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
              padding: '8px 14px',
              fontWeight: 700,
              fontSize: '0.8rem',
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
          ) : viewMode === 'daily_combined' ? (
            <>
              {/* ── MODE HARIAN: PERBANDINGAN & GABUNGAN SHIFT PAGI + SIANG + ABSEN ── */}
              {dailyCombinedRows.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--color-text-muted)' }}>
                  Tidak ada catatan harian shift yang cocok dengan pencarian.
                </div>
              ) : (
                <>
                  {/* Desktop Table Harian Pagi + Siang */}
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
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid var(--color-border)' }}>
                            <th style={{ padding: '11px 14px', textAlign: 'left', color: '#475569', fontSize: '11px', textTransform: 'uppercase' }}>
                              Tanggal &amp; Hari
                            </th>
                            <th style={{ padding: '11px 14px', textAlign: 'left', color: '#b45309', fontSize: '11px', textTransform: 'uppercase', backgroundColor: '#fffbeb' }}>
                              Shift Pagi (Omzet · Absen · Gaji)
                            </th>
                            <th style={{ padding: '11px 14px', textAlign: 'left', color: '#4338ca', fontSize: '11px', textTransform: 'uppercase', backgroundColor: '#eef2ff' }}>
                              Shift Siang (Omzet · Absen · Gaji)
                            </th>
                            <th style={{ padding: '11px 14px', textAlign: 'right', color: '#166534', fontSize: '11px', textTransform: 'uppercase', backgroundColor: '#f0fdf4' }}>
                              Gabungan (Pagi + Siang)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyCombinedRows.map((row) => {
                            const pagiGroup = groupByKey.get(`${row.hari}-Pagi`);
                            const siangGroup = groupByKey.get(`${row.hari}-Siang`);
                            return (
                              <tr key={row.tanggal} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                                <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>{row.hari}</div>
                                  <div style={{ fontSize: '11.5px', color: '#475569' }}>{formatShortDate(row.tanggal)}</div>
                                  <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: 3 }}>
                                    {row.totalTx} tx · {row.totalUnits} pcs
                                  </div>
                                </td>

                                {/* Shift Pagi */}
                                <td style={{ padding: '12px 14px', backgroundColor: '#fffbeb40' }}>
                                  {row.pagi ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                                          {formatRupiah(row.pagi.omzet)}
                                        </span>
                                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#15803d', backgroundColor: '#dcfce7', padding: '2px 7px', borderRadius: '6px' }}>
                                          Gaji {formatRupiah(row.pagi.upahBersih)}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '11px', color: '#475569' }}>
                                        {row.pagi.txCount} tx · {row.pagi.unitsSold} pcs · {formatTime(row.pagi.clockIn)}–{row.pagi.clockOut ? formatTime(row.pagi.clockOut) : 'Aktif'}
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#b45309', backgroundColor: '#fef3c7', padding: '2px 6px', borderRadius: '99px' }}>
                                          Absen: {row.pagi.personnel.length} hadir
                                        </span>
                                        {row.pagi.personnel.map((p) => (
                                          <span
                                            key={p.employeeId}
                                            style={{
                                              fontSize: '10.5px',
                                              padding: '2px 6px',
                                              borderRadius: '5px',
                                              backgroundColor: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              color: '#1e293b',
                                            }}
                                          >
                                            {p.fullName}
                                            {p.lateMinutes > 0 && <strong style={{ color: '#b45309' }}> +{p.lateMinutes}m</strong>}
                                          </span>
                                        ))}
                                      </div>
                                      {pagiGroup && (
                                        <div>
                                          <button
                                            type="button"
                                            onClick={() => setSlipPreviewGroup(pagiGroup)}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              padding: '3px 8px',
                                              borderRadius: '6px',
                                              border: '1px solid #166534',
                                              backgroundColor: '#f0fdf4',
                                              color: '#166534',
                                              fontSize: '11px',
                                              fontWeight: 700,
                                              cursor: 'pointer',
                                            }}
                                          >
                                            <FileText size={11} /> Slip Shift Pagi
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '11.5px' }}>Tidak ada sesi pagi</span>
                                  )}
                                </td>

                                {/* Shift Siang */}
                                <td style={{ padding: '12px 14px', backgroundColor: '#eef2ff40' }}>
                                  {row.siang ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                                          {formatRupiah(row.siang.omzet)}
                                        </span>
                                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#15803d', backgroundColor: '#dcfce7', padding: '2px 7px', borderRadius: '6px' }}>
                                          Gaji {formatRupiah(row.siang.upahBersih)}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '11px', color: '#475569' }}>
                                        {row.siang.txCount} tx · {row.siang.unitsSold} pcs · {formatTime(row.siang.clockIn)}–{row.siang.clockOut ? formatTime(row.siang.clockOut) : 'Aktif'}
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#4338ca', backgroundColor: '#e0e7ff', padding: '2px 6px', borderRadius: '99px' }}>
                                          Absen: {row.siang.personnel.length} hadir
                                        </span>
                                        {row.siang.personnel.map((p) => (
                                          <span
                                            key={p.employeeId}
                                            style={{
                                              fontSize: '10.5px',
                                              padding: '2px 6px',
                                              borderRadius: '5px',
                                              backgroundColor: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              color: '#1e293b',
                                            }}
                                          >
                                            {p.fullName}
                                            {p.lateMinutes > 0 && <strong style={{ color: '#b45309' }}> +{p.lateMinutes}m</strong>}
                                          </span>
                                        ))}
                                      </div>
                                      {siangGroup && (
                                        <div>
                                          <button
                                            type="button"
                                            onClick={() => setSlipPreviewGroup(siangGroup)}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              padding: '3px 8px',
                                              borderRadius: '6px',
                                              border: '1px solid #166534',
                                              backgroundColor: '#f0fdf4',
                                              color: '#166534',
                                              fontSize: '11px',
                                              fontWeight: 700,
                                              cursor: 'pointer',
                                            }}
                                          >
                                            <FileText size={11} /> Slip Shift Siang
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '11.5px' }}>Tidak ada sesi siang</span>
                                  )}
                                </td>

                                {/* Gabungan Pagi + Siang */}
                                <td style={{ padding: '12px 14px', textAlign: 'right', backgroundColor: '#f0fdf450', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                                    {formatRupiah(row.totalOmzet)}
                                  </div>
                                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#15803d', marginTop: 3 }}>
                                    Total Gaji: {formatRupiah(row.totalUpah)}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#475569', marginTop: 3 }}>
                                    Total Absen: <strong>{row.totalHadir} hadir</strong>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: '2px solid var(--color-border)', backgroundColor: '#f8fafc' }}>
                            <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0f172a' }}>
                              TOTAL ({dailyCombinedRows.length} Hari · {dailyCombinedTotals.totalTx} tx)
                            </td>
                            <td style={{ padding: '12px 14px', backgroundColor: '#fffbeb' }}>
                              <div style={{ fontWeight: 800, color: '#b45309' }}>Omzet: {formatRupiah(dailyCombinedTotals.pagiOmzet)}</div>
                              <div style={{ fontSize: '11px', color: '#475569' }}>
                                Absen: {dailyCombinedTotals.pagiHadir} hadir · Gaji: <strong style={{ color: '#15803d' }}>{formatRupiah(dailyCombinedTotals.pagiUpah)}</strong>
                              </div>
                            </td>
                            <td style={{ padding: '12px 14px', backgroundColor: '#eef2ff' }}>
                              <div style={{ fontWeight: 800, color: '#4338ca' }}>Omzet: {formatRupiah(dailyCombinedTotals.siangOmzet)}</div>
                              <div style={{ fontSize: '11px', color: '#475569' }}>
                                Absen: {dailyCombinedTotals.siangHadir} hadir · Gaji: <strong style={{ color: '#15803d' }}>{formatRupiah(dailyCombinedTotals.siangUpah)}</strong>
                              </div>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'right', backgroundColor: '#f0fdf4' }}>
                              <div style={{ fontWeight: 800, fontSize: '14px', color: '#166534' }}>
                                {formatRupiah(dailyCombinedTotals.totalOmzet)}
                              </div>
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#15803d' }}>
                                Gaji: {formatRupiah(dailyCombinedTotals.totalUpah)} · {dailyCombinedTotals.totalHadir} hadir
                              </div>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Mobile Cards Harian Pagi + Siang */}
                  <div className="rs-mobile-list">
                    {dailyCombinedRows.map((row) => (
                      <div
                        key={row.tanggal}
                        className="card"
                        style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--color-border)', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '8px' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                              {row.hari}, {formatShortDate(row.tanggal)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              Gabungan: {row.totalTx} tx · {row.totalHadir} hadir
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, color: '#166534', fontSize: '0.92rem' }}>{formatRupiah(row.totalOmzet)}</div>
                            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#15803d' }}>Gaji {formatRupiah(row.totalUpah)}</div>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                            <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#b45309' }}>Shift Pagi</div>
                            {row.pagi ? (
                              <>
                                <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#0f172a', marginTop: 2 }}>{formatRupiah(row.pagi.omzet)}</div>
                                <div style={{ fontSize: '10px', color: '#15803d', fontWeight: 700 }}>Gaji {formatRupiah(row.pagi.upahBersih)}</div>
                                <div style={{ fontSize: '10px', color: '#475569', marginTop: 3 }}>
                                  Absen ({row.pagi.personnel.length}): {row.pagi.personnel.map((p) => p.fullName).join(', ') || '-'}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: 4 }}>—</div>
                            )}
                          </div>

                          <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe' }}>
                            <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#4338ca' }}>Shift Siang</div>
                            {row.siang ? (
                              <>
                                <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#0f172a', marginTop: 2 }}>{formatRupiah(row.siang.omzet)}</div>
                                <div style={{ fontSize: '10px', color: '#15803d', fontWeight: 700 }}>Gaji {formatRupiah(row.siang.upahBersih)}</div>
                                <div style={{ fontSize: '10px', color: '#475569', marginTop: 3 }}>
                                  Absen ({row.siang.personnel.length}): {row.siang.personnel.map((p) => p.fullName).join(', ') || '-'}
                                </div>
                              </>
                            ) : (
                              <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: 4 }}>—</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* ── A. DESKTOP TABLE (6 KOLOM + SLIP GAJI & PANAH ▼) ── */}
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
                          { label: 'Hari & Tanggal', align: 'left' },
                          { label: 'Anggota Shift', align: 'left' },
                          { label: 'Personel', align: 'center' },
                          { label: 'Jumlah Shift', align: 'center' },
                          { label: 'Upah Bersih', align: 'right' },
                          { label: 'Slip & Detail', align: 'center' },
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

                              {/* 7. Slip Gaji + Panah Detail (▼) */}
                              <td style={{ padding: '12px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSlipPreviewGroup(g);
                                    }}
                                    aria-label={`Lihat slip gaji ${g.hari} ${g.sesi}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '5px 9px',
                                      borderRadius: '6px',
                                      border: '1px solid #166534',
                                      backgroundColor: '#f0fdf4',
                                      color: '#166534',
                                      fontSize: '11.5px',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <FileText size={13} />
                                    <span>Slip Gaji</span>
                                  </button>
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
                                </div>
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
                                        Transaksi & Barang Laku
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#4f46e5' }}>
                                        {g.totalTx.toLocaleString('id-ID')} tx · {g.totalUnitsSold.toLocaleString('id-ID')} pcs
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Omzet Shift
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0284c7' }}>
                                        {formatRupiah(g.totalOmzet)}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Laba Kotor
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>
                                        {formatRupiah(g.totalLabaKotor)}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                        Rata-rata Upah / Shift
                                      </div>
                                      <div style={{ fontWeight: 800, fontSize: '1rem', color: '#15803d' }}>
                                        {formatRupiah(
                                          g.totalShiftCount > 0
                                            ? Math.round(g.upahBersih / g.totalShiftCount)
                                            : 0
                                        )}
                                      </div>
                                    </div>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                                        <button
                                          type="button"
                                          onClick={() => setSlipPreviewGroup(g)}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                            padding: '7px 11px',
                                            borderRadius: '7px',
                                            border: '1px solid #166534',
                                            backgroundColor: '#166534',
                                            color: '#ffffff',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          <FileText size={13} />
                                          <span>Lihat Slip</span>
                                        </button>
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

                                  {/* Daftar Kehadiran Tim Shift (Gaji Diserahkan Utuh Per Shift) */}
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: '8px',
                                      marginBottom: '12px',
                                      padding: '10px 12px',
                                      backgroundColor: '#ffffff',
                                      borderRadius: '8px',
                                      border: '1px solid #e2e8f0',
                                    }}
                                  >
                                    <div style={{ width: '100%', fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                                      Absensi Tim:
                                    </div>
                                    {computeGroupTeamAttendance(g).map((m) => (
                                      <div
                                        key={m.nim || m.fullName}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                          padding: '5px 10px',
                                          borderRadius: '8px',
                                          backgroundColor: '#f8fafc',
                                          border: '1px solid #e2e8f0',
                                          fontSize: '11.5px',
                                        }}
                                      >
                                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.fullName}</span>
                                        <span style={{ color: '#475569', fontWeight: 600 }}>
                                          {m.hadir}x hadir
                                        </span>
                                        {m.telatMenit > 0 && (
                                          <span style={{ color: '#b45309', fontWeight: 700 }}>
                                            · telat {m.telatMenit}m
                                          </span>
                                        )}
                                      </div>
                                    ))}
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
                                          <th style={{ padding: '8px 12px', textAlign: 'center', width: '36px', color: '#475569' }}>
                                            #
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#475569' }}>
                                            Tanggal
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#475569' }}>
                                            Jam Shift
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#475569' }}>
                                            Personel Hadir
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'center', color: '#475569' }}>
                                            Trx / Barang
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>
                                            Omzet
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>
                                            Laba Kotor
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'center', color: '#475569' }}>
                                            Kas Laci & Tekor
                                          </th>
                                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#475569' }}>
                                            Upah Shift
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {g.sessions.map((sess, sIdx) => {
                                          const cashOpen = !!expandedCashSessions[sess.sessionKey];
                                          const hasGraceTag = sess.cashMovements.some((m) => m.isGraceCorrection);
                                          const hasAuditDetails =
                                            sess.cashMovements.length > 0 ||
                                            (sess.actualCash !== null && sess.actualCash !== undefined) ||
                                            sess.consignmentSummary !== null ||
                                            sess.shortageStatus !== 'NONE';
                                          return (
                                            <Fragment key={sess.sessionKey}>
                                              <tr
                                                style={{
                                                  borderBottom:
                                                    cashOpen || sIdx < g.sessions.length - 1
                                                      ? '1px solid #f1f5f9'
                                                      : 'none',
                                                }}
                                              >
                                                <td style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b' }}>
                                                  {sIdx + 1}
                                                </td>
                                                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                                  {sess.hari}, {formatShortDate(sess.tanggal)}
                                                </td>
                                                <td style={{ padding: '8px 12px', color: '#475569', whiteSpace: 'nowrap' }}>
                                                  {formatTime(sess.clockIn)} – {sess.clockOut ? formatTime(sess.clockOut) : 'Aktif'} WIB
                                                </td>
                                                <td style={{ padding: '8px 12px', color: '#334155' }}>
                                                  <div style={{ fontWeight: 600 }}>
                                                    {sess.personnel.length > 0
                                                      ? sess.personnel.map((p) => p.fullName).join(', ')
                                                      : `Kasir: ${sess.kasirName}`}
                                                  </div>
                                                  {sess.personnel.some((p) => p.lateMinutes > 0) && (
                                                    <div style={{ color: '#d97706', fontSize: '11px', fontWeight: 600, marginTop: '2px' }}>
                                                      Telat:{' '}
                                                      {sess.personnel
                                                        .filter((p) => p.lateMinutes > 0)
                                                        .map((p) => `${p.fullName} +${p.lateMinutes}m`)
                                                        .join(', ')}
                                                    </div>
                                                  )}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                  <div style={{ fontWeight: 700, color: '#4f46e5' }}>{sess.txCount} tx</div>
                                                  <div style={{ fontSize: '10.5px', color: '#64748b' }}>{sess.unitsSold} pcs</div>
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0f172a', whiteSpace: 'nowrap' }}>
                                                  {formatRupiah(sess.omzet)}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', color: '#0284c7', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                  {formatRupiah(sess.labaKotor)}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                    {sess.shortageStatus === 'PENDING_GRACE' ? (
                                                      <span
                                                        style={{
                                                          padding: '2px 8px',
                                                          borderRadius: '6px',
                                                          backgroundColor: '#fffbeb',
                                                          border: '1px solid #fcd34d',
                                                          color: '#b45309',
                                                          fontSize: '11px',
                                                          fontWeight: 700,
                                                        }}
                                                      >
                                                        Jeda 5 Menit ({formatRupiah(sess.discrepancy ?? 0)})
                                                      </span>
                                                    ) : sess.shortageStatus === 'AUTO_LOCKED' || sess.shortageDeduction > 0 ? (
                                                      <span
                                                        style={{
                                                          padding: '2px 8px',
                                                          borderRadius: '6px',
                                                          backgroundColor: '#fef2f2',
                                                          border: '1px solid #fecaca',
                                                          color: '#dc2626',
                                                          fontSize: '11px',
                                                          fontWeight: 700,
                                                        }}
                                                      >
                                                        Potong -{formatRupiah(sess.shortageDeduction)}
                                                      </span>
                                                    ) : sess.shortageStatus === 'AUDIT_WARNING' ? (
                                                      <span
                                                        style={{
                                                          padding: '2px 8px',
                                                          borderRadius: '6px',
                                                          backgroundColor: '#fff7ed',
                                                          border: '1px solid #fdba74',
                                                          color: '#c2410c',
                                                          fontSize: '11px',
                                                          fontWeight: 700,
                                                        }}
                                                        title="Peringatan audit kas — belum memotong gaji shift"
                                                      >
                                                        Perlu Cek ({formatRupiah(sess.discrepancy ?? 0)})
                                                      </span>
                                                    ) : sess.shortageStatus === 'OVERRIDDEN' ? (
                                                      <span
                                                        style={{
                                                          padding: '2px 8px',
                                                          borderRadius: '6px',
                                                          backgroundColor: '#eff6ff',
                                                          border: '1px solid #bfdbfe',
                                                          color: '#1d4ed8',
                                                          fontSize: '11px',
                                                          fontWeight: 700,
                                                        }}
                                                        title={sess.shortageOverrideReason ?? undefined}
                                                      >
                                                        Ditandai Wajar
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
                                                      ) : sess.discrepancy < -2000 ? (
                                                        <span
                                                          style={{
                                                            padding: '2px 8px',
                                                            borderRadius: '6px',
                                                            backgroundColor: '#fff7ed',
                                                            border: '1px solid #fdba74',
                                                            color: '#c2410c',
                                                            fontSize: '11px',
                                                            fontWeight: 700,
                                                          }}
                                                          title="Peringatan audit kas — belum memotong gaji shift"
                                                        >
                                                          Perlu Cek ({formatRupiah(sess.discrepancy)})
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
                                                          Klop
                                                        </span>
                                                      )
                                                    ) : (
                                                      <span style={{ color: '#94a3b8', fontSize: '11px' }}>—</span>
                                                    )}
                                                    {hasAuditDetails && (
                                                      <button
                                                        type="button"
                                                        onClick={() => toggleCashSession(sess.sessionKey)}
                                                        style={{
                                                          padding: '2px 7px',
                                                          borderRadius: '5px',
                                                          border: hasGraceTag ? '1px solid #f59e0b' : '1px solid #cbd5e1',
                                                          backgroundColor: hasGraceTag ? '#fffbeb' : '#ffffff',
                                                          color: hasGraceTag ? '#b45309' : '#334155',
                                                          fontSize: '10.5px',
                                                          fontWeight: 700,
                                                          cursor: 'pointer',
                                                        }}
                                                      >
                                                        {cashOpen
                                                          ? 'Tutup Audit'
                                                          : hasGraceTag
                                                            ? 'Audit Kas [Jeda 5m]'
                                                            : `Audit Kas${sess.cashMovements.length > 0 ? ` (${sess.cashMovements.length})` : ''}`}
                                                      </button>
                                                    )}
                                                  </div>
                                                </td>
                                                <td
                                                  style={{
                                                    padding: '8px 12px',
                                                    textAlign: 'right',
                                                    fontWeight: 800,
                                                    color: '#15803d',
                                                    whiteSpace: 'nowrap',
                                                  }}
                                                >
                                                  {formatRupiah(sess.upahBersih)}
                                                </td>
                                              </tr>
                                              {cashOpen && (
                                                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                  <td colSpan={9} style={{ padding: '10px 14px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '11.5px', color: '#334155' }}>
                                                        <span>Modal: <strong>{formatRupiah(sess.modalAwal ?? 0)}</strong></span>
                                                        <span>Cash POS: <strong>{formatRupiah(sess.cashSales)}</strong></span>
                                                        <span>Kas Keluar: <strong style={{ color: '#dc2626' }}>-{formatRupiah(sess.cashOut)}</strong></span>
                                                        <span>Kas Masuk: <strong style={{ color: '#16a34a' }}>+{formatRupiah(sess.cashIn)}</strong></span>
                                                        <span>Seharusnya: <strong>{formatRupiah(sess.expectedCash ?? 0)}</strong></span>
                                                        <span>Fisik Laci: <strong>{sess.actualCash !== null && sess.actualCash !== undefined ? formatRupiah(sess.actualCash) : 'Belum tutup'}</strong></span>
                                                      </div>

                                                      {sess.consignmentSummary && (
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', fontSize: '11.5px', color: '#0f172a', width: 'fit-content' }}>
                                                          <Package size={13} color="#166534" />
                                                          <span>
                                                            Titipan Harian: <strong>{sess.consignmentSummary.settledCount} lunas</strong> ({formatRupiah(sess.consignmentSummary.totalPayout)})
                                                            {sess.consignmentSummary.openCount > 0 ? ` · ${sess.consignmentSummary.openCount} belum dihitung` : ''}
                                                            {sess.consignmentSummary.totalDiscrepancyQty > 0 ? ` · Selisih ${sess.consignmentSummary.totalDiscrepancyQty} pcs` : ''}
                                                          </span>
                                                        </div>
                                                      )}

                                                      {sess.cashMovements.length > 0 && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>Riwayat Kas Laci:</div>
                                                          {sess.cashMovements.map((mv) => (
                                                            <div
                                                              key={mv.id}
                                                              style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                padding: '5px 9px',
                                                                borderRadius: '6px',
                                                                backgroundColor: mv.isGraceCorrection ? '#fffbeb' : '#ffffff',
                                                                border: mv.isGraceCorrection ? '1px solid #fcd34d' : '1px solid #e2e8f0',
                                                                fontSize: '11.5px',
                                                              }}
                                                            >
                                                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{formatCashCategory(mv.category)}</span>
                                                                {mv.isGraceCorrection && (
                                                                  <span style={{ padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#b45309', fontSize: '10px', fontWeight: 800 }}>
                                                                    [Koreksi Jeda 5m]
                                                                  </span>
                                                                )}
                                                                <span style={{ color: '#475569' }}>{mv.notes}</span>
                                                                {mv.employeeName && <span style={{ color: '#94a3b8', fontSize: '10.5px' }}>({mv.employeeName})</span>}
                                                              </div>
                                                              <span style={{ fontWeight: 800, color: mv.movementType === 'CASH_OUT' ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                                                                {mv.movementType === 'CASH_OUT' ? '-' : '+'}
                                                                {formatRupiah(mv.amount)}
                                                              </span>
                                                            </div>
                                                          ))}
                                                        </div>
                                                      )}

                                                      {sess.shortageOverrideReason && (
                                                        <div style={{ fontSize: '11.5px', color: '#1d4ed8', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '5px 9px', borderRadius: '6px' }}>
                                                          <strong>Catatan Override:</strong> {sess.shortageOverrideReason}
                                                        </div>
                                                      )}

                                                      {(sess.shortageStatus === 'AUTO_LOCKED' ||
                                                        sess.shortageStatus === 'AUDIT_WARNING' ||
                                                        sess.shortageStatus === 'PENDING_GRACE' ||
                                                        sess.shortageStatus === 'OVERRIDDEN' ||
                                                        (sess.discrepancy !== null && sess.discrepancy !== undefined && sess.discrepancy < -2000)) && (
                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                                                          {sess.shortageStatus !== 'OVERRIDDEN' && (
                                                            <button
                                                              type="button"
                                                              onClick={() => {
                                                                setOverrideError('');
                                                                setOverrideReason('');
                                                                setOverrideTarget({
                                                                  shiftId: sess.shiftId,
                                                                  tanggal: sess.tanggal,
                                                                  sesi: sess.sesi,
                                                                  mode: 'CANCEL_DEDUCTION',
                                                                  amount: sess.shortageDeduction || Math.abs(sess.discrepancy ?? 0),
                                                                });
                                                              }}
                                                              style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '5px',
                                                                padding: '5px 10px',
                                                                borderRadius: '6px',
                                                                border: '1px solid #1d4ed8',
                                                                backgroundColor: '#eff6ff',
                                                                color: '#1d4ed8',
                                                                fontSize: '11.5px',
                                                                fontWeight: 700,
                                                                cursor: 'pointer',
                                                              }}
                                                            >
                                                              <ShieldAlert size={12} />{' '}
                                                              {sess.shortageStatus === 'AUTO_LOCKED' ? 'Batalkan Potongan' : 'Tandai Wajar (Bebas Potong)'}
                                                            </button>
                                                          )}
                                                          {sess.shortageStatus !== 'AUTO_LOCKED' && (
                                                            <button
                                                              type="button"
                                                              onClick={() => {
                                                                setOverrideError('');
                                                                setOverrideReason('');
                                                                setOverrideTarget({
                                                                  shiftId: sess.shiftId,
                                                                  tanggal: sess.tanggal,
                                                                  sesi: sess.sesi,
                                                                  mode: 'RESTORE_DEDUCTION',
                                                                  amount: Math.abs(sess.discrepancy ?? 0),
                                                                });
                                                              }}
                                                              style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '5px',
                                                                padding: '5px 10px',
                                                                borderRadius: '6px',
                                                                border: '1px solid #dc2626',
                                                                backgroundColor: '#fef2f2',
                                                                color: '#dc2626',
                                                                fontSize: '11.5px',
                                                                fontWeight: 700,
                                                                cursor: 'pointer',
                                                              }}
                                                            >
                                                              <RotateCcw size={12} /> Terapkan Potong Tekor
                                                            </button>
                                                          )}
                                                        </div>
                                                      )}
                                                    </div>
                                                  </td>
                                                </tr>
                                              )}
                                            </Fragment>
                                          );
                                        })}
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

                        {/* Baris 4: Tombol Cepat Slip Gaji Per Shift di Mobile */}
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            gap: '6px',
                            marginTop: '8px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setSlipPreviewGroup(g)}
                            style={{
                              flex: 1,
                              minHeight: 36,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '5px',
                              padding: '6px 10px',
                              borderRadius: '7px',
                              border: '1px solid #166534',
                              backgroundColor: '#f0fdf4',
                              color: '#166534',
                              fontSize: '11.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            <FileText size={13} />
                            <span>Lihat Slip Gaji</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopySlip(g.groupKey, buildGroupSlipWaText(g))}
                            style={{
                              minHeight: 36,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '6px 10px',
                              borderRadius: '7px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: copiedSlipKey === g.groupKey ? '#15803d' : '#ffffff',
                              color: copiedSlipKey === g.groupKey ? '#ffffff' : '#0f172a',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {copiedSlipKey === g.groupKey ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedSlipKey === g.groupKey ? 'Tersalin' : 'WA'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintGroupSlip(g)}
                            style={{
                              minHeight: 36,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '6px 10px',
                              borderRadius: '7px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              color: '#334155',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            <Printer size={12} />
                            <span>Cetak</span>
                          </button>
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
                              <div style={{ fontSize: '9.5px', color: '#64748b' }}>Trx / Barang</div>
                              <div style={{ fontWeight: 800, color: '#4f46e5' }}>{g.totalTx} tx · {g.totalUnitsSold} pcs</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '9.5px', color: '#64748b' }}>Omzet</div>
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

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                            {computeGroupTeamAttendance(g).map((m) => (
                              <span
                                key={m.nim || m.fullName}
                                style={{
                                  padding: '3px 7px',
                                  borderRadius: '6px',
                                  backgroundColor: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '10.5px',
                                }}
                              >
                                <strong>{m.fullName}</strong> · {m.hadir}x hadir
                                {m.telatMenit > 0 && (
                                  <span style={{ color: '#b45309', fontWeight: 700 }}> · telat {m.telatMenit}m</span>
                                )}
                              </span>
                            ))}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {g.sessions.map((sess, idx) => (
                              <div
                                key={sess.sessionKey}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '5px',
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  backgroundColor: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '11px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                  <div>
                                    <div style={{ fontWeight: 700, color: '#0f172a' }}>
                                      #{idx + 1} · {formatShortDate(sess.tanggal)} ({sess.txCount} tx · {sess.unitsSold} pcs)
                                    </div>
                                    <div style={{ fontSize: '10px', color: '#64748b' }}>
                                      Omzet {formatRupiah(sess.omzet)} · Keluar {formatRupiah(sess.cashOut)}
                                      {sess.shortageStatus === 'AUTO_LOCKED' && sess.shortageDeduction > 0 ? (
                                        <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: '5px' }}>
                                          · Potong -{formatRupiah(sess.shortageDeduction)}
                                        </span>
                                      ) : sess.shortageStatus === 'AUDIT_WARNING' ? (
                                        <span style={{ color: '#c2410c', fontWeight: 700, marginLeft: '5px' }}>
                                          · Perlu Cek ({formatRupiah(sess.discrepancy ?? 0)})
                                        </span>
                                      ) : sess.shortageStatus === 'PENDING_GRACE' ? (
                                        <span style={{ color: '#b45309', fontWeight: 700, marginLeft: '5px' }}>
                                          · Jeda 5 Menit
                                        </span>
                                      ) : sess.shortageStatus === 'OVERRIDDEN' ? (
                                        <span style={{ color: '#1d4ed8', fontWeight: 700, marginLeft: '5px' }}>
                                          · Wajar
                                        </span>
                                      ) : sess.discrepancy !== null && sess.discrepancy !== undefined && sess.discrepancy < -2000 ? (
                                        <span style={{ color: '#c2410c', fontWeight: 700, marginLeft: '5px' }}>
                                          · Perlu Cek ({formatRupiah(sess.discrepancy)})
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div style={{ fontWeight: 800, color: '#15803d', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                                    {formatRupiah(sess.upahBersih)}
                                  </div>
                                </div>
                                {sess.cashMovements.some((m) => m.isGraceCorrection) && (
                                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#b45309', backgroundColor: '#fffbeb', padding: '3px 6px', borderRadius: '4px' }}>
                                    Ada input Kas Laci saat Jeda 5 Menit ({sess.cashMovements.filter((m) => m.isGraceCorrection).length} item)
                                  </div>
                                )}
                                {(sess.shortageStatus === 'AUTO_LOCKED' ||
                                  sess.shortageStatus === 'AUDIT_WARNING' ||
                                  sess.shortageStatus === 'PENDING_GRACE' ||
                                  sess.shortageStatus === 'OVERRIDDEN' ||
                                  (sess.discrepancy !== null && sess.discrepancy !== undefined && sess.discrepancy < -2000)) && (
                                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    {sess.shortageStatus !== 'OVERRIDDEN' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOverrideError('');
                                          setOverrideReason('');
                                          setOverrideTarget({
                                            shiftId: sess.shiftId,
                                            tanggal: sess.tanggal,
                                            sesi: sess.sesi,
                                            mode: 'CANCEL_DEDUCTION',
                                            amount: sess.shortageDeduction || Math.abs(sess.discrepancy ?? 0),
                                          });
                                        }}
                                        style={{
                                          padding: '4px 8px',
                                          borderRadius: '5px',
                                          border: '1px solid #1d4ed8',
                                          backgroundColor: '#eff6ff',
                                          color: '#1d4ed8',
                                          fontSize: '10.5px',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {sess.shortageStatus === 'AUTO_LOCKED' ? 'Batalkan Potongan' : 'Tandai Wajar'}
                                      </button>
                                    )}
                                    {sess.shortageStatus !== 'AUTO_LOCKED' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOverrideError('');
                                          setOverrideReason('');
                                          setOverrideTarget({
                                            shiftId: sess.shiftId,
                                            tanggal: sess.tanggal,
                                            sesi: sess.sesi,
                                            mode: 'RESTORE_DEDUCTION',
                                            amount: Math.abs(sess.discrepancy ?? 0),
                                          });
                                        }}
                                        style={{
                                          padding: '4px 8px',
                                          borderRadius: '5px',
                                          border: '1px solid #dc2626',
                                          backgroundColor: '#fef2f2',
                                          color: '#dc2626',
                                          fontSize: '10.5px',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        Terapkan Potong
                                      </button>
                                    )}
                                  </div>
                                )}
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

      {/* Modal Override Potongan Tekor (Tercatat di audit_logs) */}
      {overrideTarget && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(3px)',
          }}
          onClick={(e) => e.target === e.currentTarget && setOverrideTarget(null)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '20px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                  {overrideTarget.mode === 'CANCEL_DEDUCTION'
                    ? 'Tandai Selisih Wajar (Bebas Potong)'
                    : 'Terapkan Potongan Tekor Shift'}
                </h3>
                <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '3px 0 0' }}>
                  Shift {overrideTarget.sesi} · {formatShortDate(overrideTarget.tanggal)} · Selisih {formatRupiah(overrideTarget.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOverrideTarget(null)}
                aria-label="Tutup"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={15} />
              </button>
            </div>

            {overrideError && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.78rem', fontWeight: 600, marginBottom: '10px' }}>
                {overrideError}
              </div>
            )}

            <form onSubmit={handleSubmitOverride} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '5px' }}>
                  Alasan Tertulis (Wajib, tercatat permanen di log audit)
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Contoh: Uang titipan Roti Kopi Rp 30.000 belum sempat dicatat saat tutup laci, bukti nota sudah cocok."
                  className="form-input"
                  style={{ width: '100%', minHeight: '78px', fontSize: '0.82rem' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="btn btn-secondary"
                  disabled={overrideSubmitting}
                >
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={overrideSubmitting}>
                  {overrideSubmitting ? <Loader2 size={14} className="spin-icon" /> : 'Simpan Keputusan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Pratinjau Slip Gaji Per Shift (Clean & To The Point) */}
      {slipPreviewGroup && (() => {
        const g = slipPreviewGroup;
        const members = computeGroupTeamAttendance(g);
        const isPagi = g.sesi === 'Pagi';
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Slip Gaji Shift ${g.hari} ${g.sesi}`}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1150,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px',
              backgroundColor: 'rgba(15, 23, 42, 0.55)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={(e) => e.target === e.currentTarget && setSlipPreviewGroup(null)}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                width: '100%',
                maxWidth: '560px',
                maxHeight: '92dvh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 20px 40px -12px rgba(15, 23, 42, 0.25)',
              }}
            >
              {/* Header Ringkas */}
              <div
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: '#0f172a' }}>
                      Slip Shift {g.hari} {g.sesi}
                    </h3>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '99px',
                        backgroundColor: isPagi ? '#fef3c7' : '#dcfce7',
                        color: isPagi ? '#b45309' : '#15803d',
                      }}
                    >
                      {g.waktuLabel} WIB
                    </span>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                    {data?.range.label ?? '-'} · {g.totalShiftCount}x pertemuan
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSlipPreviewGroup(null)}
                  aria-label="Tutup slip gaji"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Isi Slip (Clean & Padat — Muat 1 Layar) */}
              <div style={{ padding: '14px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Ringkasan Utama: Gaji + Omzet + Laba dalam 1 kartu */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534' }}>
                      Total Gaji Kelompok (Utuh Per Shift)
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#475569', marginTop: 3 }}>
                      Omzet <strong style={{ color: '#0f172a' }}>{formatRupiah(g.totalOmzet)}</strong> · Laba{' '}
                      <strong style={{ color: '#0f172a' }}>{formatRupiah(g.totalLabaKotor)}</strong>
                      {g.totalShortageDeduction > 0 && (
                        <>
                          {' '}· Tekor <strong style={{ color: '#dc2626' }}>-{formatRupiah(g.totalShortageDeduction)}</strong>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#15803d', whiteSpace: 'nowrap' }}>
                    {formatRupiah(g.upahBersih)}
                  </div>
                </div>

                {/* Absensi Tim (3 Kolom Ringkas) */}
                <div>
                  <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#334155', marginBottom: '5px' }}>
                    Absensi Tim ({members.length} Orang)
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Nama</th>
                          <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, width: 64 }}>Hadir</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Disiplin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ padding: '10px', textAlign: 'center', color: '#64748b' }}>
                              Belum ada catatan absensi pada periode ini.
                            </td>
                          </tr>
                        ) : (
                          members.map((m) => (
                            <tr key={m.nim || m.fullName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '7px 10px', fontWeight: 600, color: '#0f172a' }}>{m.fullName}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: '#166534' }}>{m.hadir}x</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {m.telatCount > 0 ? (
                                  <span style={{ color: '#b45309', fontWeight: 700 }}>
                                    {formatDisiplinText(m.telatCount, m.telatMenit)}
                                  </span>
                                ) : (
                                  <span style={{ color: '#15803d', fontWeight: 600 }}>Tepat Waktu</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Rincian Per Tanggal (4 Kolom Ringkas) */}
                <div>
                  <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#334155', marginBottom: '5px' }}>
                    Rincian Per Tanggal ({g.totalShiftCount}x)
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Tanggal</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Omzet</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Laba</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Upah</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.sessions.map((s) => (
                          <tr key={s.sessionKey} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '7px 10px', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>{formatShortDate(s.tanggal)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>{formatRupiah(s.omzet)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>{formatRupiah(s.labaKotor)}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 800, color: '#15803d', whiteSpace: 'nowrap' }}>{formatRupiah(s.upahBersih)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer Tombol Aksi */}
              <div
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#f8fafc',
                  borderTop: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={() => handleCopySlip(`modal-${g.groupKey}`, buildGroupSlipWaText(g))}
                  className="btn btn-sm"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: copiedSlipKey === `modal-${g.groupKey}` ? '#15803d' : '#ffffff',
                    color: copiedSlipKey === `modal-${g.groupKey}` ? '#ffffff' : '#0f172a',
                    border: '1px solid #cbd5e1',
                    padding: '8px 14px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  {copiedSlipKey === `modal-${g.groupKey}` ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedSlipKey === `modal-${g.groupKey}` ? 'Tersalin' : 'Salin WA'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintGroupSlip(g)}
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
                  <Printer size={14} />
                  <span>Cetak / PDF</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
