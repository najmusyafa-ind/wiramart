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
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'semi_annual';

type RecentTransaction = {
  id: string;
  invoiceNumber: string;
  paymentMethod: 'CASH' | 'QRIS';
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
  };
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

  const fetchData = useCallback(async (p: PeriodKey) => {
    setLoading(true);
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
      // Dynamic import agar exceljs tidak masuk initial bundle
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Smartkasir Perwira';
      wb.created = new Date();

      // ── Sheet 1: Ringkasan ───────────────────────────────
      const ws1 = wb.addWorksheet('Ringkasan');
      ws1.columns = [
        { header: 'Keterangan', key: 'label', width: 28 },
        { header: 'Nilai', key: 'value', width: 20 },
      ];
      ws1.addRow({ label: 'Periode', value: data.label });
      ws1.addRow({ label: 'Total Omzet', value: data.summary.grossAmount });
      ws1.addRow({ label: 'Laba Kotor', value: data.summary.grossProfit });
      ws1.addRow({ label: 'Total HPP', value: data.summary.totalHpp });
      ws1.addRow({ label: 'Omzet Cash', value: data.summary.amountCash });
      ws1.addRow({ label: 'Omzet QRIS', value: data.summary.amountQris });
      ws1.addRow({ label: 'Jumlah Transaksi', value: data.summary.totalCount });
      ws1.addRow({ label: 'Transaksi Cash', value: data.summary.countCash });
      ws1.addRow({ label: 'Transaksi QRIS', value: data.summary.countQris });
      ws1.addRow({ label: 'Transaksi Void', value: data.summary.countVoid });

      // ── Sheet 2: Detail Transaksi ────────────────────────
      const ws2 = wb.addWorksheet('Detail Transaksi');
      ws2.columns = [
        { header: 'Invoice', key: 'invoice', width: 22 },
        { header: 'Tanggal', key: 'tanggal', width: 20 },
        { header: 'Kasir', key: 'kasir', width: 24 },
        { header: 'Metode', key: 'metode', width: 10 },
        { header: 'Total (Rp)', key: 'total', width: 16 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Alasan Void', key: 'alasan', width: 30 },
      ];
      for (const t of data.recentTransactions) {
        ws2.addRow({
          invoice: t.invoiceNumber,
          tanggal: formatDateTime(t.createdAt),
          kasir:   t.employeeName,
          metode:  t.paymentMethod,
          total:   parseFloat(t.grossAmount),
          status:  t.status,
          alasan:  t.voidReason ?? '',
        });
      }

      // ── Sheet 3: Top Produk ──────────────────────────────
      const ws3 = wb.addWorksheet('Top Produk');
      ws3.columns = [
        { header: 'Nama Produk', key: 'nama', width: 32 },
        { header: 'Qty Terjual', key: 'qty', width: 14 },
        { header: 'Total Omzet (Rp)', key: 'omzet', width: 18 },
      ];
      for (const p of data.topProducts) {
        ws3.addRow({ nama: p.productName, qty: p.totalQty, omzet: parseFloat(p.totalRevenue) });
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
    } catch {
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
          <div style={{ textAlign: 'center', padding: 'var(--space-16)', color: 'var(--color-text-muted)' }}>
            <Loader2 size={28} className="spin-icon" aria-hidden="true" style={{ marginBottom: 'var(--space-3)' }} />
            <div style={{ fontSize: 'var(--text-sm)' }}>Memuat laporan...</div>
          </div>
        ) : data ? (
          <>
            {/* ─── 3 Cards Utama: Total / Cash / QRIS ──────────── */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-6)',
              }}
            >
              {/* Total Omzet */}
              <article id={`${uid}-card-total`} className="stat-card">
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-primary)', borderRadius: 'var(--radius-full) var(--radius-full) 0 0' }} />
                <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                  <TrendingUp size={20} aria-hidden="true" />
                </div>
                <div className="stat-card__label">Total Omzet</div>
                <div className="stat-card__value" style={{ fontSize: 'var(--text-xl)' }}>{formatRp(data.summary.grossAmount)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                  {data.summary.totalCount} transaksi
                </div>
              </article>

              {/* Cash */}
              <article id={`${uid}-card-cash`} className="stat-card">
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-success)', borderRadius: 'var(--radius-full) var(--radius-full) 0 0' }} />
                <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                  <Banknote size={20} aria-hidden="true" />
                </div>
                <div className="stat-card__label">Cash</div>
                <div className="stat-card__value" style={{ fontSize: 'var(--text-xl)', color: 'var(--color-success)' }}>{formatRp(data.summary.amountCash)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                  {data.summary.countCash} transaksi
                </div>
              </article>

              {/* QRIS */}
              <article id={`${uid}-card-qris`} className="stat-card">
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-info)', borderRadius: 'var(--radius-full) var(--radius-full) 0 0' }} />
                <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-info-light)', color: 'var(--color-info)' }}>
                  <QrCode size={20} aria-hidden="true" />
                </div>
                <div className="stat-card__label">QRIS</div>
                <div className="stat-card__value" style={{ fontSize: 'var(--text-xl)', color: 'var(--color-info)' }}>{formatRp(data.summary.amountQris)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                  {data.summary.countQris} transaksi
                </div>
              </article>

              {/* Laba Kotor */}
              <article id={`${uid}-card-laba`} className="stat-card">
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--color-warning)', borderRadius: 'var(--radius-full) var(--radius-full) 0 0' }} />
                <div className="stat-card__icon" style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                  <DollarSign size={20} aria-hidden="true" />
                </div>
                <div className="stat-card__label">Laba Kotor</div>
                <div className="stat-card__value" style={{ fontSize: 'var(--text-xl)' }}>{formatRp(data.summary.grossProfit)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                  HPP: {formatRp(data.summary.totalHpp)}
                </div>
              </article>
            </div>

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
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 8px', borderRadius: 'var(--radius-full)',
                              fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
                              backgroundColor: t.paymentMethod === 'CASH' ? 'var(--color-success-light)' : 'var(--color-info-light)',
                              color: t.paymentMethod === 'CASH' ? 'var(--color-success)' : 'var(--color-info)',
                            }}>
                              {t.paymentMethod === 'CASH'
                                ? <Banknote size={11} aria-hidden="true" />
                                : <QrCode size={11} aria-hidden="true" />
                              }
                              {t.paymentMethod}
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
          </>
        ) : null}
      </div>
    </>
  );
}
