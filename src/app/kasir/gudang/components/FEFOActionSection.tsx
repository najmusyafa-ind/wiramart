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
  discountBarcode?: string | null;
  discountedPrice?: number | null;
};

interface FEFOActionSectionProps {
  onBadgeUpdate?: () => void;
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

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Simpan callback onBadgeUpdate dalam ref agar tidak memicu re-render / fetch loop
  const onBadgeUpdateRef = useRef(onBadgeUpdate);
  useEffect(() => {
    onBadgeUpdateRef.current = onBadgeUpdate;
  }, [onBadgeUpdate]);

  // Fetch To-Do List
  const fetchReports = useCallback(async (triggerScan = false) => {
    if (triggerScan) setScanningRadar(true);
    else setRefreshing(true);

    try {
      const params = new URLSearchParams({
        page: '1',
        limit: '100',
        ...(triggerScan && { scan: 'true' }),
        ...(alertFilter !== 'semua' && { alertLevel: alertFilter }),
        ...(statusFilter !== 'semua' && { status: statusFilter }),
        ...(search.trim() && { search: search.trim() }),
      });

      const res = await fetch(`/api/gudang/fefo-alerts?${params}`);
      const json = await res.json();

      if (json.success && json.data) {
        setItems(json.data.items ?? []);
        if (triggerScan && json.data.scanMeta) {
          const { scannedBatches, newAlerts, updatedAlerts } = json.data.scanMeta;
          showToast(
            `Radar FEFO: ${scannedBatches} batch dipindai. +${newAlerts} alert baru, ${updatedAlerts} diperbarui.`,
            'success',
          );
          if (onBadgeUpdateRef.current) onBadgeUpdateRef.current();
        }
      } else {
        showToast(json.error || 'Gagal memuat To-Do List FEFO', 'error');
      }
    } catch {
      showToast('Koneksi terputus saat mengambil data FEFO', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setScanningRadar(false);
    }
  }, [alertFilter, statusFilter, search]);

  useEffect(() => {
    fetchReports(false);
  }, [fetchReports]);

  // Handle Submit Laporan Fisik
  const handleSubmitLapor = async () => {
    if (!laporModalItem) return;
    if (!physicalCondition.trim()) {
      showToast('Deskripsi kondisi fisik wajib diisi minimal 5 karakter.', 'error');
      return;
    }

    setSubmittingLapor(true);
    try {
      const payload = {
        physicalCondition: physicalCondition.trim(),
        gudangSuggestion:
          gudangSuggestion === 'DISCOUNT'
            ? `Usul Diskon ${suggestedDiscountPct}% Cuci Gudang`
            : gudangSuggestion === 'RELOCATE'
            ? 'Usul Pindah ke Rak Display Depan'
            : gudangSuggestion === 'DISPOSE'
            ? 'Usul Pemusnahan / Write-off'
            : 'Usul Retur ke Supplier',
        suggestedDiscountPct: gudangSuggestion === 'DISCOUNT' ? suggestedDiscountPct : null,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Toast Notifikasi ─────────────────────────────────── */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            padding: '12px 18px',
            borderRadius: 8,
            backgroundColor:
              toastMsg.type === 'success' ? '#059669' : toastMsg.type === 'error' ? '#dc2626' : '#2563eb',
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

      {/* ── Header & Radar Trigger ───────────────────────────── */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
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
                FEFO RADAR v3.0
              </span>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'hsl(20 80% 20%)', margin: 0 }}>
                To-Do List Pemeriksaan & Penanganan Kedaluwarsa
              </h2>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'hsl(20 40% 40%)', margin: 0, maxWidth: 650, lineHeight: 1.45 }}>
              Deteksi otomatis batch yang mendekati masa kedaluwarsa. Petugas gudang wajib memeriksa kondisi fisik,
              memberikan saran penanganan, dan mencetak stiker obral darurat jika disetujui Manager.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => fetchReports(true)}
              disabled={scanningRadar || refreshing}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.8rem',
                minHeight: 38,
                background: '#fff',
                borderColor: 'hsl(24 80% 80%)',
                color: 'hsl(20 80% 30%)',
                fontWeight: 600,
              }}
            >
              <RefreshCw size={14} className={scanningRadar ? 'animate-spin' : ''} />
              {scanningRadar ? 'Memindai...' : 'Scan Radar FEFO'}
            </button>
          </div>
        </div>

        {/* ── Metric Summary Pills ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-2)' }}>
          <div
            onClick={() => setAlertFilter(alertFilter === 'H1' ? 'semua' : 'H1')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: alertFilter === 'H1' ? 'hsl(0 100% 95%)' : '#fff',
              border: alertFilter === 'H1' ? '1.5px solid #ef4444' : '1px solid hsl(0 60% 90%)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Flame size={15} color="#ef4444" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#991b1b' }}>H-1 Kritis</span>
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#dc2626' }}>{counts.H1}</span>
          </div>

          <div
            onClick={() => setAlertFilter(alertFilter === 'H3' ? 'semua' : 'H3')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: alertFilter === 'H3' ? 'hsl(24 100% 95%)' : '#fff',
              border: alertFilter === 'H3' ? '1.5px solid #f97316' : '1px solid hsl(24 60% 90%)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={15} color="#f97316" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#c2410c' }}>H-3 Urgent</span>
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#ea580c' }}>{counts.H3}</span>
          </div>

          <div
            onClick={() => setAlertFilter(alertFilter === 'H5' ? 'semua' : 'H5')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: alertFilter === 'H5' ? 'hsl(45 100% 95%)' : '#fff',
              border: alertFilter === 'H5' ? '1.5px solid #eab308' : '1px solid hsl(45 60% 90%)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={15} color="#ca8a04" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#854d0e' }}>H-5 Warning</span>
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#ca8a04' }}>{counts.H5}</span>
          </div>

          <div
            onClick={() => setAlertFilter(alertFilter === 'H7' ? 'semua' : 'H7')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: alertFilter === 'H7' ? 'hsl(215 100% 96%)' : '#fff',
              border: alertFilter === 'H7' ? '1.5px solid #3b82f6' : '1px solid hsl(215 60% 90%)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Eye size={15} color="#3b82f6" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e40af' }}>H-7 Watch</span>
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#2563eb' }}>{counts.H7}</span>
          </div>
        </div>
      </div>

      {/* ── Search & Status Filters ──────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
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
                fontSize: '0.85rem',
                minHeight: 40,
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#fff',
              }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReportStatus | 'semua')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontSize: '0.82rem',
              fontWeight: 600,
              minHeight: 40,
            }}
          >
            <option value="semua">Semua Status Progres</option>
            <option value="ALERT_ONLY">⚠️ Belum Dicek Gudang</option>
            <option value="SUBMITTED">⏳ Menunggu Manager</option>
            <option value="APPROVED">✅ Disetujui Manager</option>
            <option value="EXECUTED">🎉 Selesai Dieksekusi</option>
            <option value="REJECTED">❌ Ditolak Manager</option>
          </select>
        </div>
      </div>

      {/* ── List / Cards To-Do Gudang ────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: '#64748b' }}>
          <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.85rem' }}>Memuat To-Do List kedaluwarsa FEFO...</p>
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
                      {item.status === 'ALERT_ONLY' && '⚠️ Belum Dicek'}
                      {item.status === 'SUBMITTED' && '⏳ Menunggu ACC Manager'}
                      {item.status === 'APPROVED' && `✅ Disetujui: ${item.managerDecision}`}
                      {item.status === 'EXECUTED' && '🎉 Selesai Ditangani'}
                      {item.status === 'REJECTED' && '❌ Ditolak Manager'}
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
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                  {/* Status ALERT_ONLY: Butuh Cek Fisik */}
                  {(item.status === 'ALERT_ONLY' || item.status === 'REJECTED') && (
                    <button
                      onClick={() => {
                        setLaporModalItem(item);
                        setPhysicalCondition('');
                        setGudangSuggestion('DISCOUNT');
                        setSuggestedDiscountPct(30);
                      }}
                      className="btn btn-primary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.78rem',
                        minHeight: 34,
                        padding: '6px 12px',
                        fontWeight: 700,
                        backgroundColor: '#ea580c',
                        borderColor: '#ea580c',
                      }}
                    >
                      <FileText size={13} />
                      Input Pemeriksaan Fisik
                    </button>
                  )}

                  {/* Status APPROVED & DISCOUNT: Cetak Stiker Barcode */}
                  {isApprovedDiscount && (
                    <button
                      onClick={() => setPrintModalItem(item)}
                      className="btn btn-secondary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.78rem',
                        minHeight: 34,
                        padding: '6px 12px',
                        fontWeight: 700,
                        color: '#b91c1c',
                        borderColor: '#fca5a5',
                        background: '#fff1f2',
                      }}
                    >
                      <Printer size={13} />
                      Lihat / Cetak Stiker Barcode
                    </button>
                  )}

                  {/* Status APPROVED: Tombol Eksekusi Lapangan */}
                  {item.status === 'APPROVED' && (
                    <button
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
                        fontSize: '0.78rem',
                        minHeight: 34,
                        padding: '6px 12px',
                        fontWeight: 700,
                        backgroundColor: '#059669',
                        borderColor: '#059669',
                      }}
                    >
                      <CheckCircle2 size={13} />
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
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={18} color="#ea580c" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Lapor Kondisi Fisik Batch</h3>
              </div>
              <button
                onClick={() => setLaporModalItem(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
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
                      fontSize: '0.72rem',
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: '1px solid #cbd5e1',
                      background: physicalCondition === preset ? '#ffedd5' : '#fff',
                      color: physicalCondition === preset ? '#c2410c' : '#334155',
                      cursor: 'pointer',
                      fontWeight: 600,
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
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Rekomendasi Tindakan */}
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Rekomendasi Tindakan Petugas Gudang
              </label>
              <select
                value={gudangSuggestion}
                onChange={(e) => setGudangSuggestion(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                }}
              >
                <option value="DISCOUNT">🏷️ Usulkan Diskon Obral Darurat (Diskon Cepat)</option>
                <option value="RELOCATE">➡️ Pindahkan ke Rak Display Depan (Dekat Kasir)</option>
                <option value="DISPOSE">🗑️ Musnahkan / Buang (Rusak / Basi)</option>
                <option value="RETURN">↩️ Retur ke Pihak Supplier</option>
              </select>
            </div>

            {/* Slider Diskon jika usul DISCOUNT */}
            {gudangSuggestion === 'DISCOUNT' && (
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
                  style={{ width: '100%', accentColor: '#dc2626' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                  <span>10%</span>
                  <span>Estimasi Harga Diskon: {rp(Math.round(Number(laporModalItem.sellingPrice) * (1 - suggestedDiscountPct / 100)))}</span>
                  <span>80%</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setLaporModalItem(null)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', minHeight: 38 }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitLapor}
                disabled={submittingLapor || !physicalCondition.trim()}
                className="btn btn-primary"
                style={{
                  fontSize: '0.8rem',
                  minHeight: 38,
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
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Printer size={18} color="#dc2626" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Stiker Barcode Diskon Darurat</h3>
              </div>
              <button
                onClick={() => setPrintModalItem(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
              Tempel stiker ini pada kemasan fisik barang. Saat kasir men-scan barcode ini, harga otomatis ter-override
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
                🏷️ OBRAL {printModalItem.approvedDiscountPct}% OFF
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
                }}
              >
                <Barcode size={18} />
                {printModalItem.discountBarcode || `DISC-${printModalItem.productId.slice(0, 6).toUpperCase()}-AUTO`}
              </div>

              <div className="exp" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Batch: {printModalItem.batchCode} • ED: {printModalItem.expiryDate}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setPrintModalItem(null)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', minHeight: 38 }}
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => handlePrintLabel(printModalItem)}
                className="btn btn-primary"
                style={{
                  fontSize: '0.8rem',
                  minHeight: 38,
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
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} color="#059669" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Konfirmasi Eksekusi Fisik</h3>
              </div>
              <button
                onClick={() => setExecuteModalItem(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '8px 12px', background: '#ecfdf5', borderRadius: 8, fontSize: '0.8rem', border: '1px solid #a7f3d0' }}>
              <div style={{ fontWeight: 700, color: '#065f46' }}>
                Keputusan Manager: {executeModalItem.managerDecision}
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
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setExecuteModalItem(null)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', minHeight: 38 }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitExecute}
                disabled={submittingExecute || executionNote.trim().length < 5}
                className="btn btn-primary"
                style={{
                  fontSize: '0.8rem',
                  minHeight: 38,
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
