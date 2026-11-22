'use client';

import { useState, useCallback, useEffect, useId, useMemo } from 'react';
import {
  Users,
  TrendingUp,
  ShoppingBag,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Download,
  Search,
  RotateCcw,
  X,
  ChevronUp,
  ChevronDown,
  Calendar,
  Banknote,
} from 'lucide-react';
import { useTableSelection } from '@/hooks/useTableSelection';
import { SelectedRowsBar, SelectAllCheckbox } from '@/components/admin/SelectedRowsBar';
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
  todayWibSlug,
} from '@/lib/utils/exportSelectedExcel';

// ─── Types ────────────────────────────────────────────────────
type SelisihLaciCount = { hijau: number; kuning: number; merah: number; overage: number };

type KasirSummary = {
  kasirId: string;
  kasirName: string;
  kasirNim: string;
  jabatan: string;
  isActive?: boolean;
  totalShift: number;
  shiftDipimpin?: number;
  shiftPendamping?: number;
  totalOmzet: number;
  totalHpp: number;
  totalLabaKotor: number;
  totalTxCount: number;
  totalVoidCount: number;
  totalTxCash: number;
  totalTxQris: number;
  totalPenjualanCash: number;
  totalPenjualanQris: number;
  totalModalAwal: number;
  avgOmzetPerShift: number;
  topProduk: string;
  totalDurasiMenit: number;
  selisihLaciCount: SelisihLaciCount;
};

type ShiftDetail = {
  shiftId: string;
  employeeId: string;
  kasirPembukaName?: string;
  participantEmployeeIds?: string[];
  coCashierNames?: string[];
  clockIn: string;
  clockOut: string | null;
  status: string;
  durasiMenit: number | null;
  modalAwal: number;
  rawModalWarning?: boolean;
  omzet: number;
  hpp: number;
  labaKotor: number;
  txCount: number;
  voidCount: number;
  txCountCash: number;
  txCountQris: number;
  cashSales: number;
  cashOut: number;
  cashIn: number;
  expectedCash: number;
  actualCash: number | null;
  discrepancy: number | null;
  statusLaci: string;
  discrepancyTier: string;
  serahTerimaDiff: number | null;
  auditFlags: string;
};

type HourlyBreakdownRow = {
  hour: number;
  label: string;
  txCount: number;
  voidCount: number;
  omzet: number;
  hpp: number;
  labaKotor: number;
  cash: number;
  qris: number;
  activeKasirCount: number;
};

type RekapData = {
  dateFrom: string;
  dateTo: string;
  periodLabel?: string;
  totalKasir: number;
  summary: KasirSummary[];
  shiftDetails: ShiftDetail[];
  hourlyBreakdown?: HourlyBreakdownRow[];
};

type PresetKey = 'daily' | 'weekly' | 'monthly' | 'october' | 'november' | 'oct_nov' | 'all';

const PRESET_BUTTONS: ReadonlyArray<{ key: PresetKey; label: string; highlight?: boolean }> = [
  { key: 'daily', label: 'Hari Ini' },
  { key: 'weekly', label: '7 Hari' },
  { key: 'monthly', label: 'Bulan Ini' },
  { key: 'october', label: 'Oktober', highlight: true },
  { key: 'november', label: 'November', highlight: true },
  { key: 'oct_nov', label: 'Oktober + November', highlight: true },
  { key: 'all', label: 'Keseluruhan', highlight: true },
];

// ─── Helpers ──────────────────────────────────────────────────
function rp(num: number): string {
  return 'Rp\u00a0' + Math.round(num).toLocaleString('id-ID');
}

function n(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function dur(m: number | null): string {
  if (!m) return '\u2014';
  const h = Math.floor(m / 60);
  const mn = m % 60;
  return h ? `${h}j ${mn}m` : `${mn}m`;
}

function fdt(iso: string | null): string {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const TS: Record<string, { color: string; bg: string; border: string }> = {
  HIJAU: { color: '#16a34a', bg: '#dcfce7', border: '#86efac' },
  KUNING: { color: '#d97706', bg: '#fef3c7', border: '#fcd34d' },
  MERAH: { color: '#dc2626', bg: '#fee2e2', border: '#fca5a5' },
  OVERAGE: { color: '#0284c7', bg: '#dbeafe', border: '#93c5fd' },
  RUNNING: { color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
};

function todayW(): string {
  return todayWibSlug();
}

function prevW(): string {
  return todayWibSlug(new Date(Date.now() - 6 * 86_400_000));
}

export default function RekapKasir() {
  const uid = useId();
  const [activePreset, setActivePreset] = useState<PresetKey | null>('weekly');
  const [dateFrom, setDateFrom] = useState(prevW());
  const [dateTo, setDateTo] = useState(todayW());
  const [searchQ, setSearchQ] = useState('');
  const [data, setData] = useState<RekapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailKasir, setDetailKasir] = useState<KasirSummary | null>(null);
  const [sortKey, setSortKey] = useState<'totalOmzet' | 'totalShift' | 'totalTxCount' | 'avgOmzetPerShift'>('totalOmzet');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const kasirSelection = useTableSelection();
  const hourlySelection = useTableSelection();
  const clearKasirSel = kasirSelection.clearSelection;
  const clearHourlySel = hourlySelection.clearSelection;

  const fetchByParams = useCallback(
    async (query: string) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/admin/laporan/rekap-kasir?${query}`);
        const j = (await res.json()) as { success?: boolean; data?: RekapData; error?: string };
        if (!res.ok || !j.success) {
          setError(j.error ?? 'Gagal memuat data rekap kasir');
          return;
        }
        const loaded = j.data ?? null;
        setData(loaded);
        if (loaded) {
          setDateFrom(loaded.dateFrom);
          setDateTo(loaded.dateTo);
        }
        clearKasirSel();
        clearHourlySel();
      } catch {
        setError('Kesalahan jaringan.');
      } finally {
        setLoading(false);
      }
    },
    [clearKasirSel, clearHourlySel],
  );

  useEffect(() => {
    let active = true;
    fetch('/api/admin/laporan/rekap-kasir?period=weekly')
      .then(async (res) => {
        const j = (await res.json()) as { success?: boolean; data?: RekapData; error?: string };
        if (!active) return;
        if (!res.ok || !j.success) {
          setError(j.error ?? 'Gagal memuat data rekap kasir');
          return;
        }
        const loaded = j.data ?? null;
        setData(loaded);
        if (loaded) {
          setDateFrom(loaded.dateFrom);
          setDateTo(loaded.dateTo);
        }
      })
      .catch(() => {
        if (active) setError('Kesalahan jaringan.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function doSelectPreset(preset: PresetKey): void {
    setActivePreset(preset);
    void fetchByParams(`period=${preset}`);
  }

  function doApply(): void {
    setActivePreset(null);
    void fetchByParams(`dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`);
  }

  function doReset(): void {
    setActivePreset('weekly');
    void fetchByParams('period=weekly');
  }

  function toggleSort(k: typeof sortKey): void {
    if (sortKey === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const q = searchQ.trim().toLowerCase();
    return [...data.summary]
      .filter(
        (k) =>
          !q ||
          k.kasirName.toLowerCase().includes(q) ||
          k.kasirNim.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const d = n(a[sortKey]) - n(b[sortKey]);
        return sortDir === 'desc' ? -d : d;
      });
  }, [data, searchQ, sortKey, sortDir]);

  const hourlyRows = useMemo(() => data?.hourlyBreakdown ?? [], [data]);
  const visibleKasirIds = useMemo(() => visible.map((k) => k.kasirId), [visible]);
  const visibleHourIds = useMemo(() => hourlyRows.map((h) => String(h.hour)), [hourlyRows]);

  const selectedKasirRows = useMemo(
    () => kasirSelection.getSelectedRows(visible, (k) => k.kasirId),
    [kasirSelection, visible],
  );
  const selectedHourRows = useMemo(
    () => hourlySelection.getSelectedRows(hourlyRows, (h) => String(h.hour)),
    [hourlySelection, hourlyRows],
  );

  // Grand totals tabel Per-Kasir
  const T = visible.reduce(
    (a, k) => ({
      omzet: a.omzet + n(k.totalOmzet),
      laba: a.laba + n(k.totalLabaKotor),
      trx: a.trx + n(k.totalTxCount),
      void: a.void + n(k.totalVoidCount),
      shift: a.shift + n(k.totalShift),
      cash: a.cash + n(k.totalPenjualanCash ?? 0),
      qris: a.qris + n(k.totalPenjualanQris ?? 0),
      durasi: a.durasi + n(k.totalDurasiMenit),
    }),
    { omzet: 0, laba: 0, trx: 0, void: 0, shift: 0, cash: 0, qris: 0, durasi: 0 },
  );

  // Selected subtotals tabel Per-Kasir
  const selectedKasirTotals = selectedKasirRows.reduce(
    (a, k) => ({
      shift: a.shift + n(k.totalShift),
      omzet: a.omzet + n(k.totalOmzet),
      cash: a.cash + n(k.totalPenjualanCash),
      qris: a.qris + n(k.totalPenjualanQris),
      laba: a.laba + n(k.totalLabaKotor),
      trx: a.trx + n(k.totalTxCount),
    }),
    { shift: 0, omzet: 0, cash: 0, qris: 0, laba: 0, trx: 0 },
  );

  // Grand totals & peak hour untuk Rekapan Per-Jam (WIB)
  const HTotal = hourlyRows.reduce(
    (a, h) => ({
      tx: a.tx + n(h.txCount),
      void: a.void + n(h.voidCount),
      omzet: a.omzet + n(h.omzet),
      cash: a.cash + n(h.cash),
      qris: a.qris + n(h.qris),
      hpp: a.hpp + n(h.hpp),
      laba: a.laba + n(h.labaKotor),
    }),
    { tx: 0, void: 0, omzet: 0, cash: 0, qris: 0, hpp: 0, laba: 0 },
  );

  const selectedHourTotals = selectedHourRows.reduce(
    (a, h) => ({
      tx: a.tx + n(h.txCount),
      omzet: a.omzet + n(h.omzet),
      cash: a.cash + n(h.cash),
      qris: a.qris + n(h.qris),
      hpp: a.hpp + n(h.hpp),
      laba: a.laba + n(h.labaKotor),
    }),
    { tx: 0, omzet: 0, cash: 0, qris: 0, hpp: 0, laba: 0 },
  );

  const maxHourOmzet = hourlyRows.reduce((mx, h) => Math.max(mx, n(h.omzet)), 0);
  const peakHourRow = hourlyRows.reduce<HourlyBreakdownRow | null>(
    (best, h) => (!best || n(h.omzet) > n(best.omzet) ? h : best),
    null,
  );

  async function doExportSelectedKasir(): Promise<void> {
    if (selectedKasirRows.length === 0 || !data) return;
    await exportSelectedRowsToExcel<KasirSummary>({
      filename: `rekap-kasir-terpilih-${data.dateFrom}-sd-${data.dateTo}.xlsx`,
      sheetName: 'Kasir Terpilih',
      title: 'REKAP KINERJA KASIR (BARIS TERPILIH)',
      subtitle: `Periode: ${data.dateFrom} s/d ${data.dateTo}`,
      rows: selectedKasirRows,
      columns: [
        { header: 'Nama Kasir', key: 'name', width: 26, value: (k) => k.kasirName },
        { header: 'NIM', key: 'nim', width: 15, value: (k) => k.kasirNim },
        { header: 'Jabatan', key: 'jabatan', width: 14, value: (k) => k.jabatan },
        { header: 'Shift', key: 'shift', width: 9, format: 'integer', aggregate: 'sum', value: (k) => k.totalShift },
        { header: 'Total Omzet (Rp)', key: 'omzet', width: 18, format: 'currency', aggregate: 'sum', value: (k) => k.totalOmzet },
        { header: 'Tunai/Cash (Rp)', key: 'cash', width: 18, format: 'currency', aggregate: 'sum', value: (k) => k.totalPenjualanCash },
        { header: 'QRIS (Rp)', key: 'qris', width: 18, format: 'currency', aggregate: 'sum', value: (k) => k.totalPenjualanQris },
        { header: 'Laba Kotor (Rp)', key: 'laba', width: 18, format: 'currency', aggregate: 'sum', value: (k) => k.totalLabaKotor },
        { header: 'Trx', key: 'trx', width: 9, format: 'integer', aggregate: 'sum', value: (k) => k.totalTxCount },
        { header: 'Void', key: 'void', width: 8, format: 'integer', aggregate: 'sum', value: (k) => k.totalVoidCount },
        { header: 'Top Produk', key: 'top', width: 28, value: (k) => k.topProduk },
      ],
    });
  }

  async function doExportSelectedHourly(): Promise<void> {
    if (selectedHourRows.length === 0 || !data) return;
    await exportSelectedRowsToExcel<HourlyBreakdownRow>({
      filename: `rekap-per-jam-terpilih-${data.dateFrom}-sd-${data.dateTo}.xlsx`,
      sheetName: 'Per Jam WIB Terpilih',
      title: 'REKAP PENJUALAN PER-JAM WIB (BARIS TERPILIH)',
      subtitle: `Periode: ${data.dateFrom} s/d ${data.dateTo}`,
      rows: selectedHourRows,
      columns: [
        { header: 'Jam (WIB)', key: 'label', width: 20, value: (h) => h.label },
        { header: 'Kasir Bertugas', key: 'kasir', width: 14, format: 'integer', value: (h) => h.activeKasirCount },
        { header: 'Transaksi', key: 'tx', width: 12, format: 'integer', aggregate: 'sum', value: (h) => h.txCount },
        { header: 'Void', key: 'void', width: 9, format: 'integer', aggregate: 'sum', value: (h) => h.voidCount },
        { header: 'Omzet Total (Rp)', key: 'omzet', width: 18, format: 'currency', aggregate: 'sum', value: (h) => h.omzet },
        { header: 'Omzet Cash (Rp)', key: 'cash', width: 18, format: 'currency', aggregate: 'sum', value: (h) => h.cash },
        { header: 'Omzet QRIS (Rp)', key: 'qris', width: 18, format: 'currency', aggregate: 'sum', value: (h) => h.qris },
        { header: 'HPP (Rp)', key: 'hpp', width: 18, format: 'currency', aggregate: 'sum', value: (h) => h.hpp },
        { header: 'Laba Kotor (Rp)', key: 'laba', width: 18, format: 'currency', aggregate: 'sum', value: (h) => h.labaKotor },
      ],
    });
  }

  async function doExportAll(): Promise<void> {
    if (!data?.summary.length) return;
    try {
      const wb = await createWiramartWorkbook('Manager - Rekap Kinerja Kasir');
      const printedWib = formatWibDateTime();
      const subtitleBase = `Periode: ${data.dateFrom} s/d ${data.dateTo} • Dicetak: ${printedWib} WIB`;

      // ── SHEET 1: REKAP KINERJA PER KASIR ────────────────────────
      const ws = wb.addWorksheet('Rekap Per Kasir');
      const kasirCols = [
        { header: 'No', width: 6, align: 'center' as const, fmt: EXCEL_FMT.INT },
        { header: 'Nama Kasir', width: 26, align: 'left' as const },
        { header: 'NIM', width: 15, align: 'center' as const },
        { header: 'Jabatan', width: 15, align: 'left' as const },
        { header: 'Status', width: 12, align: 'center' as const },
        { header: 'Jumlah Shift', width: 13, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Total Omzet (Rp)', width: 19, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Tunai / Cash (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'QRIS (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Rata-Rata / Shift (Rp)', width: 20, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Laba Kotor (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        { header: 'Transaksi', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Pembatalan', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Produk Terlaris', width: 28, align: 'left' as const },
        { header: 'Laci Pas', width: 11, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Selisih Ringan', width: 14, align: 'right' as const, fmt: EXCEL_FMT.INT },
        { header: 'Selisih Berat', width: 13, align: 'right' as const, fmt: EXCEL_FMT.INT },
      ];

      kasirCols.forEach((col, i) => {
        ws.getColumn(i + 1).width = col.width;
      });

      styleBannerBlock(ws, {
        title: 'LAPORAN REKAPITULASI KINERJA & PENJUALAN PER KASIR — WIRAMART UNPERBA',
        subtitle: `${subtitleBase} • ${data.summary.length} Personel Kasir`,
        endCol: kasirCols.length,
        titleRow: 1,
        subtitleRow: 2,
      });
      ws.getRow(3).height = 8;

      const headerRow = ws.getRow(4);
      headerRow.height = 26;
      kasirCols.forEach((col, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = col.header;
        cell.font = EXCEL_FONT.HEADER;
        cell.fill = EXCEL_FILL.HEADER;
        cell.border = EXCEL_BORDER.HEADER;
        cell.alignment = { vertical: 'middle', horizontal: col.align, wrapText: true };
      });

      const dataStart = 5;
      let sumShift = 0;
      let sumOmzet = 0;
      let sumCash = 0;
      let sumQris = 0;
      let sumLaba = 0;
      let sumTx = 0;
      let sumVoid = 0;
      let sumH = 0;
      let sumK = 0;
      let sumM = 0;

      data.summary.forEach((k, idx) => {
        const rowNum = dataStart + idx;
        const shiftVal = Math.round(n(k.totalShift));
        const omzetVal = Math.round(n(k.totalOmzet));
        const cashVal = Math.round(n(k.totalPenjualanCash));
        const qrisVal = Math.round(n(k.totalPenjualanQris));
        const avgVal = shiftVal > 0 ? Math.round(omzetVal / shiftVal) : 0;
        const labaVal = Math.round(n(k.totalLabaKotor));
        const txVal = Math.round(n(k.totalTxCount));
        const voidVal = Math.round(n(k.totalVoidCount));
        const topVal = sanitizeExcelText(k.topProduk) || '—';
        const hVal = Math.round(n(k.selisihLaciCount.hijau));
        const kVal = Math.round(n(k.selisihLaciCount.kuning));
        const mVal = Math.round(n(k.selisihLaciCount.merah));

        sumShift += shiftVal;
        sumOmzet += omzetVal;
        sumCash += cashVal;
        sumQris += qrisVal;
        sumLaba += labaVal;
        sumTx += txVal;
        sumVoid += voidVal;
        sumH += hVal;
        sumK += kVal;
        sumM += mVal;

        const row = ws.getRow(rowNum);
        const values: (string | number | { formula: string; result: number })[] = [
          idx + 1,
          sanitizeExcelText(k.kasirName) || '—',
          sanitizeExcelText(k.kasirNim) || '—',
          sanitizeExcelText(k.jabatan) || '—',
          k.isActive === false ? 'Non-Aktif' : 'Aktif',
          shiftVal,
          omzetVal,
          cashVal,
          qrisVal,
          { formula: `IF(F${rowNum}>0,G${rowNum}/F${rowNum},0)`, result: avgVal },
          labaVal,
          txVal,
          voidVal,
          topVal,
          hVal,
          kVal,
          mVal,
        ];

        values.forEach((val, cIdx) => {
          const cell = row.getCell(cIdx + 1);
          const meta = kasirCols[cIdx];
          cell.value = val;
          cell.font = EXCEL_FONT.BODY;
          cell.border = EXCEL_BORDER.THIN;
          cell.alignment = {
            vertical: 'middle',
            horizontal: meta.align,
            wrapText: cIdx === 1 || cIdx === 13,
          };
          if (meta.fmt) cell.numFmt = meta.fmt;
          if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
        });

        row.height = calcWrapRowHeight(
          [
            { text: String(values[1]), width: kasirCols[1].width },
            { text: topVal, width: kasirCols[13].width },
          ],
          21,
          14,
        );
      });

      const dataEnd = dataStart + data.summary.length - 1;
      const totalRowNum = dataEnd + 1;
      const totalRow = ws.getRow(totalRowNum);
      totalRow.height = 24;
      const sumCols: Record<number, number> = {
        5: sumShift,
        6: sumOmzet,
        7: sumCash,
        8: sumQris,
        10: sumLaba,
        11: sumTx,
        12: sumVoid,
        14: sumH,
        15: sumK,
        16: sumM,
      };
      const avgAll = sumShift > 0 ? Math.round(sumOmzet / sumShift) : 0;

      kasirCols.forEach((col, cIdx) => {
        const cell = totalRow.getCell(cIdx + 1);
        const colChar = colLetter(cIdx + 1);
        if (cIdx === 1) {
          cell.value = `TOTAL (${data.summary.length} Kasir)`;
        } else if (cIdx === 9) {
          cell.value = { formula: `IF(F${totalRowNum}>0,G${totalRowNum}/F${totalRowNum},0)`, result: avgAll };
        } else if (cIdx in sumCols) {
          cell.value = { formula: `SUM(${colChar}${dataStart}:${colChar}${dataEnd})`, result: sumCols[cIdx] };
        } else {
          cell.value = '';
        }
        cell.font = EXCEL_FONT.BOLD;
        cell.fill = EXCEL_FILL.TOTAL;
        cell.border = EXCEL_BORDER.TOTAL;
        cell.alignment = { vertical: 'middle', horizontal: col.align };
        if (col.fmt) cell.numFmt = col.fmt;
      });

      applySheetLayout(ws, {
        freezeRow: 4,
        autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: kasirCols.length } },
        orientation: 'landscape',
      });

      // ── SHEET 2: REKAP PER JAM WIB ──────────────────────────────
      if (hourlyRows.length > 0) {
        const wsH = wb.addWorksheet('Rekap Per Jam WIB');
        const hourCols = [
          { header: 'Jam Operasional (WIB)', width: 22, align: 'left' as const },
          { header: 'Kasir Bertugas', width: 15, align: 'right' as const, fmt: EXCEL_FMT.INT },
          { header: 'Transaksi', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
          { header: 'Pembatalan', width: 12, align: 'right' as const, fmt: EXCEL_FMT.INT },
          { header: 'Omzet Total (Rp)', width: 19, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
          { header: 'Tunai / Cash (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
          { header: 'QRIS (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
          { header: 'HPP (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
          { header: 'Laba Kotor (Rp)', width: 18, align: 'right' as const, fmt: EXCEL_FMT.RUPIAH },
        ];

        hourCols.forEach((col, i) => {
          wsH.getColumn(i + 1).width = col.width;
        });

        styleBannerBlock(wsH, {
          title: 'REKAPITULASI PENJUALAN PER JAM (WIB) — WIRAMART UNPERBA',
          subtitle: `${subtitleBase} • ${hourlyRows.length} Slot Jam Operasional`,
          endCol: hourCols.length,
          titleRow: 1,
          subtitleRow: 2,
        });
        wsH.getRow(3).height = 8;

        const hHeader = wsH.getRow(4);
        hHeader.height = 26;
        hourCols.forEach((col, i) => {
          const cell = hHeader.getCell(i + 1);
          cell.value = col.header;
          cell.font = EXCEL_FONT.HEADER;
          cell.fill = EXCEL_FILL.HEADER;
          cell.border = EXCEL_BORDER.HEADER;
          cell.alignment = { vertical: 'middle', horizontal: col.align, wrapText: true };
        });

        let sumH_tx = 0;
        let sumH_void = 0;
        let sumH_omzet = 0;
        let sumH_cash = 0;
        let sumH_qris = 0;
        let sumH_hpp = 0;
        let sumH_laba = 0;

        hourlyRows.forEach((h, idx) => {
          const rowNum = 5 + idx;
          const row = wsH.getRow(rowNum);
          row.height = 21;

          const txV = Math.round(n(h.txCount));
          const voidV = Math.round(n(h.voidCount));
          const omzV = Math.round(n(h.omzet));
          const cashV = Math.round(n(h.cash));
          const qrisV = Math.round(n(h.qris));
          const hppV = Math.round(n(h.hpp));
          const labaV = Math.round(n(h.labaKotor));

          sumH_tx += txV;
          sumH_void += voidV;
          sumH_omzet += omzV;
          sumH_cash += cashV;
          sumH_qris += qrisV;
          sumH_hpp += hppV;
          sumH_laba += labaV;

          const rowValues: (string | number)[] = [
            sanitizeExcelText(h.label) || '—',
            Math.round(n(h.activeKasirCount)),
            txV,
            voidV,
            omzV,
            cashV,
            qrisV,
            hppV,
            labaV,
          ];

          rowValues.forEach((val, cIdx) => {
            const cell = row.getCell(cIdx + 1);
            const meta = hourCols[cIdx];
            cell.value = val;
            cell.font = EXCEL_FONT.BODY;
            cell.border = EXCEL_BORDER.THIN;
            cell.alignment = { vertical: 'middle', horizontal: meta.align };
            if (meta.fmt) cell.numFmt = meta.fmt;
            if (idx % 2 === 1) cell.fill = EXCEL_FILL.ZEBRA;
          });
        });

        const hEnd = 5 + hourlyRows.length - 1;
        const hTotalRow = wsH.getRow(hEnd + 1);
        hTotalRow.height = 24;
        const hSumMap: Record<number, number> = {
          2: sumH_tx,
          3: sumH_void,
          4: sumH_omzet,
          5: sumH_cash,
          6: sumH_qris,
          7: sumH_hpp,
          8: sumH_laba,
        };

        hourCols.forEach((col, cIdx) => {
          const cell = hTotalRow.getCell(cIdx + 1);
          const colChar = colLetter(cIdx + 1);
          if (cIdx === 0) {
            cell.value = `TOTAL (${hourlyRows.length} Jam)`;
          } else if (cIdx in hSumMap) {
            cell.value = { formula: `SUM(${colChar}5:${colChar}${hEnd})`, result: hSumMap[cIdx] };
          } else {
            cell.value = '';
          }
          cell.font = EXCEL_FONT.BOLD;
          cell.fill = EXCEL_FILL.TOTAL;
          cell.border = EXCEL_BORDER.TOTAL;
          cell.alignment = { vertical: 'middle', horizontal: col.align };
          if (col.fmt) cell.numFmt = col.fmt;
        });

        applySheetLayout(wsH, {
          freezeRow: 4,
          autoFilter: { from: { row: 4, column: 1 }, to: { row: 4, column: hourCols.length } },
          orientation: 'landscape',
        });
      }

      await downloadWorkbookBlob(wb, `rekap-kasir-${data.dateFrom}-sd-${data.dateTo}.xlsx`);
    } catch {
      alert('Gagal mengekspor Excel.');
    }
  }

  return (
    <div>
      {/* Detail Modal */}
      {detailKasir && data && (
        <ShiftModal
          kasir={detailKasir}
          shifts={data.shiftDetails}
          onClose={() => setDetailKasir(null)}
        />
      )}

      {/* Filter Card */}
      <div className="card" style={{ marginBottom: 20, borderRadius: 14 }}>
        <div className="card-body" style={{ padding: '14px 18px' }}>
          {/* Quick Presets */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', marginRight: 4 }}>
              Periode Cepat:
            </span>
            {PRESET_BUTTONS.map((p) => {
              const active = activePreset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => doSelectPreset(p.key)}
                  disabled={loading}
                  aria-pressed={active}
                  className={active ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                  style={{
                    minHeight: 44,
                    fontSize: '0.78rem',
                    padding: '8px 14px',
                    borderRadius: 20,
                    borderColor: active
                      ? undefined
                      : p.highlight
                        ? 'hsl(262 60% 72%)'
                        : undefined,
                    color: active ? undefined : p.highlight ? 'hsl(262 55% 38%)' : undefined,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Date Range + Search + Export */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0, flex: '1 1 150px', minWidth: 'min(100%, 150px)' }}>
              <label htmlFor={`${uid}-f`} className="form-label" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={11} /> Dari
              </label>
              <input
                id={`${uid}-f`}
                type="date"
                className="form-input"
                style={{ fontSize: 'var(--text-base)', minHeight: 44, padding: '8px 10px', width: '100%' }}
                value={dateFrom}
                max={dateTo}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setActivePreset(null);
                }}
              />
            </div>
            <div className="form-group" style={{ margin: 0, flex: '1 1 150px', minWidth: 'min(100%, 150px)' }}>
              <label htmlFor={`${uid}-t`} className="form-label" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={11} /> Sampai
              </label>
              <input
                id={`${uid}-t`}
                type="date"
                className="form-input"
                style={{ fontSize: 'var(--text-base)', minHeight: 44, padding: '8px 10px', width: '100%' }}
                value={dateTo}
                min={dateFrom}
                max={todayW()}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setActivePreset(null);
                }}
              />
            </div>
            <button
              type="button"
              id={`${uid}-ap`}
              onClick={doApply}
              disabled={loading}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', minHeight: 44 }}
            >
              {loading ? <Loader2 size={14} className="spin-icon" /> : <Search size={14} />} Tampilkan
            </button>
            <button
              type="button"
              onClick={doReset}
              disabled={loading}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44 }}
            >
              <RotateCcw size={13} /> Reset
            </button>
            <div style={{ position: 'relative', flex: '1 1 185px', minWidth: 'min(100%, 185px)' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                id={`${uid}-s`}
                type="search"
                className="form-input"
                placeholder="Cari nama / NIM…"
                style={{ paddingLeft: 32, fontSize: 'var(--text-base)', minHeight: 44, width: '100%' }}
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                aria-label="Cari kasir"
              />
            </div>
            <button
              type="button"
              onClick={doExportAll}
              disabled={!data || !data.summary.length}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', minHeight: 44 }}
              aria-label="Export Semua Excel"
            >
              <Download size={13} /> Export Semua Excel
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="card" style={{ borderRadius: 14, marginBottom: 16 }}>
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 0' }}>
            <Loader2 size={32} className="spin-icon" style={{ color: 'var(--color-primary)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>
              Memuat rekap kasir &amp; data per jam…
            </p>
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Stat Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { l: 'Total Omzet', v: rp(T.omzet), sub: `${visible.length} kasir`, icon: <TrendingUp size={20} />, g: 'linear-gradient(135deg,#166534,#15803d)' },
              { l: 'Laba Kotor', v: rp(T.laba), sub: 'dari penjualan', icon: <Banknote size={20} />, g: 'linear-gradient(135deg,#0369a1,#0284c7)' },
              { l: 'Total Partisipasi Shift', v: T.shift.toLocaleString('id-ID'), sub: `${visible.length} kasir`, icon: <Clock size={20} />, g: 'linear-gradient(135deg,#6d28d9,#7c3aed)' },
              { l: 'Total Transaksi', v: T.trx.toLocaleString('id-ID'), sub: T.void > 0 ? `${T.void} void` : 'tanpa void', icon: <ShoppingBag size={20} />, g: 'linear-gradient(135deg,#b45309,#d97706)' },
              {
                l: peakHourRow ? `Jam Tersibuk` : 'Kasir Tercatat',
                v: peakHourRow ? peakHourRow.label.replace(' WIB', '') : String(visible.length),
                sub: peakHourRow ? `${rp(peakHourRow.omzet)} (${peakHourRow.txCount} trx)` : `${data.dateFrom} s/d ${data.dateTo}`,
                icon: <Users size={20} />,
                g: 'linear-gradient(135deg,#0f766e,#14b8a6)',
              },
            ].map((item) => (
              <div
                key={item.l}
                style={{
                  background: item.g,
                  borderRadius: 14,
                  padding: '16px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: '#fff',
                  }}
                >
                  {item.icon}
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{item.l}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{item.v}</div>
                  {item.sub && <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.72)', marginTop: 2 }}>{item.sub}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Sort bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            <span style={{ fontWeight: 600 }}>Urutkan:</span>
            {(
              [
                ['totalOmzet', 'Total Omzet'],
                ['totalShift', 'Jumlah Shift'],
                ['totalTxCount', 'Transaksi'],
                ['avgOmzetPerShift', 'Rata-rata/Shift'],
              ] as [typeof sortKey, string][]
            ).map(([k, lbl]) => {
              const act = sortKey === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleSort(k)}
                  aria-pressed={act}
                  style={{
                    minHeight: 44,
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: `1.5px solid ${act ? '#166534' : 'var(--color-border)'}`,
                    background: act ? '#166534' : 'transparent',
                    color: act ? '#fff' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontSize: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontWeight: act ? 700 : 400,
                    transition:
                      'background-color 0.16s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.16s cubic-bezier(0.16, 1, 0.3, 1), color 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {lbl}
                  {act && (sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                </button>
              );
            })}
          </div>

          {/* Table 1: Kinerja Per-Kasir */}
          {visible.length === 0 ? (
            <div className="card" style={{ borderRadius: 14, marginBottom: 24 }}>
              <div className="card-body" style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-text-muted)' }}>
                {searchQ ? `Tidak ditemukan kasir dengan kata kunci "${searchQ}".` : 'Tidak ada data transaksi maupun shift kasir pada periode ini.'}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 26 }}>
              <div className="card" style={{ borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ background: 'linear-gradient(90deg,#f0fdf4,#fff)', borderBottom: '1px solid var(--color-border)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Users size={15} style={{ color: '#166534' }} />
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#166534' }}>
                    Kinerja Per-Anak / Kasir
                  </span>
                  <span style={{ marginLeft: 4, background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '1px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    {visible.length} kasir
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    Centang baris untuk hitung subtotal real-time &amp; ekspor terpilih
                  </span>
                </div>
                <div className="table-wrapper" style={{ WebkitOverflowScrolling: 'touch' }}>
                  <table className="table" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 34, textAlign: 'center' }}>
                          <SelectAllCheckbox
                            checked={kasirSelection.allVisibleSelected(visibleKasirIds)}
                            indeterminate={kasirSelection.someVisibleSelected(visibleKasirIds)}
                            onChange={() => kasirSelection.toggleAll(visibleKasirIds)}
                            ariaLabel="Pilih semua baris kasir"
                          />
                        </th>
                        <th style={{ width: 28 }}>#</th>
                        <th>Kasir</th>
                        <th>NIM</th>
                        <th style={{ textAlign: 'center' }}>Jam Kerja</th>
                        <th style={{ textAlign: 'right' }}>Shift</th>
                        <th style={{ textAlign: 'right' }}>Total Omzet</th>
                        <th style={{ textAlign: 'right', color: '#16a34a' }}>Cash</th>
                        <th style={{ textAlign: 'right', color: '#7c3aed' }}>QRIS</th>
                        <th style={{ textAlign: 'right' }}>Rata-rata/Shift</th>
                        <th style={{ textAlign: 'right' }}>Laba Kotor</th>
                        <th style={{ textAlign: 'right' }}>Trx</th>
                        <th style={{ textAlign: 'right' }}>Void</th>
                        <th style={{ textAlign: 'center' }}>Selisih Laci</th>
                        <th>Top Produk</th>
                        <th style={{ textAlign: 'center' }}>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((k, i) => {
                        const l = k.selisihLaciCount;
                        const isTop = i === 0;
                        const vc = n(k.totalVoidCount);
                        const checked = kasirSelection.isSelected(k.kasirId);
                        return (
                          <tr
                            key={k.kasirId}
                            style={{
                              background: checked ? '#ecfdf5' : isTop ? '#f0fdf4' : undefined,
                              transition: 'background-color 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          >
                            <td style={{ textAlign: 'center', padding: 0 }}>
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minWidth: 44,
                                  minHeight: 44,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => kasirSelection.toggleRow(k.kasirId)}
                                  aria-label={`Pilih ${k.kasirName}`}
                                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                                />
                              </label>
                            </td>
                            <td style={{ textAlign: 'center', color: isTop ? '#f59e0b' : '#9ca3af', fontWeight: 700 }}>
                              {isTop ? '' : i + 1}
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: isTop ? '#166534' : 'inherit' }}>
                                <span>{k.kasirName}</span>
                                {k.isActive === false && (
                                  <span style={{ fontSize: '0.62rem', background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 999, fontWeight: 600 }}>
                                    Non-Aktif
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
                                {k.jabatan}
                                {n(k.shiftPendamping) > 0 && ` · Pendamping: ${k.shiftPendamping}x`}
                              </div>
                            </td>
                            <td style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: '0.73rem' }}>{k.kasirNim}</td>
                            <td style={{ textAlign: 'center', color: '#475569', fontSize: '0.72rem' }}>{dur(k.totalDurasiMenit)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n(k.totalShift)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 800, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{rp(n(k.totalOmzet))}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{rp(n(k.totalPenjualanCash ?? 0))}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#7c3aed', fontVariantNumeric: 'tabular-nums' }}>{rp(n(k.totalPenjualanQris ?? 0))}</td>
                            <td style={{ textAlign: 'right', color: '#0369a1', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rp(n(k.avgOmzetPerShift))}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rp(n(k.totalLabaKotor))}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(k.totalTxCount).toLocaleString('id-ID')}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {vc > 0 ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#dc2626', fontWeight: 700 }}>
                                  <AlertTriangle size={11} />
                                  {vc}
                                </span>
                              ) : (
                                <span style={{ color: '#9ca3af' }}>0</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                                {l.hijau > 0 && (
                                  <span title={`${l.hijau} shift pas`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...TS.HIJAU, padding: '2px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, border: `1px solid ${TS.HIJAU.border}` }}>
                                    <CheckCircle size={9} />
                                    {l.hijau}
                                  </span>
                                )}
                                {l.kuning > 0 && (
                                  <span title={`${l.kuning} shift selisih kecil`} style={{ ...TS.KUNING, padding: '2px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, border: `1px solid ${TS.KUNING.border}` }}>
                                    {l.kuning}
                                  </span>
                                )}
                                {l.merah > 0 && (
                                  <span title={`${l.merah} shift selisih besar!`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...TS.MERAH, padding: '2px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, border: `1px solid ${TS.MERAH.border}` }}>
                                    <AlertTriangle size={9} />
                                    {l.merah}
                                  </span>
                                )}
                                {l.overage > 0 && (
                                  <span title={`${l.overage} shift lebih`} style={{ ...TS.OVERAGE, padding: '2px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, border: `1px solid ${TS.OVERAGE.border}` }}>
                                    ▲ {l.overage}
                                  </span>
                                )}
                                {l.hijau + l.kuning + l.merah + l.overage === 0 && (
                                  <span style={{ color: '#d1d5db', fontSize: '0.68rem' }}>—</span>
                                )}
                              </div>
                            </td>
                            <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', color: '#6b7280' }} title={k.topProduk}>
                              {k.topProduk}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => setDetailKasir(k)}
                                className="btn btn-secondary btn-sm"
                                style={{
                                  minHeight: 44,
                                  padding: '8px 14px',
                                  borderRadius: 999,
                                  fontSize: '0.78rem',
                                  borderColor: 'var(--color-border)',
                                  color: 'var(--color-text-primary)',
                                }}
                                aria-label={`Detail ${k.kasirName}`}
                              >
                                Detail
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 800, borderTop: '2px solid var(--color-border)', background: '#f0fdf4' }}>
                        <td />
                        <td />
                        <td colSpan={2} style={{ color: '#166534' }}>
                          TOTAL ({visible.length} kasir)
                        </td>
                        <td style={{ textAlign: 'center', color: '#475569' }}>{dur(T.durasi)}</td>
                        <td style={{ textAlign: 'right', color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{T.shift.toLocaleString('id-ID')}</td>
                        <td style={{ textAlign: 'right', color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{rp(T.omzet)}</td>
                        <td style={{ textAlign: 'right', color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{rp(T.cash)}</td>
                        <td style={{ textAlign: 'right', color: '#7c3aed', fontVariantNumeric: 'tabular-nums' }}>{rp(T.qris)}</td>
                        <td style={{ textAlign: 'right', color: '#0369a1', fontVariantNumeric: 'tabular-nums' }}>
                          {visible.length > 0 ? rp(T.omzet / visible.length) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rp(T.laba)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{T.trx.toLocaleString('id-ID')}</td>
                        <td style={{ textAlign: 'right', color: T.void > 0 ? '#dc2626' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                          {T.void}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <SelectedRowsBar
                selectedCount={selectedKasirRows.length}
                itemLabel="kasir"
                metrics={[
                  { label: 'Shift Terpilih', value: selectedKasirTotals.shift.toLocaleString('id-ID'), tone: 'info' },
                  { label: 'Subtotal Omzet', value: rp(selectedKasirTotals.omzet), tone: 'primary' },
                  { label: 'Subtotal Cash', value: rp(selectedKasirTotals.cash), tone: 'success' },
                  { label: 'Subtotal QRIS', value: rp(selectedKasirTotals.qris), tone: 'info' },
                  { label: 'Subtotal Laba Kotor', value: rp(selectedKasirTotals.laba), tone: 'success' },
                  { label: 'Transaksi', value: selectedKasirTotals.trx.toLocaleString('id-ID') },
                ]}
                onExportExcel={doExportSelectedKasir}
                onClear={kasirSelection.clearSelection}
              />
            </div>
          )}

          {/* Table 2: Rekapan Penjualan Per-Jam (WIB) */}
          <div style={{ marginTop: 8 }}>
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(90deg,#eff6ff,#fff)', borderBottom: '1px solid var(--color-border)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Clock size={15} style={{ color: '#1d4ed8' }} />
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e3a8a' }}>
                  Rekapan Penjualan Per-Jam (WIB)
                </span>
                <span style={{ marginLeft: 4, background: '#dbeafe', color: '#1e40af', borderRadius: 999, padding: '1px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                  {hourlyRows.length} jam aktif
                </span>
                {peakHourRow && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.74rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '2px 10px', borderRadius: 999 }}>
                    Jam Puncak: {peakHourRow.label} ({rp(peakHourRow.omzet)})
                  </span>
                )}
              </div>

              {hourlyRows.length === 0 ? (
                <div className="card-body" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--color-text-muted)', fontSize: '0.84rem' }}>
                  Belum ada transaksi tercatat pada rentang waktu ini.
                </div>
              ) : (
                <div className="table-wrapper" style={{ WebkitOverflowScrolling: 'touch' }}>
                  <table className="table" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 34, textAlign: 'center' }}>
                          <SelectAllCheckbox
                            checked={hourlySelection.allVisibleSelected(visibleHourIds)}
                            indeterminate={hourlySelection.someVisibleSelected(visibleHourIds)}
                            onChange={() => hourlySelection.toggleAll(visibleHourIds)}
                            ariaLabel="Pilih semua baris per jam"
                          />
                        </th>
                        <th>Jam (WIB)</th>
                        <th style={{ textAlign: 'center' }}>Kasir Aktif</th>
                        <th style={{ textAlign: 'right' }}>Trx</th>
                        <th style={{ textAlign: 'right' }}>Void</th>
                        <th style={{ textAlign: 'right' }}>Omzet Total</th>
                        <th style={{ minWidth: 110 }}>Porsi Omzet</th>
                        <th style={{ textAlign: 'right', color: '#16a34a' }}>Cash</th>
                        <th style={{ textAlign: 'right', color: '#7c3aed' }}>QRIS</th>
                        <th style={{ textAlign: 'right' }}>HPP</th>
                        <th style={{ textAlign: 'right' }}>Laba Kotor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourlyRows.map((h) => {
                        const rowId = String(h.hour);
                        const checked = hourlySelection.isSelected(rowId);
                        const isPeak = peakHourRow?.hour === h.hour;
                        const pctWidth = maxHourOmzet > 0 ? Math.max(4, Math.round((n(h.omzet) / maxHourOmzet) * 100)) : 0;
                        return (
                          <tr
                            key={h.hour}
                            style={{
                              background: checked ? '#eff6ff' : isPeak ? '#f0fdf4' : undefined,
                              transition: 'background-color 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          >
                            <td style={{ textAlign: 'center', padding: 0 }}>
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minWidth: 44,
                                  minHeight: 44,
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => hourlySelection.toggleRow(rowId)}
                                  aria-label={`Pilih jam ${h.label}`}
                                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                                />
                              </label>
                            </td>
                            <td style={{ fontWeight: 700, color: isPeak ? '#166534' : 'inherit' }}>
                              {h.label} {isPeak && ''}
                            </td>
                            <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{h.activeKasirCount}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{h.txCount.toLocaleString('id-ID')}</td>
                            <td style={{ textAlign: 'right', color: h.voidCount > 0 ? '#dc2626' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                              {h.voidCount}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 800, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{rp(h.omzet)}</td>
                            <td>
                              <div style={{ height: 8, width: '100%', background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pctWidth}%`, background: isPeak ? '#16a34a' : '#2563eb', borderRadius: 999 }} />
                              </div>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{rp(h.cash)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#7c3aed', fontVariantNumeric: 'tabular-nums' }}>{rp(h.qris)}</td>
                            <td style={{ textAlign: 'right', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{rp(h.hpp)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#0369a1', fontVariantNumeric: 'tabular-nums' }}>{rp(h.labaKotor)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 800, borderTop: '2px solid var(--color-border)', background: '#eff6ff' }}>
                        <td />
                        <td style={{ color: '#1e3a8a' }}>TOTAL ({hourlyRows.length} jam)</td>
                        <td />
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{HTotal.tx.toLocaleString('id-ID')}</td>
                        <td style={{ textAlign: 'right', color: HTotal.void > 0 ? '#dc2626' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{HTotal.void}</td>
                        <td style={{ textAlign: 'right', color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{rp(HTotal.omzet)}</td>
                        <td />
                        <td style={{ textAlign: 'right', color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{rp(HTotal.cash)}</td>
                        <td style={{ textAlign: 'right', color: '#7c3aed', fontVariantNumeric: 'tabular-nums' }}>{rp(HTotal.qris)}</td>
                        <td style={{ textAlign: 'right', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{rp(HTotal.hpp)}</td>
                        <td style={{ textAlign: 'right', color: '#0369a1', fontVariantNumeric: 'tabular-nums' }}>{rp(HTotal.laba)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <SelectedRowsBar
              selectedCount={selectedHourRows.length}
              itemLabel="jam"
              metrics={[
                { label: 'Transaksi', value: selectedHourTotals.tx.toLocaleString('id-ID') },
                { label: 'Subtotal Omzet', value: rp(selectedHourTotals.omzet), tone: 'primary' },
                { label: 'Subtotal Cash', value: rp(selectedHourTotals.cash), tone: 'success' },
                { label: 'Subtotal QRIS', value: rp(selectedHourTotals.qris), tone: 'info' },
                { label: 'Subtotal HPP', value: rp(selectedHourTotals.hpp) },
                { label: 'Subtotal Laba', value: rp(selectedHourTotals.laba), tone: 'success' },
              ]}
              onExportExcel={doExportSelectedHourly}
              onClear={hourlySelection.clearSelection}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shift Detail Modal ───────────────────────────────────────
function ShiftModal({ kasir, shifts, onClose }: { kasir: KasirSummary; shifts: ShiftDetail[]; onClose: () => void }) {
  const uid = useId();
  const myS = shifts.filter(
    (s) => s.employeeId === kasir.kasirId || s.participantEmployeeIds?.includes(kasir.kasirId),
  );

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-t`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 12px',
        overflowY: 'auto',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 1040,
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 16,
          overflow: 'hidden',
          animation: 'slideUpFade 0.22s var(--ease-out-expo)',
        }}
      >
        <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#1e40af)', padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
          <div>
            <h2 id={`${uid}-t`} style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
              Detail Partisipasi Shift — {kasir.kasirName}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.78rem', margin: '4px 0 0' }}>
              NIM {kasir.kasirNim} · {kasir.jabatan} · {myS.length} shift
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, cursor: 'pointer', minWidth: 44, minHeight: 44, padding: 0, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 10, padding: '14px 18px', background: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          {[
            { l: 'Omzet Pribadi', v: rp(n(kasir.totalOmzet)), c: '#166534' },
            { l: 'Laba Kotor Pribadi', v: rp(n(kasir.totalLabaKotor)), c: '#0369a1' },
            { l: 'Rata-rata/Shift', v: rp(n(kasir.avgOmzetPerShift)), c: '#7c3aed' },
            { l: 'Total Trx', v: n(kasir.totalTxCount).toLocaleString('id-ID'), c: '#b45309' },
            { l: 'Top Produk', v: kasir.topProduk, c: '#0f766e' },
          ].map((item) => (
            <div key={item.l} style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: 3 }}>{item.l}</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: item.c, wordBreak: 'break-word' }}>{item.v}</div>
            </div>
          ))}
        </div>

        <div className="table-wrapper" style={{ flex: 1, minHeight: 0, maxHeight: '55dvh', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <table className="table" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr>
                <th>Peran Shift</th>
                <th>Clock-In</th>
                <th>Clock-Out</th>
                <th>Durasi</th>
                <th style={{ textAlign: 'right' }}>Omzet Laci</th>
                <th style={{ textAlign: 'right' }}>Laba Kotor Laci</th>
                <th style={{ textAlign: 'right', color: '#16a34a' }}>Hak 50% (Bruto)</th>
                <th style={{ textAlign: 'right' }}>Selisih Laci</th>
                <th style={{ textAlign: 'right', color: '#dc2626' }}>Potong Tekor</th>
                <th style={{ textAlign: 'right', color: '#15803d', fontWeight: 800 }}>Upah Bersih</th>
                <th style={{ textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {myS.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--color-text-muted)' }}>
                    Tidak ada shift tercatat pada rentang tanggal ini.
                  </td>
                </tr>
              ) : (
                myS.map((s) => {
                  const tier = s.status === 'ACTIVE' ? 'RUNNING' : s.discrepancyTier;
                  const ts = TS[tier] ?? TS.RUNNING;
                  const labaKotor = n(s.labaKotor);
                  const hakBruto = Math.round(labaKotor * 0.5);
                  const isTekor = s.discrepancy !== null && s.discrepancy < -2000;
                  const potongTekor = isTekor ? Math.abs(n(s.discrepancy)) : 0;
                  const upahBersih = Math.max(0, hakBruto - potongTekor);
                  const isPendamping = s.employeeId !== kasir.kasirId;

                  return (
                    <tr key={s.shiftId}>
                      <td>
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: isPendamping ? '#f5f3ff' : '#ecfdf5',
                            color: isPendamping ? '#6d28d9' : '#166534',
                            border: `1px solid ${isPendamping ? '#ddd6fe' : '#bbf7d0'}`,
                          }}
                        >
                          {isPendamping ? `Pendamping (${s.kasirPembukaName ?? 'Rekan'})` : 'Pembuka Laci'}
                        </span>
                        {s.rawModalWarning && (
                          <div style={{ fontSize: '0.62rem', color: '#b45309', marginTop: 2 }}>
                            Modal: {rp(n(s.modalAwal))}
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{fdt(s.clockIn)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: s.clockOut ? 'inherit' : '#9ca3af' }}>{fdt(s.clockOut)}</td>
                      <td>{dur(s.durasiMenit)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{rp(n(s.omzet))}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rp(labaKotor)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{rp(hakBruto)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: ts.color, fontVariantNumeric: 'tabular-nums' }}>
                        {s.discrepancy !== null
                          ? (s.discrepancy >= 0 ? '+' : '') + rp(n(s.discrepancy))
                          : s.status === 'ACTIVE'
                            ? '(aktif)'
                            : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: potongTekor > 0 ? '#dc2626' : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                        {potongTekor > 0 ? `-${rp(potongTekor)}` : 'Rp 0'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: '#166534', backgroundColor: '#f0fdf4', fontVariantNumeric: 'tabular-nums' }}>
                        {rp(upahBersih)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 999,
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: ts.color,
                            background: ts.bg,
                            border: `1px solid ${ts.border}`,
                          }}
                        >
                          {s.status === 'ACTIVE' ? 'Aktif' : s.statusLaci}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
