'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Calculator, Banknote, QrCode, AlertTriangle,
  Receipt, Calendar, Loader2, ArrowLeft, ArrowRight,
  Printer, RefreshCw, CheckCircle2, XCircle, Clock,
  Coins, Sparkles, TrendingDown, TrendingUp, HandCoins,
} from 'lucide-react';
import type {
  CashierRecapResponseDTO,
  CashierRecapItemDTO,
  CashierShiftInfoDTO,
} from '@/lib/services/cashierRecapService';

// ── Helpers Pemformatan ──────────────────────────────────────
const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

const fmtWaktu = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '-';
  }
};

const fmtTanggalPanjang = (tgl: string) => {
  try {
    return new Date(tgl + 'T00:00:00+07:00').toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return tgl;
  }
};

export default function CashierRecapPage() {
  const router = useRouter();

  // Waktu Hari Ini (WIB)
  const todayWIB = (() => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  })();

  const [tanggal, setTanggal] = useState(todayWIB);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CashierRecapResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecap = useCallback(async (targetDate: string, shiftId: string, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const shiftQuery = shiftId ? `&shiftId=${shiftId}` : '';
      const res = await fetch(`/api/kasir/rekap-harian?tanggal=${targetDate}${shiftQuery}&page=${targetPage}&limit=15`);
      
      if (res.status === 401 || res.status === 403) {
        router.push('/kasir/login');
        return;
      }
      
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Gagal memuat rekap kasir.');
        return;
      }
      
      setData(json.data);
      // Sinkronisasi active shift id jika belum dipilih
      if (!shiftId && json.data.activeShiftId) {
        setSelectedShiftId(json.data.activeShiftId);
      }
    } catch {
      setError('Terjadi kendala jaringan saat memuat rekap kasir.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchRecap(tanggal, selectedShiftId, page);
  }, [tanggal, selectedShiftId, page, fetchRecap]);

  const handleDateChange = (newDate: string) => {
    setTanggal(newDate);
    setSelectedShiftId('');
    setPage(1);
  };

  const handleShiftChange = (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setPage(1);
  };

  const s = data?.summary;
  const activeShift = data?.shiftsSaya?.find((sh) => sh.id === selectedShiftId) ?? data?.shiftsSaya?.[0];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg, #0f172a)', color: 'var(--color-text, #f8fafc)', paddingBottom: 48 }}>
      
      {/* ── CSS Khusus Print (Slip Kasir Thermal & A4) ── */}
      <style jsx global>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .rekap-card {
            border: 1px solid #000 !important;
            box-shadow: none !important;
            background: #fff !important;
            color: #000 !important;
          }
        }
        @media screen {
          .print-only {
            display: none !important;
          }
        }
      `}</style>

      {/* ── Top Header Bar ── */}
      <header className="no-print" style={{
        background: 'var(--color-surface, #1e293b)',
        borderBottom: '1px solid var(--color-border, #334155)',
        padding: '14px 20px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => router.push('/kasir/pos')}
            style={{
              background: 'hsl(220 15% 25% / 0.8)',
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 8,
              padding: 8,
              color: 'var(--color-text, #f8fafc)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Kembali ke POS Kasir"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calculator size={18} style={{ color: 'hsl(150, 80%, 45%)' }} />
              Rekapitulasi Shift Saya
            </div>
            {data && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
                Kasir: <strong style={{ color: 'var(--color-text, #f8fafc)' }}>{data.kasir.fullName}</strong> ({data.kasir.nim})
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => fetchRecap(tanggal, selectedShiftId, page)}
            disabled={loading}
            style={{
              background: 'hsl(220 15% 25% / 0.8)',
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text, #f8fafc)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            style={{
              background: 'hsl(150 80% 40%)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
            }}
          >
            <Printer size={15} />
            <span>Cetak Slip Rekap</span>
          </button>
        </div>
      </header>

      {/* ── Area Cetak Struk Ringkas (Print-Only) ── */}
      <div className="print-only" style={{ padding: 20, maxWidth: 360, margin: '0 auto', fontSize: 12, color: '#000' }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 'bold', margin: 0 }}>SMARTKASIR PERWIRA</h2>
          <div style={{ fontSize: 12 }}>WIRAMART UNPERBA</div>
          <div style={{ fontSize: 11, borderBottom: '1px dashed #000', paddingBottom: 6 }}>
            SLIP REKAPITULASI FISIK KASIR
          </div>
        </div>
        <div style={{ marginBottom: 10, lineHeight: 1.4 }}>
          <div>Kasir: {data?.kasir.fullName} ({data?.kasir.nim})</div>
          <div>Sesi: {data?.activeShiftName ?? 'Shift Kerja'}</div>
          <div>Tanggal: {fmtTanggalPanjang(tanggal)}</div>
          <div>Waktu Cetak: {new Date().toLocaleTimeString('id-ID')} WIB</div>
        </div>
        <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '8px 0', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Modal Awal Kasir:</span>
            <strong>{rp(s?.modalAwal ?? 100000)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Total Struk Selesai:</span>
            <strong>{s?.totalTransaksi ?? 0} transaksi</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span>Penjualan Tunai (Bersih):</span>
            <span>{rp(s?.netCashSales ?? 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: 4, paddingTop: 4, borderTop: '1px dotted #000' }}>
            <span>TOTAL FISIK DI LACI:</span>
            <span>{rp(s?.totalFisikLaci ?? 0)}</span>
          </div>
          <div style={{ fontSize: 10, color: '#444', fontStyle: 'italic', marginBottom: 4 }}>
            *(Wajib ada di laci: Modal Awal + Tunai Bersih)
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span>Penjualan QRIS:</span>
            <span>{rp(s?.totalAmountQris ?? 0)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginTop: 4, paddingTop: 4, borderTop: '1px dotted #000' }}>
            <span>TOTAL OMZET SHIFT:</span>
            <span>{rp(s?.totalOmzet ?? 0)}</span>
          </div>
          {Number(s?.totalVoid ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', marginTop: 4 }}>
              <span>Transaksi VOID:</span>
              <span>{s?.totalVoid} struk ({rp(s?.totalVoidAmount ?? 0)})</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11 }}>
          <p>Tanda Tangan Kasir Bertugas,</p>
          <div style={{ height: 40 }}></div>
          <p>({data?.kasir.fullName})</p>
        </div>
      </div>

      {/* ── Main Dashboard Container ── */}
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 16px' }}>

        {/* ── Filter Tanggal & Pilihan Shift Saya ── */}
        <section className="no-print" style={{
          background: 'var(--color-surface, #1e293b)',
          border: '1px solid var(--color-border, #334155)',
          borderRadius: 16,
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Calendar size={18} style={{ color: 'hsl(150, 80%, 45%)' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                  Tanggal Transaksi Kasir
                </div>
                <input
                  type="date"
                  value={tanggal}
                  max={todayWIB}
                  onChange={(e) => handleDateChange(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text, #f8fafc)',
                    fontSize: 15,
                    fontWeight: 700,
                    outline: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #cbd5e1)', background: 'hsl(220 15% 25% / 0.5)', padding: '6px 12px', borderRadius: 8 }}>
              {fmtTanggalPanjang(tanggal)}
            </div>
          </div>

          {/* ── Selector Shift Milik Kasir Ini (Jika ada lebih dari 1 shift) ── */}
          {data?.shiftsSaya && data.shiftsSaya.length > 0 && (
            <div style={{ borderTop: '1px solid var(--color-border, #334155)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', marginBottom: 8, textTransform: 'uppercase' }}>
                Sesi Shift Kerja Saya:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.shiftsSaya.map((sh: CashierShiftInfoDTO) => {
                  const isSelected = selectedShiftId === sh.id || (!selectedShiftId && data.activeShiftId === sh.id);
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      onClick={() => handleShiftChange(sh.id)}
                      style={{
                        background: isSelected ? 'hsl(150 80% 40% / 0.2)' : 'hsl(220 15% 22% / 0.6)',
                        border: isSelected ? '1px solid hsl(150 80% 45%)' : '1px solid var(--color-border, #334155)',
                        color: isSelected ? 'hsl(150 80% 55%)' : 'var(--color-text-secondary, #cbd5e1)',
                        padding: '8px 14px',
                        borderRadius: 10,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        transition: 'all 0.2s',
                      }}
                    >
                      <Clock size={14} />
                      <span>{sh.shiftName}</span>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 6,
                        background: sh.status === 'ACTIVE' ? 'hsl(150 80% 40% / 0.3)' : 'hsl(220 15% 35% / 0.5)',
                        color: sh.status === 'ACTIVE' ? 'hsl(150 80% 65%)' : '#cbd5e1',
                      }}>
                        {sh.status === 'ACTIVE' ? 'Sedang Aktif' : 'Selesai'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── Status Loading & Error Alert ── */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '40px 0', color: 'var(--color-text-muted, #94a3b8)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 14 }}>Mengkalkulasi transaksi & uang laci...</span>
          </div>
        )}

        {error && (
          <div style={{
            background: 'hsl(0 80% 50% / 0.15)',
            border: '1px solid hsl(0 80% 60% / 0.3)',
            borderRadius: 12,
            padding: '14px 18px',
            color: 'hsl(0 100% 75%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}>
            <AlertTriangle size={20} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{error}</span>
          </div>
        )}

        {/* ── Ringkasan Riwayat: Cash, QRIS, & Modal Awal (Sesuai Arahan Anda) ── */}
        {!loading && s && (
          <>
            {/* ── ALFA / INDOMARET HANDOVER ALLOCATION BANNER ── */}
            <div className="rekap-card no-print" style={{
              background: 'linear-gradient(135deg, hsl(220 30% 16%) 0%, hsl(220 25% 12%) 100%)',
              border: '1px solid hsl(150 80% 40% / 0.5)',
              borderRadius: 16,
              padding: '20px 24px',
              marginBottom: 20,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16, borderBottom: '1px solid hsl(220 20% 25%)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ background: 'hsl(150 80% 45% / 0.2)', padding: 8, borderRadius: 10, color: 'hsl(150 80% 55%)' }}>
                    <HandCoins size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text, #f8fafc)' }}>
                      Instruksi Serah Terima Shift (Standar Alfa / Indomaret)
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
                      Pisahkan uang fisik laci kasir menjadi 2 pos sebelum diserahkan ke kasir shift berikutnya
                    </div>
                  </div>
                </div>
                <div style={{
                  background: 'hsl(150 80% 40% / 0.15)',
                  border: '1px solid hsl(150 80% 45% / 0.4)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'hsl(150 80% 60%)',
                }}>
                  Total Fisik Seharusnya: {rp(s.totalFisikLaci)}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                {/* Pos 1: Tinggalkan di Laci */}
                <div style={{
                  background: 'hsl(220 25% 20% / 0.7)',
                  border: '1px solid hsl(45 90% 50% / 0.4)',
                  borderRadius: 12,
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'hsl(45 95% 65%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      1. Tinggalkan di Laci Kasir
                    </span>
                    <Coins size={16} style={{ color: 'hsl(45 95% 65%)' }} />
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#fef08a', marginBottom: 4 }}>
                    {rp(s.uangTinggalDiLaci)}
                  </div>
                  <div style={{ fontSize: 11, color: 'hsl(220 15% 75%)', lineHeight: 1.4 }}>
                    Modal paten uang kembalian untuk <strong>Kasir Shift Berikutnya</strong> (Jangan diambil).
                  </div>
                </div>

                {/* Pos 2: Setoran Tunai Toko */}
                <div style={{
                  background: 'hsl(150 80% 12% / 0.7)',
                  border: '1px solid hsl(150 80% 45% / 0.5)',
                  borderRadius: 12,
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'hsl(150 80% 65%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      2. Uang Setoran Tunai Toko
                    </span>
                    <Banknote size={16} style={{ color: 'hsl(150 80% 65%)' }} />
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#a7f3d0', marginBottom: 4 }}>
                    {rp(s.uangSetoranToko)}
                  </div>
                  <div style={{ fontSize: 11, color: 'hsl(150 40% 85%)', lineHeight: 1.4 }}>
                    Masukkan amplop setoran shift beserta struk rekap untuk <strong>Manajer / Brankas</strong>.
                  </div>
                </div>
              </div>
            </div>

            {/* ── GRID RINCIAN ARUS KAS SHIFT ── */}
            <div className="no-print" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
              marginBottom: 24,
            }}>
              {/* Card 1: Modal Awal Kasir */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface, #1e293b)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 16,
                padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(45 95% 65%)', textTransform: 'uppercase' }}>
                    Modal Awal Laci
                  </span>
                  <Coins size={16} style={{ color: 'hsl(45 95% 65%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text, #f8fafc)', marginBottom: 4 }}>
                  {rp(s.modalAwal)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
                  Paten uang receh buka shift
                </div>
              </div>

              {/* Card 2: Penjualan Tunai Bersih */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface, #1e293b)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 16,
                padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(150 80% 65%)', textTransform: 'uppercase' }}>
                    Penjualan Tunai (+)
                  </span>
                  <TrendingUp size={16} style={{ color: 'hsl(150 80% 65%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text, #f8fafc)', marginBottom: 4 }}>
                  {rp(s.netCashSales)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
                  Total {s.totalTransaksi} transaksi belanja
                </div>
              </div>

              {/* Card 3: Kas Keluar (Titipan Makanan, Beli Lepas, Galon) */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface, #1e293b)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 16,
                padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(0 90% 70%)', textTransform: 'uppercase' }}>
                    Kas Keluar Laci (-)
                  </span>
                  <TrendingDown size={16} style={{ color: 'hsl(0 90% 70%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.totalCashOut > 0 ? 'hsl(0 90% 70%)' : 'var(--color-text, #f8fafc)', marginBottom: 4 }}>
                  {s.totalCashOut > 0 ? `-${rp(s.totalCashOut)}` : 'Rp 0'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
                  Titipan makanan, beli lepas, galon
                </div>
              </div>

              {/* Card 4: Penjualan QRIS */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface, #1e293b)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 16,
                padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(200 90% 65%)', textTransform: 'uppercase' }}>
                    Penjualan QRIS
                  </span>
                  <QrCode size={16} style={{ color: 'hsl(200 90% 65%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text, #f8fafc)', marginBottom: 4 }}>
                  {rp(s.totalAmountQris)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
                  Total Omzet Kasir: <strong style={{ color: 'var(--color-text, #f8fafc)' }}>{rp(s.totalOmzet)}</strong>
                </div>
              </div>
            </div>

            {/* ── Tabel Riwayat Transaksi Kasir ── */}
            <div style={{
              background: 'var(--color-surface, #1e293b)',
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--color-border, #334155)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text, #f8fafc)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Receipt size={18} style={{ color: 'hsl(150 80% 45%)' }} />
                  Riwayat Struk Transaksi ({data.pagination.total} Transaksi)
                </div>
                {activeShift && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
                    {activeShift.shiftName}
                  </div>
                )}
              </div>

              {data.transaksi.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-muted, #94a3b8)' }}>
                  <Receipt size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text, #f8fafc)', marginBottom: 4 }}>
                    Belum Ada Riwayat Transaksi
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Tidak ada transaksi pada sesi shift ini.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'hsl(220 15% 18% / 0.5)', borderBottom: '1px solid var(--color-border, #334155)', color: 'var(--color-text-muted, #94a3b8)' }}>
                        <th style={{ padding: '12px 18px', fontWeight: 600 }}>No. Struk (Invoice)</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Waktu</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Metode</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Total Belanja</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Kembalian</th>
                        <th style={{ padding: '12px 18px', fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transaksi.map((t: CashierRecapItemDTO) => {
                        const isSplit = t.payments.length > 1;

                        return (
                          <tr
                            key={t.id}
                            style={{
                              borderBottom: '1px solid var(--color-border, #334155)',
                              background: t.isVoid ? 'hsl(0 80% 50% / 0.05)' : 'transparent',
                            }}
                          >
                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ fontWeight: 700, color: t.isVoid ? 'hsl(0 100% 75%)' : 'var(--color-text, #f8fafc)' }}>
                                {t.invoiceNumber}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
                                {t.itemCount} jenis produk
                              </div>
                            </td>

                            <td style={{ padding: '14px 16px', color: 'var(--color-text-secondary, #cbd5e1)' }}>
                              {fmtWaktu(t.createdAt)} WIB
                            </td>

                            <td style={{ padding: '14px 16px' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                background: isSplit
                                  ? 'hsl(260 80% 50% / 0.2)'
                                  : t.paymentMethod === 'CASH'
                                  ? 'hsl(150 80% 40% / 0.2)'
                                  : 'hsl(200 90% 50% / 0.2)',
                                color: isSplit
                                  ? 'hsl(260 80% 75%)'
                                  : t.paymentMethod === 'CASH'
                                  ? 'hsl(150 80% 65%)'
                                  : 'hsl(200 90% 70%)',
                              }}>
                                {isSplit ? 'SPLIT' : t.paymentMethod}
                              </span>
                            </td>

                            <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--color-text, #f8fafc)' }}>
                              {rp(t.grossAmount)}
                            </td>

                            <td style={{ padding: '14px 16px', color: 'var(--color-text-muted, #94a3b8)' }}>
                              {t.changeAmount ? rp(t.changeAmount) : '-'}
                            </td>

                            <td style={{ padding: '14px 18px' }}>
                              {t.status === 'COMPLETED' ? (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  color: 'hsl(150 80% 65%)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}>
                                  <CheckCircle2 size={14} />
                                  Selesai
                                </span>
                              ) : (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  color: 'hsl(0 100% 75%)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}>
                                  <XCircle size={14} />
                                  VOID
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Pagination Controls ── */}
              {data.pagination.totalPages > 1 && (
                <div className="no-print" style={{
                  padding: '14px 20px',
                  borderTop: '1px solid var(--color-border, #334155)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={data.pagination.page <= 1 || loading}
                    style={{
                      background: 'hsl(220 15% 25% / 0.8)',
                      border: '1px solid var(--color-border, #334155)',
                      borderRadius: 8,
                      padding: '6px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: data.pagination.page <= 1 ? 'var(--color-text-muted, #64748b)' : 'var(--color-text, #f8fafc)',
                      cursor: data.pagination.page <= 1 ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <ArrowLeft size={14} />
                    <span>Sebelumnya</span>
                  </button>

                  <span style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
                    Halaman <strong>{data.pagination.page}</strong> dari <strong>{data.pagination.totalPages}</strong>
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                    disabled={data.pagination.page >= data.pagination.totalPages || loading}
                    style={{
                      background: 'hsl(220 15% 25% / 0.8)',
                      border: '1px solid var(--color-border, #334155)',
                      borderRadius: 8,
                      padding: '6px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: data.pagination.page >= data.pagination.totalPages ? 'var(--color-text-muted, #64748b)' : 'var(--color-text, #f8fafc)',
                      cursor: data.pagination.page >= data.pagination.totalPages ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>Berikutnya</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* ── DEDICATED THERMAL PRINT SLIP (HANYA MUNCUL SAAT CETAK / PRINT) ── */}
            <div className="print-only" style={{
              width: '100%',
              maxWidth: 320,
              margin: '0 auto',
              fontFamily: 'monospace, "Courier New", Courier',
              fontSize: 12,
              lineHeight: 1.35,
              color: '#000000',
              padding: '10px 0',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 900 }}>WIRAMART UNPERBA</div>
                <div style={{ fontSize: 11 }}>Universitas Perwira Purbalingga</div>
                <div style={{ fontSize: 11, fontWeight: 700, margin: '4px 0' }}>SLIP REKAP SHIFT & SERAH TERIMA</div>
                <div style={{ borderBottom: '1px dashed #000', margin: '6px 0' }} />
              </div>

              <div style={{ fontSize: 11, marginBottom: 6 }}>
                <div>Kasir       : {data.kasir.fullName} ({data.kasir.nim})</div>
                <div>Sesi Shift  : {activeShift?.shiftName ?? 'Shift Aktif'}</div>
                <div>Tanggal     : {fmtTanggalPanjang(tanggal)}</div>
                <div>Dicetak     : {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB</div>
              </div>

              <div style={{ borderBottom: '1px dashed #000', margin: '6px 0' }} />

              <div style={{ fontWeight: 700, marginBottom: 4 }}>RINGKASAN PENJUALAN:</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Struk Selesai</span>
                <span>{s.totalTransaksi} Transaksi</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Struk VOID</span>
                <span>{s.totalVoid} Transaksi</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Omzet Tunai</span>
                <span>{rp(s.netCashSales)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Omzet QRIS</span>
                <span>{rp(s.totalAmountQris)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginTop: 2 }}>
                <span>TOTAL OMZET</span>
                <span>{rp(s.totalOmzet)}</span>
              </div>

              <div style={{ borderBottom: '1px dashed #000', margin: '6px 0' }} />

              <div style={{ fontWeight: 700, marginBottom: 4 }}>REKAP FISIK LACI KAS:</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Modal Awal Laci</span>
                <span>{rp(s.modalAwal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Penjualan Tunai (+)</span>
                <span>{rp(s.netCashSales)}</span>
              </div>
              {s.totalCashIn > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Kas Masuk (+)</span>
                  <span>{rp(s.totalCashIn)}</span>
                </div>
              )}
              {s.totalCashOut > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Kas Keluar/Titipan (-)</span>
                  <span>-{rp(s.totalCashOut)}</span>
                </div>
              )}
              <div style={{ borderTop: '1px dotted #000', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900 }}>
                <span>TOTAL FISIK LACI</span>
                <span>{rp(s.totalFisikLaci)}</span>
              </div>

              <div style={{ borderBottom: '1px solid #000', margin: '8px 0' }} />

              <div style={{ fontWeight: 900, textAlign: 'center', marginBottom: 4 }}>
                SOP SERAH TERIMA (ALFA / INDOMARET)
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>1. TINGGAL DI LACI</span>
                <span>{rp(s.uangTinggalDiLaci)}</span>
              </div>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 4 }}>
                *Modal paten kasir shift berikutnya
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 13 }}>
                <span>2. SETORAN TUNAI</span>
                <span>{rp(s.uangSetoranToko)}</span>
              </div>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 8 }}>
                *Disetor ke amplop + serahkan ke Manajer
              </div>

              <div style={{ borderBottom: '1px dashed #000', margin: '8px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', marginTop: 16 }}>
                <div>
                  <div style={{ fontSize: 10 }}>Kasir Bertugas,</div>
                  <div style={{ height: 40 }} />
                  <div style={{ borderTop: '1px solid #000', minWidth: 100 }}>
                    ({data.kasir.fullName.split(' ')[0]})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10 }}>Penerima / Shift Siang,</div>
                  <div style={{ height: 40 }} />
                  <div style={{ borderTop: '1px solid #000', minWidth: 100 }}>
                    ( ____________ )
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'center', fontSize: 9, marginTop: 16, color: '#666' }}>
                *** Terimakasih atas ketelitian Anda ***
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
