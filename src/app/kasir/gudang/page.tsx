'use client';
// =============================================================
// src/app/kasir/gudang/page.tsx
// Portal Petugas Gudang & Manajemen Logistik Wiramart UNPERBA
// STANDAR: Mobile-First Ergonomics, Zero-Trust HPP Protection, Live FEFO Radar
// =============================================================

import { useState, useEffect, useRef, useId } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Package,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Search,
  Camera,
  Plus,
  RefreshCw,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Boxes,
  Calendar,
  X,
  History,
  Barcode,
  Layers,
  ArrowRight,
  TrendingUp,
  FileText,
  AlertCircle,
  Sparkles,
  Truck,
} from 'lucide-react';
import PenerimaanBarangSection from './components/PenerimaanBarangSection';
import FEFOActionSection from './components/FEFOActionSection';

// ── Tipe Data Frontend ─────────────────────────────────────────

type WarehouseEmployee = {
  id: string;
  name: string;
  nim: string;
  jabatan: string;
};

type WarehouseSummary = {
  totalSku: number;
  outOfStockSku: number;
  lowStockSku: number;
  expiringSoonSku: number;
  todayRestockCount: number;
  perishableSku?: number;
};

type WarehouseProduct = {
  id: string;
  name: string;
  barcode: string | null;
  categoryName: string;
  stockQty: number;
  unit: string;
  photoUrl: string | null;
  isPerishable: boolean;
  perishableType: string | null;
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'SAFE';
  nearestExpiryDate: string | null;
  expiryUrgency: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'SAFE' | 'NONE';
  activeBatchesCount: number;
};

type ActivityLog = {
  id: string;
  productId: string;
  productName: string;
  categoryName?: string;
  qtyDiff: number;
  reason: string;
  createdAt: string;
  actorName?: string;
  actorNim?: string;
  shiftInfo?: string;
  batchCode?: string;
  expiryDate?: string | null;
  notes?: string | null;
  formattedDate?: string;
  formattedTime?: string;
};

// BarcodeDetector Interface untuk Kamera HP
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(options?: { formats?: string[] });
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

export default function GudangPortalPage() {
  const router = useRouter();
  const searchInputId = useId();

  // State Data
  const [employee, setEmployee] = useState<WarehouseEmployee | null>(null);
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [products, setProducts] = useState<WarehouseProduct[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // State Filter & Pencarian
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'semua' | 'kritis' | 'fefo' | 'perishable' | 'habis' | 'aktivitas' | 'penerimaan'>('semua');

  // State Modal Restock
  const [selectedProduct, setSelectedProduct] = useState<WarehouseProduct | null>(null);
  const [restockQty, setRestockQty] = useState<number>(1);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [batchCode, setBatchCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submittingRestock, setSubmittingRestock] = useState(false);
  const [restockSuccessMsg, setRestockSuccessMsg] = useState<string | null>(null);

  // State Kamera Scanner
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load Data Awal ───────────────────────────────────────────
  async function loadData(targetFilter = activeTab, targetSearch = search) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const filterParam = targetFilter === 'aktivitas' || targetFilter === 'penerimaan' ? 'semua' : targetFilter;
      const res = await fetch(
        `/api/kasir/gudang?filter=${filterParam}&search=${encodeURIComponent(targetSearch)}`,
      );

      if (res.status === 401 || res.status === 403) {
        router.push('/kasir/login');
        return;
      }

      const json = (await res.json()) as {
        success: boolean;
        data?: {
          employee: WarehouseEmployee;
          summary: WarehouseSummary;
          items: WarehouseProduct[];
          activities: ActivityLog[];
        };
        error?: string;
      };

      if (!res.ok || !json.success || !json.data) {
        setErrorMsg(json.error ?? 'Gagal memuat data gudang.');
        return;
      }

      setEmployee(json.data.employee);
      setSummary(json.data.summary);
      setProducts(json.data.items);
      setActivities(json.data.activities);
    } catch {
      setErrorMsg('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(activeTab, search);
  }, [activeTab]);

  // Debounced Search
  useEffect(() => {
    const handler = setTimeout(() => {
      loadData(activeTab, search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // ── Modal Restock Open Helper ────────────────────────────────
  function openRestockModal(prod: WarehouseProduct) {
    setSelectedProduct(prod);
    setRestockQty(1);
    setExpiryDate('');
    setBatchCode('');
    setNotes('');
    setRestockSuccessMsg(null);
  }

  // ── Submit Restock Mutasi Stok (ACID) ─────────────────────────
  async function handleRestockSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProduct || restockQty <= 0) return;

    setSubmittingRestock(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/kasir/gudang', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          qtyAdd: Number(restockQty),
          expiryDate: expiryDate ? expiryDate : null,
          batchCode: batchCode.trim() ? batchCode.trim() : null,
          notes: notes.trim() ? notes.trim() : null,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        data?: { qtyBefore: number; qtyAfter: number; productName: string };
        error?: string;
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? 'Gagal mencatat restock.');
        return;
      }

      setRestockSuccessMsg(
        `Sukses! Stok ${selectedProduct.name} bertambah +${restockQty} ${selectedProduct.unit}. Total sekarang: ${json.data?.qtyAfter ?? selectedProduct.stockQty + restockQty} ${selectedProduct.unit}.`,
      );

      // Refresh data di background
      await loadData();

      // Tutup modal setelah delay singkat agar user melihat feedback
      setTimeout(() => {
        setSelectedProduct(null);
        setRestockSuccessMsg(null);
      }, 1500);
    } catch {
      alert('Koneksi terputus saat menyimpan restock.');
    } finally {
      setSubmittingRestock(false);
    }
  }

  // ── Barcode Scanner Kamera Handheld ──────────────────────────
  async function startScanner() {
    setIsScanning(true);
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Kamera tidak didukung pada browser ini.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a'],
          });

          scanIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                const detectedCode = barcodes[0].rawValue;
                stopScanner();
                setSearch(detectedCode);
              }
            } catch {
              // Abaikan frame drop
            }
          }, 300);
        }
      }
    } catch {
      setCameraError('Izin kamera ditolak atau kamera sedang digunakan aplikasi lain.');
    }
  }

  function stopScanner() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  }

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  // ── Logout Handler ───────────────────────────────────────────
  async function handleLogout() {
    if (!window.confirm('Keluar dari Portal Petugas Gudang?')) return;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/kasir/login');
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        fontFamily: 'inherit',
        paddingBottom: 80,
      }}
    >
      {/* ── TOP APP BAR (MOBILE FRIENDLY) ── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.05)',
          padding: '12px 16px',
        }}
      >
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: 'hsl(217 91% 60%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 2px 6px -1px hsl(217 91% 60% / 0.4)',
              }}
            >
              <Package size={22} />
            </div>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, lineHeight: 1.2, color: '#0f172a' }}>
                Wiramart Gudang
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                  }}
                />
                {employee ? `${employee.name} (${employee.jabatan || 'Gudang'})` : 'Memuat sesi...'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {employee && (employee.jabatan?.toLowerCase().includes('admin') || employee.jabatan?.toLowerCase().includes('manager')) && (
              <button
                type="button"
                onClick={() => router.push('/admin/dashboard')}
                className="btn btn-secondary"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#0f172a',
                  fontWeight: 600,
                }}
                title="Kembali ke Dashboard Admin"
              >
                <ChevronLeft size={14} />
                <span>Dashboard</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => loadData()}
              className="btn btn-secondary"
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#475569',
              }}
              title="Segarkan Data"
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span style={{ display: 'none' }}>Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#ef4444',
              }}
              title="Keluar"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* ── KONTEN UTAMA ── */}
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '16px 14px' }}>
        {/* KPI DASHBOARD CARDS (HEALTH BAR) */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {/* Card 1: Stok Habis */}
          <button
            type="button"
            onClick={() => setActiveTab('habis')}
            style={{
              textAlign: 'left',
              padding: '10px 8px',
              borderRadius: 12,
              backgroundColor: activeTab === 'habis' ? '#fee2e2' : '#ffffff',
              border: activeTab === 'habis' ? '1.5px solid #ef4444' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase' }}>
              Habis
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#991b1b', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.outOfStockSku : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>0 Pcs</div>
          </button>

          {/* Card 2: Stok Kritis */}
          <button
            type="button"
            onClick={() => setActiveTab('kritis')}
            style={{
              textAlign: 'left',
              padding: '10px 8px',
              borderRadius: 12,
              backgroundColor: activeTab === 'kritis' ? '#fef3c7' : '#ffffff',
              border: activeTab === 'kritis' ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>
              Kritis
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#b45309', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.lowStockSku : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>&le; 5 Pcs</div>
          </button>

          {/* Card 3: FEFO Mendekati Expired */}
          <button
            type="button"
            onClick={() => setActiveTab('fefo')}
            style={{
              textAlign: 'left',
              padding: '10px 8px',
              borderRadius: 12,
              backgroundColor: activeTab === 'fefo' ? '#ffedd5' : '#ffffff',
              border: activeTab === 'fefo' ? '1.5px solid #f97316' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ea580c', textTransform: 'uppercase' }}>
              FEFO Exp
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#c2410c', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.expiringSoonSku : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>&lt; 30 Hari</div>
          </button>

          {/* Card 4: Restock Hari Ini */}
          <button
            type="button"
            onClick={() => setActiveTab('aktivitas')}
            style={{
              textAlign: 'left',
              padding: '10px 8px',
              borderRadius: 12,
              backgroundColor: activeTab === 'aktivitas' ? '#dcfce7' : '#ffffff',
              border: activeTab === 'aktivitas' ? '1.5px solid #22c55e' : '1px solid #e2e8f0',
              boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase' }}>
              Restock
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#15803d', lineHeight: 1.2, marginTop: 2 }}>
              {summary ? summary.todayRestockCount : '0'}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: 2 }}>Hari Ini</div>
          </button>
        </section>

        {/* ── BAR PENCARIAN & SCANNER KAMERA ── */}
        <section style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              />
              <input
                id={searchInputId}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama produk / scan barcode..."
                style={{
                  width: '100%',
                  height: 42,
                  paddingLeft: 36,
                  paddingRight: search ? 36 : 12,
                  borderRadius: 10,
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={startScanner}
              className="btn btn-primary"
              style={{
                height: 42,
                padding: '0 14px',
                borderRadius: 10,
                backgroundColor: 'hsl(217 91% 60%)',
                color: '#fff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 6px -1px hsl(217 91% 60% / 0.4)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Camera size={16} />
              <span>Scan Kamera</span>
            </button>
          </div>
        </section>

        {/* ── FILTER PILLS TABS ── */}
        <section
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 6,
            marginBottom: 12,
            scrollbarWidth: 'none',
          }}
        >
          {[
            { id: 'semua', label: summary ? `Semua Produk (${summary.totalSku})` : 'Semua Produk' },
            { id: 'penerimaan', label: '🚚 Barang Masuk (ACC)' },
            { id: 'fefo', label: summary ? `🚨 To-Do FEFO & Diskon (${summary.expiringSoonSku})` : '🚨 To-Do FEFO & Diskon' },
            { id: 'kritis', label: summary ? `⚠️ Stok Kritis (${summary.lowStockSku})` : '⚠️ Stok Kritis' },
            { id: 'perishable', label: summary?.perishableSku !== undefined ? `🥪 Makanan Basah (${summary.perishableSku})` : '🥪 Makanan Basah' },
            { id: 'habis', label: summary ? `🔴 Stok Habis (${summary.outOfStockSku})` : '🔴 Stok Habis' },
            { id: 'aktivitas', label: summary ? `📋 Riwayat Restock (${summary.todayRestockCount})` : '📋 Riwayat Restock' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 20,
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  border: isActive ? '1px solid hsl(217 91% 60%)' : '1px solid #cbd5e1',
                  backgroundColor: isActive ? 'hsl(217 91% 95%)' : '#ffffff',
                  color: isActive ? 'hsl(217 91% 35%)' : '#475569',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </section>

        {/* ── ERROR ALERT JIKA ADA ── */}
        {errorMsg && (
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: '#fee2e2',
              border: '1px solid #ef4444',
              borderRadius: 10,
              color: '#991b1b',
              fontSize: '0.8rem',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ── TAB KONTEN: RIWAYAT / PENERIMAAN / PRODUK ── */}
        {activeTab === 'aktivitas' ? (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b' }}>
                Riwayat Restock Gudang Hari Ini
              </h2>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {activities.length} aktivitas tercatat
              </span>
            </div>

            {activities.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                }}
              >
                <History size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Belum ada restock hari ini</div>
                <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  Barang yang Anda restock akan otomatis tercatat dan terlihat oleh Admin Shift.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activities.map((act) => {
                  const dateStr = act.formattedDate || new Date(act.createdAt).toLocaleDateString('id-ID', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'Asia/Jakarta',
                  });
                  const timeStr = act.formattedTime || `${new Date(act.createdAt).toLocaleTimeString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    hour: '2-digit',
                    minute: '2-digit',
                  })} WIB`;

                  return (
                    <div
                      key={act.id}
                      style={{
                        padding: '14px 16px',
                        backgroundColor: '#ffffff',
                        borderRadius: 12,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Baris 1: Nama Produk & Badge Qty */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                            {act.productName}
                          </div>
                          {act.categoryName && (
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                              Kategori: {act.categoryName}
                            </div>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: 900,
                            padding: '4px 10px',
                            borderRadius: 8,
                            backgroundColor: '#dcfce7',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                            flexShrink: 0,
                          }}
                        >
                          +{act.qtyDiff} Pcs
                        </span>
                      </div>

                      {/* Baris 2: Waktu Lengkap & Shift */}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: '0.73rem',
                          color: '#334155',
                          backgroundColor: '#f8fafc',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Calendar size={13} style={{ color: '#0284c7' }} />
                          <span><strong>{dateStr}</strong></span>
                        </div>
                        <span style={{ color: '#cbd5e1' }}>•</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={13} style={{ color: '#f59e0b' }} />
                          <span>{timeStr}</span>
                        </div>
                        <span style={{ color: '#cbd5e1' }}>•</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#475569' }}>
                          <Layers size={13} style={{ color: '#8b5cf6' }} />
                          <span>{act.shiftInfo || 'Shift Reguler Toko'}</span>
                        </div>
                      </div>

                      {/* Baris 3: Petugas & Batch Info */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: '0.72rem', color: '#64748b' }}>
                        <div>
                          👤 <strong>Petugas:</strong> {act.actorName ? `${act.actorName} (${act.actorNim || 'Gudang'})` : 'Petugas Toko'}
                        </div>
                        {act.batchCode && (
                          <div>
                            📦 <strong>Batch:</strong> <code style={{ backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: 4, color: '#0f172a' }}>{act.batchCode}</code>
                          </div>
                        )}
                        {act.expiryDate && (
                          <div style={{ color: '#c2410c' }}>
                            ⏰ <strong>Exp:</strong> {act.expiryDate}
                          </div>
                        )}
                      </div>

                      {/* Catatan jika ada */}
                      {act.notes && (
                        <div style={{ fontSize: '0.72rem', color: '#475569', fontStyle: 'italic', borderLeft: '2px solid #cbd5e1', paddingLeft: 8 }}>
                          &ldquo;{act.notes}&rdquo;
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : activeTab === 'penerimaan' ? (
          <PenerimaanBarangSection
            productsList={products.map((p) => ({
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              categoryName: p.categoryName,
              stockQty: p.stockQty,
              unit: p.unit,
              isPerishable: p.isPerishable,
            }))}
            onDraftApproved={() => loadData(activeTab, search)}
          />
        ) : activeTab === 'fefo' ? (
          <FEFOActionSection onBadgeUpdate={() => loadData(activeTab, search)} />
        ) : (
          /* ── TAB KONTEN 2: LIST PRODUK GUDANG & RADAR FEFO ── */
          <section>
            {/* ── CARD EDUKASI Makanan Basah (PERISHABLE) ── */}
            {activeTab === 'perishable' && (
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #fed7aa',
                  padding: '14px 16px',
                  marginBottom: 16,
                  boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Sparkles size={18} style={{ color: '#ea580c' }} />
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#9a3412', margin: 0 }}>
                    Sistem Pemantauan Kedaluwarsa Wiramart (2 Tipe Produk)
                  </h3>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 10,
                    fontSize: '0.74rem',
                    color: '#475569',
                  }}
                >
                  {/* Tipe 1: Produk Pabrik Ber-Barcode */}
                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                    }}
                    onClick={() => setActiveTab('fefo')}
                  >
                    <div style={{ fontWeight: 800, color: '#c2410c', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>🥫 Tipe 1: Produk Kemasan Ber-Barcode (FEFO)</span>
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.45 }}>
                      <strong>Sistem FEFO:</strong> Minuman botol (Ades, Sprite), susu, biskuit, snack pabrik. Tanggal expired dicatat per batch dus masuk dan dipantau 7 s/d 30 hari sebelum basi. Produk expired terdekat wajib ditaruh paling depan rak.
                    </p>
                    <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#ea580c', fontWeight: 700 }}>
                      &bull; {summary ? `${summary.expiringSoonSku} batch mendekati expired` : 'Dipantau otomatis'}
                    </div>
                  </div>

                  {/* Tipe 2: Makanan Basah Non-Barcode */}
                  <div
                    style={{
                      backgroundColor: activeTab === 'perishable' ? '#f0fdf4' : '#f8fafc',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: activeTab === 'perishable' ? '1.5px solid #22c55e' : '1px solid #e2e8f0',
                      cursor: 'pointer',
                    }}
                    onClick={() => setActiveTab('perishable')}
                  >
                    <div style={{ fontWeight: 800, color: '#15803d', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>🥪 Tipe 2: Makanan Basah Non-Barcode (Harian)</span>
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.45 }}>
                      <strong>Kadaluarsa 1 Hari (Cut-off Jam 15:00 WIB):</strong> Risol, lemper, ricebowl, donat, jajanan pasar konsinyasi/titipan mitra. <em>Wajib habis hari ini juga</em>. Jam 15:00 sore wajib cut-off sisa (retur/obral), dilarang menginap di rak!
                    </p>
                    <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#16a34a', fontWeight: 700 }}>
                      &bull; {summary ? `${summary.perishableSku ?? 0} item makanan basah terdaftar` : 'Wajib Cut-Off Jam 15:00'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b' }}>
                {activeTab === 'perishable'
                  ? 'Daftar Makanan Basah Harian (Kadaluarsa 1 Hari / Cut-off 15:00)'
                  : activeTab === 'kritis'
                  ? 'Daftar Stok Kritis (≤ 5 Pcs)'
                  : activeTab === 'habis'
                  ? 'Daftar Stok Habis (0 Pcs)'
                  : 'Daftar Inventaris Produk'}
              </h2>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {search.trim() ? `${products.length} hasil untuk "${search.trim()}"` : `${products.length} produk ditemukan`}
              </span>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
                <RefreshCw size={24} className="spin-icon" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: '0.8rem' }}>Memuat status stok produk...</div>
              </div>
            ) : products.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                }}
              >
                <Package size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {search.trim()
                    ? `Tidak ada produk "${search.trim()}" pada filter ${activeTab === 'habis' ? 'Stok Habis' : activeTab === 'kritis' ? 'Stok Kritis' : 'ini'}`
                    : 'Tidak ada produk yang cocok'}
                </div>
                <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  {search.trim() && activeTab !== 'semua'
                    ? 'Produk mungkin masih memiliki stok aman. Coba cari di Semua Produk.'
                    : 'Coba ubah kata kunci pencarian atau ganti filter.'}
                </div>
                {search.trim() && activeTab !== 'semua' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('semua')}
                    style={{
                      marginTop: 10,
                      padding: '6px 14px',
                      borderRadius: 8,
                      backgroundColor: 'hsl(217 91% 60%)',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Cari &ldquo;{search.trim()}&rdquo; di Semua Produk
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {products.map((item) => {
                  const isZero = item.stockQty <= 0;
                  const isLow = !isZero && item.stockQty <= 5;

                  return (
                    <div
                      key={item.id}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: 12,
                        border: isZero
                          ? '1px solid #fca5a5'
                          : isLow
                          ? '1px solid #fcd34d'
                          : '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.04)',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Baris 1: Nama, Kategori, Badge Perishable */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                              {item.name}
                            </span>
                            {item.isPerishable && (
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  backgroundColor: 'hsl(38 92% 92%)',
                                  color: 'hsl(38 92% 35%)',
                                }}
                              >
                                {item.perishableType === 'BELI_LEPAS' ? 'Modal Toko' : 'Konsinyasi'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                            {item.categoryName} &bull; Barcode: {item.barcode || 'Non-barcode'}
                          </div>
                        </div>

                        {/* Indikator Stok Badge */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: '0.85rem',
                              fontWeight: 900,
                              padding: '2px 8px',
                              borderRadius: 6,
                              backgroundColor: isZero ? '#fee2e2' : isLow ? '#fef3c7' : '#dcfce7',
                              color: isZero ? '#ef4444' : isLow ? '#b45309' : '#15803d',
                            }}
                          >
                            {item.stockQty} {item.unit}
                          </span>
                          <div
                            style={{
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              color: isZero ? '#ef4444' : isLow ? '#d97706' : '#16a34a',
                              marginTop: 2,
                            }}
                          >
                            {isZero ? 'HABIS' : isLow ? 'KRITIS' : 'AMAN'}
                          </div>
                        </div>
                      </div>

                      {/* Baris 2: Radar Kedaluwarsa FEFO */}
                      {item.nearestExpiryDate && (
                        <div
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '0.72rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor:
                              item.expiryUrgency === 'EXPIRED'
                                ? '#fee2e2'
                                : item.expiryUrgency === 'CRITICAL'
                                ? '#ffedd5'
                                : item.expiryUrgency === 'WARNING'
                                ? '#fef9c3'
                                : '#f1f5f9',
                            color:
                              item.expiryUrgency === 'EXPIRED'
                                ? '#991b1b'
                                : item.expiryUrgency === 'CRITICAL'
                                ? '#c2410c'
                                : item.expiryUrgency === 'WARNING'
                                ? '#854d0e'
                                : '#475569',
                            border:
                              item.expiryUrgency === 'EXPIRED'
                                ? '1px solid #f87171'
                                : item.expiryUrgency === 'CRITICAL'
                                ? '1px solid #fb923c'
                                : '1px solid #e2e8f0',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                            <Clock size={13} />
                            <span>
                              Exp Terdekat: <strong>{item.nearestExpiryDate}</strong>
                            </span>
                          </div>
                          <span style={{ fontWeight: 800, fontSize: '0.68rem' }}>
                            {item.expiryUrgency === 'EXPIRED'
                              ? '🚨 SUDAH EXPIRED'
                              : item.expiryUrgency === 'CRITICAL'
                              ? '⚠️ < 7 HARI (FEFO)'
                              : item.expiryUrgency === 'WARNING'
                              ? '🟡 < 30 HARI'
                              : 'AMAN'}
                          </span>
                        </div>
                      )}

                      {/* Baris 3: Tombol Aksi Restock */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                        <button
                          type="button"
                          onClick={() => openRestockModal(item)}
                          className="btn btn-primary"
                          style={{
                            padding: '6px 14px',
                            borderRadius: 8,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor: 'hsl(217 91% 60%)',
                            color: '#fff',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            cursor: 'pointer',
                          }}
                        >
                          <Plus size={14} />
                          <span>Restock / Barang Masuk</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* ── MODAL RESTOCK / INBOUND BARANG MASUK ── */}
      {selectedProduct && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              backgroundColor: '#ffffff',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: '20px 18px',
              boxShadow: '0 -4px 16px rgb(0 0 0 / 0.15)',
              maxHeight: '90vh',
              overflowY: 'auto',
              animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Header Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: 'hsl(217 91% 95%)',
                    color: 'hsl(217 91% 40%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Plus size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                    Input Restock Barang
                  </h3>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Tercatat atas nama: {employee?.name || 'Petugas Gudang'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  padding: 6,
                  cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Info Produk Terpilih */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                {selectedProduct.name}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                Barcode: {selectedProduct.barcode || 'Non-barcode'} &bull; Stok Sekarang:{' '}
                <strong>
                  {selectedProduct.stockQty} {selectedProduct.unit}
                </strong>
              </div>
            </div>

            {/* Feedback Sukses */}
            {restockSuccessMsg ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: 10,
                  backgroundColor: '#dcfce7',
                  border: '1px solid #22c55e',
                  color: '#15803d',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CheckCircle2 size={18} />
                <span>{restockSuccessMsg}</span>
              </div>
            ) : (
              <form onSubmit={handleRestockSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Input Qty Masuk */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Jumlah Barang Masuk ({selectedProduct.unit}) <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => setRestockQty((prev) => Math.max(1, prev - 1))}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f1f5f9',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={restockQty}
                      onChange={(e) => setRestockQty(Math.max(1, Number(e.target.value)))}
                      style={{
                        flex: 1,
                        height: 44,
                        textAlign: 'center',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        fontSize: '1.1rem',
                        fontWeight: 800,
                      }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setRestockQty((prev) => prev + 1)}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f1f5f9',
                        fontSize: '1.2rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      +
                    </button>
                  </div>

                  {/* Tombol Cepat Tambah */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {[5, 10, 24, 48].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRestockQty(n)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: '0.7rem',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          color: '#475569',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        +{n} pcs
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Tanggal Expired (FEFO) */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Tanggal Kedaluwarsa / Expired (Wajib untuk Makanan/Minuman)
                  </label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    style={{
                      width: '100%',
                      height: 42,
                      padding: '0 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                    }}
                  />
                  <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>
                    Membantu sistem menyusun antrean display FEFO (First Expired First Out).
                  </div>
                </div>

                {/* Input Catatan Opsional */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                    Catatan Penerimaan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Contoh: Titipan Bu Siti / Faktur No. 12"
                    style={{
                      width: '100%',
                      height: 40,
                      padding: '0 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                    }}
                    maxLength={200}
                  />
                </div>

                {/* Kalkulasi Perubahan Stok */}
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    fontSize: '0.75rem',
                    color: '#1e40af',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Stok Sistem Setelah Restock:</span>
                  <strong>
                    {selectedProduct.stockQty + Number(restockQty)} {selectedProduct.unit}
                  </strong>
                </div>

                {/* Tombol Submit & Batal */}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(null)}
                    className="btn btn-secondary"
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#f1f5f9',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    disabled={submittingRestock}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{
                      flex: 2,
                      height: 44,
                      borderRadius: 10,
                      backgroundColor: 'hsl(217 91% 60%)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                    disabled={submittingRestock}
                  >
                    {submittingRestock ? (
                      <>
                        <RefreshCw size={16} className="spin-icon" />
                        <span>Menyimpan...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        <span>Simpan Stok Masuk</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL KAMERA SCANNER BARCODE ── */}
      {isScanning && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            backgroundColor: '#000000',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header Scanner */}
          <div
            style={{
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Barcode size={20} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Arahkan Kamera ke Barcode</span>
            </div>
            <button
              type="button"
              onClick={stopScanner}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#fff',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Area Video Viewfinder */}
          <div
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />

            {/* Kotak Bidik Scanner */}
            <div
              style={{
                position: 'absolute',
                width: '75%',
                maxWidth: 280,
                height: 180,
                border: '2px solid hsl(217 91% 60%)',
                borderRadius: 16,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                pointerEvents: 'none',
              }}
            />

            {cameraError && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 20,
                  right: 20,
                  padding: 12,
                  backgroundColor: 'rgba(239,68,68,0.9)',
                  color: '#fff',
                  borderRadius: 10,
                  fontSize: '0.8rem',
                  textAlign: 'center',
                }}
              >
                {cameraError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
