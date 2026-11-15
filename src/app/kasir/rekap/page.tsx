'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Calculator, Banknote, QrCode, AlertTriangle,
  Receipt, Calendar, Loader2, ArrowLeft, ArrowRight,
  Printer, RefreshCw, CheckCircle2, XCircle, Clock,
  Coins, TrendingDown, TrendingUp, HandCoins,
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

async function requestRecap(targetDate: string, shiftId: string, targetPage: number, signal?: AbortSignal) {
  const shiftQuery = shiftId ? `&shiftId=${shiftId}` : '';
  const res = await fetch(`/api/kasir/rekap-harian?tanggal=${targetDate}${shiftQuery}&page=${targetPage}&limit=15`, {
    signal,
  });
  if (res.status === 401 || res.status === 403) {
    return { status: 'unauthorized' as const };
  }
  const json = await res.json();
  if (!res.ok || !json.success) {
    return { status: 'error' as const, error: (json.error as string | undefined) ?? 'Gagal memuat rekap kasir.' };
  }
  return { status: 'ok' as const, data: json.data as CashierRecapResponseDTO };
}

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

  const applyRecapResult = useCallback(
    (result: Awaited<ReturnType<typeof requestRecap>>) => {
      if (result.status === 'unauthorized') {
        router.push('/kasir/login');
        return;
      }
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      setError(null);
      setData(result.data);
    },
    [router],
  );

  const fetchRecap = useCallback(async (targetDate: string, shiftId: string, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await requestRecap(targetDate, shiftId, targetPage);
      applyRecapResult(result);
    } catch {
      setError('Terjadi kendala jaringan saat memuat rekap kasir.');
    } finally {
      setLoading(false);
    }
  }, [applyRecapResult]);

  useEffect(() => {
    const controller = new AbortController();

    requestRecap(tanggal, selectedShiftId, page, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          applyRecapResult(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Terjadi kendala jaringan saat memuat rekap kasir.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [tanggal, selectedShiftId, page, applyRecapResult]);

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
  const effectiveShiftId = selectedShiftId || data?.activeShiftId || '';
  const activeShift = data?.shiftsSaya?.find((sh) => sh.id === effectiveShiftId) ?? data?.shiftsSaya?.[0];

  return (
    <div style={{ minHeight: '100svh', background: 'var(--color-bg)', color: 'var(--color-text)', paddingBottom: 48 }}>
      
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
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
          <button
            type="button"
            onClick={() => router.push('/kasir/pos')}
            style={{
              background: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              minWidth: 44,
              minHeight: 44,
              padding: 0,
              flexShrink: 0,
              color: 'var(--color-text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Kembali ke POS Kasir"
          >
            <ChevronLeft size={20} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calculator size={18} style={{ color: 'hsl(150 75% 32%)', flexShrink: 0 }} />
              <span>Rekapitulasi Shift Saya</span>
            </div>
            {data && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Kasir: <strong style={{ color: 'var(--color-text)' }}>{data.kasir.fullName}</strong> ({data.kasir.nim})
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => fetchRecap(tanggal, selectedShiftId, page)}
            disabled={loading}
            aria-label="Segarkan Data Rekap"
            style={{
              background: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              minWidth: 44,
              minHeight: 44,
              padding: '8px 12px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text)',
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            style={{
              background: 'hsl(150 75% 32%)',
              border: 'none',
              borderRadius: 10,
              minHeight: 44,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 700,
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 8px hsl(150 75% 32% / 0.25)',
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
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 16,
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Calendar size={18} style={{ color: 'hsl(150 75% 32%)' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                  Tanggal Transaksi Kasir
                </div>
                <input
                  type="date"
                  aria-label="Tanggal Transaksi Kasir"
                  value={tanggal}
                  max={todayWIB}
                  onChange={(e) => handleDateChange(e.target.value)}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    color: 'var(--color-text)',
                    fontSize: '1rem',
                    fontWeight: 700,
                    minHeight: 44,
                    padding: '6px 10px',
                    marginTop: 4,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)', padding: '8px 12px', borderRadius: 8 }}>
              {fmtTanggalPanjang(tanggal)}
            </div>
          </div>

          {/* ── Selector Shift Milik Kasir Ini (Jika ada lebih dari 1 shift) ── */}
          {data?.shiftsSaya && data.shiftsSaya.length > 0 && (
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
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
                        background: isSelected ? 'hsl(150 60% 94%)' : 'var(--color-surface-muted)',
                        border: isSelected ? '1.5px solid hsl(150 75% 32%)' : '1px solid var(--color-border)',
                        color: isSelected ? 'hsl(150 80% 22%)' : 'var(--color-text)',
                        minHeight: 44,
                        padding: '8px 14px',
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        transition: 'background-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      <Clock size={14} />
                      <span>{sh.shiftName}</span>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 6,
                        background: sh.status === 'ACTIVE' ? 'hsl(150 65% 86%)' : 'var(--color-surface)',
                        border: sh.status === 'ACTIVE' ? '1px solid hsl(150 60% 65%)' : '1px solid var(--color-border)',
                        color: sh.status === 'ACTIVE' ? 'hsl(150 80% 22%)' : 'var(--color-text-secondary)',
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '40px 0', color: 'var(--color-text-muted)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 14 }}>Mengkalkulasi transaksi & uang laci...</span>
          </div>
        )}

        {error && (
          <div style={{
            background: 'hsl(0 84% 96%)',
            border: '1px solid hsl(0 75% 80%)',
            borderRadius: 12,
            padding: '14px 18px',
            color: 'hsl(0 75% 32%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}>
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {/* ── Ringkasan Riwayat: Cash, QRIS, & Modal Awal (Sesuai Arahan Anda) ── */}
        {!loading && s && (
          <>
            {/* ── ALFA / INDOMARET HANDOVER ALLOCATION BANNER ── */}
            <div className="rekap-card no-print" style={{
              background: 'hsl(150 45% 96%)',
              border: '1.5px solid hsl(150 55% 68%)',
              borderRadius: 16,
              padding: '20px 24px',
              marginBottom: 20,
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16, borderBottom: '1px solid hsl(150 35% 84%)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ background: 'hsl(150 60% 88%)', padding: 8, borderRadius: 10, color: 'hsl(150 80% 26%)', flexShrink: 0 }}>
                    <HandCoins size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text)' }}>
                      Instruksi Serah Terima Shift (Standar Alfa / Indomaret)
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      Pisahkan uang fisik laci kasir menjadi 2 pos sebelum diserahkan ke kasir shift berikutnya
                    </div>
                  </div>
                </div>
                <div style={{
                  background: 'hsl(150 65% 88%)',
                  border: '1px solid hsl(150 60% 62%)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'hsl(150 85% 20%)',
                }}>
                  Total Fisik Seharusnya: {rp(s.totalFisikLaci)}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 14 }}>
                {/* Pos 1: Tinggalkan di Laci */}
                <div style={{
                  background: 'hsl(45 95% 94%)',
                  border: '1px solid hsl(42 85% 65%)',
                  borderRadius: 12,
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'hsl(35 90% 26%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      1. Tinggalkan di Laci Kasir
                    </span>
                    <Coins size={16} style={{ color: 'hsl(35 90% 28%)' }} />
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: 'hsl(30 95% 22%)', marginBottom: 4 }}>
                    {rp(s.uangTinggalDiLaci)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                    Modal paten uang kembalian untuk <strong>Kasir Shift Berikutnya</strong> (Jangan diambil).
                  </div>
                </div>

                {/* Pos 2: Setoran Tunai Toko */}
                <div style={{
                  background: 'hsl(150 60% 92%)',
                  border: '1px solid hsl(150 55% 62%)',
                  borderRadius: 12,
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'hsl(150 80% 22%)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      2. Uang Setoran Tunai Toko
                    </span>
                    <Banknote size={16} style={{ color: 'hsl(150 80% 24%)' }} />
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: 'hsl(150 85% 18%)', marginBottom: 4 }}>
                    {rp(s.uangSetoranToko)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                    Masukkan amplop setoran shift beserta struk rekap untuk <strong>Manajer / Brankas</strong>.
                  </div>
                </div>
              </div>
            </div>

            {/* ── GRID RINCIAN ARUS KAS SHIFT ── */}
            <div className="no-print" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: 14,
              marginBottom: 24,
            }}>
              {/* Card 1: Modal Awal Kasir */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                padding: '16px 18px',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(38 92% 30%)', textTransform: 'uppercase' }}>
                    Modal Awal Laci
                  </span>
                  <Coins size={16} style={{ color: 'hsl(38 92% 32%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)', marginBottom: 4 }}>
                  {rp(s.modalAwal)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Paten uang receh buka shift
                </div>
              </div>

              {/* Card 2: Penjualan Tunai Bersih */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                padding: '16px 18px',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(150 75% 28%)', textTransform: 'uppercase' }}>
                    Penjualan Tunai (+)
                  </span>
                  <TrendingUp size={16} style={{ color: 'hsl(150 75% 30%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)', marginBottom: 4 }}>
                  {rp(s.netCashSales)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Total {s.totalTransaksi} transaksi belanja
                </div>
              </div>

              {/* Card 3: Kas Keluar (Titipan Makanan, Beli Lepas, Galon) */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                padding: '16px 18px',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(0 72% 38%)', textTransform: 'uppercase' }}>
                    Kas Keluar Laci (-)
                  </span>
                  <TrendingDown size={16} style={{ color: 'hsl(0 72% 40%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.totalCashOut > 0 ? 'hsl(0 72% 38%)' : 'var(--color-text)', marginBottom: 4 }}>
                  {s.totalCashOut > 0 ? `-${rp(s.totalCashOut)}` : 'Rp 0'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Titipan makanan, beli lepas, galon
                </div>
              </div>

              {/* Card 4: Penjualan QRIS */}
              <div className="rekap-card" style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                padding: '16px 18px',
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'hsl(200 85% 32%)', textTransform: 'uppercase' }}>
                    Penjualan QRIS
                  </span>
                  <QrCode size={16} style={{ color: 'hsl(200 85% 34%)' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)', marginBottom: 4 }}>
                  {rp(s.totalAmountQris)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Total Omzet Kasir: <strong style={{ color: 'var(--color-text)' }}>{rp(s.totalOmzet)}</strong>
                </div>
              </div>
            </div>

            {/* ── Tabel Riwayat Transaksi Kasir ── */}
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Receipt size={18} style={{ color: 'hsl(150 75% 32%)' }} />
                  <span>Riwayat Struk Transaksi ({data.pagination.total} Transaksi)</span>
                </div>
                {activeShift && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {activeShift.shiftName}
                  </div>
                )}
              </div>

              {data.transaksi.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-muted)' }}>
                  <Receipt size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
                    Belum Ada Riwayat Transaksi
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Tidak ada transaksi pada sesi shift ini.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
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
                              borderBottom: '1px solid var(--color-border)',
                              background: t.isVoid ? 'hsl(0 84% 97%)' : 'transparent',
                            }}
                          >
                            <td style={{ padding: '14px 18px' }}>
                              <div style={{ fontWeight: 700, color: t.isVoid ? 'hsl(0 72% 38%)' : 'var(--color-text)' }}>
                                {t.invoiceNumber}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {t.itemCount} jenis produk
                              </div>
                            </td>

                            <td style={{ padding: '14px 16px', color: 'var(--color-text-secondary)' }}>
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
                                  ? 'hsl(260 70% 94%)'
                                  : t.paymentMethod === 'CASH'
                                  ? 'hsl(150 65% 92%)'
                                  : 'hsl(200 80% 92%)',
                                color: isSplit
                                  ? 'hsl(260 65% 35%)'
                                  : t.paymentMethod === 'CASH'
                                  ? 'hsl(150 75% 24%)'
                                  : 'hsl(200 85% 28%)',
                              }}>
                                {isSplit ? 'SPLIT' : t.paymentMethod}
                              </span>
                            </td>

                            <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--color-text)' }}>
                              {rp(t.grossAmount)}
                            </td>

                            <td style={{ padding: '14px 16px', color: 'var(--color-text-muted)' }}>
                              {t.changeAmount ? rp(t.changeAmount) : '-'}
                            </td>

                            <td style={{ padding: '14px 18px' }}>
                              {t.status === 'COMPLETED' ? (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  color: 'hsl(150 75% 28%)',
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
                                  color: 'hsl(0 75% 38%)',
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
                  borderTop: '1px solid var(--color-border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={data.pagination.page <= 1 || loading}
                    style={{
                      background: 'var(--color-surface-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      minHeight: 44,
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: data.pagination.page <= 1 ? 'var(--color-text-muted)' : 'var(--color-text)',
                      opacity: data.pagination.page <= 1 ? 0.55 : 1,
                      cursor: data.pagination.page <= 1 ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <ArrowLeft size={14} />
                    <span>Sebelumnya</span>
                  </button>

                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Halaman <strong>{data.pagination.page}</strong> dari <strong>{data.pagination.totalPages}</strong>
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                    disabled={data.pagination.page >= data.pagination.totalPages || loading}
                    style={{
                      background: 'var(--color-surface-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 10,
                      minHeight: 44,
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: data.pagination.page >= data.pagination.totalPages ? 'var(--color-text-muted)' : 'var(--color-text)',
                      opacity: data.pagination.page >= data.pagination.totalPages ? 0.55 : 1,
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
