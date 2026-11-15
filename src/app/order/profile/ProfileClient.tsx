'use client';

// =============================================================
// Wiramart v2.0 — Buyer Profile & Order History Client
// Menampilkan identitas pembeli, riwayat pesanan terbaru, dan logout.
// =============================================================

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  LogOut,
  Package,
  RefreshCw,
  ShoppingBag,
  User,
} from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

export type OrderStatusType =
  | 'WAITING_PAYMENT_VERIFICATION'
  | 'WAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface BuyerOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatusType;
  deliveryType: 'PICKUP' | 'DELIVERY';
  deliveryFloor: number | null;
  roomDetail: string | null;
  paymentMethod: 'QRIS' | 'TRANSFER';
  totalAmount: number;
  createdAt: string;
}

interface ProfileClientProps {
  initialBuyer: { id: string; fullName: string; nim: string };
  initialOrders: BuyerOrderSummary[];
}

const STATUS_META: Record<
  OrderStatusType,
  { label: string; tone: '' | 'ok' | 'bad'; kind: 'pending' | 'ok' | 'bad' }
> = {
  WAITING_PAYMENT_VERIFICATION: { label: 'Menunggu verifikasi bayar', tone: '', kind: 'pending' },
  WAITING_CONFIRMATION: { label: 'Menunggu konfirmasi', tone: '', kind: 'pending' },
  CONFIRMED: { label: 'Dikonfirmasi', tone: 'ok', kind: 'ok' },
  PREPARING: { label: 'Sedang disiapkan', tone: 'ok', kind: 'pending' },
  OUT_FOR_DELIVERY: { label: 'Sedang diantar', tone: 'ok', kind: 'pending' },
  COMPLETED: { label: 'Selesai', tone: 'ok', kind: 'ok' },
  CANCELLED: { label: 'Dibatalkan', tone: 'bad', kind: 'bad' },
  REJECTED: { label: 'Ditolak', tone: 'bad', kind: 'bad' },
  EXPIRED: { label: 'Kedaluwarsa', tone: 'bad', kind: 'bad' },
};

const formatCurrency = (amount: number) => `Rp ${amount.toLocaleString('id-ID')}`;

const formatFloor = (floor: number | null) =>
  floor === 99 ? 'Auditorium' : floor ? `Lantai ${floor}` : '-';

const formatOrderDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

function StatusIcon({ kind }: { kind: 'pending' | 'ok' | 'bad' }) {
  if (kind === 'ok') return <CheckCircle2 size={13} aria-hidden="true" />;
  if (kind === 'bad') return <XCircle size={13} aria-hidden="true" />;
  return <Clock size={13} aria-hidden="true" />;
}

export default function ProfileClient({
  initialBuyer,
  initialOrders,
}: ProfileClientProps) {
  const router = useRouter();
  const { logoutBuyer } = useCart();

  const [orders, setOrders] = useState<BuyerOrderSummary[]>(initialOrders);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleRefreshOrders() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch('/api/order', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        router.replace('/order/login?next=/order/profile');
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !Array.isArray(json.data?.orders)) {
        setRefreshError('Gagal menyegarkan riwayat pesanan.');
        return;
      }
      setOrders(json.data.orders as BuyerOrderSummary[]);
    } catch {
      setRefreshError('Koneksi bermasalah. Tidak dapat memuat ulang riwayat.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutBuyer();
      router.replace('/order');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="pwa-page-bar">
        <Link href="/order" className="pwa-back-btn" aria-label="Kembali ke katalog">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <h1>Akun &amp; Pesanan</h1>
      </div>

      <div className="pwa-page-body">
        {/* Identitas Pembeli */}
        <section className="pwa-section" aria-label="Profil pembeli">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 'var(--pwa-radius-full)',
                background: 'var(--pwa-primary-light)',
                color: 'var(--pwa-primary-hover)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <User size={22} aria-hidden="true" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: 'block', fontSize: 15, color: 'var(--pwa-text-main)' }}>
                {initialBuyer.fullName}
              </strong>
              <span style={{ fontSize: 13, color: 'var(--pwa-text-muted)' }}>
                NIM: {initialBuyer.nim}
              </span>
            </div>
          </div>

          {confirmLogout ? (
            <div
              role="region"
              aria-label="Konfirmasi keluar akun"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                paddingTop: 10,
                borderTop: '1px dashed var(--pwa-border)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pwa-text-main)' }}>
                Keluar dari akun {initialBuyer.fullName} di perangkat ini?
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setConfirmLogout(false)}
                  disabled={loggingOut}
                  className="pwa-btn-secondary"
                  style={{ flex: 1 }}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="pwa-btn-danger-outline"
                  style={{ flex: 1 }}
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>{loggingOut ? 'Keluar...' : 'Ya, Keluar'}</span>
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="pwa-btn-danger-outline"
            >
              <LogOut size={16} aria-hidden="true" />
              <span>Keluar Akun</span>
            </button>
          )}
        </section>

        {/* Riwayat Pesanan */}
        <section className="pwa-section" aria-label="Riwayat pesanan">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h2 className="pwa-section-title">Pesanan Terbaru ({orders.length})</h2>
            <button
              type="button"
              onClick={handleRefreshOrders}
              disabled={refreshing}
              className="pwa-inline-action-btn"
              aria-label="Muat ulang riwayat pesanan"
            >
              <RefreshCw
                size={14}
                aria-hidden="true"
                style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}
              />
              <span>{refreshing ? 'Memuat...' : 'Segarkan'}</span>
            </button>
          </div>

          {refreshError && (
            <div className="pwa-alert" role="alert">
              {refreshError}
            </div>
          )}

          {orders.length === 0 ? (
            <div className="pwa-empty-state" style={{ padding: '28px 12px' }}>
              <div className="pwa-empty-icon">
                <Package size={26} aria-hidden="true" />
              </div>
              <h3 className="pwa-empty-title">Belum Ada Pesanan</h3>
              <p className="pwa-empty-desc" style={{ marginBottom: 14 }}>
                Pesanan yang kamu buat lewat Wiramart Delivery akan muncul di sini.
              </p>
              <Link href="/order" className="pwa-btn-primary">
                <ShoppingBag size={16} aria-hidden="true" />
                <span>Mulai Belanja</span>
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.map((order) => {
                const meta = STATUS_META[order.status];
                return (
                  <Link
                    key={order.id}
                    href={`/order/status/${order.id}`}
                    className="pwa-order-card"
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong style={{ fontSize: 14, color: 'var(--pwa-text-main)' }}>
                        #{order.orderNumber}
                      </strong>
                      <span className={`pwa-status-chip ${meta.tone}`}>
                        <StatusIcon kind={meta.kind} />
                        <span>{meta.label}</span>
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12.5,
                        color: 'var(--pwa-text-muted)',
                      }}
                    >
                      <span>
                        {order.deliveryType === 'DELIVERY'
                          ? `${formatFloor(order.deliveryFloor)} · ${order.roomDetail ?? '-'}`
                          : 'Ambil Sendiri · Lantai 1'}{' '}
                        · {order.paymentMethod}
                      </span>
                      <span>{formatOrderDate(order.createdAt)}</span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: 6,
                        borderTop: '1px dashed var(--pwa-border)',
                      }}
                    >
                      <strong style={{ fontSize: 14, color: 'var(--pwa-primary)' }}>
                        {formatCurrency(order.totalAmount)}
                      </strong>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: 'var(--pwa-primary)',
                        }}
                      >
                        <span>Lihat Detail</span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

