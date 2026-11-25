'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Calculator, QrCode, AlertTriangle,
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

const recapMemCache = new Map<string, CashierRecapResponseDTO>();

function makeRecapCacheKey(targetDate: string, shiftId: string, targetPage: number): string {
  return `${targetDate}::${shiftId || 'default'}::${targetPage}`;
}

export default function CashierRecapPage() {
  const router = useRouter();

  // Waktu Hari Ini (WIB)
  const todayWIB = (() => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  })();

  const initialCacheKey = makeRecapCacheKey(todayWIB, '', 1);
  const [tanggal, setTanggal] = useState(todayWIB);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CashierRecapResponseDTO | null>(
    () => recapMemCache.get(initialCacheKey) ?? null,
  );
  const [loading, setLoading] = useState<boolean>(() => !recapMemCache.has(initialCacheKey));
  const [error, setError] = useState<string | null>(null);
  const [titipanRows, setTitipanRows] = useState<Array<{
    id: string;
    mitraName: string;
    productName: string;
    qtyInitial: number;
    qtySoldPos: number;
    qtySoldPhysical: number | null;
    qtyRemaining: number | null;
    qtyDiscrepancy: number;
    totalPayout: number;
    status: string;
  }>>([]);

  useEffect(() => {
    let active = true;
    fetch(`/api/kasir/titipan?date=${tanggal}&catalog=0`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!active || !j?.success) return;
        setTitipanRows([...(j.data?.carryoverEntries ?? []), ...(j.data?.todayEntries ?? [])]);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [tanggal]);

  const applyRecapResult = useCallback(
    (result: Awaited<ReturnType<typeof requestRecap>>, cacheKey?: string) => {
      if (result.status === 'unauthorized') {
        router.push('/kasir/login');
        return;
      }
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      if (cacheKey) {
        recapMemCache.set(cacheKey, result.data);
      }
      setError(null);
      setData(result.data);
    },
    [router],
  );

  const fetchRecap = useCallback(async (targetDate: string, shiftId: string, targetPage: number) => {
    const cKey = makeRecapCacheKey(targetDate, shiftId, targetPage);
    if (!recapMemCache.has(cKey)) setLoading(true);
    setError(null);
    try {
      const result = await requestRecap(targetDate, shiftId, targetPage);
      applyRecapResult(result, cKey);
    } catch {
      setError('Terjadi kendala jaringan saat memuat rekapitulasi kasir.');
    } finally {
      setLoading(false);
    }
  }, [applyRecapResult]);

  useEffect(() => {
    const controller = new AbortController();
    const cKey = makeRecapCacheKey(tanggal, selectedShiftId, page);

    requestRecap(tanggal, selectedShiftId, page, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          applyRecapResult(result, cKey);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Terjadi kendala jaringan saat memuat rekapitulasi kasir.');
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
    const cached = recapMemCache.get(makeRecapCacheKey(newDate, '', 1));
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
  };

  const handleShiftChange = (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setPage(1);
    const cached = recapMemCache.get(makeRecapCacheKey(tanggal, shiftId, 1));
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
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
              <span>Rekap Shift</span>
            </div>
            {data && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong style={{ color: 'var(--color-text)' }}>{data.kasir.fullName}</strong> · {data.kasir.nim}
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
            <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
            <span className="kasir-hide-mobile">Segarkan</span>
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
            <span>Cetak Slip</span>
          </button>
        </div>
      </header>

      {/* ── Main Dashboard Container ── */}
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '16px 16px 20px' }}>

        {/* ── Navigasi Terpadu Rekap & Detail Struk ── */}
        <div className="no-print rep-seg" style={{ width: '100%', maxWidth: 420, marginBottom: 14 }}>
          <span
            className="rep-seg-btn active"
            style={{ flex: 1, textAlign: 'center', cursor: 'default' }}
          >
            Rekap &amp; Cetak
          </span>
          <Link
            href="/kasir/riwayat"
            className="rep-seg-btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
          >
            Detail Struk &amp; WA
          </Link>
        </div>

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
            <Loader2 size={24} className="spin-icon" />
            <span style={{ fontSize: 14 }}>Memuat rekap shift...</span>
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

        {/* ── Ringkasan Riwayat: Cash, QRIS, & Modal Awal ── */}
        {!loading && s && (
          <>
            {/* ── RINGKASAN SALDO KAS KOTAK SHIFT ── */}
            <div className="rekap-card no-print" style={{
              background: 'hsl(150 45% 96%)',
              border: '1.5px solid hsl(150 55% 68%)',
              borderRadius: 16,
              padding: '16px 18px',
              marginBottom: 16,
              boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 10, borderBottom: '1px solid hsl(150 35% 84%)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ background: 'hsl(150 60% 88%)', padding: 8, borderRadius: 10, color: 'hsl(150 80% 26%)', flexShrink: 0 }}>
                    <HandCoins size={20} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text)' }}>
                      {activeShift?.status === 'ACTIVE' ? 'Target Uang Fisik di Kotak (Blind Count)' : 'Estimasi Uang Fisik di Kotak'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {activeShift?.status === 'ACTIVE'
                        ? 'Nominal target disembunyikan selama shift aktif — hitung uang fisik di kotak saat Tutup Shift'
                        : 'Modal Awal + Tunai − Kas Keluar + Kas Masuk'}
                    </div>
                  </div>
                </div>
                <div style={{
                  background: activeShift?.status === 'ACTIVE' ? 'hsl(38 92% 92%)' : 'hsl(150 65% 88%)',
                  border: activeShift?.status === 'ACTIVE' ? '1px solid hsl(38 78% 72%)' : '1px solid hsl(150 60% 62%)',
                  padding: '6px 14px',
                  borderRadius: 10,
                  fontSize: activeShift?.status === 'ACTIVE' ? 13 : 18,
                  fontWeight: 900,
                  color: activeShift?.status === 'ACTIVE' ? 'hsl(28 84% 28%)' : 'hsl(150 85% 18%)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {activeShift?.status === 'ACTIVE' ? 'Terkunci (Shift Aktif)' : rp(s.totalFisikLaci)}
                </div>
              </div>

              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                Hitung semua uang tunai di kotak termasuk modal awal. Catat pembayaran supplier, titipan, atau pengambilan uang di menu <strong>Kas Laci</strong> agar saldo tetap cocok.
              </div>
            </div>

            {/* ── GRID RINCIAN ARUS KAS SHIFT (2x2 di HP, 4-kolom di Desktop) ── */}
            <div className="no-print rep-kpi-grid" style={{ marginBottom: 20 }}>
              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Modal Awal</span>
                  <Coins size={14} style={{ color: 'hsl(38 92% 32%)' }} />
                </div>
                <div className="rep-kpi__val">{rp(s.modalAwal)}</div>
                <div className="rep-kpi__sub">Uang awal di kotak</div>
              </div>

              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Tunai (+)</span>
                  <TrendingUp size={14} style={{ color: 'hsl(150 75% 30%)' }} />
                </div>
                <div className="rep-kpi__val" style={{ color: 'hsl(150 75% 26%)' }}>{rp(s.netCashSales)}</div>
                <div className="rep-kpi__sub">{s.totalTransaksi} transaksi</div>
              </div>

              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Kas Keluar (-)</span>
                  <TrendingDown size={14} style={{ color: 'hsl(0 72% 40%)' }} />
                </div>
                <div className="rep-kpi__val" style={{ color: s.totalCashOut > 0 ? 'hsl(0 72% 38%)' : '#0f172a' }}>
                  {s.totalCashOut > 0 ? `-${rp(s.totalCashOut)}` : 'Rp 0'}
                </div>
                <div className="rep-kpi__sub">Supplier &amp; operasional</div>
              </div>

              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">QRIS</span>
                  <QrCode size={14} style={{ color: 'hsl(200 85% 34%)' }} />
                </div>
                <div className="rep-kpi__val">{rp(s.totalAmountQris)}</div>
                <div className="rep-kpi__sub">Omzet {rp(s.totalOmzet)}</div>
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
                <>
                  <div className="rep-desktop-only" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
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

                  {/* Mobile Cards — Transaksi */}
                  <div className="rep-mobile-only" style={{ padding: 12 }}>
                    {data.transaksi.map((t: CashierRecapItemDTO) => {
                      const isSplit = t.payments.length > 1;
                      return (
                        <div
                          key={t.id}
                          className="rep-mcard"
                          style={{ background: t.isVoid ? 'hsl(0 84% 98%)' : '#ffffff' }}
                        >
                          <div className="rep-mcard__top">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: t.isVoid ? 'hsl(0 72% 38%)' : 'var(--color-text)' }}>
                                {t.invoiceNumber}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {fmtWaktu(t.createdAt)} WIB · {t.itemCount} jenis produk
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                                {rp(t.grossAmount)}
                              </div>
                              <span style={{
                                display: 'inline-block',
                                marginTop: 2,
                                padding: '2px 7px',
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 700,
                                background: isSplit ? 'hsl(260 70% 94%)' : t.paymentMethod === 'CASH' ? 'hsl(150 65% 92%)' : 'hsl(200 80% 92%)',
                                color: isSplit ? 'hsl(260 65% 35%)' : t.paymentMethod === 'CASH' ? 'hsl(150 75% 24%)' : 'hsl(200 85% 28%)',
                              }}>
                                {isSplit ? 'SPLIT' : t.paymentMethod}
                              </span>
                            </div>
                          </div>
                          <div className="rep-mcard__grid">
                            <div>
                              <div className="rep-mcard__k">Kembalian</div>
                              <div className="rep-mcard__v">{t.changeAmount ? rp(t.changeAmount) : '-'}</div>
                            </div>
                            <div>
                              <div className="rep-mcard__k">Status</div>
                              <div className="rep-mcard__v" style={{ color: t.status === 'COMPLETED' ? 'hsl(150 75% 28%)' : 'hsl(0 75% 38%)' }}>
                                {t.status === 'COMPLETED' ? 'Selesai' : 'VOID'}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
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

            {/* ── BAGIAN TERAKHIR CLOSING: REKAPITULASI PERGERAKAN BARANG PENUTUPAN SHIFT ── */}
            {(() => {
              const itemsRecap = data.closingProductRecap ?? [];
              const totalMasuk = itemsRecap.reduce((acc, r) => acc + r.qtyReceived, 0);
              const totalLaku = itemsRecap.reduce((acc, r) => acc + r.qtySold, 0);
              const totalOmzetBarang = itemsRecap.reduce((acc, r) => acc + r.omzetSold, 0);
              const totalRetur = itemsRecap.reduce((acc, r) => acc + r.qtyReturned, 0);

              return (
                <div
                  className="no-print"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 18,
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-sm)',
                    marginTop: 20,
                  }}
                >
                  <div
                    style={{
                      padding: '18px 20px',
                      borderBottom: '1px solid var(--color-border)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--color-text)' }}>
                        Rekap Barang
                      </h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Barang masuk, terjual, retur, dan sisa stok
                      </p>
                    </div>

                    <Link
                      href="/gudang"
                      style={{
                        minHeight: 40,
                        padding: '8px 14px',
                        borderRadius: 10,
                        border: '1px solid var(--color-primary)',
                        background: 'var(--color-primary-light)',
                        color: 'var(--color-primary)',
                        fontSize: 12,
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      Buka Gudang
                    </Link>
                  </div>

                  {/* Ringkasan Angka Cepat */}
                  <div
                    className="rep-kpi-grid rep-kpi-grid--3"
                    style={{
                      padding: '12px 16px',
                      marginBottom: 0,
                      background: 'var(--color-surface-muted)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <div className="rep-kpi">
                      <span className="rep-kpi__label">Barang Masuk</span>
                      <div className="rep-kpi__val" style={{ color: 'hsl(200 85% 32%)' }}>
                        {totalMasuk.toLocaleString('id-ID')} pcs
                      </div>
                    </div>
                    <div className="rep-kpi">
                      <span className="rep-kpi__label">Terjual</span>
                      <div className="rep-kpi__val" style={{ color: 'hsl(150 75% 28%)' }}>
                        {totalLaku.toLocaleString('id-ID')} pcs
                      </div>
                      <div className="rep-kpi__sub">{rp(totalOmzetBarang)}</div>
                    </div>
                    <div className="rep-kpi">
                      <span className="rep-kpi__label">Retur / Rusak</span>
                      <div className="rep-kpi__val" style={{ color: totalRetur > 0 ? 'hsl(0 75% 42%)' : '#0f172a' }}>
                        {totalRetur.toLocaleString('id-ID')} pcs
                      </div>
                    </div>
                  </div>

                  {itemsRecap.length === 0 ? (
                    <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                      Belum ada pergerakan barang pada tanggal ini.
                    </div>
                  ) : (
                    <>
                      <div className="rep-desktop-only" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
                          <thead>
                            <tr style={{ background: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)', textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                              <th style={{ padding: '12px 18px', fontWeight: 700 }}>Nama Produk &amp; Pemasok</th>
                              <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right' }}>Diterima (Faktur)</th>
                              <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right' }}>Terjual (POS)</th>
                              <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right' }}>Diretur</th>
                              <th style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right' }}>Nilai Penjualan (Rp)</th>
                              <th style={{ padding: '12px 18px', fontWeight: 700, textAlign: 'right' }}>Saldo Stok Akhir</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itemsRecap.map((item) => (
                              <tr key={item.productId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '12px 18px' }}>
                                  <div style={{ fontWeight: 700, color: 'var(--color-text)' }}>{item.productName}</div>
                                  {item.supplierName && (
                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                      Pemasok: {item.supplierName}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: item.qtyReceived > 0 ? 'hsl(200 85% 32%)' : 'var(--color-text-muted)' }}>
                                  {item.qtyReceived > 0 ? `+${item.qtyReceived} ${item.unit}` : '-'}
                                </td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: item.qtySold > 0 ? 'hsl(150 75% 28%)' : 'var(--color-text-muted)' }}>
                                  {item.qtySold > 0 ? `${item.qtySold} ${item.unit}` : '0'}
                                </td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: item.qtyReturned > 0 ? 'hsl(0 75% 42%)' : 'var(--color-text-muted)' }}>
                                  {item.qtyReturned > 0 ? `${item.qtyReturned} ${item.unit}` : '0'}
                                </td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text)' }}>
                                  {item.omzetSold > 0 ? rp(item.omzetSold) : '-'}
                                </td>
                                <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                  {item.stockRemaining} {item.unit}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: 'var(--color-surface-muted)', borderTop: '2px solid var(--color-border)', fontWeight: 800 }}>
                              <td style={{ padding: '12px 18px' }}>TOTAL REKAPITULASI BARANG ({itemsRecap.length} produk)</td>
                              <td style={{ padding: '12px 14px', textAlign: 'right', color: 'hsl(200 85% 32%)' }}>
                                {totalMasuk} pcs
                              </td>
                              <td style={{ padding: '12px 14px', textAlign: 'right', color: 'hsl(150 75% 28%)' }}>
                                {totalLaku} pcs
                              </td>
                              <td style={{ padding: '12px 14px', textAlign: 'right', color: totalRetur > 0 ? 'hsl(0 75% 42%)' : 'var(--color-text)' }}>
                                {totalRetur} pcs
                              </td>
                              <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--color-text)' }}>
                                {rp(totalOmzetBarang)}
                              </td>
                              <td style={{ padding: '12px 18px' }} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* Mobile Cards — Rekap Barang */}
                      <div className="rep-mobile-only" style={{ padding: 12 }}>
                        {itemsRecap.map((item) => (
                          <div key={item.productId} className="rep-mcard">
                            <div className="rep-mcard__top">
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text)' }}>{item.productName}</div>
                                {item.supplierName && (
                                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.supplierName}</div>
                                )}
                              </div>
                              <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--color-text)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                {item.omzetSold > 0 ? rp(item.omzetSold) : '-'}
                              </div>
                            </div>
                            <div className="rep-mcard__grid rep-mcard__grid--4">
                              <div>
                                <div className="rep-mcard__k">Masuk</div>
                                <div className="rep-mcard__v" style={{ color: item.qtyReceived > 0 ? 'hsl(200 85% 32%)' : '#64748b' }}>
                                  {item.qtyReceived > 0 ? `+${item.qtyReceived}` : '-'}
                                </div>
                              </div>
                              <div>
                                <div className="rep-mcard__k">Laku</div>
                                <div className="rep-mcard__v" style={{ color: item.qtySold > 0 ? 'hsl(150 75% 28%)' : '#64748b' }}>
                                  {item.qtySold}
                                </div>
                              </div>
                              <div>
                                <div className="rep-mcard__k">Retur</div>
                                <div className="rep-mcard__v" style={{ color: item.qtyReturned > 0 ? 'hsl(0 75% 42%)' : '#64748b' }}>
                                  {item.qtyReturned}
                                </div>
                              </div>
                              <div>
                                <div className="rep-mcard__k">Sisa</div>
                                <div className="rep-mcard__v">{item.stockRemaining}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── RINGKASAN TITIPAN HARIAN ── */}
            {titipanRows.length > 0 && (
              <div
                className="no-print"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-sm)',
                  marginTop: 20,
                }}
              >
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', fontWeight: 800, fontSize: 15 }}>
                  Titipan Harian ({titipanRows.length})
                </div>
                <div className="rep-desktop-only" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 16px' }}>Mitra &amp; Produk</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Titip</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Laku</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Sisa</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Setor Mitra</th>
                        <th style={{ padding: '10px 16px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {titipanRows.map((tr) => (
                        <tr key={tr.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '10px 16px' }}>
                            <div style={{ fontWeight: 700 }}>{tr.productName}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{tr.mitraName}</div>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>{tr.qtyInitial}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                            {tr.qtySoldPhysical ?? tr.qtySoldPos}
                            {tr.qtyDiscrepancy !== 0 && (
                              <span style={{ display: 'block', fontSize: 11, color: 'hsl(0 72% 42%)' }}>
                                Selisih {tr.qtyDiscrepancy > 0 ? `+${tr.qtyDiscrepancy}` : tr.qtyDiscrepancy}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>{tr.qtyRemaining ?? '-'}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{rp(tr.totalPayout)}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 700, fontSize: 11 }}>
                            {tr.status === 'SETTLED' ? 'Selesai' : tr.status === 'CARRYOVER' ? 'Susulan' : 'Aktif'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards — Titipan Harian */}
                <div className="rep-mobile-only" style={{ padding: 12 }}>
                  {titipanRows.map((tr) => (
                    <div key={tr.id} className="rep-mcard">
                      <div className="rep-mcard__top">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{tr.productName}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{tr.mitraName}</div>
                        </div>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: tr.status === 'SETTLED' ? 'hsl(150 65% 92%)' : tr.status === 'CARRYOVER' ? 'hsl(38 95% 92%)' : 'var(--color-surface-muted)',
                          color: tr.status === 'SETTLED' ? 'hsl(150 75% 26%)' : tr.status === 'CARRYOVER' ? 'hsl(32 85% 30%)' : 'var(--color-text-secondary)',
                          flexShrink: 0,
                        }}>
                          {tr.status === 'SETTLED' ? 'Selesai' : tr.status === 'CARRYOVER' ? 'Susulan' : 'Aktif'}
                        </span>
                      </div>
                      <div className="rep-mcard__grid rep-mcard__grid--4">
                        <div>
                          <div className="rep-mcard__k">Titip</div>
                          <div className="rep-mcard__v">{tr.qtyInitial}</div>
                        </div>
                        <div>
                          <div className="rep-mcard__k">Laku</div>
                          <div className="rep-mcard__v">
                            {tr.qtySoldPhysical ?? tr.qtySoldPos}
                            {tr.qtyDiscrepancy !== 0 && (
                              <span style={{ display: 'block', fontSize: 10, color: 'hsl(0 72% 42%)' }}>
                                ({tr.qtyDiscrepancy > 0 ? `+${tr.qtyDiscrepancy}` : tr.qtyDiscrepancy})
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="rep-mcard__k">Sisa</div>
                          <div className="rep-mcard__v">{tr.qtyRemaining ?? '-'}</div>
                        </div>
                        <div>
                          <div className="rep-mcard__k">Setor</div>
                          <div className="rep-mcard__v">{rp(tr.totalPayout)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                SERAH TERIMA KAS SHIFT
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>1. TINGGAL DI LACI</span>
                <span>{rp(s.uangTinggalDiLaci)}</span>
              </div>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 4 }}>
                *Modal awal kasir shift berikutnya
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 13 }}>
                <span>2. SETORAN TUNAI</span>
                <span>{rp(s.uangSetoranToko)}</span>
              </div>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 8 }}>
                *Disetor ke amplop &amp; serahkan ke Pengelola
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
