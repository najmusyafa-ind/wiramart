'use client';

import { useState, useEffect, useId, useCallback, useRef, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Calendar,
  Download,
  AlertTriangle,
  X,
  Loader2,
  FileText,
  QrCode,
  Wallet,
  Users,
  Users2,
  Lock,
  Boxes,
  Receipt,
} from 'lucide-react';
import type { PeriodKey, MonthlyBreakdownRow } from '@/lib/finance/report';
import { todayWibSlug } from '@/lib/utils/exportSelectedExcel';
import RekapHarian from './RekapHarian';
import BiayaOperasionalPanel from './BiayaOperasionalPanel';
import TutupBukuModal from './TutupBukuModal';
import LaporanMutasiStokSection from '@/features/portal/laporan/LaporanMutasiStokSection';
import RekapKasir from './RekapKasir';
import RekapShift from '@/features/portal/laporan/RekapShift';
import TransaksiQrisPanel from '@/features/portal/laporan/TransaksiQrisPanel';
import JejakTransaksiPanel from './JejakTransaksiPanel';
import NotaBelanjaPanel from '@/features/portal/nota-belanja/NotaBelanjaPanel';
import {
  formatRupiah,
  noticeStyle,
  type DailyRowUi,
  type IntegrityChecksUi,
} from '@/features/portal/laporan/shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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
  rawModalWarning?: boolean;
  cashSales?: number;
  cashOut?: number;
  cashIn?: number;
  expectedCash?: number;
  actualCash?: number | null;
  discrepancy?: number | null;
  statusLaci?: 'RUNNING' | 'BALANCED' | 'SHORTAGE' | 'OVERAGE';
  discrepancyTier?: 'HIJAU' | 'KUNING' | 'MERAH' | 'OVERAGE';
  notes?: string | null;
  kasirName: string;
  kasirNim: string;
  serahTerimaDiff?: number | null;
  auditFlags?: string[] | null;
};

type LaporanData = {
  period: string;
  label: string;
  rangeStartDate?: string;
  rangeEndDate?: string;
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
  monthly?: MonthlyBreakdownRow[];
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

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'daily', label: 'Hari Ini' },
  { key: 'weekly', label: 'Minggu Ini' },
  { key: 'monthly', label: 'Bulan Ini' },
  { key: 'october', label: 'Oktober' },
  { key: 'november', label: 'November' },
  { key: 'all', label: 'Semua' },
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
  const [mainTab, setMainTab] = useState<'keuangan' | 'shift_gaji' | 'transaksi_qris' | 'stok_log' | 'nota_belanja'>('keuangan');
  const [shiftSubTab, setShiftSubTab] = useState<'slip_shift' | 'harian_shift' | 'rekap_kasir'>('slip_shift');
  const [stokLogSubTab, setStokLogSubTab] = useState<'mutasi_stok' | 'log_sistem'>('mutasi_stok');
  const [period, setPeriod] = useState<PeriodKey>('daily');
  const [useCustomDates, setUseCustomDates] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() => `${todayWibSlug().slice(0, 7)}-01`);
  const [draftTo, setDraftTo] = useState(() => todayWibSlug());
  const [appliedFrom, setAppliedFrom] = useState(() => `${todayWibSlug().slice(0, 7)}-01`);
  const [appliedTo, setAppliedTo] = useState(() => todayWibSlug());
  const [dateFormError, setDateFormError] = useState('');

  // State fetch terstruktur (menghindari setState sinkron inside useEffect)
  const [silentTick, setSilentTick] = useState(0);
  const [loadedState, setLoadedState] = useState<{
    baseKey: string;
    requestKey: string;
    data: LaporanData | null;
    error: string;
  } | null>(null);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportHarianLoading, setExportHarianLoading] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [voidTarget, setVoidTarget] = useState<RecentTransaction | null>(null);
  const [showTutupBuku, setShowTutupBuku] = useState(false);

  // Sync tab jika dibuka via query parameter ?tab=... (async microtask agar bebas setState-in-effect)
  useEffect(() => {
    let cancelled = false;
    if (typeof window !== 'undefined') {
      const tabParam = new URLSearchParams(window.location.search).get('tab');
      if (tabParam) {
        Promise.resolve().then(() => {
          if (cancelled) return;
          if (tabParam === 'transaksi_qris' || tabParam === 'qris') {
            setMainTab('transaksi_qris');
          } else if (tabParam === 'shift_gaji' || tabParam === 'rekap_shift') {
            setMainTab('shift_gaji');
            setShiftSubTab('slip_shift');
          } else if (tabParam === 'rekap_kasir') {
            setMainTab('shift_gaji');
            setShiftSubTab('rekap_kasir');
          } else if (tabParam === 'mutasi' || tabParam === 'mutasi_stok' || tabParam === 'stok_log') {
            setMainTab('stok_log');
            setStokLogSubTab('mutasi_stok');
          } else if (tabParam === 'jejak_transaksi' || tabParam === 'log_sistem') {
            setMainTab('stok_log');
            setStokLogSubTab('log_sistem');
          } else if (tabParam === 'nota_belanja' || tabParam === 'nota') {
            setMainTab('nota_belanja');
          }
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    if (useCustomDates && appliedFrom && appliedTo) {
      qs.set('dateFrom', appliedFrom);
      qs.set('dateTo', appliedTo);
    } else {
      qs.set('period', period);
    }
    return qs.toString();
  }, [useCustomDates, appliedFrom, appliedTo, period]);

  const requestKey = `${queryString}:${silentTick}`;
  const loading = !loadedState || loadedState.baseKey !== queryString;
  const data = loadedState?.data ?? null;
  const error = loadedState?.requestKey === requestKey ? loadedState.error : '';

  const reloadData = useCallback(() => {
    setSilentTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const baseKey = queryString;
    const reqKey = requestKey;
    fetch(`/api/admin/laporan?${queryString}`)
      .then(async (res) => {
        const json = (await res.json()) as { success?: boolean; data?: LaporanData; error?: string };
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setLoadedState((prev) => ({
            baseKey,
            requestKey: reqKey,
            data: prev?.baseKey === baseKey ? prev.data : null,
            error: json.error ?? 'Gagal memuat laporan',
          }));
          return;
        }
        setLoadedState({
          baseKey,
          requestKey: reqKey,
          data: json.data ?? null,
          error: '',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedState((prev) => ({
            baseKey,
            requestKey: reqKey,
            data: prev?.baseKey === baseKey ? prev.data : null,
            error: 'Terjadi kesalahan jaringan. Periksa koneksi Anda.',
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [queryString, requestKey]);

  function handleSelectPreset(key: PeriodKey) {
    setDateFormError('');
    setUseCustomDates(false);
    setPeriod(key);
  }

  function handleApplyCustomRange(e: React.FormEvent) {
    e.preventDefault();
    if (!draftFrom || !draftTo) {
      setDateFormError('Tanggal mulai dan tanggal akhir wajib diisi.');
      return;
    }
    if (draftFrom > draftTo) {
      setDateFormError('Tanggal mulai tidak boleh melebihi tanggal akhir.');
      return;
    }
    setDateFormError('');
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
    setUseCustomDates(true);
  }

  async function downloadServerExcel(url: string, fallbackName: string): Promise<void> {
    setExportNotice('');
    const res = await fetch(url);
    if (!res.ok) {
      let msg = 'Gagal mengunduh file Excel.';
      try {
        const errJson = (await res.json()) as { error?: string };
        if (errJson.error) msg = errJson.error;
      } catch {
        // non-JSON response
      }
      setExportNotice(msg);
      return;
    }

    const truncated = res.headers.get('X-Export-Truncated') === '1';
    const maxRows = res.headers.get('X-Export-Max-Rows') ?? '10.000';
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const nameMatch = /filename="?([^";\r\n]+)"?/i.exec(disposition);
    const filename = nameMatch?.[1] || fallbackName;

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);

    if (truncated) {
      setExportNotice(
        `Perhatian: Data melebihi batas ${maxRows} baris/sheet sehingga sebagian daftar dipotong. Perkecil rentang tanggal untuk ekspor penuh per bagian.`,
      );
    }
  }

  // ── Export Excel 1-Sheet Skema Harian (Executive) ─────────────
  async function handleDownloadSkemaHarian() {
    if (!data) return;
    setExportHarianLoading(true);
    try {
      const slug = useCustomDates ? `${appliedFrom}_sd_${appliedTo}` : period;
      await downloadServerExcel(
        `/api/admin/export/harian?${queryString}`,
        `skema-harian-wiramart-${slug}-${todayWibSlug()}.xlsx`,
      );
    } catch {
      setExportNotice('Terjadi kesalahan koneksi saat mengunduh skema harian.');
    } finally {
      setExportHarianLoading(false);
    }
  }

  // ── Export Excel Multi-Sheet Lengkap (7 Sheet dari Server) ────
  async function handleExport() {
    if (!data) return;
    setExportLoading(true);
    try {
      const slug = useCustomDates ? `${appliedFrom}_sd_${appliedTo}` : period;
      await downloadServerExcel(
        `/api/admin/export?type=sales_report&${queryString}`,
        `laporan-penjualan-lengkap-${slug}-${todayWibSlug()}.xlsx`,
      );
    } catch {
      setExportNotice('Terjadi kesalahan koneksi saat mengunduh laporan multi-sheet.');
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
          onSuccess={reloadData}
        />
      )}

      {/* Tutup Buku Modal */}
      <TutupBukuModal
        isOpen={showTutupBuku}
        onClose={() => setShowTutupBuku(false)}
        onSuccess={() => {
          setShowTutupBuku(false);
          reloadData();
        }}
      />

      <div>
        {/* ── HEADER RINGKAS ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div>
            <h1
              className="page-title"
              style={{ margin: 0, fontSize: 'clamp(1.15rem, 3.5vw, 1.45rem)', fontWeight: 800 }}
            >
              Laporan
            </h1>
            <p
              className="page-subtitle"
              style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}
            >
              {data?.label ?? '—'}
              {data?.rangeStartDate && data?.rangeEndDate ? ` · ${data.rangeStartDate} s/d ${data.rangeEndDate}` : ''}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              id={`${uid}-tutup-buku`}
              type="button"
              onClick={() => setShowTutupBuku(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 13px',
                borderRadius: 10,
                border: '1px solid hsl(217 91% 50%)',
                background: 'hsl(217 91% 56%)',
                color: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              aria-label="Tutup Buku Hari Ini"
            >
              <Lock size={14} aria-hidden="true" />
              <span>Tutup Buku</span>
            </button>

            <div style={{ position: 'relative' }} id={`${uid}-export-wrapper`}>
              <button
                id={`${uid}-export-toggle`}
                type="button"
                onClick={() => {
                  const el = document.getElementById(`${uid}-export-menu`);
                  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid #16a34a',
                  background: '#f0fdf4',
                  color: '#15803d',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                aria-label="Export Excel"
              >
                <Download size={14} aria-hidden="true" />
                <span>Export ▾</span>
              </button>

              <div
                id={`${uid}-export-menu`}
                style={{
                  display: 'none',
                  flexDirection: 'column',
                  gap: 4,
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 6px)',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 8,
                  minWidth: 195,
                  boxShadow: '0 8px 30px -4px rgba(0,0,0,0.12)',
                  zIndex: 100,
                }}
              >
                <button
                  id={`${uid}-export-harian`}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`${uid}-export-menu`);
                    if (el) el.style.display = 'none';
                    handleDownloadSkemaHarian();
                  }}
                  disabled={!data || exportHarianLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: !data || exportHarianLoading ? '#f1f5f9' : '#f0fdf4',
                    color: !data || exportHarianLoading ? '#94a3b8' : '#15803d',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: !data || exportHarianLoading ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  {exportHarianLoading
                    ? <><Loader2 size={13} className="spin-icon" /> Mengunduh...</>
                    : 'Excel Harian (1 Sheet)'}
                </button>
                <button
                  id={`${uid}-export`}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`${uid}-export-menu`);
                    if (el) el.style.display = 'none';
                    handleExport();
                  }}
                  disabled={!data || exportLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: !data || exportLoading ? '#f1f5f9' : '#f8fafc',
                    color: !data || exportLoading ? '#94a3b8' : '#334155',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: !data || exportLoading ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  {exportLoading
                    ? <><Loader2 size={13} className="spin-icon" /> Mengunduh...</>
                    : 'Excel Lengkap (Multi-Sheet)'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {exportNotice && (
          <div
            role="alert"
            style={{
              ...noticeStyle('warning'),
              marginBottom: 'var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
            }}
          >
            <span>{exportNotice}</span>
            <button
              type="button"
              onClick={() => setExportNotice('')}
              aria-label="Tutup pemberitahuan"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4 }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ─── 5 TAB UTAMA (UNDERLINE MODERN) ─── */}
        <div role="tablist" aria-label="Pilih Jenis Laporan" className="rep-tabs">
          {([
            { id: 'keuangan', icon: <BarChart3 size={15} />, label: 'Keuangan' },
            { id: 'shift_gaji', icon: <TrendingUp size={15} />, label: 'Shift & Gaji' },
            { id: 'transaksi_qris', icon: <QrCode size={15} />, label: 'Transaksi & QRIS' },
            { id: 'stok_log', icon: <Boxes size={15} />, label: 'Stok & Log' },
            { id: 'nota_belanja', icon: <Receipt size={15} />, label: 'Nota Belanja' },
          ] as const).map((tab) => {
            const isActive = mainTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setMainTab(tab.id)}
                className={`rep-tab${isActive ? ' active' : ''}`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {mainTab === 'shift_gaji' ? (
          <div>
            <div style={{ marginBottom: 14 }}>
              <div role="tablist" aria-label="Tampilan Shift dan Gaji" className="rep-seg">
                <button
                  type="button"
                  role="tab"
                  aria-selected={shiftSubTab === 'slip_shift'}
                  onClick={() => setShiftSubTab('slip_shift')}
                  className={`rep-seg-btn${shiftSubTab === 'slip_shift' ? ' active' : ''}`}
                >
                  <FileText size={14} aria-hidden="true" />
                  <span>Slip Gaji Shift</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={shiftSubTab === 'harian_shift'}
                  onClick={() => setShiftSubTab('harian_shift')}
                  className={`rep-seg-btn${shiftSubTab === 'harian_shift' ? ' active' : ''}`}
                >
                  <Calendar size={14} aria-hidden="true" />
                  <span>Harian Pagi + Siang</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={shiftSubTab === 'rekap_kasir'}
                  onClick={() => setShiftSubTab('rekap_kasir')}
                  className={`rep-seg-btn${shiftSubTab === 'rekap_kasir' ? ' active' : ''}`}
                >
                  <Users2 size={14} aria-hidden="true" />
                  <span>Per Kasir</span>
                </button>
              </div>
            </div>
            {shiftSubTab === 'rekap_kasir' ? (
              <RekapKasir />
            ) : (
              <RekapShift externalViewMode={shiftSubTab === 'harian_shift' ? 'daily_combined' : 'groups'} />
            )}
          </div>
        ) : mainTab === 'stok_log' ? (
          <div>
            <div style={{ marginBottom: 14 }}>
              <div role="tablist" aria-label="Tampilan Stok dan Log" className="rep-seg">
                <button
                  type="button"
                  role="tab"
                  aria-selected={stokLogSubTab === 'mutasi_stok'}
                  onClick={() => setStokLogSubTab('mutasi_stok')}
                  className={`rep-seg-btn${stokLogSubTab === 'mutasi_stok' ? ' active' : ''}`}
                >
                  <Boxes size={14} aria-hidden="true" />
                  <span>Mutasi Stok</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={stokLogSubTab === 'log_sistem'}
                  onClick={() => setStokLogSubTab('log_sistem')}
                  className={`rep-seg-btn${stokLogSubTab === 'log_sistem' ? ' active' : ''}`}
                >
                  <FileText size={14} aria-hidden="true" />
                  <span>Log Sistem</span>
                </button>
              </div>
            </div>
            {stokLogSubTab === 'mutasi_stok' ? <LaporanMutasiStokSection /> : <JejakTransaksiPanel />}
          </div>
        ) : mainTab === 'nota_belanja' ? (
          <NotaBelanjaPanel portalRole="MANAGER" onOpexSynced={reloadData} />
        ) : (
          <>
            {/* Filter periode modern netral */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <div role="group" aria-label="Pilih periode laporan" className="rep-chip-bar">
                {PERIODS.map((p) => {
                  const isPresetActive = !useCustomDates && period === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      id={`${uid}-period-${p.key}`}
                      onClick={() => {
                        setShowCustomPicker(false);
                        handleSelectPreset(p.key);
                      }}
                      className={`rep-chip${isPresetActive ? ' active' : ''}`}
                      aria-pressed={isPresetActive}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowCustomPicker((v) => !v)}
                  className={`rep-chip${useCustomDates || showCustomPicker ? ' active' : ''}`}
                >
                  <Calendar size={13} aria-hidden="true" />
                  <span>{useCustomDates ? `${appliedFrom} – ${appliedTo}` : 'Tanggal'}</span>
                </button>
              </div>

              {showCustomPicker && (
                <form
                  onSubmit={handleApplyCustomRange}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#f8fafc',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <input
                    type="date"
                    className="form-input"
                    value={draftFrom}
                    max={draftTo || todayWibSlug()}
                    onChange={(e) => { setDraftFrom(e.target.value); setDateFormError(''); }}
                    aria-label="Tanggal mulai"
                    style={{ width: 145, minHeight: 34, padding: '4px 8px', fontSize: 'var(--text-xs)' }}
                  />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>s/d</span>
                  <input
                    type="date"
                    className="form-input"
                    value={draftTo}
                    min={draftFrom}
                    max={todayWibSlug()}
                    onChange={(e) => { setDraftTo(e.target.value); setDateFormError(''); }}
                    aria-label="Tanggal akhir"
                    style={{ width: 145, minHeight: 34, padding: '4px 8px', fontSize: 'var(--text-xs)' }}
                  />
                  <button type="submit" className="btn btn-sm btn-primary">
                    Terapkan
                  </button>
                  {useCustomDates && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setShowCustomPicker(false);
                        handleSelectPreset(period);
                      }}
                    >
                      Reset
                    </button>
                  )}
                  {dateFormError && (
                    <span role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                      {dateFormError}
                    </span>
                  )}
                </form>
              )}
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
          mainTab === 'transaksi_qris' ? (
            <TransaksiQrisPanel
              dailyRows={data.daily}
              transactions={data.recentTransactions}
              summary={data.summary}
              periodLabel={data.label}
              onVoidRequest={(tx) => setVoidTarget(tx)}
            />
          ) : (
          <>
            {/* ─── Peringatan singkat jika HPP belum lengkap / tidak cocok ── */}
            {!data.summary.labaLengkap && (
              <div role="alert" style={{ ...noticeStyle('warning'), marginBottom: 'var(--space-4)', fontSize: '0.78rem' }}>
                Ada {data.summary.unitTanpaHpp} produk terjual ({formatRupiah(data.summary.omzetTanpaHpp)}) tanpa HPP. Lengkapi HPP di menu Produk.
              </div>
            )}
            {(!data.checks.methodSplitMatches || !data.checks.itemsMatchOmzet || !data.checks.dailyMatchesSummary) && (
              <div role="alert" style={{ ...noticeStyle('error'), marginBottom: 'var(--space-4)', fontSize: '0.78rem' }}>
                Data ringkasan tidak konsisten. Periksa transaksi sebelum digunakan.
              </div>
            )}

            {/* ─── 4 KARTU INTI KEUANGAN (2x2 MOBILE, 4-KOLOM DESKTOP) ── */}
            <div className="rep-kpi-grid">
              <article id={`${uid}-card-total`} className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Omzet ({data.summary.totalCount} tx)</span>
                  <TrendingUp size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} aria-hidden="true" />
                </div>
                <div className="rep-kpi__val" style={{ color: 'var(--color-primary)' }}>
                  {formatRp(data.summary.grossAmount)}
                </div>
                <div className="rep-kpi__sub">
                  Tunai {formatRp(data.summary.amountCash)} · QRIS {formatRp(data.summary.amountQris)}
                </div>
              </article>

              <article id={`${uid}-card-laba`} className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Laba Kotor{!data.summary.labaLengkap && ' *'}</span>
                  <DollarSign size={15} style={{ color: '#d97706', flexShrink: 0 }} aria-hidden="true" />
                </div>
                <div className="rep-kpi__val">
                  {formatRupiah(data.summary.grossProfit)}
                </div>
                <div className="rep-kpi__sub">
                  HPP {formatRupiah(data.summary.totalHpp)}
                </div>
              </article>

              <article id={`${uid}-card-gaji`} className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Gaji Shift (50%)</span>
                  <Users size={15} style={{ color: '#4f46e5', flexShrink: 0 }} aria-hidden="true" />
                </div>
                <div className="rep-kpi__val" style={{ color: '#4338ca' }}>
                  {formatRupiah(data.summary.alokasiGajiKaryawan ?? Math.round(data.summary.grossProfit * 0.5))}
                </div>
                <div className="rep-kpi__sub">
                  Utuh per shift
                </div>
              </article>

              <article id={`${uid}-card-bersih`} className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Laba Toko (50%){!data.summary.labaLengkap && ' *'}</span>
                  <Wallet size={15} style={{ color: data.summary.labaBersih < 0 ? 'var(--color-error)' : 'var(--color-success)', flexShrink: 0 }} aria-hidden="true" />
                </div>
                <div className="rep-kpi__val" style={{ color: data.summary.labaBersih < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                  {formatRupiah(data.summary.labaBersih)}
                </div>
                <div className="rep-kpi__sub">
                  Biaya {formatRupiah(data.summary.biayaOperasional)}
                </div>
              </article>
            </div>

            {/* ─── Ringkasan Per Bulan (jika rentang multi-bulan) ─ */}
            {data.monthly && data.monthly.length > 1 && (
              <section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-labelledby={`${uid}-monthly-title`}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <h2
                    id={`${uid}-monthly-title`}
                    className="card-title"
                    style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  >
                    <Calendar size={16} aria-hidden="true" /> Rekap Bulanan ({data.monthly.length} Bulan)
                  </h2>
                </div>
                <div className="table-wrapper">
                  <table className="table" style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr>
                        <th scope="col">Bulan</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Hari Aktif</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Trx</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Void</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Omzet</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Cash</th>
                        <th scope="col" style={{ textAlign: 'right' }}>QRIS</th>
                        <th scope="col" style={{ textAlign: 'right' }}>HPP</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Laba Kotor</th>
                        <th scope="col" style={{ textAlign: 'right', color: 'var(--color-primary)' }}>50% Mahasiswa</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Biaya</th>
                        <th scope="col" style={{ textAlign: 'right' }}>50% Wiramart</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.monthly.map((m) => (
                        <tr key={m.monthKey}>
                          <td style={{ fontWeight: 'var(--weight-semibold)' }}>{m.monthLabel}</td>
                          <td className="text-right">{m.activeDays}</td>
                          <td className="text-right">{m.txCount}</td>
                          <td className="text-right" style={{ color: m.voidCount > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}>{m.voidCount}</td>
                          <td className="text-right" style={{ fontWeight: 'var(--weight-semibold)' }}>{formatRupiah(m.omzet)}</td>
                          <td className="text-right">{formatRupiah(m.omzetCash)}</td>
                          <td className="text-right">{formatRupiah(m.omzetQris)}</td>
                          <td className="text-right">{formatRupiah(m.hppTerjual)}</td>
                          <td className="text-right" style={{ color: m.labaKotor < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>{formatRupiah(m.labaKotor)}</td>
                          <td className="text-right" style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-medium)' }}>{formatRupiah(m.alokasiGajiKaryawan)}</td>
                          <td className="text-right">{formatRupiah(m.biayaOperasional)}</td>
                          <td className="text-right" style={{ fontWeight: 'var(--weight-bold)', color: m.labaBersih < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>{formatRupiah(m.labaBersih)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ─── Rekap Harian ────────────────────────────────── */}
            <RekapHarian rows={data.daily} labaLengkap={data.summary.labaLengkap} />

            {/* ─── Biaya Operasional (input & daftar) ──────────── */}
            <BiayaOperasionalPanel
              period={period}
              dateFrom={useCustomDates ? appliedFrom : undefined}
              dateTo={useCustomDates ? appliedTo : undefined}
              onChanged={reloadData}
            />

            {/* ─── Produk Terlaris & Grafik Omzet berdampingan ── */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 'var(--space-5)',
                marginBottom: 'var(--space-6)',
              }}
            >
              {/* Top Produk Terlaris */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <TrendingUp size={16} aria-hidden="true" /> Produk Terlaris
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

              {/* Grafik Omzet Harian */}
              {data.dailyChart.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h2 className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <BarChart3 size={16} aria-hidden="true" /> Grafik Harian
                    </h2>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-success)', display: 'inline-block' }} aria-hidden="true" />
                        Tunai
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-info)', display: 'inline-block' }} aria-hidden="true" />
                        QRIS
                      </span>
                    </div>
                  </div>
                  <div className="card-body">
                    <div
                      role="img"
                      aria-label="Grafik omzet harian"
                      style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: 180, overflowX: 'auto', paddingBottom: 'var(--space-4)' }}
                    >
                      {data.dailyChart.map((d) => {
                        const total = parseFloat(d.revenue) || 0;
                        const cash = parseFloat(d.amountCash) || 0;
                        const qris = parseFloat(d.amountQris) || 0;
                        const totalHeight = (total / maxRevenue) * 140;
                        const cashPct = total > 0 ? cash / total : 0;
                        const qrisPct = total > 0 ? qris / total : 0;

                        return (
                          <div
                            key={d.day}
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 32, flex: 1 }}
                          >
                            <div
                              title={`${d.day}\nTotal: ${formatRp(total)}\nTunai: ${formatRp(cash)}\nQRIS: ${formatRp(qris)}\n${d.txCount} tx`}
                              style={{
                                width: '100%', maxWidth: 26,
                                height: `${Math.max(totalHeight, 4)}px`,
                                display: 'flex', flexDirection: 'column-reverse',
                                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                                overflow: 'hidden',
                              }}
                            >
                              <div style={{ flex: cashPct, backgroundColor: 'var(--color-success)', minHeight: cash > 0 ? 2 : 0 }} />
                              <div style={{ flex: qrisPct, backgroundColor: 'var(--color-info)', minHeight: qris > 0 ? 2 : 0 }} />
                            </div>
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
            </div>
          </>
          )
        ) : null}
          </>
        )}
      </div>
    </>
  );
}
