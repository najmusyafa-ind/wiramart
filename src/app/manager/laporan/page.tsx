'use client';

import { useState, useEffect, useId, useCallback, useRef, useMemo } from 'react';
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
  QrCode,
  Receipt,
  Wallet,
  Users,
  Users2,
  Lock,
  Boxes,
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
  { key: 'oct_nov', label: 'Oktober + November' },
  { key: 'semi_annual', label: '6 Bulan' },
  { key: 'all', label: 'Keseluruhan' },
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
  const [mainTab, setMainTab] = useState<'keuangan' | 'shift_gaji' | 'transaksi_qris' | 'stok_log'>('keuangan');
  const [shiftSubTab, setShiftSubTab] = useState<'rekap_shift' | 'rekap_kasir'>('rekap_shift');
  const [stokLogSubTab, setStokLogSubTab] = useState<'mutasi_stok' | 'log_sistem'>('mutasi_stok');
  const [period, setPeriod] = useState<PeriodKey>('daily');
  const [useCustomDates, setUseCustomDates] = useState(false);
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
            setShiftSubTab('rekap_shift');
          } else if (tabParam === 'rekap_kasir') {
            setMainTab('shift_gaji');
            setShiftSubTab('rekap_kasir');
          } else if (tabParam === 'mutasi' || tabParam === 'mutasi_stok' || tabParam === 'stok_log') {
            setMainTab('stok_log');
            setStokLogSubTab('mutasi_stok');
          } else if (tabParam === 'jejak_transaksi' || tabParam === 'log_sistem') {
            setMainTab('stok_log');
            setStokLogSubTab('log_sistem');
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
        {/* ── HEADER MOBILE-FIRST ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12,
          }}
        >
          {/* Judul + Tanggal */}
          <div>
            <h1
              className="page-title"
              style={{ margin: 0, fontSize: 'clamp(1.15rem, 4vw, 1.55rem)', fontWeight: 800 }}
            >
              Laporan Keuangan
            </h1>
            <p
              className="page-subtitle"
              style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}
            >
              {data?.label ?? '—'}
              {data?.rangeStartDate && data?.rangeEndDate ? ` · ${data.rangeStartDate} s/d ${data.rangeEndDate}` : ''}
            </p>
          </div>

          {/* Export Dropdown — tampil ikonis di HP, teks di desktop */}
          <div style={{ position: 'relative', flexShrink: 0 }} id={`${uid}-export-wrapper`}>
            <button
              id={`${uid}-export-toggle`}
              type="button"
              onClick={() => {
                const el = document.getElementById(`${uid}-export-menu`);
                if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 10,
                border: '1.5px solid #16a34a',
                background: '#f0fdf4',
                color: '#15803d',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              aria-label="Pilih format ekspor Excel"
            >
              <Download size={14} aria-hidden="true" />
              <span>Export ▾</span>
            </button>

            {/* Dropdown panel — hidden by default */}
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
                minWidth: 210,
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
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: !data || exportHarianLoading ? '#f1f5f9' : '#f0fdf4',
                  color: !data || exportHarianLoading ? '#94a3b8' : '#15803d',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: !data || exportHarianLoading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
                aria-label="Unduh 1-Sheet Skema Harian Excel"
              >
                {exportHarianLoading
                  ? <><Loader2 size={13} className="spin-icon" /> Mengunduh...</>
                  : <><span></span> 1-Sheet Harian (.xlsx)</>
                }
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
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: !data || exportLoading ? '#f1f5f9' : '#f8fafc',
                  color: !data || exportLoading ? '#94a3b8' : '#334155',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: !data || exportLoading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
                aria-label="Export multi-sheet ke Excel"
              >
                {exportLoading
                  ? <><Loader2 size={13} className="spin-icon" /> Exporting...</>
                  : <><span></span> Multi-Sheet Lengkap</>
                }
              </button>
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
              aria-label="Tutup pemberitahuan ekspor"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4 }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── TUTUP BUKU — Hero Action Card ── */}
        <button
          id={`${uid}-tutup-buku`}
          type="button"
          onClick={() => setShowTutupBuku(true)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '13px 20px',
            borderRadius: 12,
            border: '1.5px solid hsl(217 91% 50%)',
            background: 'linear-gradient(135deg, hsl(217 91% 60%), hsl(230 85% 58%))',
            color: '#ffffff',
            fontSize: '0.9rem',
            fontWeight: 800,
            cursor: 'pointer',
            marginBottom: 14,
            boxShadow: '0 4px 14px -2px hsl(217 91% 60% / 0.4)',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            letterSpacing: '0.01em',
          }}
          aria-label="Tutup Buku Finansial Harian (Locking Period)"
        >
          <Lock size={15} aria-hidden="true" />
          <span>Tutup Buku Hari Ini</span>
        </button>

        {/* ─── MOBILE SCROLLABLE PILL TAB BAR ─── */}
        <div
          role="tablist"
          aria-label="Pilih Jenis Laporan"
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 'var(--space-5)',
            overflowX: 'auto',
            flexWrap: 'nowrap',
            scrollbarWidth: 'none',
            paddingBottom: 4,
            /* Fade hints at the trailing edge so user knows it's scrollable */
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {([
            {
              id: 'keuangan',
              icon: <BarChart3 size={14} />,
              label: 'Ringkasan Keuangan',
              activeColor: '#166534',
              activeBg: '#f0fdf4',
              activeBorder: '#16a34a',
            },
            {
              id: 'shift_gaji',
              icon: <TrendingUp size={14} />,
              label: 'Shift & Gaji',
              activeColor: '#4338ca',
              activeBg: '#eef2ff',
              activeBorder: '#6366f1',
            },
            {
              id: 'transaksi_qris',
              icon: <QrCode size={14} />,
              label: 'Transaksi & QRIS',
              activeColor: '#0369a1',
              activeBg: '#e0f2fe',
              activeBorder: '#0284c7',
            },
            {
              id: 'stok_log',
              icon: <Boxes size={14} />,
              label: 'Stok & Log',
              activeColor: '#0f766e',
              activeBg: '#f0fdfa',
              activeBorder: '#0d9488',
            },
          ] as const).map((tab) => {
            const isActive = mainTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setMainTab(tab.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 16px',
                  borderRadius: 100,
                  border: isActive ? `1.5px solid ${tab.activeBorder}` : '1.5px solid #e2e8f0',
                  background: isActive ? tab.activeBg : '#f8fafc',
                  color: isActive ? tab.activeColor : '#64748b',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                  boxShadow: isActive ? `0 0 0 3px ${tab.activeBorder}22` : 'none',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {mainTab === 'shift_gaji' ? (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShiftSubTab('rekap_shift')}
                className={`btn btn-sm ${shiftSubTab === 'rekap_shift' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <TrendingUp size={14} aria-hidden="true" />
                <span>Rekap Shift &amp; Slip Gaji</span>
              </button>
              <button
                type="button"
                onClick={() => setShiftSubTab('rekap_kasir')}
                className={`btn btn-sm ${shiftSubTab === 'rekap_kasir' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Users2 size={14} aria-hidden="true" />
                <span>Performa Per Kasir</span>
              </button>
            </div>
            {shiftSubTab === 'rekap_shift' ? <RekapShift /> : <RekapKasir />}
          </div>
        ) : mainTab === 'stok_log' ? (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setStokLogSubTab('mutasi_stok')}
                className={`btn btn-sm ${stokLogSubTab === 'mutasi_stok' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Boxes size={14} aria-hidden="true" />
                <span>Mutasi Stok Gudang</span>
              </button>
              <button
                type="button"
                onClick={() => setStokLogSubTab('log_sistem')}
                className={`btn btn-sm ${stokLogSubTab === 'log_sistem' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FileText size={14} aria-hidden="true" />
                <span>Log Transaksi Sistem</span>
              </button>
            </div>
            {stokLogSubTab === 'mutasi_stok' ? <LaporanMutasiStokSection /> : <JejakTransaksiPanel />}
          </div>
        ) : (
          <>
            {/* Period selector + custom date range */}
            <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
              <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div
                  role="group"
                  aria-label="Pilih periode laporan"
                  style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}
                >
                  {PERIODS.map((p) => {
                    const isPresetActive = !useCustomDates && period === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        id={`${uid}-period-${p.key}`}
                        onClick={() => handleSelectPreset(p.key)}
                        className={`btn btn-sm ${isPresetActive ? 'btn-primary' : 'btn-secondary'}`}
                        aria-pressed={isPresetActive}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                <form
                  onSubmit={handleApplyCustomRange}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    flexWrap: 'wrap',
                    paddingTop: 'var(--space-2)',
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)' }}>
                    <Calendar size={14} aria-hidden="true" />
                    Rentang Custom (WIB):
                  </span>
                  <input
                    type="date"
                    className="form-input"
                    value={draftFrom}
                    max={draftTo || todayWibSlug()}
                    onChange={(e) => { setDraftFrom(e.target.value); setDateFormError(''); }}
                    aria-label="Tanggal mulai laporan"
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
                    aria-label="Tanggal akhir laporan"
                    style={{ width: 145, minHeight: 34, padding: '4px 8px', fontSize: 'var(--text-xs)' }}
                  />
                  <button
                    type="submit"
                    className={`btn btn-sm ${useCustomDates ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    Terapkan Rentang
                  </button>
                  {useCustomDates && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleSelectPreset(period)}
                    >
                      Reset ke Preset
                    </button>
                  )}
                  {dateFormError && (
                    <span role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                      {dateFormError}
                    </span>
                  )}
                </form>
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
                <span style={{ fontSize: '1.1rem', lineHeight: 1 }}></span>
                <div style={{ lineHeight: 1.6 }}>
                  <strong>Sistem Bagi Hasil 50:50 Wiramart:</strong> Laba kotor penjualan dikurangi biaya operasional toko terlebih dahulu untuk mendapatkan <strong>Laba Bersih Operasional</strong>. Hasil bersih tersebut kemudian dibagi <strong>50%</strong> untuk hak mahasiswa (diserahkan utuh per kelompok shift, tanpa pemecahan nominal per nama), dan <strong>50%</strong> menjadi laba bersih hak milik toko Wiramart. Pada periode bulanan, biaya paten Rp 50.000 (ATK Rp 20.000 + Bensin Rp 30.000) otomatis diikutsertakan.
                </div>
              </div>
            </div>

            {/* ─── Ringkasan Per Bulan (jika rentang multi-bulan) ─ */}
            {data.monthly && data.monthly.length > 1 && (
              <section className="card" style={{ marginBottom: 'var(--space-6)' }} aria-labelledby={`${uid}-monthly-title`}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <h2
                    id={`${uid}-monthly-title`}
                    className="card-title"
                    style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  >
                    <Calendar size={16} aria-hidden="true" /> Rekap Bulanan ({data.monthly.length} Bulan)
                  </h2>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    Akumulasi konsisten dengan total harian
                  </span>
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

            {/* ─── Row: Top Produk + Void info ──────────────────── */}
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
                    <TrendingUp size={16} aria-hidden="true" /> Top {data.topProducts.length || 5} Produk Terlaris
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
                      const cash = parseFloat(d.amountCash) || 0;
                      const qris = parseFloat(d.amountQris) || 0;
                      const totalHeight = (total / maxRevenue) * 140;
                      const cashPct = total > 0 ? cash / total : 0;
                      const qrisPct = total > 0 ? qris / total : 0;

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
          </>
          )
        ) : null}
          </>
        )}
      </div>
    </>
  );
}
