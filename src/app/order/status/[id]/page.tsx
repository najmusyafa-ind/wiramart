'use client';

// =============================================================
// Wiramart v2.0 — /order/status/[id]
// Tracking pesanan + PIN serah terima. IDOR dijaga di GET /api/order/[id] (404 jika bukan milik buyer).
// Polling 15 dtk, berhenti di status final & saat tab tersembunyi.
// =============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  ShieldCheck,
  UploadCloud,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
} from 'lucide-react';

type Status =
  | 'WAITING_PAYMENT_VERIFICATION'
  | 'WAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

interface OrderView {
  id: string;
  orderNumber: string;
  status: Status;
  deliveryType: 'PICKUP' | 'DELIVERY';
  deliveryFloor: number | null;
  deliveryFee: number;
  roomDetail: string | null;
  paymentMethod: 'QRIS' | 'TRANSFER';
  paymentReference: string | null;
  paymentProofUrl?: string | null;
  handoverPin: string | null;
  subtotal: number;
  totalAmount: number;
  cancelledReason: string | null;
  rejectedReason: string | null;
}
interface ItemView {
  id: string;
  productName: string;
  sellingPrice: number;
  quantity: number;
  subtotal: number;
}
interface PaymentInfoView {
  qrImageUrl: string | null;
  merchantName: string;
  storePhone: string | null;
}

const STATUS_UI: Record<Status, { label: string; hint: string; tone: '' | 'ok' | 'bad'; final: boolean }> = {
  WAITING_PAYMENT_VERIFICATION: { label: 'Menunggu Verifikasi Pembayaran', hint: 'Pengelola akan memverifikasi bukti pembayaran Anda.', tone: '', final: false },
  WAITING_CONFIRMATION: { label: 'Menunggu Konfirmasi', hint: 'Pengelola Wiramart sedang memverifikasi pesanan Anda.', tone: '', final: false },
  CONFIRMED: { label: 'Dikonfirmasi', hint: 'Pesanan telah diterima dan sedang dijadwalkan untuk penyiapan.', tone: 'ok', final: false },
  PREPARING: { label: 'Sedang Disiapkan', hint: 'Petugas sedang menyiapkan pesanan Anda.', tone: 'ok', final: false },
  OUT_FOR_DELIVERY: { label: 'Sedang Diantar', hint: 'Petugas pengantar sedang menuju lokasi Anda. Mohon siapkan kode PIN serah terima.', tone: 'ok', final: false },
  COMPLETED: { label: 'Selesai', hint: 'Terima kasih telah berbelanja di Wiramart UNPERBA.', tone: 'ok', final: true },
  CANCELLED: { label: 'Dibatalkan', hint: '', tone: 'bad', final: true },
  REJECTED: { label: 'Ditolak', hint: '', tone: 'bad', final: true },
  EXPIRED: { label: 'Kedaluwarsa', hint: 'Pesanan melewati batas waktu pemrosesan 2 jam. Silakan lakukan pemesanan ulang.', tone: 'bad', final: true },
};

const PIN_VISIBLE: ReadonlySet<Status> = new Set(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY']);
const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
const floorLabel = (f: number | null) => (f === 99 ? 'Auditorium' : f ? `Lantai ${f}` : '-');

export default function OrderStatusPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // State upload bukti transfer
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isChangingProof, setIsChangingProof] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const updatePreviewSrc = useCallback((nextUrl: string | null) => {
    if (previewUrlRef.current && previewUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = nextUrl;
    setPreviewSrc(nextUrl);
  }, []);

  // Pastikan objectURL dilepas saat komponen unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/order/${id}`, { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        router.replace(`/order/login?next=/order/status/${id}`);
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(res.status === 404 ? 'Pesanan tidak ditemukan.' : 'Gagal memuat pesanan.');
        return;
      }
      setOrder(json.data.order as OrderView);
      setItems(json.data.items as ItemView[]);
      if (json.data.paymentInfo) {
        setPaymentInfo(json.data.paymentInfo as PaymentInfoView);
      }
      setError(null);
    } catch {
      // Jika load pertama gagal karena Wi-Fi putus, tampilkan error + tombol coba lagi (jangan spinner permanen)
      setOrder((prev) => {
        if (!prev) setError('Koneksi Wi-Fi terganggu saat memuat status pesanan. Coba muat ulang halaman.');
        return prev;
      });
    }
  }, [id, router]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/order/${id}/cancel`, { method: 'POST', credentials: 'same-origin' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionError(typeof json?.error === 'string' ? json.error : 'Gagal membatalkan pesanan.');
      }
      setConfirmCancel(false);
      await load(); // status terbaru (bisa jadi sudah dikonfirmasi admin)
    } catch {
      setActionError('Koneksi internet terganggu saat membatalkan pesanan. Coba lagi.');
    } finally {
      setCancelling(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setUploadError(null);
    setUploadSuccess(null);
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setUploadError('Hanya format JPG, PNG, atau WebP yang diperbolehkan.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Ukuran file maksimal 2MB.');
      return;
    }

    setUploadFile(file);
    updatePreviewSrc(URL.createObjectURL(file));
  }

  async function submitBuktiTransfer() {
    if (!uploadFile || uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);

      const res = await fetch(`/api/order/${id}/bukti-transfer`, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setUploadError(typeof json?.error === 'string' ? json.error : 'Gagal mengunggah bukti transfer.');
        return;
      }

      setUploadSuccess('Bukti transfer berhasil dikirim. Menunggu verifikasi admin.');
      setUploadFile(null);
      updatePreviewSrc(null);
      setIsChangingProof(false);
      await load();
    } catch {
      setUploadError('Terjadi kesalahan jaringan saat mengunggah. Coba lagi.');
    } finally {
      setUploading(false);
    }
  }

  const isFinal = order ? STATUS_UI[order.status].final : false;
  useEffect(() => {
    if (isFinal || error) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15_000);
    return () => clearInterval(t);
  }, [isFinal, error, load]);

  const header = (
    <div className="pwa-page-bar">
      <Link href="/order" className="pwa-back-btn" aria-label="Kembali ke katalog">
        <ArrowLeft size={18} aria-hidden="true" />
      </Link>
      <h1>Status Pesanan</h1>
    </div>
  );

  if (error) {
    return (
      <main style={{ flex: 1 }}>
        {header}
        <div className="pwa-page-body">
          <div className="pwa-alert" role="alert">{error}</div>
          <Link href="/order" className="pwa-btn-primary">Kembali ke Katalog</Link>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main style={{ flex: 1 }} aria-busy="true">
        {header}
        <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}>
          <Loader2 size={26} aria-hidden="true" style={{ animation: 'spin 1s linear infinite', color: 'var(--pwa-primary)' }} />
        </div>
      </main>
    );
  }

  const ui = STATUS_UI[order.status];
  const reason = order.status === 'CANCELLED' ? order.cancelledReason : order.status === 'REJECTED' ? order.rejectedReason : null;
  const waitingPay = order.status === 'WAITING_PAYMENT_VERIFICATION' || order.status === 'WAITING_CONFIRMATION';

  return (
    <main style={{ flex: 1 }}>
      {header}
      <div className="pwa-page-body">
        <section className="pwa-section" aria-live="polite">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>#{order.orderNumber}</strong>
            <span className={`pwa-status-chip ${ui.tone}`}>{ui.label}</span>
          </div>
          {(reason || ui.hint) && <p className="pwa-hint" style={{ margin: 0 }}>{reason ? `Alasan: ${reason}` : ui.hint}</p>}
        </section>

        {order.handoverPin && PIN_VISIBLE.has(order.status) && (
          <section className="pwa-pin-box" aria-label="PIN serah terima">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, opacity: 0.9 }}>
              <ShieldCheck size={14} aria-hidden="true" /> PIN Serah Terima
            </div>
            <div className="pwa-pin-code">{order.handoverPin}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              {order.deliveryType === 'DELIVERY'
                ? 'Tunjukkan PIN ini ke runner saat pesanan tiba. Jangan dibagikan sebelumnya.'
                : 'Tunjukkan PIN ini ke petugas saat mengambil pesanan.'}
            </div>
          </section>
        )}

        {waitingPay && (
          <section className="pwa-section" aria-label="Instruksi pembayaran">
            <div className="pwa-alert pwa-alert-info" style={{ margin: 0 }}>
              {order.paymentMethod === 'QRIS'
                ? `Bayar sejumlah ${rp(order.totalAmount)} dengan scan QRIS ${paymentInfo?.merchantName ?? 'Wiramart UNPERBA'} di bawah ini (atau di kasir Lantai 1). Pesanan kedaluwarsa dalam 2 jam.`
                : `Transfer sejumlah ${rp(order.totalAmount)} ke rekening/QRIS resmi ${paymentInfo?.merchantName ?? 'Wiramart UNPERBA'} dengan berita/referensi ${order.paymentReference ?? order.orderNumber}, lalu unggah bukti di bawah.${paymentInfo?.storePhone ? ` Konfirmasi WA toko: ${paymentInfo.storePhone}.` : ''} Pesanan kedaluwarsa dalam 2 jam.`}
            </div>
            {paymentInfo?.qrImageUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <Image
                  src={paymentInfo.qrImageUrl}
                  alt={`QRIS ${paymentInfo.merchantName}`}
                  width={220}
                  height={220}
                  unoptimized
                  style={{ width: 200, height: 'auto', borderRadius: 10, border: '1px solid var(--pwa-border)', background: '#ffffff', padding: 6 }}
                />
                <span style={{ fontSize: 12, color: 'var(--pwa-text-muted)', fontWeight: 600 }}>
                  {paymentInfo.merchantName}
                </span>
              </div>
            )}
          </section>
        )}

        {/* Upload Bukti Transfer untuk Metode TRANSFER */}
        {order.paymentMethod === 'TRANSFER' && order.status === 'WAITING_PAYMENT_VERIFICATION' && (
          <section className="pwa-section" aria-label="Bukti transfer bank">
            <h2 className="pwa-section-title">Bukti Transfer</h2>

            {order.paymentProofUrl && !isChangingProof ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pwa-primary)', fontSize: 13, fontWeight: 600 }}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Bukti transfer sudah terkirim</span>
                </div>
                <div style={{ borderRadius: 'var(--pwa-radius-md)', overflow: 'hidden', border: '1px solid var(--pwa-border)', maxHeight: 180, display: 'flex', justifyContent: 'center', background: 'var(--pwa-surface-muted)' }}>
                  <Image
                    src={order.paymentProofUrl}
                    alt="Bukti Transfer"
                    width={360}
                    height={180}
                    unoptimized
                    style={{ maxHeight: 180, width: 'auto', height: 'auto', objectFit: 'contain' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={order.paymentProofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="pwa-btn-secondary"
                    style={{ flex: 1, fontSize: 13 }}
                  >
                    <ExternalLink size={14} aria-hidden="true" /> Lihat Foto
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingProof(true);
                      setUploadFile(null);
                      updatePreviewSrc(null);
                    }}
                    className="pwa-btn-secondary"
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: 'var(--pwa-primary-text)',
                      borderColor: 'var(--pwa-primary)',
                    }}
                  >
                    Ganti Foto
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="pwa-hint" style={{ margin: 0 }}>
                  Upload foto struk / tangkapan layar m-banking (maks. 2MB, JPG/PNG/WebP).
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {previewSrc ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ borderRadius: 'var(--pwa-radius-md)', overflow: 'hidden', border: '1px solid var(--pwa-border)', maxHeight: 180, display: 'flex', justifyContent: 'center', background: 'var(--pwa-surface-muted)' }}>
                      <Image
                        src={previewSrc}
                        alt="Preview Bukti"
                        width={360}
                        height={180}
                        unoptimized
                        style={{ maxHeight: 180, width: 'auto', height: 'auto', objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadFile(null);
                          updatePreviewSrc(null);
                          if (order.paymentProofUrl) setIsChangingProof(false);
                        }}
                        disabled={uploading}
                        className="pwa-btn-secondary"
                        style={{ flex: 1, fontSize: 13 }}
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        onClick={submitBuktiTransfer}
                        disabled={uploading}
                        className="pwa-btn-primary"
                        style={{ flex: 2, minHeight: 44, fontSize: 13.5 }}
                      >
                        {uploading ? <Loader2 size={15} aria-hidden="true" className="spin-icon" /> : <UploadCloud size={15} aria-hidden="true" />}
                        <span>{uploading ? 'Mengunggah...' : 'Kirim Bukti'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="pwa-btn-secondary"
                    style={{
                      width: '100%',
                      background: 'var(--pwa-surface-muted)',
                      border: '1.5px dashed var(--pwa-border-strong)',
                      minHeight: 48,
                      fontSize: 13.5,
                    }}
                  >
                    <ImageIcon size={18} aria-hidden="true" style={{ color: 'var(--pwa-primary)' }} />
                    <span>Pilih Foto Bukti Transfer</span>
                  </button>
                )}

                {uploadError && <div className="pwa-alert" role="alert">{uploadError}</div>}
                {uploadSuccess && (
                  <div className="pwa-alert" style={{ background: 'var(--pwa-primary-light)', color: 'var(--pwa-primary-text)', borderColor: 'var(--pwa-primary)' }}>
                    {uploadSuccess}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="pwa-section">
          <h2 className="pwa-section-title">Pengiriman</h2>
          <div className="pwa-sum-row">
            <span>{order.deliveryType === 'DELIVERY' ? 'Diantar ke' : 'Ambil sendiri'}</span>
            <strong>
              {order.deliveryType === 'DELIVERY'
                ? `${floorLabel(order.deliveryFloor)} · ${order.roomDetail ?? '-'}`
                : 'Wiramart, Lantai 1'}
            </strong>
          </div>
        </section>

        <section className="pwa-section">
          <h2 className="pwa-section-title">Rincian</h2>
          {items.map((i) => (
            <div key={i.id} className="pwa-sum-row">
              <span>{i.productName} × {i.quantity}</span>
              <span>{rp(i.subtotal)}</span>
            </div>
          ))}
          <div className="pwa-sum-row" style={{ borderTop: '1px dashed var(--pwa-border-strong)', paddingTop: 8 }}>
            <span>Subtotal</span><span>{rp(order.subtotal)}</span>
          </div>
          <div className="pwa-sum-row"><span>Ongkir</span><span>{rp(order.deliveryFee)}</span></div>
          <div className="pwa-sum-row total"><span>Total</span><span>{rp(order.totalAmount)}</span></div>
        </section>

        {waitingPay && (
          <>
            {actionError && <div className="pwa-alert" role="alert">{actionError}</div>}
            {confirmCancel ? (
              <section
                className="pwa-section"
                role="region"
                aria-label="Konfirmasi pembatalan pesanan"
                style={{ borderColor: 'hsl(0, 70%, 80%)', background: 'hsl(0, 85%, 97%)' }}
              >
                <strong style={{ fontSize: 13.5, color: 'hsl(0, 65%, 32%)' }}>
                  Yakin batalkan pesanan #{order.orderNumber}?
                </strong>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    disabled={cancelling}
                    className="pwa-btn-secondary"
                    style={{ flex: 1 }}
                  >
                    Kembali
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={cancelling}
                    className="pwa-btn-danger-outline"
                    style={{ flex: 1 }}
                  >
                    {cancelling ? 'Membatalkan...' : 'Ya, Batalkan'}
                  </button>
                </div>
              </section>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                disabled={cancelling}
                className="pwa-btn-danger-outline"
              >
                Batalkan Pesanan
              </button>
            )}
          </>
        )}

        <Link href="/order/profile" className="pwa-btn-secondary">
          Lihat Riwayat Pesanan
        </Link>
        <Link href="/order" className="pwa-btn-primary">Belanja Lagi</Link>
      </div>
    </main>
  );
}
