'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
  discountPolicyId?: string | null;
};

type CashMovement = {
  id: string;
  movementType: string;
  category: string;
  amount: string;
  notes: string;
  createdAt: string;
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
  totalCashOut?: number;
  totalCashIn?: number;
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
  cashMovements?: CashMovement[];
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
  const hasFefoDiscount = trx.items.some((item) => Boolean(item.discountPolicyId));
  const inlineItemsPreview = trx.items
    .map((item) => `${item.productNameSnapshot} ×${item.qty}`)
    .join(', ');

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header baris */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', minHeight: 52, padding: '12px 14px',
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

        {/* Info — ringkasan item langsung tanpa harus klik panah */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
              {trx.invoiceNumber}
            </span>
            {hasFefoDiscount && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#b45309',
                background: '#fef3c7', border: '1px solid #fcd34d',
                borderRadius: 4, padding: '1px 5px',
              }}>
                Diskon Obral
              </span>
            )}
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: 'var(--color-text)',
            lineHeight: 1.35, marginBottom: 2,
          }}>
            {inlineItemsPreview || `${trx.items.length} item`}
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

async function requestRiwayat(tgl: string, signal?: AbortSignal) {
  const res = await fetch(`/api/kasir/riwayat?tanggal=${tgl}`, { signal });
  if (res.status === 401 || res.status === 403) {
    return { status: 'unauthorized' as const };
  }
  const json = await res.json();
  if (json.success) {
    return { status: 'ok' as const, data: json.data as RiwayatData };
  }
  const errText =
    typeof json.error === 'string'
      ? json.error
      : typeof json.message === 'string'
        ? json.message
        : 'Gagal memuat data.';
  return { status: 'error' as const, error: errText };
}

// ── Halaman Utama ────────────────────────────────────────────
export default function KasirRiwayatPage() {
  const router = useRouter();

  const [todayWIB] = useState(() => {
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });

  const [tanggal, setTanggal] = useState(todayWIB);
  const [copiedHandover, setCopiedHandover] = useState(false);
  const [data, setData] = useState<RiwayatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    requestRiwayat(tanggal, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'unauthorized') {
          router.push('/kasir/login');
          return;
        }
        if (result.status === 'error') {
          setError(result.error);
          return;
        }
        setError('');
        setData(result.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Koneksi gagal. Coba lagi.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [tanggal, router]);

  const s = data?.summary;

  return (
    <div style={{ minHeight: '100svh', background: 'var(--color-bg)', paddingBottom: 'calc(32px + env(safe-area-inset-bottom, 0px))' }}>

      {/* ── Header ── */}
      <div style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        boxShadow: 'var(--shadow-xs)',
      }}>
        <button
          type="button"
          onClick={() => router.push('/kasir/pos')}
          style={{
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            cursor: 'pointer',
            color: 'var(--color-text)',
            minWidth: 44,
            minHeight: 44,
            padding: 0,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Kembali ke POS"
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Riwayat Transaksi Saya</div>
          {data && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.kasir.namaLengkap} · {data.kasir.nim}
            </div>
          )}
        </div>
        <Receipt size={20} color="var(--color-primary)" style={{ flexShrink: 0 }} />
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '14px 16px 0' }}>

        {/* ── Navigasi Terpadu Rekap & Detail Struk ── */}
        <div className="rep-seg" style={{ width: '100%', marginBottom: 14 }}>
          <Link
            href="/kasir/rekap"
            className="rep-seg-btn"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
          >
            Rekap &amp; Cetak
          </Link>
          <span
            className="rep-seg-btn active"
            style={{ flex: 1, textAlign: 'center', cursor: 'default' }}
          >
            Detail Struk &amp; WA
          </span>
        </div>

        {/* ── Filter Tanggal ── */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 10, padding: '8px 14px',
          marginBottom: 16,
        }}>
          <Calendar size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
          <label htmlFor="riwayat-tanggal" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', flex: 1 }}>
            Tanggal
          </label>
          <input
            id="riwayat-tanggal"
            type="date"
            value={tanggal}
            max={todayWIB}
            onChange={(e) => {
              setLoading(true);
              setError('');
              setTanggal(e.target.value);
            }}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '6px 10px',
              minHeight: 44,
              outline: 'none',
              background: 'var(--color-surface)',
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--color-primary)',
              cursor: 'pointer',
            }}
          />
        </div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '48px 0', color: 'var(--color-text-muted)' }}>
            <Loader2 size={20} className="spin-icon" />
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
            <div className="rep-kpi-grid" style={{ marginBottom: 14 }}>
              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Total Struk</span>
                  <ShoppingBag size={14} style={{ color: '#2563eb' }} />
                </div>
                <div className="rep-kpi__val">{s?.jumlahStruk ?? 0}</div>
                <div className="rep-kpi__sub">Transaksi selesai</div>
              </div>
              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Total Omzet</span>
                  <TrendingUp size={14} style={{ color: '#15803d' }} />
                </div>
                <div className="rep-kpi__val" style={{ color: '#15803d' }}>{rp(s?.totalOmzet ?? 0)}</div>
                <div className="rep-kpi__sub">Tunai + QRIS</div>
              </div>
              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">Tunai</span>
                  <Banknote size={14} style={{ color: '#b45309' }} />
                </div>
                <div className="rep-kpi__val">{rp(s?.totalCash ?? 0)}</div>
                <div className="rep-kpi__sub">Masuk laci</div>
              </div>
              <div className="rep-kpi">
                <div className="rep-kpi__top">
                  <span className="rep-kpi__label">QRIS</span>
                  <QrCode size={14} style={{ color: '#7c3aed' }} />
                </div>
                <div className="rep-kpi__val">{rp(s?.totalQris ?? 0)}</div>
                <div className="rep-kpi__sub">Non-tunai</div>
              </div>
            </div>

            {/* Ringkasan Serah Terima Kas & Potongan Supplier */}
            {s?.statusShift && (
              <div style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12, padding: '12px 14px', marginBottom: 16,
                fontSize: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <strong style={{ color: 'var(--color-text)' }}>Ringkasan Serah Terima Kas Shift</strong>
                  <button
                    type="button"
                    onClick={async () => {
                      const potongan = (data.cashMovements ?? []).filter((m) => m.movementType === 'CASH_OUT');
                      const lines = [
                        `SERAH TERIMA KAS SHIFT - WIRAMART UNPERBA`,
                        `Tanggal: ${fmtTanggal(data.tanggal)}`,
                        `Kasir: ${data.kasir.namaLengkap}`,
                        `Total Struk: ${s.jumlahStruk} transaksi`,
                        `Modal Awal Kotak: ${s.modalAwal !== null ? rp(s.modalAwal) : '-'}`,
                        `Cash Masuk: ${rp(s.totalCash)}`,
                        `QRIS Masuk: ${rp(s.totalQris)}`,
                        `Total Penjualan: ${rp(s.totalOmzet)}`,
                        ...(potongan.length > 0
                          ? [
                              `Potongan Bayar Supplier / Kas Keluar:`,
                              ...potongan.map((m) => `- ${m.notes}: ${rp(parseFloat(m.amount ?? '0'))}`),
                            ]
                          : ['Potongan Bayar Supplier: Rp 0']),
                        `Sisa Cash di Kotak Uang: ${s.aktualKas !== null ? rp(s.aktualKas) : 'Belum tutup shift'}`,
                      ];
                      try {
                        await navigator.clipboard.writeText(lines.join('\n'));
                        setCopiedHandover(true);
                        window.setTimeout(() => setCopiedHandover(false), 2500);
                      } catch {
                        window.alert('Gagal menyalin laporan serah terima.');
                      }
                    }}
                    style={{
                      padding: '6px 10px', borderRadius: 8,
                      border: '1px solid var(--color-border)',
                      background: copiedHandover ? '#15803d' : 'var(--color-bg)',
                      color: copiedHandover ? '#ffffff' : 'var(--color-text)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {copiedHandover ? 'Tersalin ke WA' : 'Salin Laporan WA'}
                  </button>
                </div>
                {(data.cashMovements ?? []).filter((m) => m.movementType === 'CASH_OUT').length > 0 ? (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontWeight: 600, color: '#b91c1c', marginBottom: 3 }}>
                      Potongan Bayar Supplier / Kas Keluar ({rp(s.totalCashOut ?? 0)}):
                    </div>
                    {(data.cashMovements ?? [])
                      .filter((m) => m.movementType === 'CASH_OUT')
                      .map((m) => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)', marginBottom: 2 }}>
                          <span>• {m.notes}</span>
                          <span>-{rp(parseFloat(m.amount ?? '0'))}</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    Potongan Bayar Supplier / Kas Keluar: Rp 0
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--color-border)', paddingTop: 6, fontWeight: 700, color: '#15803d' }}>
                  <span>Sisa Cash Fisik di Kotak Uang</span>
                  <span>{s.aktualKas !== null ? rp(s.aktualKas) : 'Menunggu tutup shift'}</span>
                </div>
              </div>
            )}

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
