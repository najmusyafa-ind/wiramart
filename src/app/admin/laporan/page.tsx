'use client';

import { useState, useEffect, useId, useCallback, useRef } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  ShoppingBag,
  CreditCard,
  Banknote,
  Calendar,
  Download,
  AlertTriangle,
  X,
  Loader2,
  FileText,
  CheckCircle,
  QrCode,
  Receipt,
  Wallet,
  Users,
  ArrowLeftRight,
} from 'lucide-react';
import RekapHarian from './RekapHarian';
import BiayaOperasionalPanel from './BiayaOperasionalPanel';
import {
  EXPENSE_CATEGORY_LABEL,
  formatRupiah,
  formatTanggalWib,
  noticeStyle,
  type DailyRowUi,
  type ExpenseRowUi,
  type IntegrityChecksUi,
} from './shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'semi_annual';

type RecentTransaction = {
  id: string;
  invoiceNumber: string;
  paymentMethod: 'CASH' | 'QRIS' | 'SPLIT';
  payments?: { paymentMethod: 'CASH' | 'QRIS'; amount: string }[];
  status: 'COMPLETED' | 'VOID';
  grossAmount: string;
  cashReceived: string | null;
  changeAmount: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  employeeName: string;
  employeeId: string;
};

type ShiftRecord = {
  shiftId: string;
  clockIn: string;
  clockOut: string | null;
  status: string;
  modalAwal: number | null;
  cashSales?: number;
  cashOut?: number;
  cashIn?: number;
  expectedCash?: number;
  actualCash?: number | null;
  discrepancy?: number | null;
  statusLaci?: 'RUNNING' | 'BALANCED' | 'SHORTAGE' | 'OVERAGE';
  notes?: string | null;
  kasirName: string;
  kasirNim: string;
};

type LaporanData = {
  period: string;
  label: string;
  summary: {
    grossAmount: number;
    grossProfit: number;
    totalHpp: number;
    totalCount: number;
    countCash: number;
    countQris: number;
    countVoid: number;
    amountCash: number;
    amountQris: number;
    voidAmount: number;
    alokasiGajiKaryawan?: number;
    persenBagiHasil?: number;
    omzetTanpaHpp: number;
    unitTanpaHpp: number;
    labaLengkap: boolean;
    biayaOperasional: number;
    labaBersih: number;
  };
  daily: DailyRowUi[];
  checks: IntegrityChecksUi;
  topProducts: { productName: string; totalQty: number; totalRevenue: string }[];
  dailyChart: {
    day: string;
    revenue: string;
    profit: string;
    txCount: number;
    amountCash: string;
    amountQris: string;
  }[];
  recentTransactions: RecentTransaction[];
  shifts: ShiftRecord[];
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function formatRp(n: number | string) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return 'Rp ' + (isNaN(num) ? 0 : num).toLocaleString('id-ID');
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'daily',       label: 'Hari Ini' },
  { key: 'weekly',      label: 'Minggu Ini' },
  { key: 'monthly',     label: 'Bulan Ini' },
  { key: 'semi_annual', label: '6 Bulan' },
];

// ─────────────────────────────────────────────────────────────
// Void Modal Component
// ─────────────────────────────────────────────────────────────
type VoidModalProps = {
  transaction: RecentTransaction;
  onClose: () => void;
  onSuccess: () => void;
};

function VoidModal({ transaction, onClose, onSuccess }: VoidModalProps) {
  const uid = useId();
  const [alasan, setAlasan] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // Focus trap: fokus ke textarea saat modal buka
  useEffect(() => {
    reasonRef.current?.focus();
    // Escape key close
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleVoid() {
    if (!alasan.trim()) { setError('Alasan wajib diisi.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/transaksi/${transaction.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alasan: alasan.trim() }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (res.ok && json.success) {
        onSuccess();
        onClose();
      } else {
        setError(typeof json.error === 'string' ? json.error : 'Gagal void transaksi.');
      }
    } catch {
      setError('Terjadi kesalahan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-void-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{
          width: '100%', maxWidth: 440,
          animation: 'slideUpFade 0.2s var(--ease-out-expo)',
        }}
      >
        {/* Header */}
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2
            id={`${uid}-void-title`}
            className="card-title"
            style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-error)' }}
          >
            <AlertTriangle size={16} aria-hidden="true" />
            Batalkan Transaksi (Void)
          </h2>
          <button
            onClick={onClose}
            aria-label="Tutup modal"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Info transaksi */}
          <div
            style={{
              backgroundColor: 'var(--color-surface-alt)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Invoice</span>
              <strong>{transaction.invoiceNumber}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Total</span>
              <strong>{formatRp(transaction.grossAmount)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Kasir</span>
              <span>{transaction.employeeName}</span>
            </div>
          </div>

          {/* Warning */}
          <div
            role="alert"
            style={{
              backgroundColor: 'var(--color-error-light)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.6,
            }}
          >
            Transaksi yang di-void <strong>tidak dapat dibatalkan</strong>. Stok produk akan
            dikembalikan secara otomatis. Pastikan alasan void sudah benar.
          </div>

          {/* Input alasan */}
          <div className="form-group">
            <label htmlFor={`${uid}-alasan`} className="form-label">
              Alasan Void <span aria-hidden="true" style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <textarea
              ref={reasonRef}
              id={`${uid}-alasan`}
              className="form-input form-textarea"
              rows={3}
              placeholder="Contoh: Salah input produk, permintaan pembeli, dll."
              value={alasan}
              onChange={(e) => { setAlasan(e.target.value); setError(''); }}
              maxLength={300}
              aria-required="true"
              aria-describedby={error ? `${uid}-void-error` : undefined}
            />
            {error && (
              <p id={`${uid}-void-error`} role="alert" style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                {error}
              </p>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
            <button onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Batal
            </button>
            <button
              onClick={handleVoid}
              className="btn btn-danger"
              disabled={loading || !alasan.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              {loading ? (
                <><Loader2 size={14} className="spin-icon" aria-hidden="true" /> Memproses...</>
              ) : (
                <><AlertTriangle size={14} aria-hidden="true" /> Konfirmasi Void</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function LaporanPage() {
  const uid = useId();
  const [period, setPeriod] = useState<PeriodKey>('daily');
  const [data, setData] = useState<LaporanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState<RecentTransaction | null>(null);

  const fetchData = useCallback(async (p: PeriodKey, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/laporan?period=${p}`);
      const json = await res.json() as { success?: boolean; data?: LaporanData; error?: string };
      if (!res.ok || !json.success) { setError(json.error ?? 'Gagal memuat laporan'); return; }
      setData(json.data ?? null);
    } catch {
      setError('Terjadi kesalahan jaringan. Periksa koneksi Anda.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(period); }, [period, fetchData]);

  // ── Export Excel ────────────────────────────────────────────
  async function handleExport() {
    if (!data) return;
    setExportLoading(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira';
      wb.created = new Date();

      // ── Sheet 1: Ringkasan ───────────────────────────────
      const ws1 = wb.addWorksheet('Ringkasan');
      ws1.columns = [
        { header: 'Keterangan', key: 'label', width: 30 },
        { header: 'Nilai', key: 'value', width: 22 },
      ];

      // Style header row
      const hRow1 = ws1.getRow(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow1.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
        cell.alignment = { vertical: 'middle' };
      });
      hRow1.height = 22;

      const summaryRows: { label: string; value: number | string; isCurrency?: boolean }[] = [
        { label: 'Periode',          value: data.label },
        { label: 'Total Omzet',      value: data.summary.grossAmount,  isCurrency: true },
        { label: 'Omzet Cash',       value: data.summary.amountCash,   isCurrency: true },
        { label: 'Omzet QRIS',       value: data.summary.amountQris,   isCurrency: true },
        { label: 'Total HPP (produk ber-HPP)', value: data.summary.totalHpp, isCurrency: true },
        { label: 'Laba Kotor',       value: data.summary.grossProfit,  isCurrency: true },
        { label: 'Bagi Hasil Karyawan (50% Paten)', value: data.summary.alokasiGajiKaryawan ?? Math.round(data.summary.grossProfit * 0.5), isCurrency: true },
        { label: 'Biaya Operasional Toko', value: data.summary.biayaOperasional, isCurrency: true },
        { label: 'Laba Bersih Toko', value: data.summary.labaBersih,   isCurrency: true },
        {
          label: 'Status Laba',
          value: data.summary.labaLengkap
            ? 'Lengkap'
            : `TIDAK LENGKAP — ${data.summary.unitTanpaHpp} unit produk tanpa HPP tidak dihitung`,
        },
        { label: 'Omzet Produk Tanpa HPP', value: data.summary.omzetTanpaHpp, isCurrency: true },
        { label: 'Nilai Transaksi Void', value: data.summary.voidAmount, isCurrency: true },
        { label: 'Jumlah Transaksi', value: data.summary.totalCount },
        { label: 'Transaksi Cash',   value: data.summary.countCash },
        { label: 'Transaksi QRIS',   value: data.summary.countQris },
        { label: 'Transaksi Void',   value: data.summary.countVoid },
      ];

      summaryRows.forEach(({ label, value, isCurrency }) => {
        const row = ws1.addRow({ label, value });
        if (isCurrency && typeof value === 'number') {
          row.getCell('value').numFmt = '"Rp "#,##0';
        }
        // Zebra striping
        const rowIdx = row.number;
        if (rowIdx % 2 === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((cell: any) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          });
        }
        // Bold untuk Laba Bersih
        if (label === 'Laba Bersih') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FF166534' } };
          });
        }
      });

      // ── Sheet 2: Detail Transaksi ────────────────────────
      const ws2 = wb.addWorksheet('Detail Transaksi');
      ws2.columns = [
        { header: 'Invoice', key: 'invoice', width: 22 },
        { header: 'Tanggal', key: 'tanggal', width: 20 },
        { header: 'Kasir', key: 'kasir', width: 24 },
        { header: 'Metode', key: 'metode', width: 10 },
        { header: 'Total (Rp)', key: 'total', width: 18 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Alasan Void', key: 'alasan', width: 30 },
      ];

      const hRow2 = ws2.getRow(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow2.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
        cell.alignment = { vertical: 'middle' };
      });
      hRow2.height = 22;

      for (const t of data.recentTransactions) {
        const row = ws2.addRow({
          invoice: t.invoiceNumber,
          tanggal: formatDateTime(t.createdAt),
          kasir:   t.employeeName,
          metode:  t.paymentMethod,
          total:   parseFloat(t.grossAmount),
          status:  t.status,
          alasan:  t.voidReason ?? '',
        });
        row.getCell('total').numFmt = '"Rp "#,##0';
        // Warna baris void
        if (t.status === 'VOID') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((cell: any) => {
            cell.font = { color: { argb: 'FFDC2626' } };
          });
        }
      }

      // ── Sheet 3: Top Produk ──────────────────────────────
      const ws3 = wb.addWorksheet('Top Produk');
      ws3.columns = [
        { header: 'Nama Produk', key: 'nama', width: 32 },
        { header: 'Qty Terjual', key: 'qty', width: 14 },
        { header: 'Total Omzet (Rp)', key: 'omzet', width: 20 },
      ];

      const hRow3 = ws3.getRow(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow3.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
        cell.alignment = { vertical: 'middle' };
      });
      hRow3.height = 22;

      for (const p of data.topProducts) {
        const row = ws3.addRow({ nama: p.productName, qty: p.totalQty, omzet: parseFloat(p.totalRevenue) });
        row.getCell('omzet').numFmt = '"Rp "#,##0';
      }

      // ── Sheet 4: Laporan Shift (Modal Awal) ─────────────────
      const ws4 = wb.addWorksheet('Laporan Shift');
      ws4.columns = [
        { header: 'Kasir', key: 'kasir', width: 28 },
        { header: 'NIM', key: 'nim', width: 16 },
        { header: 'Clock In', key: 'in', width: 22 },
        { header: 'Clock Out', key: 'out', width: 22 },
        { header: 'Durasi', key: 'durasi', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Modal Awal (Rp)', key: 'modal', width: 20 },
      ];
      const hRow4 = ws4.getRow(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hRow4.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
        cell.alignment = { vertical: 'middle' };
      });
      hRow4.height = 22;

      const shiftRows = data.shifts ?? [];
      shiftRows.forEach((s, idx) => {
        const inStr = new Date(s.clockIn).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
        const outStr = s.clockOut
          ? new Date(s.clockOut).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
          : 'Masih Aktif';
        const durasiMenit = s.clockOut
          ? Math.round((new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime()) / 60000)
          : null;
        const durasiStr = durasiMenit !== null
          ? `${Math.floor(durasiMenit / 60)}j ${durasiMenit % 60}m`
          : '—';
        const row = ws4.addRow({
          kasir: s.kasirName,
          nim: s.kasirNim,
          in: inStr,
          out: outStr,
          durasi: durasiStr,
          status: s.status,
          modal: s.modalAwal ?? 0,
        });
        row.getCell('modal').numFmt = '"Rp "#,##0';
        if (idx % 2 === 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.eachCell((cell: any) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          });
        }
        // Highlight shift masih aktif
        if (s.status === 'ACTIVE') {
          const statusCell = row.getCell('status');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (statusCell as any).font = { bold: true, color: { argb: 'FF16A34A' } };
        }
        row.height = 20;
      });

      // Total modal awal di bawah
      if (shiftRows.length > 0) {
        const totalModal = shiftRows.reduce((sum, s) => sum + (s.modalAwal ?? 0), 0);
        const totalRow = ws4.addRow({
          kasir: 'TOTAL', nim: '', in: '', out: '', durasi: `${shiftRows.length} shift`, status: '', modal: totalModal,
        });
        totalRow.getCell('modal').numFmt = '"Rp "#,##0';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        totalRow.eachCell((cell: any) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        });
      }

      // ── Sheet 5: Rekap Harian ─────────────────────────────────
      const styleHeader = (row: typeof hRow1) => {
        row.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
          cell.alignment = { vertical: 'middle' };
        });
        row.height = 22;
      };

      const ws5 = wb.addWorksheet('Rekap Harian');
      ws5.columns = [
        { header: 'Tanggal', key: 'tanggal', width: 20 },
        { header: 'Transaksi', key: 'trx', width: 11 },
        { header: 'Void', key: 'void', width: 8 },
        { header: 'Omzet (Rp)', key: 'omzet', width: 16 },
        { header: 'Cash (Rp)', key: 'cash', width: 16 },
        { header: 'QRIS (Rp)', key: 'qris', width: 16 },
        { header: 'HPP (Rp)', key: 'hpp', width: 16 },
        { header: 'Laba Kotor (Rp)', key: 'kotor', width: 18 },
        { header: 'Bagi Hasil (50%) (Rp)', key: 'gaji', width: 20 },
        { header: 'Biaya (Rp)', key: 'biaya', width: 16 },
        { header: 'Laba Bersih Toko (Rp)', key: 'bersih', width: 20 },
      ];
      styleHeader(ws5.getRow(1));
      const moneyKeys = ['omzet', 'cash', 'qris', 'hpp', 'kotor', 'gaji', 'biaya', 'bersih'] as const;
      for (const d of data.daily) {
        const row = ws5.addRow({
          tanggal: formatTanggalWib(d.date), trx: d.txCount, void: d.voidCount,
          omzet: d.omzet, cash: d.omzetCash, qris: d.omzetQris, hpp: d.hppTerjual,
          kotor: d.labaKotor, gaji: d.alokasiGajiKaryawan ?? Math.round(d.labaKotor * 0.5),
          biaya: d.biayaOperasional, bersih: d.labaBersih,
        });
        moneyKeys.forEach((k) => { row.getCell(k).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0'; });
      }
      if (data.daily.length > 0) {
        const sum = (pick: (d: DailyRowUi) => number) => data.daily.reduce((s, d) => s + pick(d), 0);
        const totOmzet = sum((d) => d.omzet);
        const totBersih = sum((d) => d.labaBersih);
        const totalRow = ws5.addRow({
          tanggal: `TOTAL (${data.daily.length} hari)`,
          trx: sum((d) => d.txCount), void: sum((d) => d.voidCount),
          omzet: totOmzet, cash: sum((d) => d.omzetCash), qris: sum((d) => d.omzetQris),
          hpp: sum((d) => d.hppTerjual), kotor: sum((d) => d.labaKotor),
          gaji: sum((d) => d.alokasiGajiKaryawan ?? Math.round(d.labaKotor * 0.5)),
          biaya: sum((d) => d.biayaOperasional), bersih: totBersih,
        });
        moneyKeys.forEach((k) => { totalRow.getCell(k).numFmt = '"Rp "#,##0;[Red]-"Rp "#,##0'; });
        totalRow.eachCell((cell) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        });
        const konsisten =
          totOmzet === data.summary.grossAmount &&
          totBersih === data.summary.labaBersih &&
          data.checks.methodSplitMatches && data.checks.itemsMatchOmzet && data.checks.dailyMatchesSummary;
        ws5.addRow({});
        ws5.addRow({ tanggal: `Pemeriksaan konsistensi: ${konsisten ? 'OK (total harian = ringkasan)' : 'PERIKSA — ada selisih'}` });
        if (!data.summary.labaLengkap) {
          ws5.addRow({ tanggal: '* Laba tidak lengkap: produk tanpa HPP tidak dihitung dalam laba.' });
        }
      }

      // ── Sheet 6: Biaya Operasional ───────────────────────────
      const ws6 = wb.addWorksheet('Biaya');
      ws6.columns = [
        { header: 'Tanggal', key: 'tanggal', width: 20 },
        { header: 'Kategori', key: 'kategori', width: 30 },
        { header: 'Keterangan', key: 'ket', width: 40 },
        { header: 'Nominal (Rp)', key: 'nominal', width: 18 },
        { header: 'Dicatat oleh', key: 'oleh', width: 24 },
      ];
      styleHeader(ws6.getRow(1));
      let biayaRows: ExpenseRowUi[] = [];
      let biayaOk = false;
      try {
        const biayaRes = await fetch(`/api/admin/biaya?period=${period}`);
        const biayaJson = (await biayaRes.json()) as { success?: boolean; data?: { rows: ExpenseRowUi[] } };
        if (biayaRes.ok && biayaJson.success && biayaJson.data) {
          biayaRows = biayaJson.data.rows;
          biayaOk = true;
        }
      } catch {
        biayaOk = false;
      }
      if (!biayaOk) {
        ws6.addRow({ tanggal: 'GAGAL memuat daftar biaya — ekspor ulang untuk melengkapi sheet ini.' });
      }
      for (const b of biayaRows) {
        const row = ws6.addRow({
          tanggal: formatTanggalWib(b.expenseDate),
          kategori: EXPENSE_CATEGORY_LABEL[b.category],
          ket: b.description,
          nominal: b.amount,
          oleh: b.createdByName,
        });
        row.getCell('nominal').numFmt = '"Rp "#,##0';
      }
      if (biayaRows.length > 0) {
        const totalBiaya = ws6.addRow({
          tanggal: 'TOTAL', kategori: '', ket: '',
          nominal: biayaRows.reduce((s, b) => s + b.amount, 0), oleh: '',
        });
        totalBiaya.getCell('nominal').numFmt = '"Rp "#,##0';
        totalBiaya.eachCell((cell) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        });
      }

      // Generate dan download
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-smartkasir-${period}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (_e) {
      // Fallback — tidak crash halaman
    } finally {
      setExportLoading(false);
    }
  }

  // ── Chart helpers ───────────────────────────────────────────
  const maxRevenue = data?.dailyChart.reduce(
    (m, d) => Math.max(m, parseFloat(d.revenue) || 0), 1,
  ) ?? 1;

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Void Modal */}
      {voidTarget && (
        <VoidModal
          transaction={voidTarget}
          onClose={() => setVoidTarget(null)}
          onSuccess={() => fetchData(period)}
        />
      )}

      <div>
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Laporan Keuangan</h1>
            <p className="page-subtitle">{data?.label ?? '—'}</p>
          </div>
          <button
            id={`${uid}-export`}
            onClick={handleExport}
            className="btn btn-secondary"
            disabled={!data || exportLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            aria-label="Export laporan ke Excel"
          >
            {exportLoading
              ? <><Loader2 size={14} className="spin-icon" aria-hidden="true" /> Exporting...</>
              : <><Download size={14} aria-hidden="true" /> Export Excel</>
            }
          </button>
        </div>

        {/* Period selector */}
        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div
              role="group"
              aria-label="Pilih periode laporan"
              style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
            >
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  id={`${uid}-period-${p.key}`}
                  onClick={() => setPeriod(p.key)}
                  className={`btn btn-sm ${period === p.key ? 'btn-primary' : 'btn-secondary'}`}
                  aria-pressed={period === p.key}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-16) var(--space-6)',
              minHeight: 280,
              gap: 'var(--space-3)',
              textAlign: 'center',
              width: '100%',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'var(--color-primary-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
              }}
            >
              <Loader2 size={26} className="spin-icon" aria-hidden="true" />
            </div>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
              Memuat Laporan Keuangan...
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: 360, lineHeight: 1.5 }}>
              Menghitung omzet, HPP, laba kotor, dan bagi hasil 50% shift
            </div>
          </div>
        ) : data ? (
          <>
            {/* ─── Peringatan keakuratan ──────────────────────── */}
            {!data.summary.labaLengkap && (
              <div role="alert" style={{ ...noticeStyle('warning'), marginBottom: 'var(--space-4)' }}>
                <strong>Laba belum lengkap.</strong> Ada penjualan {data.summary.unitTanpaHpp} unit produk
                (omzet {formatRupiah(data.summary.omzetTanpaHpp)}) yang HPP-nya belum diisi. Penjualan tersebut
                tetap masuk Omzet, tetapi <strong>tidak dihitung</strong> dalam Laba Kotor/Bersih. Lengkapi HPP
                di menu Produk agar laba akurat.
              </div>
            )}
            {(!data.checks.methodSplitMatches || !data.checks.itemsMatchOmzet || !data.checks.dailyMatchesSummary) && (
              <div role="alert" style={{ ...noticeStyle('error'), marginBottom: 'var(--space-4)' }}>
                <strong>Pemeriksaan konsistensi gagal.</strong> Total per metode/rincian/harian tidak sama dengan
                ringkasan. Jangan gunakan angka ini sebelum diperiksa.
              </div>
            )}

            {/* ─── CLUSTER 1: Arus Pendapatan & Metode Pembayaran ── */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
                  <TrendingUp size={16} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                  Arus Pendapatan &amp; Penjualan
                </h2>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Total {data.summary.totalCount} transaksi ({data.summary.countVoid > 0 ? `${data.summary.countVoid} void dibatalkan` : '0 void'})
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 'var(--space-4)',
                }}
              >
                {/* Total Omzet */}
                <article id={`${uid}-card-total`} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-primary)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                    <TrendingUp size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label">Total Omzet Penjualan</div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                    {formatRp(data.summary.grossAmount)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    100% total omzet kotor periode ini
                  </div>
                </article>

                {/* Cash */}
                <article id={`${uid}-card-cash`} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-success)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                    <Banknote size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label">Penerimaan Tunai (Cash)</div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-success)' }}>
                    {formatRp(data.summary.amountCash)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    {data.summary.countCash} transaksi {data.summary.grossAmount > 0 ? `(${Math.round((data.summary.amountCash / data.summary.grossAmount) * 100)}% omzet)` : ''}
                  </div>
                </article>

                {/* QRIS */}
                <article id={`${uid}-card-qris`} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-info)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-info-light)', color: 'var(--color-info)' }}>
                    <QrCode size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label">Penerimaan Non-Tunai (QRIS)</div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-info)' }}>
                    {formatRp(data.summary.amountQris)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    {data.summary.countQris} transaksi {data.summary.grossAmount > 0 ? `(${Math.round((data.summary.amountQris / data.summary.grossAmount) * 100)}% omzet)` : ''}
                  </div>
                </article>
              </div>
            </div>

            {/* ─── CLUSTER 2: Profitabilitas & Kalkulasi Laba Bersih (Sistem Bagi Hasil 50:50) ── */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
                  <Wallet size={16} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                  Profitabilitas &amp; Beban Toko
                </h2>
                <span style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-alt)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-medium)' }}>
                  Rumus: (Laba Kotor − Biaya Operasional) = Laba Bersih Operasional → 50% Mahasiswa : 50% Wiramart
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 'var(--space-4)',
                }}
              >
                {/* Laba Kotor */}
                <article id={`${uid}-card-laba`} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-warning)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                    <DollarSign size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label">Laba Kotor{!data.summary.labaLengkap && ' *'}</div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
                    {formatRupiah(data.summary.grossProfit)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    Omzet − Total HPP ({formatRupiah(data.summary.totalHpp)})
                  </div>
                  {!data.summary.labaLengkap && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', marginTop: 'var(--space-1)' }}>
                      * Sebagian produk belum memiliki data HPP
                    </div>
                  )}
                </article>

                {/* Bagi Hasil Karyawan (50% Paten) */}
                <article id={`${uid}-card-gaji`} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-primary)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                    <Users size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label" style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-primary)' }}>
                    Bagi Hasil Mahasiswa (50%)
                  </div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                    {formatRupiah(data.summary.alokasiGajiKaryawan ?? Math.round(data.summary.grossProfit * 0.5))}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    50% dari sisa laba bersih operasional
                  </div>
                </article>

                {/* Biaya Operasional */}
                <article id={`${uid}-card-biaya`} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-error)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-error-light)', color: 'var(--color-error)' }}>
                    <Receipt size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label">Biaya Operasional Toko</div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: data.summary.biayaOperasional > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                    {formatRupiah(data.summary.biayaOperasional)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    Paten bulanan 50rb (ATK 20rb + Bensin 30rb) + pengeluaran lain
                  </div>
                </article>

                {/* Laba Bersih Toko */}
                <article id={`${uid}-card-bersih`} className="stat-card" style={{ position: 'relative', overflow: 'hidden', border: '1px solid var(--color-success-light)' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: data.summary.labaBersih < 0 ? 'var(--color-error)' : 'var(--color-success)' }} />
                  <div className="stat-card__icon" style={{ backgroundColor: data.summary.labaBersih < 0 ? 'var(--color-error-light)' : 'var(--color-success-light)', color: data.summary.labaBersih < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    <Wallet size={20} aria-hidden="true" />
                  </div>
                  <div className="stat-card__label" style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
                    Laba Bersih Wiramart (50%){!data.summary.labaLengkap && ' *'}
                  </div>
                  <div className="stat-card__value" style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: data.summary.labaBersih < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    {formatRupiah(data.summary.labaBersih)}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    Hak bersih toko setelah biaya &amp; bagi hasil
                  </div>
                </article>
              </div>

              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--text-xs)', color: 'var(--color-text)', display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>🤝</span>
                <div style={{ lineHeight: 1.6 }}>
                  <strong>Sistem Bagi Hasil 50:50 Wiramart:</strong> Laba kotor penjualan dikurangi biaya operasional toko terlebih dahulu untuk mendapatkan <strong>Laba Bersih Operasional</strong>. Hasil bersih tersebut kemudian dibagi <strong>50%</strong> untuk hak mahasiswa (akumulasi per shift dan dibagi rata antar 4 role shift), dan <strong>50%</strong> menjadi laba bersih hak milik toko Wiramart. Pada periode bulanan, biaya paten Rp 50.000 (ATK Rp 20.000 + Bensin Rp 30.000) otomatis diikutsertakan.
                </div>
              </div>
            </div>

            {/* ─── Rekap Harian ────────────────────────────────── */}
            <RekapHarian rows={data.daily} labaLengkap={data.summary.labaLengkap} />

            {/* ─── Biaya Operasional (input & daftar) ──────────── */}
            <BiayaOperasionalPanel period={period} onChanged={() => void fetchData(period, true)} />

            {/* ─── Row: Top Produk + Void info ──────────────────── */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 'var(--space-5)',
                marginBottom: 'var(--space-6)',
              }}
            >
              {/* Top 5 Produk Terlaris */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <TrendingUp size={16} aria-hidden="true" /> Top 5 Produk Terlaris
                  </h2>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {data.topProducts.length === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
                      Belum ada data produk
                    </p>
                  ) : data.topProducts.map((p, i) => (
                    <div key={p.productName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{
                          width: 24, height: 24, borderRadius: '50%',
                          background: i === 0 ? 'var(--color-primary)' : 'var(--color-surface-alt)',
                          color: i === 0 ? 'white' : 'var(--color-text-muted)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', flexShrink: 0,
                        }}>
                          {i + 1}
                        </span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
                          {p.productName}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                          {p.totalQty} pcs
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          {formatRp(p.totalRevenue)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ringkasan Metode + Void Count */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <CreditCard size={16} aria-hidden="true" /> Ringkasan Pembayaran
                  </h2>
                </div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {[
                    { label: 'Cash', amount: data.summary.amountCash, count: data.summary.countCash, color: 'var(--color-success)', icon: <Banknote size={16} aria-hidden="true" /> },
                    { label: 'QRIS', amount: data.summary.amountQris, count: data.summary.countQris, color: 'var(--color-info)', icon: <QrCode size={16} aria-hidden="true" /> },
                  ].map((m) => (
                    <div key={m.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: m.color, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                          {m.icon} {m.label}
                        </span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)' }}>{formatRp(m.amount)}</span>
                      </div>
                      {/* Progress bar proporsional */}
                      <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          borderRadius: 3,
                          backgroundColor: m.color,
                          width: data.summary.grossAmount > 0
                            ? `${(m.amount / data.summary.grossAmount * 100).toFixed(1)}%`
                            : '0%',
                          transition: 'width 0.6s var(--ease-out-expo)',
                        }} aria-hidden="true" />
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {m.count} transaksi
                        {data.summary.grossAmount > 0 && ` · ${(m.amount / data.summary.grossAmount * 100).toFixed(1)}%`}
                      </div>
                    </div>
                  ))}
                  {data.summary.countVoid > 0 && (
                    <div style={{ paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                      <span style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <ShoppingBag size={14} aria-hidden="true" /> Void
                      </span>
                      <strong style={{ color: 'var(--color-error)' }}>{data.summary.countVoid} transaksi</strong>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ─── Bar Chart Stacked: Cash vs QRIS per hari ─────── */}
            {data.dailyChart.length > 0 && (
              <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="card-header">
                  <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <BarChart3 size={16} aria-hidden="true" /> Grafik Omzet Harian
                  </h2>
                  {/* Legenda */}
                  <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-success)', display: 'inline-block' }} aria-hidden="true" />
                      Cash
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-info)', display: 'inline-block' }} aria-hidden="true" />
                      QRIS
                    </span>
                  </div>
                </div>
                <div className="card-body">
                  <div
                    role="img"
                    aria-label="Grafik bar omzet harian"
                    style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: 180, overflowX: 'auto', paddingBottom: 'var(--space-4)' }}
                  >
                    {data.dailyChart.map((d) => {
                      const total = parseFloat(d.revenue) || 0;
                      const cash  = parseFloat(d.amountCash) || 0;
                      const qris  = parseFloat(d.amountQris) || 0;
                      const totalHeight = (total / maxRevenue) * 140;
                      const cashPct  = total > 0 ? cash / total : 0;
                      const qrisPct  = total > 0 ? qris / total : 0;

                      return (
                        <div
                          key={d.day}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 36, flex: 1 }}
                        >
                          {/* Bar stacked */}
                          <div
                            title={`${d.day}\nTotal: ${formatRp(total)}\nCash: ${formatRp(cash)}\nQRIS: ${formatRp(qris)}\n${d.txCount} transaksi`}
                            style={{
                              width: '100%', maxWidth: 28,
                              height: `${Math.max(totalHeight, 4)}px`,
                              display: 'flex', flexDirection: 'column-reverse',
                              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                              overflow: 'hidden',
                              transition: 'height 0.4s var(--ease-out-expo)',
                            }}
                          >
                            <div style={{ flex: cashPct, backgroundColor: 'var(--color-success)', minHeight: cash > 0 ? 2 : 0 }} />
                            <div style={{ flex: qrisPct, backgroundColor: 'var(--color-info)', minHeight: qris > 0 ? 2 : 0 }} />
                          </div>
                          {/* Label tanggal */}
                          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', transformOrigin: 'top center' }}>
                            {d.day.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ─── Tabel Transaksi Terbaru + Void ──────────────── */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <FileText size={16} aria-hidden="true" /> Transaksi Terbaru
                </h2>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  20 transaksi terakhir
                </span>
              </div>
              <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
                {data.recentTransactions.length === 0 ? (
                  <p style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                    Belum ada transaksi pada periode ini
                  </p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['Invoice', 'Waktu', 'Kasir', 'Metode', 'Total', 'Status', 'Aksi'].map((h) => (
                          <th
                            key={h}
                            scope="col"
                            style={{
                              padding: 'var(--space-3) var(--space-4)',
                              textAlign: 'left', fontWeight: 'var(--weight-semibold)',
                              color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentTransactions.map((t) => (
                        <tr
                          key={t.id}
                          style={{
                            borderBottom: '1px solid var(--color-border)',
                            opacity: t.status === 'VOID' ? 0.55 : 1,
                            transition: 'background-color var(--duration-fast)',
                          }}
                        >
                          <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'monospace', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                            {t.invoiceNumber}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                            {formatDateTime(t.createdAt)}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap' }}>
                            {t.employeeName}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            <span
                              title={
                                t.paymentMethod === 'SPLIT' && t.payments && t.payments.length > 0
                                  ? t.payments.map((p) => `${p.paymentMethod}: ${formatRp(p.amount)}`).join(' + ')
                                  : undefined
                              }
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                                backgroundColor: t.paymentMethod === 'CASH'
                                  ? 'var(--color-success-light)'
                                  : t.paymentMethod === 'QRIS'
                                  ? 'var(--color-info-light)'
                                  : 'hsl(var(--color-primary-h, 220), 80%, 93%)',
                                color: t.paymentMethod === 'CASH'
                                  ? 'var(--color-success)'
                                  : t.paymentMethod === 'QRIS'
                                  ? 'var(--color-info)'
                                  : 'var(--color-primary)',
                              }}>
                              {t.paymentMethod === 'CASH' ? (
                                <Banknote size={11} aria-hidden="true" />
                              ) : t.paymentMethod === 'QRIS' ? (
                                <QrCode size={11} aria-hidden="true" />
                              ) : (
                                <ArrowLeftRight size={11} aria-hidden="true" />
                              )}
                              {t.paymentMethod === 'SPLIT' ? 'SPLIT' : t.paymentMethod}
                            </span>
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)', whiteSpace: 'nowrap' }}>
                            {formatRp(t.grossAmount)}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            {t.status === 'VOID' ? (
                              <span
                                title={t.voidReason ?? ''}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                                  backgroundColor: 'var(--color-error-light)',
                                  color: 'var(--color-error)',
                                }}
                              >
                                <AlertTriangle size={11} aria-hidden="true" /> VOID
                              </span>
                            ) : (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                                backgroundColor: 'var(--color-success-light)',
                                color: 'var(--color-success)',
                              }}>
                                <CheckCircle size={11} aria-hidden="true" /> OK
                              </span>
                            )}
                          </td>
                          <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                            {t.status === 'COMPLETED' && (
                              <button
                                onClick={() => setVoidTarget(t)}
                                aria-label={`Void transaksi ${t.invoiceNumber}`}
                                style={{
                                  background: 'none',
                                  border: '1px solid var(--color-error)',
                                  color: 'var(--color-error)',
                                  borderRadius: 'var(--radius-sm)',
                                  padding: '3px 10px',
                                  fontSize: 'var(--text-xs)',
                                  cursor: 'pointer',
                                  fontWeight: 'var(--weight-semibold)',
                                  transition: 'background-color var(--duration-fast)',
                                }}
                              >
                                Void
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── CARD AUDIT LACI & REKAP SHIFT KASIR ────────────────── */}
            <div className="card" style={{ marginTop: 'var(--space-6)', overflow: 'hidden' }}>
              <div
                className="card-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--space-4) var(--space-5)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Wallet size={18} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                  <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
                    Audit Laci &amp; Riwayat Shift Kasir
                  </h2>
                </div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {data.shifts?.length ?? 0} shift dalam periode ini
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                {!data.shifts || data.shifts.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)' }}>
                    Tidak ada sesi shift tercatat dalam periode ini.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-elevated)', textAlign: 'left' }}>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Kasir</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Waktu Sesi</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Modal Awal</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Penjualan Tunai</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Petty Cash (-)</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Kas Masuk (+)</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Expected Kas</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Fisik Laci (Blind Count)</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Selisih</th>
                        <th style={{ padding: 'var(--space-3) var(--space-4)', fontWeight: 'var(--weight-semibold)' }}>Status Audit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.shifts.map((sh) => {
                        const isClosed = sh.status === 'CLOSED';
                        const isShortage = sh.statusLaci === 'SHORTAGE';
                        const isOverage  = sh.statusLaci === 'OVERAGE';
                        const isBalanced = sh.statusLaci === 'BALANCED';

                        return (
                          <tr key={sh.shiftId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                              <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                                {sh.kasirName}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                                NIM {sh.kasirNim}
                              </div>
                              {sh.notes && (
                                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-secondary)', marginTop: 2, fontStyle: 'italic' }}>
                                  Catatan: &ldquo;{sh.notes}&rdquo;
                                </div>
                              )}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap' }}>
                              <div>{formatDateTime(sh.clockIn)}</div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                                {sh.clockOut ? `s/d ${formatDateTime(sh.clockOut)}` : '🟢 Sedang Berjalan'}
                              </div>
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap' }}>
                              {sh.modalAwal !== null ? formatRp(sh.modalAwal) : '—'}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', color: 'var(--color-success)', fontWeight: 600 }}>
                              +{formatRp(sh.cashSales ?? 0)}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', color: (sh.cashOut ?? 0) > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                              {(sh.cashOut ?? 0) > 0 ? `-${formatRp(sh.cashOut ?? 0)}` : 'Rp 0'}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', color: (sh.cashIn ?? 0) > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                              {(sh.cashIn ?? 0) > 0 ? `+${formatRp(sh.cashIn ?? 0)}` : 'Rp 0'}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', fontWeight: 700 }}>
                              {sh.expectedCash !== undefined ? formatRp(sh.expectedCash) : '—'}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', fontWeight: 700 }}>
                              {sh.actualCash !== null && sh.actualCash !== undefined
                                ? formatRp(sh.actualCash)
                                : isClosed ? 'Tidak diisi' : 'Belum tutup'}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)', whiteSpace: 'nowrap', fontWeight: 800 }}>
                              {sh.discrepancy !== null && sh.discrepancy !== undefined ? (
                                <span style={{
                                  color: isShortage
                                    ? 'var(--color-error)'
                                    : isOverage
                                    ? 'var(--color-info)'
                                    : 'var(--color-success)',
                                }}>
                                  {sh.discrepancy > 0 ? `+${formatRp(sh.discrepancy)}` : formatRp(sh.discrepancy)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                              {!isClosed ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)',
                                  fontWeight: 600,
                                }}>
                                  ⏳ AKTIF
                                </span>
                              ) : isBalanced ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'var(--color-success-light)', color: 'var(--color-success)',
                                  fontWeight: 600,
                                }}>
                                  <CheckCircle size={11} /> PAS
                                </span>
                              ) : isShortage ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'var(--color-error-light)', color: 'var(--color-error)',
                                  fontWeight: 600,
                                }}>
                                  <AlertTriangle size={11} /> TEKOR / KURANG
                                </span>
                              ) : (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'var(--color-info-light)', color: 'var(--color-info)',
                                  fontWeight: 600,
                                }}>
                                  ⬆️ LEBIH
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
