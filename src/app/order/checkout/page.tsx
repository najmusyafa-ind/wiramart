'use client';

// =============================================================
// Wiramart v2.0 — /order/checkout
// Pickup/Delivery → lantai + detail ruang (wajib) → bayar → POST /api/order.
// Harga & ongkir di sini HANYA tampilan; server menghitung ulang (anti-manipulasi).
// =============================================================

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, ShoppingBag } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';
import { calculateDeliveryFee } from '@/features/order/order.types';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

// Lantai 1 = lokasi Wiramart → tidak ditawarkan sebagai tujuan antar (pakai Ambil Sendiri).
const FLOORS = [
  { value: 2, label: 'Lantai 2' },
  { value: 3, label: 'Lantai 3' },
  { value: 4, label: 'Lantai 4' },
  { value: 99, label: 'Auditorium' },
] as const;

type DeliveryType = 'PICKUP' | 'DELIVERY';
type PaymentMethod = 'QRIS' | 'TRANSFER';

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal, clearCart, buyer, isLoadingBuyer } = useCart();

  const [mounted, setMounted] = useState(false);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('DELIVERY');
  const [floor, setFloor] = useState<number | null>(null);
  const [roomDetail, setRoomDetail] = useState('');
  const [note, setNote] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('QRIS');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false); // guard sinkron double-tap (state async)

  useEffect(() => setMounted(true), []);

  // Belum login → ke halaman masuk, kembali ke sini setelahnya
  useEffect(() => {
    if (mounted && !isLoadingBuyer && !buyer) {
      router.replace('/order/login?next=/order/checkout');
    }
  }, [mounted, isLoadingBuyer, buyer, router]);

  const fee =
    deliveryType === 'PICKUP' ? 0 : floor !== null ? calculateDeliveryFee('DELIVERY', floor) : 0;
  const total = subtotal + fee;

  const missing =
    deliveryType === 'DELIVERY' && (floor === null || roomDetail.trim().length === 0);

  async function submit() {
    if (lock.current || missing || items.length === 0) return;
    lock.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          deliveryType,
          ...(deliveryType === 'DELIVERY'
            ? { deliveryFloor: floor, roomDetail: roomDetail.trim() }
            : {}),
          ...(note.trim() ? { deliveryNote: note.trim() } : {}),
          paymentMethod: payment,
        }),
      });
      const json = await res.json().catch(() => null);

      if (res.status === 401) {
        router.replace('/order/login?next=/order/checkout');
        return;
      }
      if (!res.ok || !json?.success) {
        setError(typeof json?.error === 'string' ? json.error : 'Gagal membuat pesanan. Coba lagi.');
        return;
      }
      clearCart();
      router.replace(`/order/status/${json.data.order.id}`);
    } catch {
      setError('Koneksi bermasalah. Pesanan belum dibuat, silakan coba lagi.');
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  // Skeleton singkat sampai cart + sesi siap (cegah flash "keranjang kosong")
  if (!mounted || isLoadingBuyer) {
    return (
      <main style={{ flex: 1, display: 'grid', placeItems: 'center' }} aria-busy="true">
        <Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: 'var(--pwa-primary)' }} />
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="pwa-page-bar">
          <Link href="/order" className="pwa-back-btn" aria-label="Kembali ke katalog">
            <ArrowLeft size={18} />
          </Link>
          <h1>Checkout</h1>
        </div>
        <div className="pwa-empty-state" style={{ margin: 'auto 0' }}>
          <div className="pwa-empty-icon"><ShoppingBag size={28} /></div>
          <h2 className="pwa-empty-title">Keranjang kosong</h2>
          <p className="pwa-empty-desc" style={{ marginBottom: 16 }}>Pilih produk dulu dari katalog.</p>
          <Link href="/order" className="pwa-btn-primary" style={{ width: 'auto', padding: '0 24px' }}>
            Lihat Katalog
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="pwa-page-bar">
        <Link href="/order" className="pwa-back-btn" aria-label="Kembali ke katalog">
          <ArrowLeft size={18} />
        </Link>
        <h1>Checkout</h1>
      </div>

      <div className="pwa-page-body" style={{ flex: 1 }}>
        {/* 1. Metode terima */}
        <fieldset className="pwa-section" style={{ margin: 0 }}>
          <legend className="pwa-section-title" style={{ padding: 0 }}>Cara terima pesanan</legend>
          <div className="pwa-choice-grid cols-2">
            <label className="pwa-choice">
              <input type="radio" name="dt" checked={deliveryType === 'DELIVERY'} onChange={() => setDeliveryType('DELIVERY')} />
              <span className="pwa-choice-title">Diantar</span>
              <span className="pwa-choice-sub">Sampai ke kelas</span>
            </label>
            <label className="pwa-choice">
              <input type="radio" name="dt" checked={deliveryType === 'PICKUP'} onChange={() => setDeliveryType('PICKUP')} />
              <span className="pwa-choice-title">Ambil Sendiri</span>
              <span className="pwa-choice-sub">Lantai 1 · Rp 0</span>
            </label>
          </div>

          {deliveryType === 'DELIVERY' && (
            <>
              <div className="pwa-field">
                <span className="pwa-label" id="floor-label">Lantai tujuan</span>
                <div className="pwa-choice-grid cols-2" role="radiogroup" aria-labelledby="floor-label">
                  {FLOORS.map((f) => (
                    <label key={f.value} className="pwa-choice">
                      <input type="radio" name="floor" checked={floor === f.value} onChange={() => setFloor(f.value)} />
                      <span className="pwa-choice-title">{f.label}</span>
                      <span className="pwa-choice-sub">Ongkir {rp(calculateDeliveryFee('DELIVERY', f.value))}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pwa-field">
                <label className="pwa-label" htmlFor="room">Ruang / kelas <span style={{ color: 'hsl(0,72%,50%)' }}>*</span></label>
                <input
                  id="room"
                  className="pwa-input"
                  value={roomDetail}
                  onChange={(e) => setRoomDetail(e.target.value)}
                  maxLength={100}
                  placeholder="contoh: R.301 atau Lab Komputer B"
                  aria-invalid={floor !== null && roomDetail.trim() === ''}
                  required
                />
                <span className="pwa-hint">Wajib, agar runner tidak salah ruang.</span>
              </div>
            </>
          )}

          <div className="pwa-field">
            <label className="pwa-label" htmlFor="note">Catatan (opsional)</label>
            <textarea
              id="note"
              className="pwa-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="contoh: duduk di baris belakang"
            />
          </div>
        </fieldset>

        {/* 2. Pembayaran */}
        <fieldset className="pwa-section" style={{ margin: 0 }}>
          <legend className="pwa-section-title" style={{ padding: 0 }}>Pembayaran</legend>
          <div className="pwa-choice-grid cols-2">
            <label className="pwa-choice">
              <input type="radio" name="pay" checked={payment === 'QRIS'} onChange={() => setPayment('QRIS')} />
              <span className="pwa-choice-title">QRIS</span>
              <span className="pwa-choice-sub">Scan di Wiramart</span>
            </label>
            <label className="pwa-choice">
              <input type="radio" name="pay" checked={payment === 'TRANSFER'} onChange={() => setPayment('TRANSFER')} />
              <span className="pwa-choice-title">Transfer Bank</span>
              <span className="pwa-choice-sub">Upload bukti</span>
            </label>
          </div>
        </fieldset>

        {/* 3. Ringkasan */}
        <section className="pwa-section" aria-label="Ringkasan pesanan">
          <h2 className="pwa-section-title">Ringkasan</h2>
          {items.map((i) => (
            <div key={i.productId} className="pwa-sum-row">
              <span>{i.name} × {i.quantity}</span>
              <span>{rp(i.price * i.quantity)}</span>
            </div>
          ))}
          <div className="pwa-sum-row" style={{ borderTop: '1px dashed var(--pwa-border-strong)', paddingTop: 8 }}>
            <span>Subtotal</span><span>{rp(subtotal)}</span>
          </div>
          <div className="pwa-sum-row">
            <span>Ongkir{deliveryType === 'DELIVERY' && floor === null ? ' (pilih lantai)' : ''}</span>
            <span>{rp(fee)}</span>
          </div>
          <div className="pwa-sum-row total"><span>Total</span><span>{rp(total)}</span></div>
          <p className="pwa-hint" style={{ margin: 0 }}>
            Harga final dihitung ulang server sesuai harga terbaru. Ongkir 100% untuk runner.
          </p>
        </section>

        {error && <div className="pwa-alert" role="alert">{error}</div>}
      </div>

      <div className="pwa-sticky-cta">
        <button type="button" className="pwa-btn-primary" disabled={missing || submitting} onClick={submit}>
          {submitting ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : null}
          <span>
            {submitting
              ? 'Membuat pesanan...'
              : missing
                ? 'Lengkapi lantai & ruang'
                : `Pesan Sekarang · ${rp(total)}`}
          </span>
        </button>
      </div>
    </main>
  );
}
