'use client';
// =============================================================
// src/app/kasir/gudang/components/FEFOActionSection.tsx
// Modul FEFO Alert System & To-Do List Gudang (Wiramart v3.0)
// STANDAR: Mobile-First Ergonomics, Zero-Trust Architecture, Clean HSL System
// =============================================================

import { useState, useEffect, useId, useCallback, useRef } from 'react';
import {
  Flame,
  Zap,
  AlertTriangle,
  Eye,
  CheckCircle2,
  RefreshCw,
  Send,
  Printer,
  X,
  Search,
  FileText,
  AlertCircle,
  Clock,
  Barcode,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
export type AlertLevel = 'H1' | 'H3' | 'H5' | 'H7';
export type ReportStatus = 'ALERT_ONLY' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
export type ManagerDecision = 'DISCOUNT' | 'DISPLAY_FRONT' | 'DESTROY' | 'RETURN_SUPPLIER' | 'HOLD';

export type ConditionReportItem = {
  id: string;
  batchId: string;
  productId: string;
  productName: string;
  productUnit: string;
  sellingPrice: string | number;
  batchCode: string;
  currentBatchQty: number;
  alertLevel: AlertLevel;
  qtyAtAlert: number;
  expiryDate: string;
  daysRemainingAtAlert: number;
  status: ReportStatus;
  physicalCondition: string | null;
  gudangSuggestion: string | null;
  suggestedDiscountPct: string | number | null;
  submittedAt: string | null;
  managerDecision: ManagerDecision | null;
  approvedDiscountPct: string | number | null;
  managerNote: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  executionNote: string | null;
  createdAt: string;
  isExpired?: boolean;
  discountBarcode?: string | null;
  discountedPrice?: number | null;
};

function getTodayWibIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

interface FEFOActionSectionProps {
  onBadgeUpdate?: () => void;
}

async function requestFefoAlerts(
  opts: {
    alertFilter: 'semua' | AlertLevel;
    statusFilter: 'semua' | ReportStatus;
    search: string;
    triggerScan?: boolean;
  },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    page: '1',
    limit: '100',
    ...(opts.triggerScan && { scan: 'true' }),
    ...(opts.alertFilter !== 'semua' && { alertLevel: opts.alertFilter }),
    ...(opts.statusFilter !== 'semua' && { status: opts.statusFilter }),
    ...(opts.search.trim() && { search: opts.search.trim() }),
  });

  const res = await fetch(`/api/gudang/fefo-alerts?${params}`, { signal });
  return res.json();
}

export default function FEFOActionSection({ onBadgeUpdate }: FEFOActionSectionProps) {
  const printUid = useId();

  // State data
  const [items, setItems] = useState<ConditionReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanningRadar, setScanningRadar] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Filter state
  const [alertFilter, setAlertFilter] = useState<'semua' | AlertLevel>('semua');
  const [statusFilter, setStatusFilter] = useState<'semua' | ReportStatus>('semua');
  const [search, setSearch] = useState('');

  // Modal 1: Lapor Kondisi Fisik
  const [laporModalItem, setLaporModalItem] = useState<ConditionReportItem | null>(null);
  const [physicalCondition, setPhysicalCondition] = useState('');
  const [gudangSuggestion, setGudangSuggestion] = useState<string>('DISCOUNT');
  const [suggestedDiscountPct, setSuggestedDiscountPct] = useState<number>(30);
  const [submittingLapor, setSubmittingLapor] = useState(false);

  // Modal 2: Cetak Barcode Diskon
  const [printModalItem, setPrintModalItem] = useState<ConditionReportItem | null>(null);

  // Modal 3: Eksekusi Lapangan
  const [executeModalItem, setExecuteModalItem] = useState<ConditionReportItem | null>(null);
  const [executionNote, setExecutionNote] = useState('');
  const [submittingExecute, setSubmittingExecute] = useState(false);

  // Helpers
  const rp = (n: number | string | null | undefined) => {
    if (n === null || n === undefined) return 'Rp 0';
    const num = typeof n === 'string' ? parseFloat(n) : n;
    return 'Rp ' + (isNaN(num) ? 0 : num).toLocaleString('id-ID');
  };

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // Simpan callback onBadgeUpdate dalam ref agar tidak memicu re-render / fetch loop
  const onBadgeUpdateRef = useRef(onBadgeUpdate);
  useEffect(() => {
    onBadgeUpdateRef.current = onBadgeUpdate;
  }, [onBadgeUpdate]);

  // Fetch To-Do List (untuk aksi tombol / refresh manual)
  const fetchReports = useCallback(async (triggerScan = false) => {
    if (triggerScan) setScanningRadar(true);
    else setRefreshing(true);

    try {
      const json = await requestFefoAlerts({ alertFilter, statusFilter, search, triggerScan });

      if (json.success && json.data) {
        setItems(json.data.items ?? []);
        if (triggerScan && json.data.scanMeta) {
          const { scannedBatches, newAlerts, updatedAlerts } = json.data.scanMeta;
          showToast(
            `Pemindaian selesai: ${scannedBatches} batch diperiksa. +${newAlerts} baru, ${updatedAlerts} diperbarui.`,
            'success',
          );
          if (onBadgeUpdateRef.current) onBadgeUpdateRef.current();
        }
      } else {
        showToast(json.error || 'Gagal memuat daftar kedaluwarsa', 'error');
      }
    } catch {
      showToast('Koneksi terputus saat mengambil data kedaluwarsa', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setScanningRadar(false);
    }
  }, [alertFilter, statusFilter, search, showToast]);

  useEffect(() => {
    const controller = new AbortController();

    requestFefoAlerts({ alertFilter, statusFilter, search }, controller.signal)
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json.success && json.data) {
          setItems(json.data.items ?? []);
        } else {
          showToast(json.error || 'Gagal memuat daftar kedaluwarsa', 'error');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          showToast('Koneksi terputus saat mengambil data kedaluwarsa', 'error');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => controller.abort();
  }, [alertFilter, statusFilter, search, showToast]);

  // Handle Submit Laporan Fisik
  const handleSubmitLapor = async () => {
    if (!laporModalItem) return;
    if (!physicalCondition.trim()) {
      showToast('Deskripsi kondisi fisik wajib diisi minimal 5 karakter.', 'error');
      return;
    }

    const expiredNow = Boolean(
      laporModalItem.isExpired ||
        (laporModalItem.expiryDate && laporModalItem.expiryDate < getTodayWibIso()),
    );
    if (expiredNow && (gudangSuggestion === 'DISCOUNT' || gudangSuggestion === 'RELOCATE')) {
      showToast(
        'Barang sudah kedaluwarsa. Pilih Musnahkan atau Retur ke Supplier.',
        'error',
      );
      return;
    }

    setSubmittingLapor(true);
    try {
      const payload = {
        physicalCondition: physicalCondition.trim(),
        gudangSuggestion:
          !expiredNow && gudangSuggestion === 'DISCOUNT'
            ? `Usul Diskon ${suggestedDiscountPct}% Cuci Gudang`
            : !expiredNow && gudangSuggestion === 'RELOCATE'
            ? 'Usul Pindah ke Rak Display Depan'
            : gudangSuggestion === 'DISPOSE'
            ? 'Usul Pemusnahan'
            : 'Usul Retur ke Supplier',
        suggestedDiscountPct:
          !expiredNow && gudangSuggestion === 'DISCOUNT' ? suggestedDiscountPct : null,
      };

      const res = await fetch(`/api/gudang/fefo-alerts/${laporModalItem.id}/lapor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        showToast(json.error || 'Gagal mengirimkan laporan', 'error');
        return;
      }

      showToast('Laporan kondisi fisik berhasil dikirim ke Manager.', 'success');
      setLaporModalItem(null);
      setPhysicalCondition('');
      fetchReports(false);
      if (onBadgeUpdateRef.current) onBadgeUpdateRef.current();
    } catch {
      showToast('Terjadi kesalahan jaringan saat mengirim laporan.', 'error');
    } finally {
      setSubmittingLapor(false);
    }
  };

  // Handle Submit Eksekusi Lapangan
  const handleSubmitExecute = async () => {
    if (!executeModalItem) return;
    if (!executionNote.trim() || executionNote.trim().length < 5) {
      showToast('Catatan eksekusi wajib diisi minimal 5 karakter.', 'error');
      return;
    }

    setSubmittingExecute(true);
    try {
      const res = await fetch(`/api/gudang/fefo-alerts/${executeModalItem.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionNote: executionNote.trim() }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        showToast(json.error || 'Gagal menyimpan konfirmasi eksekusi', 'error');
        return;
      }

      showToast('Eksekusi lapangan berhasil ditandai selesai.', 'success');
      setExecuteModalItem(null);
      setExecutionNote('');
      fetchReports(false);
      if (onBadgeUpdateRef.current) onBadgeUpdateRef.current();
    } catch {
      showToast('Terjadi kesalahan jaringan saat konfirmasi eksekusi.', 'error');
    } finally {
      setSubmittingExecute(false);
    }
  };

  // Trigger Cetak Label Thermal
  const handlePrintLabel = (item: ConditionReportItem) => {
    const printEl = document.getElementById(`${printUid}-label`);
    if (!printEl) return;
    const w = window.open('', '_blank', 'width=380,height=480');
    if (!w) return;

    w.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Label Diskon - ${item.productName}</title>
        <style>
          @page { size: 58mm auto; margin: 0; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            width: 58mm;
            padding: 8px 6px;
            text-align: center;
            color: #000;
          }
          .title { font-size: 11px; font-weight: 800; text-transform: uppercase; margin-bottom: 2px; }
          .sub { font-size: 9px; color: #444; margin-bottom: 6px; }
          .badge {
            display: inline-block;
            background: #000;
            color: #fff;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 900;
            margin-bottom: 6px;
          }
          .price-box { margin: 4px 0 8px 0; }
          .orig { font-size: 10px; text-decoration: line-through; color: #555; }
          .disc { font-size: 15px; font-weight: 900; }
          .barcode-box {
            border: 1.5px solid #000;
            border-radius: 4px;
            padding: 6px;
            font-family: monospace;
            font-size: 13px;
            font-weight: 900;
            letter-spacing: 1.5px;
            margin: 6px 0;
            background: #fff;
          }
          .exp { font-size: 8px; color: #444; margin-top: 4px; }
        </style>
      </head>
      <body>
        ${printEl.innerHTML}
      </body>
      </html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 250);
  };

  // Hitung jumlah alert per level
  const counts = {
    H1: items.filter((i) => i.alertLevel === 'H1' && i.status !== 'EXECUTED').length,
    H3: items.filter((i) => i.alertLevel === 'H3' && i.status !== 'EXECUTED').length,
    H5: items.filter((i) => i.alertLevel === 'H5' && i.status !== 'EXECUTED').length,
    H7: items.filter((i) => i.alertLevel === 'H7' && i.status !== 'EXECUTED').length,
  };

  const DECISION_LABELS: Record<ManagerDecision, string> = {
    DISCOUNT: 'Diskon Obral',
    DISPLAY_FRONT: 'Pajang Rak Depan',
    DESTROY: 'Musnahkan',
    RETURN_SUPPLIER: 'Retur ke Supplier',
    HOLD: 'Tahan Sementara',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Toast Notifikasi ─────────────────────────────────── */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'calc(100vw - 32px)',
            zIndex: 9999,
            padding: '12px 18px',
            borderRadius: 10,
            backgroundColor:
              toastMsg.type === 'success' ? '#059669' : toastMsg.type === 'error' ? '#dc2626' : '#15803d',
            color: '#fff',
            fontSize: '0.85rem',
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {toastMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toastMsg.text}
        </div>
      )}

      {/* ── Header & Pemindaian Kedaluwarsa ─────────────────── */}
      <div
        style={{
          background: 'linear-gradient(135deg, hsl(24 95% 97%) 0%, hsl(30 100% 98%) 100%)',
          border: '1px solid hsl(24 90% 88%)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span
                style={{
                  background: 'hsl(14 90% 50%)',
                  color: '#fff',
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  letterSpacing: 0.5,
                }}
              >
                PANTAU KEDALUWARSA
              </span>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'hsl(20 80% 20%)', margin: 0 }}>
                Pemeriksaan &amp; Penanganan Kedaluwarsa
              </h2>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'hsl(20 40% 40%)', margin: 0, maxWidth: 650, lineHeight: 1.45 }}>
              Daftar batch yang mendekati masa kedaluwarsa. Periksa kondisi fisik, ajukan saran penanganan,
              dan cetak stiker diskon obral jika disetujui.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => fetchReports(true)}
              disabled={scanningRadar || refreshing}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.82rem',
                minHeight: 44,
                padding: '8px 14px',
                background: '#fff',
                borderColor: 'hsl(24 80% 80%)',
                color: 'hsl(20 80% 30%)',
                fontWeight: 600,
              }}
            >
              <RefreshCw size={14} className={scanningRadar ? 'spin-icon' : ''} />
              {scanningRadar ? 'Memindai...' : 'Pindai Ulang'}
            </button>
          </div>
        </div>

        {/* ── Metric Summary Pills ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 'var(--space-2)' }}>
          {([
            {
              key: 'H1' as const,
              label: 'H-1 Kritis',
              count: counts.H1,
              Icon: Flame,
              iconColor: '#ef4444',
              activeBg: 'hsl(0 100% 95%)',
              activeBorder: '1.5px solid #ef4444',
              inactiveBorder: '1px solid hsl(0 60% 90%)',
              labelColor: '#991b1b',
              countColor: '#dc2626',
            },
            {
              key: 'H3' as const,
              label: 'H-3 Mendesak',
              count: counts.H3,
              Icon: Zap,
              iconColor: '#f97316',
              activeBg: 'hsl(24 100% 95%)',
              activeBorder: '1.5px solid #f97316',
              inactiveBorder: '1px solid hsl(24 60% 90%)',
              labelColor: '#c2410c',
              countColor: '#ea580c',
            },
            {
              key: 'H5' as const,
              label: 'H-5 Waspada',
              count: counts.H5,
              Icon: AlertTriangle,
              iconColor: '#ca8a04',
              activeBg: 'hsl(45 100% 95%)',
              activeBorder: '1.5px solid #eab308',
              inactiveBorder: '1px solid hsl(45 60% 90%)',
              labelColor: '#854d0e',
              countColor: '#ca8a04',
            },
            {
              key: 'H7' as const,
              label: 'H-7 Pantau',
              count: counts.H7,
              Icon: Eye,
              iconColor: '#15803d',
              activeBg: '#f0fdf4',
              activeBorder: '1.5px solid #16a34a',
              inactiveBorder: '1px solid #bbf7d0',
              labelColor: '#166534',
              countColor: '#15803d',
            },
          ]).map((pill) => {
            const isActive = alertFilter === pill.key;
            const PillIcon = pill.Icon;
            return (
              <button
                key={pill.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setAlertFilter(isActive ? 'semua' : pill.key)}
                style={{
                  minHeight: 44,
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: isActive ? pill.activeBg : '#fff',
                  border: isActive ? pill.activeBorder : pill.inactiveBorder,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  font: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PillIcon size={15} color={pill.iconColor} />
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: pill.labelColor }}>{pill.label}</span>
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: pill.countColor }}>{pill.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Search & Status Filters ──────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 'min(100%, 220px)' }}>
            <Search
              size={15}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
            />
            <input
              type="text"
              placeholder="Cari nama produk atau kode batch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pos-search-input"
              style={{
                width: '100%',
                paddingLeft: 36,
                paddingRight: 12,
                fontSize: 'var(--text-base)',
                minHeight: 44,
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#fff',
              }}
            />
          </div>

          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReportStatus | 'semua')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              minHeight: 44,
              maxWidth: '100%',
            }}
          >
            <option value="semua">Semua Status Progres</option>
            <option value="ALERT_ONLY">Belum Dicek Gudang</option>
            <option value="SUBMITTED">Menunggu Manager</option>
            <option value="APPROVED">Disetujui Manager</option>
            <option value="EXECUTED">Selesai Dieksekusi</option>
            <option value="REJECTED">Ditolak Manager</option>
          </select>
        </div>
      </div>

      {/* ── List / Cards To-Do Gudang ────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: '#64748b' }}>
          <RefreshCw size={28} className="spin-icon" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.85rem' }}>Memuat daftar kedaluwarsa...</p>
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 'var(--space-10)',
            background: '#fff',
            borderRadius: 12,
            border: '1px dashed #cbd5e1',
            color: '#64748b',
          }}
        >
          <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 10px', opacity: 0.8 }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 4px', color: '#1e293b' }}>
            Semua Batch Aman!
          </h3>
          <p style={{ fontSize: '0.82rem', margin: 0 }}>
            Tidak ada batch yang mendekati tanggal kedaluwarsa pada kriteria filter saat ini.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {items.map((item) => {
            const isH1 = item.alertLevel === 'H1';
            const isH3 = item.alertLevel === 'H3';
            const isApprovedDiscount = item.status === 'APPROVED' && item.managerDecision === 'DISCOUNT';
            const isExecuted = item.status === 'EXECUTED';
            const normalPrice = Number(item.sellingPrice);
            const discountPct = item.approvedDiscountPct ? Number(item.approvedDiscountPct) : 0;
            const discountedPrice = discountPct > 0 ? Math.round(normalPrice * (1 - discountPct / 100)) : normalPrice;

            return (
              <div
                key={item.id}
                style={{
                  background: '#fff',
                  border: isH1
                    ? '1.5px solid #fca5a5'
                    : isH3
                    ? '1.5px solid #fdba74'
                    : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 'var(--space-3)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Top Row: Badges & Urgency */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: isH1
                          ? '#fee2e2'
                          : isH3
                          ? '#ffedd5'
                          : item.alertLevel === 'H5'
                          ? '#fef9c3'
                          : '#dbeafe',
                        color: isH1
                          ? '#991b1b'
                          : isH3
                          ? '#9a3412'
                          : item.alertLevel === 'H5'
                          ? '#854d0e'
                          : '#1e40af',
                      }}
                    >
                      {isH1 ? <Flame size={12} /> : isH3 ? <Zap size={12} /> : <Clock size={12} />}
                      {item.alertLevel}: Kedaluwarsa {item.expiryDate} ({item.daysRemainingAtAlert <= 0 ? 'HARI INI / LEWAT' : `Tersisa ${item.daysRemainingAtAlert} Hari`})
                    </span>

                    {/* Status Badge */}
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        background:
                          item.status === 'ALERT_ONLY'
                            ? '#f1f5f9'
                            : item.status === 'SUBMITTED'
                            ? '#fef3c7'
                            : item.status === 'APPROVED'
                            ? '#d1fae5'
                            : item.status === 'EXECUTED'
                            ? '#e0e7ff'
                            : '#fee2e2',
                        color:
                          item.status === 'ALERT_ONLY'
                            ? '#475569'
                            : item.status === 'SUBMITTED'
                            ? '#b45309'
                            : item.status === 'APPROVED'
                            ? '#065f46'
                            : item.status === 'EXECUTED'
                            ? '#3730a3'
                            : '#991b1b',
                      }}
                    >
                      {item.status === 'ALERT_ONLY' && 'Belum Dicek'}
                      {item.status === 'SUBMITTED' && 'Menunggu Persetujuan'}
                      {item.status === 'APPROVED' && `Disetujui: ${item.managerDecision ? DECISION_LABELS[item.managerDecision] : '—'}`}
                      {item.status === 'EXECUTED' && 'Selesai Ditangani'}
                      {item.status === 'REJECTED' && 'Ditolak Manager'}
                    </span>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Stok Batch</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                      {item.currentBatchQty} {item.productUnit}
                    </div>
                  </div>
                </div>

                {/* Middle Row: Product info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>
                      {item.productName}
                    </h4>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Batch: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.batchCode}</span> • Harga Normal: {rp(item.sellingPrice)}
                    </div>
                  </div>

                  {isApprovedDiscount && (
                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: '#fee2e2',
                          color: '#dc2626',
                          display: 'inline-block',
                          marginBottom: 2,
                        }}
                      >
                        OBRAL -{discountPct}%
                      </span>
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#dc2626' }}>
                        {rp(discountedPrice)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Detail Notes from Warehouse or Manager */}
                {(item.physicalCondition || item.managerNote || item.executionNote) && (
                  <div
                    style={{
                      background: '#f8fafc',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: '0.78rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      borderLeft: '3px solid #cbd5e1',
                    }}
                  >
                    {item.physicalCondition && (
                      <div>
                        <strong>Kondisi Fisik:</strong> {item.physicalCondition}
                        {item.gudangSuggestion && <span> • <em>Saran: {item.gudangSuggestion}</em></span>}
                      </div>
                    )}
                    {item.managerNote && (
                      <div style={{ color: '#047857' }}>
                        <strong>Instruksi Manager:</strong> {item.managerNote}
                      </div>
                    )}
                    {item.executionNote && (
                      <div style={{ color: '#4338ca' }}>
                        <strong>Laporan Eksekusi:</strong> {item.executionNote}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons Row */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', paddingTop: 4 }}>
                  {/* Status ALERT_ONLY: Butuh Cek Fisik */}
                  {(item.status === 'ALERT_ONLY' || item.status === 'REJECTED') && (
                    <button
                      type="button"
                      onClick={() => {
                        const expiredNow = Boolean(item.isExpired || (item.expiryDate && item.expiryDate < getTodayWibIso()));
                        setLaporModalItem(item);
                        setPhysicalCondition(
                          expiredNow ? 'Batch sudah melewati tanggal kedaluwarsa, wajib ditarik dari rak.' : '',
                        );
                        setGudangSuggestion(expiredNow ? 'DISPOSE' : 'DISCOUNT');
                        setSuggestedDiscountPct(expiredNow ? 0 : 30);
                      }}
                      className="btn btn-primary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.82rem',
                        minHeight: 44,
                        padding: '8px 14px',
                        fontWeight: 700,
                        backgroundColor: item.isExpired || (item.expiryDate && item.expiryDate < getTodayWibIso()) ? '#dc2626' : '#ea580c',
                        borderColor: item.isExpired || (item.expiryDate && item.expiryDate < getTodayWibIso()) ? '#dc2626' : '#ea580c',
                      }}
                    >
                      <FileText size={14} />
                      {item.isExpired || (item.expiryDate && item.expiryDate < getTodayWibIso())
                        ? 'Ajukan Tarik / Musnahkan (Expired)'
                        : 'Input Pemeriksaan Fisik'}
                    </button>
                  )}

                  {/* Status APPROVED & DISCOUNT: Cetak Stiker Barcode */}
                  {isApprovedDiscount && (
                    <button
                      type="button"
                      onClick={() => setPrintModalItem(item)}
                      className="btn btn-secondary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.82rem',
                        minHeight: 44,
                        padding: '8px 14px',
                        fontWeight: 700,
                        color: '#b91c1c',
                        borderColor: '#fca5a5',
                        background: '#fff1f2',
                      }}
                    >
                      <Printer size={14} />
                      Lihat / Cetak Stiker Barcode
                    </button>
                  )}

                  {/* Status APPROVED: Tombol Eksekusi Lapangan */}
                  {item.status === 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => {
                        setExecuteModalItem(item);
                        setExecutionNote(
                          item.managerDecision === 'DISCOUNT'
                            ? 'Stiker diskon sudah ditempel pada kemasan fisik dan dipajang di rak obral depan.'
                            : item.managerDecision === 'DESTROY'
                            ? 'Barang fisik sudah dimusnahkan dan disingkirkan dari rak display sesuai SOP.'
                            : 'Barang fisik sudah digeser ke rak display bagian depan dekat kasir.'
                        );
                      }}
                      className="btn btn-primary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.82rem',
                        minHeight: 44,
                        padding: '8px 14px',
                        fontWeight: 700,
                        backgroundColor: '#059669',
                        borderColor: '#059669',
                      }}
                    >
                      <CheckCircle2 size={14} />
                      Konfirmasi Selesai Eksekusi
                    </button>
                  )}

                  {isExecuted && (
                    <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircle2 size={13} /> Telah diselesaikan di lapangan
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL 1: Input Laporan Kondisi Fisik ─────────────── */}
      {laporModalItem && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 480,
              padding: 'var(--space-4)',
              paddingBottom: 'calc(var(--space-4) + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              maxHeight: '90dvh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={18} color="#ea580c" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Lapor Kondisi Fisik Batch</h3>
              </div>
              <button
                type="button"
                aria-label="Tutup modal laporan fisik"
                onClick={() => setLaporModalItem(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{laporModalItem.productName}</div>
              <div style={{ color: '#64748b' }}>
                Batch: {laporModalItem.batchCode} • ED: {laporModalItem.expiryDate} • Stok: {laporModalItem.currentBatchQty} {laporModalItem.productUnit}
              </div>
            </div>

            {/* Quick chips kondisi fisik */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Kondisi Fisik Barang di Lapangan *
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {[
                  'Kemasan utuh & kondisi bagus',
                  'Kemasan sedikit penyok / berdebu',
                  'Mendekati ED, kualitas rasa/aroma masih normal',
                  'Kemasan rusak / bocor',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPhysicalCondition(preset)}
                    style={{
                      fontSize: '0.78rem',
                      minHeight: 44,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: physicalCondition === preset ? '#ffedd5' : '#fff',
                      color: physicalCondition === preset ? '#c2410c' : '#334155',
                      cursor: 'pointer',
                      fontWeight: 600,
                      textAlign: 'left',
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                placeholder="Tuliskan catatan detail kondisi fisik barang di rak/gudang..."
                value={physicalCondition}
                onChange={(e) => setPhysicalCondition(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--text-base)',
                  minHeight: 88,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Peringatan Keras Jika Batch Sudah Kedaluwarsa */}
            {(laporModalItem.isExpired || (laporModalItem.expiryDate && laporModalItem.expiryDate < getTodayWibIso())) && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: '#fef2f2',
                  border: '1.5px solid #ef4444',
                  color: '#991b1b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  lineHeight: 1.45,
                }}
              >
                BARANG SUDAH KEDALUWARSA (ED: {laporModalItem.expiryDate}). Dilarang didiskon atau dijual kembali! Pilih <strong>Musnahkan</strong> atau <strong>Retur ke Supplier</strong> untuk menolkan stok batch ini setelah disetujui Manager.
              </div>
            )}

            {/* Rekomendasi Tindakan */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Rekomendasi Tindakan Petugas Gudang
              </label>
              <select
                className="form-select"
                value={gudangSuggestion}
                onChange={(e) => setGudangSuggestion(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--text-base)',
                  minHeight: 44,
                  fontWeight: 600,
                }}
              >
                {!(laporModalItem.isExpired || (laporModalItem.expiryDate && laporModalItem.expiryDate < getTodayWibIso())) && (
                  <>
                    <option value="DISCOUNT">Usulkan Diskon Obral Darurat (Diskon Cepat)</option>
                    <option value="RELOCATE">Pindahkan ke Rak Display Depan (Dekat Kasir)</option>
                  </>
                )}
                <option value="DISPOSE">Musnahkan / Tarik &amp; Nol-kan Stok (Rusak / Kedaluwarsa)</option>
                <option value="RETURN">Retur ke Pihak Supplier (Tarik &amp; Nol-kan Stok)</option>
              </select>
            </div>

            {/* Slider Diskon jika usul DISCOUNT & BELUM expired */}
            {gudangSuggestion === 'DISCOUNT' &&
              !(laporModalItem.isExpired || (laporModalItem.expiryDate && laporModalItem.expiryDate < getTodayWibIso())) && (
              <div style={{ background: '#fef2f2', padding: 10, borderRadius: 8, border: '1px solid #fecaca' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#991b1b' }}>Usulan Besaran Diskon:</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#dc2626' }}>{suggestedDiscountPct}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={80}
                  step={5}
                  value={suggestedDiscountPct}
                  onChange={(e) => setSuggestedDiscountPct(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#dc2626', minHeight: 44, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                  <span>10%</span>
                  <span>Estimasi Harga Diskon: {rp(Math.round(Number(laporModalItem.sellingPrice) * (1 - suggestedDiscountPct / 100)))}</span>
                  <span>80%</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setLaporModalItem(null)}
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem', minHeight: 44, padding: '8px 16px' }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitLapor}
                disabled={submittingLapor || !physicalCondition.trim()}
                className="btn btn-primary"
                style={{
                  fontSize: '0.85rem',
                  minHeight: 44,
                  padding: '8px 16px',
                  fontWeight: 700,
                  backgroundColor: '#ea580c',
                  borderColor: '#ea580c',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Send size={14} />
                {submittingLapor ? 'Mengirim...' : 'Kirim Laporan ke Manager'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Lihat & Cetak Barcode Diskon Darurat ──────── */}
      {printModalItem && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 420,
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: 'var(--space-4)',
              paddingBottom: 'calc(var(--space-4) + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Printer size={18} color="#dc2626" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Stiker Barcode Diskon Darurat</h3>
              </div>
              <button
                type="button"
                aria-label="Tutup modal cetak barcode"
                onClick={() => setPrintModalItem(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
              Tempel stiker ini pada kemasan fisik barang. Saat kasir memindai barcode ini, harga otomatis berubah
              menjadi harga diskon secara resmi.
            </p>

            {/* Label Thermal Mockup */}
            <div
              id={`${printUid}-label`}
              style={{
                border: '2px dashed #94a3b8',
                borderRadius: 8,
                padding: '16px 12px',
                textAlign: 'center',
                backgroundColor: '#fff',
              }}
            >
              <div className="title" style={{ fontSize: '0.85rem', fontWeight: 800, textTransform: 'uppercase' }}>
                {printModalItem.productName}
              </div>
              <div className="sub" style={{ fontSize: '0.72rem', color: '#475569', marginBottom: 6 }}>
                WIRAMART UNPERBA • CLEARANCE SALE
              </div>

              <div
                className="badge"
                style={{
                  display: 'inline-block',
                  background: '#dc2626',
                  color: '#fff',
                  padding: '3px 10px',
                  borderRadius: 4,
                  fontSize: '0.85rem',
                  fontWeight: 900,
                  marginBottom: 6,
                }}
              >
                OBRAL {printModalItem.approvedDiscountPct}% OFF
              </div>

              <div className="price-box" style={{ margin: '6px 0' }}>
                <div className="orig" style={{ fontSize: '0.78rem', textDecoration: 'line-through', color: '#64748b' }}>
                  {rp(printModalItem.sellingPrice)}
                </div>
                <div className="disc" style={{ fontSize: '1.25rem', fontWeight: 900, color: '#dc2626' }}>
                  {rp(
                    Math.round(
                      Number(printModalItem.sellingPrice) *
                        (1 - Number(printModalItem.approvedDiscountPct || 0) / 100),
                    ),
                  )}
                </div>
              </div>

              {/* Barcode String Box */}
              <div
                className="barcode-box"
                style={{
                  border: '1.5px solid #0f172a',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontFamily: 'monospace',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  letterSpacing: 2,
                  margin: '8px 0',
                  background: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  overflowWrap: 'anywhere',
                }}
              >
                <Barcode size={18} style={{ flexShrink: 0 }} />
                {printModalItem.discountBarcode || `DISC-${printModalItem.productId.slice(0, 6).toUpperCase()}-AUTO`}
              </div>

              <div className="exp" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Batch: {printModalItem.batchCode} • ED: {printModalItem.expiryDate}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setPrintModalItem(null)}
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem', minHeight: 44, padding: '8px 16px' }}
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => handlePrintLabel(printModalItem)}
                className="btn btn-primary"
                style={{
                  fontSize: '0.85rem',
                  minHeight: 44,
                  padding: '8px 16px',
                  fontWeight: 700,
                  backgroundColor: '#dc2626',
                  borderColor: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Printer size={15} />
                Cetak Label Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: Konfirmasi Eksekusi Lapangan ─────────────── */}
      {executeModalItem && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 460,
              maxHeight: '90dvh',
              overflowY: 'auto',
              padding: 'var(--space-4)',
              paddingBottom: 'calc(var(--space-4) + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} color="#059669" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Konfirmasi Eksekusi Fisik</h3>
              </div>
              <button
                type="button"
                aria-label="Tutup modal konfirmasi eksekusi"
                onClick={() => setExecuteModalItem(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748b',
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '8px 12px', background: '#ecfdf5', borderRadius: 8, fontSize: '0.8rem', border: '1px solid #a7f3d0' }}>
              <div style={{ fontWeight: 700, color: '#065f46' }}>
                Keputusan Manager: {executeModalItem.managerDecision ? DECISION_LABELS[executeModalItem.managerDecision] : '—'}
                {executeModalItem.approvedDiscountPct && ` (${executeModalItem.approvedDiscountPct}% OFF)`}
              </div>
              <div style={{ color: '#047857', marginTop: 2 }}>
                {executeModalItem.managerNote || 'Laksanakan tindakan di rak display toko sesuai arahan.'}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Catatan Bukti Pelaksanaan Lapangan *
              </label>
              <textarea
                rows={3}
                value={executionNote}
                onChange={(e) => setExecutionNote(e.target.value)}
                placeholder="Tuliskan konfirmasi tindakan fisik yang telah diselesaikan..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 'var(--text-base)',
                  minHeight: 88,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setExecuteModalItem(null)}
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem', minHeight: 44, padding: '8px 16px' }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitExecute}
                disabled={submittingExecute || executionNote.trim().length < 5}
                className="btn btn-primary"
                style={{
                  fontSize: '0.85rem',
                  minHeight: 44,
                  padding: '8px 16px',
                  fontWeight: 700,
                  backgroundColor: '#059669',
                  borderColor: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CheckCircle2 size={15} />
                {submittingExecute ? 'Menyimpan...' : 'Tandai Selesai Eksekusi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
