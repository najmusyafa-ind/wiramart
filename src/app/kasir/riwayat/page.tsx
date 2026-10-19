'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, Receipt, Banknote, QrCode, Clock,
  TrendingUp, Package, ChevronDown, ChevronUp,
  Calendar, Loader2, AlertCircle, ShoppingBag,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────
type ItemTrx = {
  id: string;
  productNameSnapshot: string;
  qty: number;
  sellingPriceSnapshot: string;
  subtotalSell: string;
};

type PaymentTrx = {
  paymentMethod: 'CASH' | 'QRIS';
  amount: string;
  cashReceived: string | null;
  changeAmount: string | null;
};

type Transaksi = {
  id: string;
  invoiceNumber: string;
  paymentMethod: string;
  grossAmount: string;
  cashReceived: string | null;
  changeAmount: string | null;
  shiftId: string;
  createdAt: string;
  items: ItemTrx[];
  payments: PaymentTrx[];
};

type Summary = {
  jumlahStruk: number;
  totalOmzet: number;
  totalCash: number;
  totalQris: number;
  modalAwal: number | null;
  aktualKas: number | null;
  statusShift: string | null;
  clockIn: string | null;
  clockOut: string | null;
};

type RiwayatData = {
  kasir: { namaLengkap: string; jabatan: string; nim: string };
  tanggal: string;
  summary: Summary;
  transaksi: Transaksi[];
};

// ── Helpers ─────────────────────────────────────────────────
const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmt = (s: string | null) => {
  if (!s) return null;
  return new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
};
const fmtTanggal = (s: string) =>
  new Date(s + 'T00:00:00+07:00').toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
const fmtWaktu = (s: string) =>
  new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });

// ── Kartu Summary ────────────────────────────────────────────
function SummaryCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string;
}) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{value}</div>
      </div>
    </div>
  );
}

// ── Baris Transaksi ──────────────────────────────────────────
function TrxRow({ trx }: { trx: Transaksi }) {
  const [open, setOpen] = useState(false);
  const total = parseFloat(trx.grossAmount ?? '0');

  const hasCash = trx.payments.some((p) => p.paymentMethod === 'CASH');
  const hasQris = trx.payments.some((p) => p.paymentMethod === 'QRIS');
  const isSplit = hasCash && hasQris;

  const badgeColor = isSplit ? '#8b5cf6' : hasCash ? '#16a34a' : '#0ea5e9';
  const badgeLabel = isSplit ? 'SPLIT' : hasCash ? 'CASH' : 'QRIS';
  const BadgeIcon  = isSplit ? Banknote : hasCash ? Banknote : QrCode;

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header baris */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Ikon metode */}
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: badgeColor + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <BadgeIcon size={16} color={badgeColor} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)', marginBottom: 2 }}>
            {trx.invoiceNumber}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {fmtWaktu(trx.createdAt)} · {trx.items.length} item
          </div>
        </div>

        {/* Nominal + badge */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
            {rp(total)}
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 10, fontWeight: 600, color: badgeColor,
            background: badgeColor + '18', borderRadius: 6,
            padding: '2px 6px', marginTop: 2,
          }}>
            {badgeLabel}
          </div>
        </div>

        {/* Chevron */}
        <div style={{ flexShrink: 0, color: 'var(--color-text-muted)', marginLeft: 4 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Detail (expandable) */}
      {open && (
        <div style={{
          borderTop: '1px solid var(--color-border)',
          padding: '10px 14px',
          background: 'var(--color-bg)',
        }}>
          {/* Items */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Detail Belanja
            </div>
            {trx.items.map((item) => (
              <div key={item.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontSize: 12, color: 'var(--color-text)', marginBottom: 4,
              }}>
                <span style={{ flex: 1, marginRight: 8 }}>
                  {item.productNameSnapshot}
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>×{item.qty}</span>
                </span>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>
                  {rp(parseFloat(item.subtotalSell ?? '0'))}
                </span>
              </div>
            ))}
            <div style={{
              borderTop: '1px dashed var(--color-border)',
              marginTop: 6, paddingTop: 6,
              display: 'flex', justifyContent: 'space-between',
              fontSize: 13, fontWeight: 700, color: 'var(--color-text)',
            }}>
              <span>Total</span>
              <span>{rp(total)}</span>
            </div>
          </div>

          {/* Pembayaran */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Pembayaran
            </div>
            {trx.payments.map((p, i) => (
              <div key={i} style={{ fontSize: 12, marginBottom: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text)' }}>
                  <span style={{ fontWeight: 500 }}>{p.paymentMethod}</span>
                  <span>{rp(parseFloat(p.amount ?? '0'))}</span>
                </div>
                {p.paymentMethod === 'CASH' && p.cashReceived && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                      <span>Diterima</span>
                      <span>{rp(parseFloat(p.cashReceived))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                      <span>Kembalian</span>
                      <span>{rp(parseFloat(p.changeAmount ?? '0'))}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Halaman Utama ────────────────────────────────────────────
export default function KasirRiwayatPage() {
  const router = useRouter();

  const todayWIB = (() => {
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  })();

  const [tanggal, setTanggal] = useState(todayWIB);
  const [data, setData] = useState<RiwayatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async (tgl: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/kasir/riwayat?tanggal=${tgl}`);
      if (res.status === 401 || res.status === 403) {
        router.push('/kasir/login');
        return;
      }
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.message ?? 'Gagal memuat data.');
      }
    } catch {
      setError('Koneksi gagal. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(tanggal); }, [tanggal, fetchData]);

  const s = data?.summary;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 32 }}>

      {/* ── Header ── */}
      <div style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        boxShadow: 'var(--shadow-xs)',
      }}>
        <button
          onClick={() => router.push('/kasir/pos')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 4, display: 'flex' }}
          aria-label="Kembali ke POS"
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Riwayat Transaksi Saya</div>
          {data && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {data.kasir.namaLengkap} · {data.kasir.nim}
            </div>
          )}
        </div>
        <Receipt size={20} color="var(--color-primary)" />
      </div>

      <div style={{ padding: '16px 16px 0' }}>

        {/* ── Filter Tanggal ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 10, padding: '10px 14px',
          marginBottom: 16,
        }}>
          <Calendar size={16} color="var(--color-primary)" />
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', flex: 1 }}>
            Tanggal
          </label>
          <input
            type="date"
            value={tanggal}
            max={todayWIB}
            onChange={(e) => setTanggal(e.target.value)}
            style={{
              border: 'none', outline: 'none',
              background: 'transparent',
              fontSize: 13, fontWeight: 600,
              color: 'var(--color-primary)',
              cursor: 'pointer',
            }}
          />
        </div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '48px 0', color: 'var(--color-text-muted)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 14 }}>Memuat riwayat...</span>
          </div>
        )}

        {error && !loading && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'hsl(0 72% 51% / 0.1)', border: '1px solid hsl(0 72% 51% / 0.3)',
            borderRadius: 10, padding: '12px 14px', color: 'hsl(0 72% 51%)',
            fontSize: 13,
          }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Judul tanggal */}
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              {fmtTanggal(data.tanggal)}
            </div>

            {/* Info Shift */}
            {s?.statusShift && (
              <div style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12, padding: '12px 14px', marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Clock size={16} color="var(--color-primary)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Shift Hari Ini</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginTop: 1 }}>
                    {fmt(s.clockIn)} – {s.clockOut ? fmt(s.clockOut) : 'Aktif'}
                    {' '}
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      background: s.statusShift === 'ACTIVE' ? 'hsl(142 60% 38% / 0.15)' : 'var(--color-surface-muted)',
                      color: s.statusShift === 'ACTIVE' ? 'hsl(142 60% 38%)' : 'var(--color-text-muted)',
                      borderRadius: 6, padding: '2px 6px',
                    }}>
                      {s.statusShift === 'ACTIVE' ? 'Aktif' : 'Selesai'}
                    </span>
                  </div>
                </div>
                {s.modalAwal !== null && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Modal Awal</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                      {rp(s.modalAwal)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Summary cards 2x2 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <SummaryCard label="Total Struk" value={`${s?.jumlahStruk ?? 0} transaksi`} icon={ShoppingBag} color="hsl(220 80% 55%)" />
              <SummaryCard label="Total Omzet" value={rp(s?.totalOmzet ?? 0)} icon={TrendingUp} color="hsl(142 60% 38%)" />
              <SummaryCard label="Tunai (Cash)" value={rp(s?.totalCash ?? 0)} icon={Banknote} color="hsl(35 90% 50%)" />
              <SummaryCard label="QRIS" value={rp(s?.totalQris ?? 0)} icon={QrCode} color="hsl(262 80% 58%)" />
            </div>

            {/* List transaksi */}
            {data.transaksi.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '48px 16px',
                color: 'var(--color-text-muted)',
              }}>
                <Package size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Belum ada transaksi</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Tidak ada transaksi pada tanggal ini</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {data.transaksi.length} Transaksi — Tap untuk detail
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.transaksi.map((trx) => (
                    <TrxRow key={trx.id} trx={trx} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
