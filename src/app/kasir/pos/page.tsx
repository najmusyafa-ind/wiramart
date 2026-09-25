'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import Image from 'next/image';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Banknote,
  CheckCircle, X, Loader2, Package, LogOut,
  User, Clock, AlertTriangle, ScanLine,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

// BarcodeDetector Type — Shape Detection API (belum di TS stdlib)
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(options?: { formats?: string[] });
  detect(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<{ rawValue: string; format: string }[]>;
}

// ── Types ──────────────────────────────────────────────────────
type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  sellingPrice: string;
  stockQty: number;
  unit: string;
  categoryId: string;
  categoryName: string | null;
  photoUrl: string | null;
};
type CartItem = Product & { qty: number };
type PaymentMethod = 'CASH' | 'QRIS';

type SessionInfo = {
  employee: { id: string; fullName: string; jabatan: string; nim: string };
  shift: { id: string; clockIn: string } | null;
  qris: { qrImageUrl: string | null; bankName: string | null; accountName: string | null } | null;
};

// ── Helpers ────────────────────────────────────────────────────
const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

function formatShiftDuration(clockIn: string): string {
  const start = new Date(clockIn);
  const now = new Date();
  const ms = now.getTime() - start.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function formatTimeShort(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ── QrCode SVG ────────────────────────────────────────────────
function QrCodeIcon({ size, style }: { size: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="3" width="5" height="5" /><rect x="3" y="16" width="5" height="5" />
      <rect x="16" y="3" width="5" height="5" /><path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" /><path d="M12 3h.01" /><path d="M12 16v.01" />
      <path d="M16 12h1" /><path d="M21 12v.01" /><path d="M12 21v-1" />
    </svg>
  );
}

// ── Product Card ──────────────────────────────────────────────
function ProductCard({ product, onAdd }: { product: Product; onAdd: (p: Product) => void }) {
  const isOut = product.stockQty === 0;
  const isLow = !isOut && product.stockQty <= 5;
  return (
    <button
      onClick={() => !isOut && onAdd(product)}
      id={`prod-${product.id}`}
      disabled={isOut}
      className="pos-product-card"
      style={{ opacity: isOut ? 0.5 : 1, cursor: isOut ? 'not-allowed' : 'pointer' }}
      aria-label={`Tambah ${product.name} ke keranjang${isOut ? ' (Habis)' : ''}`}
    >
      {/* Foto atau placeholder */}
      <div className="pos-product-img">
        {product.photoUrl ? (
          <Image src={product.photoUrl} alt={product.name} fill style={{ objectFit: 'cover' }} sizes="140px" />
        ) : (
          <Package size={26} style={{ color: 'var(--color-primary)', opacity: 0.6 }} aria-hidden />
        )}
        {isOut && (
          <div className="pos-product-badge-out">Habis</div>
        )}
        {isLow && !isOut && (
          <div className="pos-product-badge-low">Sisa {product.stockQty}</div>
        )}
      </div>
      <div className="pos-product-name">{product.name}</div>
      <div className="pos-product-price">{rp(parseFloat(product.sellingPrice))}</div>
      {!isLow && !isOut && (
        <div className="pos-product-stock">Stok: {product.stockQty} {product.unit}</div>
      )}
    </button>
  );
}

// ── Payment Modal ─────────────────────────────────────────────
function PaymentModal({
  total, method, qrisInfo, onClose, onConfirm, loading,
}: {
  total: number;
  method: PaymentMethod;
  qrisInfo: SessionInfo['qris'];
  onClose: () => void;
  onConfirm: (cashReceived?: number) => void;
  loading: boolean;
}) {
  const uid = useId();
  const [cashInput, setCashInput] = useState('');
  const cashAmount = cashInput ? parseFloat(cashInput) : 0;
  const cashChange = cashInput ? cashAmount - total : null;

  const quickAmounts = [total, 20000, 50000, 100000, 150000, 200000]
    .filter((a, i, arr) => arr.indexOf(a) === i && a >= total)
    .slice(0, 4);

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)', backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        animation: 'fade-in 0.15s ease',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0, boxShadow: 'var(--shadow-xl)' }}>
        <div className="card-header">
          <h2 id={`${uid}-title`} className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {method === 'CASH'
              ? <><Banknote size={18} style={{ color: 'var(--color-accent)' }} /> Pembayaran Tunai</>
              : <><QrCodeIcon size={18} /> Pembayaran QRIS</>}
          </h2>
          <button
            onClick={onClose}
            aria-label="Tutup"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Total */}
          <div style={{
            textAlign: 'center', padding: 'var(--space-4)',
            background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>Total Tagihan</div>
            <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
              {rp(total)}
            </div>
          </div>

          {/* Cash section */}
          {method === 'CASH' && (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor={`${uid}-cash`} className="form-label">Uang Diterima (Rp)</label>
                <input
                  id={`${uid}-cash`}
                  type="number"
                  className="form-input"
                  placeholder={`Min. ${rp(total)}`}
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  min={total}
                  step={1000}
                  autoFocus
                  style={{ fontSize: 'var(--text-xl)', textAlign: 'center', fontWeight: 'var(--weight-bold)' }}
                />
              </div>
              {/* Quick amounts */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {quickAmounts.map((a) => (
                  <button key={a} onClick={() => setCashInput(a.toString())} className="btn btn-secondary" style={{ flex: 1, minWidth: 80, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
                    {rp(a)}
                  </button>
                ))}
              </div>
              {/* Kembalian */}
              {cashChange !== null && (
                <div style={{
                  padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                  background: cashChange >= 0 ? 'var(--color-success-light)' : 'var(--color-error-light)',
                  textAlign: 'center', transition: 'background 0.2s',
                }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Kembalian</div>
                  <div style={{
                    fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)',
                    color: cashChange >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                  }}>
                    {cashChange >= 0 ? rp(cashChange) : '⚠ Kurang!'}
                  </div>
                </div>
              )}
            </>
          )}

          {/* QRIS section */}
          {method === 'QRIS' && (
            <div style={{ textAlign: 'center' }}>
              {qrisInfo?.qrImageUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{
                    border: '3px solid var(--color-primary)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3)',
                    background: 'white',
                    display: 'inline-block',
                  }}>
                    <Image
                      src={qrisInfo.qrImageUrl}
                      alt="QR Code Pembayaran"
                      width={200} height={200}
                      style={{ display: 'block', borderRadius: 'var(--radius-sm)' }}
                    />
                  </div>
                  {(qrisInfo.bankName || qrisInfo.accountName) && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      {qrisInfo.bankName && <div style={{ fontWeight: 'var(--weight-semibold)' }}>{qrisInfo.bankName}</div>}
                      {qrisInfo.accountName && <div>{qrisInfo.accountName}</div>}
                    </div>
                  )}
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', maxWidth: 300 }}>
                    Silakan arahkan kamera HP ke QR Code di atas, lalu klik <strong>Konfirmasi</strong> setelah pembayaran berhasil.
                  </p>
                </div>
              ) : (
                <div style={{
                  padding: 'var(--space-8)', background: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 'var(--space-3)',
                }}>
                  <AlertTriangle size={40} style={{ color: 'var(--color-warning)', opacity: 0.7 }} />
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    QR Code QRIS belum dikonfigurasi Admin. Gunakan pembayaran <strong>Tunai</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }} disabled={loading}>
              Batal
            </button>
            <button
              id={`${uid}-confirm`}
              onClick={() => onConfirm(cashInput ? parseFloat(cashInput) : undefined)}
              className="btn btn-primary"
              style={{ flex: 2 }}
              disabled={
                loading ||
                (method === 'CASH' && (!cashInput || cashAmount < total)) ||
                (method === 'QRIS' && !qrisInfo?.qrImageUrl)
              }
            >
              {loading
                ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Memproses...</>
                : <><CheckCircle size={16} /> {method === 'CASH' ? 'Konfirmasi Bayar' : 'Konfirmasi Diterima'}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Success Modal ─────────────────────────────────────────────
function SuccessModal({
  invoiceNumber, total, change, method, onClose,
}: {
  invoiceNumber: string; total: number; change: number | null; method: PaymentMethod; onClose: () => void;
}) {
  const uid = useId();
  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)', backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        animation: 'fade-in 0.15s ease',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 360, margin: 0, textAlign: 'center', boxShadow: 'var(--shadow-xl)' }}>
        <div className="card-body" style={{
          padding: 'var(--space-8)', display: 'flex',
          flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'var(--color-success-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'check-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          }}>
            <CheckCircle size={40} style={{ color: 'var(--color-success)' }} />
          </div>
          <div>
            <h2 id={`${uid}-title`} style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)' }}>
              Transaksi Berhasil!
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              {method === 'CASH' ? 'Pembayaran tunai diterima' : 'Pembayaran QRIS dikonfirmasi'}
            </p>
          </div>

          <div style={{
            width: '100%', padding: 'var(--space-4)',
            background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>No. Invoice</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                {invoiceNumber}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Total</span>
              <span style={{ fontWeight: 'var(--weight-bold)' }}>{rp(total)}</span>
            </div>
            {change !== null && change > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Kembalian</span>
                <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-success)' }}>{rp(change)}</span>
              </div>
            )}
          </div>

          <button id={`${uid}-close`} onClick={onClose} className="btn btn-primary" style={{ width: '100%' }}>
            Transaksi Berikutnya
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Halaman POS ───────────────────────────────────────────────
export default function PosPage() {
  const uid = useId();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // State
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [showPayment, setShowPayment] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [processingTx, setProcessingTx] = useState(false);
  const [showCart, setShowCart] = useState(false); // mobile cart toggle
  const [lastTx, setLastTx] = useState<{
    invoiceNumber: string; total: number; change: number | null; method: PaymentMethod;
  } | null>(null);
  const [shiftDuration, setShiftDuration] = useState('');
  const [showPosScanner, setShowPosScanner] = useState(false);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const posCamRef = useRef<HTMLVideoElement>(null);
  const posScanInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch session info
  useEffect(() => {
    fetch('/api/kasir/sesi')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setSession(json.data);
        else router.push('/kasir/login');
      })
      .catch(() => router.push('/kasir/login'));
  }, [router]);

  // Update shift duration setiap menit
  useEffect(() => {
    if (!session?.shift?.clockIn) return;
    const update = () => setShiftDuration(formatShiftDuration(session.shift!.clockIn));
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [session?.shift?.clockIn]);

  // Keyboard shortcut Ctrl+K → focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Fetch produk
  const fetchProducts = useCallback(async (q = '', catId = '') => {
    try {
      const params = new URLSearchParams({ q, ...(catId && { categoryId: catId }) });
      const res = await fetch(`/api/kasir/produk?${params}`);
      if (res.status === 401) { router.push('/kasir/login'); return; }
      const json = await res.json();
      if (json.success) {
        setProducts(json.data?.products ?? []);
        setCategories(json.data?.categories ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    const t = setTimeout(() => fetchProducts(search, activeCategory), 300);
    return () => clearTimeout(t);
  }, [search, activeCategory, fetchProducts]);

  // ── Barcode POS scanner (DB-first -> notif) ─────────────
  async function startPosScanner() {
    setShowPosScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!posCamRef.current) return;
      posCamRef.current.srcObject = stream;
      await posCamRef.current.play();
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
      posScanInterval.current = setInterval(async () => {
        if (!posCamRef.current || posCamRef.current.readyState < 2) return;
        const codes = await detector.detect(posCamRef.current).catch(() => []);
        if (codes.length > 0 && codes[0]) {
          stopPosScanner();
          await handleBarcodeScanned(codes[0].rawValue);
        }
      }, 400);
    } catch {
      setScanToast('Kamera tidak dapat diakses.');
      setShowPosScanner(false);
      setTimeout(() => setScanToast(null), 3000);
    }
  }

  function stopPosScanner() {
    if (posScanInterval.current) clearInterval(posScanInterval.current);
    if (posCamRef.current?.srcObject) {
      (posCamRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      posCamRef.current.srcObject = null;
    }
    setShowPosScanner(false);
  }

  async function handleBarcodeScanned(barcode: string) {
    // 1. Cari di DB lokal dulu (produk yang sudah diinput admin)
    try {
      const res = await fetch(`/api/kasir/produk/barcode?code=${encodeURIComponent(barcode)}`);
      const json = await res.json() as { success: boolean; data?: { found: boolean; product?: Product } };
      if (json.success && json.data?.found && json.data.product) {
        addToCart(json.data.product);
        setScanToast(`Ditambahkan: ${json.data.product.name}`);
        setTimeout(() => setScanToast(null), 2500);
        return;
      }
    } catch { /* jaringan error */ }
    // 2. Tidak ada di DB
    setScanToast(`Barcode ${barcode} belum terdaftar. Hubungi admin.`);
    setTimeout(() => setScanToast(null), 4000);
  }

  // Cart ops
  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      if (existing) {
        if (existing.qty >= product.stockQty) return prev;
        return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => i.id === id ? { ...i, qty: Math.max(0, Math.min(i.qty + delta, i.stockQty)) } : i)
        .filter((i) => i.qty > 0),
    );
  };

  const clearCart = () => setCart([]);
  const total = cart.reduce((sum, i) => sum + parseFloat(i.sellingPrice) * i.qty, 0);
  const totalItems = cart.reduce((sum, i) => sum + i.qty, 0);

  // Submit transaksi
  async function handleConfirmPayment(cashReceived?: number) {
    setProcessingTx(true);
    try {
      const res = await fetch('/api/kasir/transaksi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((i) => ({ productId: i.id, qty: i.qty })),
          paymentMethod,
          cashReceived,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = typeof json.error === 'string'
          ? json.error
          : 'Transaksi gagal. Silakan coba lagi.';
        alert(msg);
        return;
      }
      setLastTx({
        invoiceNumber: json.data.invoiceNumber,
        total: json.data.grossAmount,
        change: json.data.changeAmount,
        method: paymentMethod,
      });
      setShowPayment(false);
      setShowSuccess(true);
      setShowCart(false);
      clearCart();
      fetchProducts(search, activeCategory);
    } catch {
      alert('Terjadi kesalahan jaringan.');
    } finally {
      setProcessingTx(false);
    }
  }

  async function handleLogout() {
    // role: 'employee' agar hanya cookie sk_kasir yang dihapus
    // — tidak mengganggu sesi admin yang aktif di tab lain
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'employee' }),
    });
    router.push('/kasir/login');
    router.refresh();
  }

  const kasirName = session?.employee?.fullName ?? '...';

  return (
    <div className="layout-pos">

      {/* ── Scan Toast ──────────────────────────────────── */}
      {scanToast && (
        <div style={{
          position: 'fixed', bottom: 'var(--space-8)', left: '50%', transform: 'translateX(-50%)',
          zIndex: 2000, background: 'var(--color-surface)', color: 'var(--color-text)',
          padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-full)',
          boxShadow: 'var(--shadow-xl)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }} role="status" aria-live="polite">
          {scanToast}
        </div>
      )}

      {/* ── POS Barcode Scanner Modal ────────────────────── */}
      {showPosScanner && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1500, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.88)',
        }}>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
            Arahkan kamera ke barcode produk
          </p>
          <div style={{ position: 'relative', width: 300, height: 220, borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={posCamRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline />
            <div style={{ position: 'absolute', inset: 0, border: '3px solid var(--color-primary)', borderRadius: 'var(--radius-xl)', pointerEvents: 'none' }} />
            {/* Animated scan line */}
            <div style={{ position: 'absolute', top: '50%', left: '10%', right: '10%', height: 2, background: 'var(--color-primary)', opacity: 0.9, animation: 'scan-line 1.5s linear infinite', pointerEvents: 'none' }} />
          </div>
          <button onClick={stopPosScanner} className="btn btn-secondary" style={{ marginTop: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <X size={16} /> Tutup Scanner
          </button>
        </div>
      )}

      {/* ── Top bar ────────────────────────────────────── */}
      <header className="pos-topbar">
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{
              color: 'var(--color-text-inverse)', fontWeight: 'var(--weight-bold)',
              fontSize: 'var(--text-sm)', letterSpacing: 'var(--tracking-wide)',
            }}>
              🏪 SMARTKASIR
            </span>
            <span style={{ color: 'var(--color-sidebar-muted)', fontSize: 'var(--text-xs)' }}>
              Perwira UNPERBA
            </span>
          </div>
        </div>

        {/* Search — hidden on mobile */}
        <div style={{ flex: 1, maxWidth: 380, position: 'relative' }} className="pos-search-wrap">
          <Search
            size={14}
            style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)',
              pointerEvents: 'none',
            }}
          />
          <input
            ref={searchRef}
            id={`${uid}-search`}
            type="search"
            placeholder="Cari produk... (Ctrl+K)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Cari produk"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 'var(--radius-full)',
              padding: '7px 12px 7px 30px',
              color: 'white',
              fontSize: 'var(--text-sm)',
              outline: 'none',
            }}
          />
        </div>

        {/* Tombol Scan Barcode */}
        <button
          onClick={startPosScanner}
          aria-label="Scan barcode produk"
          title="Scan Barcode"
          style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
            color: 'white', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
            flexShrink: 0,
          }}
        >
          <ScanLine size={16} aria-hidden="true" />
          <span className="pos-search-wrap">Scan</span>
        </button>

        {/* User info + Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Kasir info — hidden on very small screens */}
          <div className="pos-kasir-info">
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              color: 'var(--color-sidebar-text)',
            }}>
              <User size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {kasirName}
              </span>
            </div>
            {session?.shift && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--color-sidebar-muted)' }}>
                <Clock size={12} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 10 }}>
                  {formatTimeShort(session.shift.clockIn)} · {shiftDuration}
                </span>
              </div>
            )}
          </div>

          {/* Mobile cart button */}
          <button
            id="btn-show-cart"
            onClick={() => setShowCart((v) => !v)}
            className="pos-cart-toggle"
            aria-label="Buka keranjang"
          >
            <ShoppingCart size={18} />
            {totalItems > 0 && (
              <span className="pos-cart-badge">{totalItems}</span>
            )}
          </button>

          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-sidebar-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: '6px 10px',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-medium)',
              transition: 'all var(--duration-fast)',
            }}
            aria-label="Keluar dari sesi"
          >
            <LogOut size={14} />
            <span className="pos-logout-label">Keluar</span>
          </button>
        </div>
      </header>

      {/* ── Produk area ───────────────────────────────── */}
      <div className="pos-products">
        {/* Search mobile */}
        <div className="pos-mobile-search">
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
          <input
            type="search"
            placeholder="Cari produk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Cari produk (mobile)"
            style={{
              width: '100%',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-full)',
              padding: '8px 12px 8px 32px',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              background: 'var(--color-surface)',
            }}
          />
        </div>

        {/* Category tabs */}
        <div className="pos-category-tabs" role="tablist" aria-label="Filter kategori produk">
          <button
            role="tab"
            aria-selected={!activeCategory}
            onClick={() => setActiveCategory('')}
            className={`pos-cat-btn${!activeCategory ? ' active' : ''}`}
            id={`${uid}-cat-all`}
          >
            Semua
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={activeCategory === c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`pos-cat-btn${activeCategory === c.id ? ' active' : ''}`}
              id={`${uid}-cat-${c.id}`}
              style={{ whiteSpace: 'nowrap' }}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Products grid */}
        <div className="pos-products-grid" role="list" aria-label="Daftar produk">
          {loading ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--space-16)', color: 'var(--color-text-muted)' }}>
              <Loader2 size={32} style={{ margin: '0 auto', animation: 'spin 1s linear infinite' }} />
              <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>Memuat produk...</p>
            </div>
          ) : products.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Package size={48} style={{ margin: '0 auto var(--space-4)', opacity: 0.2 }} />
              <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
                {search ? `Tidak ada produk untuk "${search}"` : 'Tidak ada produk tersedia'}
              </p>
              {search && (
                <button onClick={() => setSearch('')} className="btn btn-ghost" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                  Reset pencarian
                </button>
              )}
            </div>
          ) : (
            products.map((p) => (
              <div key={p.id} role="listitem">
                <ProductCard product={p} onAdd={addToCart} />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Keranjang ────────────────────────────────── */}
      {/* Backdrop on mobile */}
      {showCart && (
        <div
          aria-hidden="true"
          onClick={() => setShowCart(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 19,
            backgroundColor: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(2px)',
            animation: 'fade-in 0.15s ease',
          }}
        />
      )}

      <aside
        className={`pos-cart${showCart ? ' pos-cart-open' : ''}`}
        aria-label="Keranjang belanja"
      >
        {/* Cart header */}
        <div className="pos-cart-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ShoppingCart size={18} style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontWeight: 'var(--weight-semibold)' }}>Keranjang</span>
            {totalItems > 0 && (
              <span style={{
                background: 'var(--color-primary)', color: 'white',
                borderRadius: '999px', fontSize: 11, fontWeight: 700,
                padding: '1px 7px', minWidth: 22, textAlign: 'center',
              }}>
                {totalItems}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)' }}
              >
                Kosongkan
              </button>
            )}
            {/* Mobile close button */}
            <button
              onClick={() => setShowCart(false)}
              className="pos-cart-close-btn"
              aria-label="Tutup keranjang"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Cart items */}
        <div className="pos-cart-items">
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-muted)' }}>
              <ShoppingCart size={40} style={{ margin: '0 auto var(--space-3)', opacity: 0.15 }} />
              <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                Keranjang kosong.<br />Tap produk untuk menambah.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {cart.map((item) => (
                <div key={item.id} className="pos-cart-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginBottom: 2,
                    }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--weight-semibold)' }}>
                      {rp(parseFloat(item.sellingPrice) * item.qty)}
                    </div>
                  </div>
                  {/* Qty controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
                    <button
                      onClick={() => updateQty(item.id, -1)}
                      aria-label={`Kurangi ${item.name}`}
                      className="pos-qty-btn"
                    >
                      <Minus size={11} />
                    </button>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', minWidth: 22, textAlign: 'center' }}>
                      {item.qty}
                    </span>
                    <button
                      onClick={() => updateQty(item.id, 1)}
                      disabled={item.qty >= item.stockQty}
                      aria-label={`Tambah ${item.name}`}
                      className="pos-qty-btn"
                      style={{ opacity: item.qty >= item.stockQty ? 0.35 : 1 }}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                  <button
                    onClick={() => setCart((prev) => prev.filter((i) => i.id !== item.id))}
                    aria-label={`Hapus ${item.name}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', opacity: 0.6, padding: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart footer */}
        <div className="pos-cart-footer">
          {/* Subtotal */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              {totalItems} item
            </span>
            <span style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
              {rp(total)}
            </span>
          </div>

          {/* Payment method */}
          <div
            style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}
            role="group"
            aria-label="Metode pembayaran"
          >
            {(['CASH', 'QRIS'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                id={`${uid}-method-${m.toLowerCase()}`}
                onClick={() => setPaymentMethod(m)}
                aria-pressed={paymentMethod === m}
                className={`pos-method-btn${paymentMethod === m ? ' active' : ''}`}
                style={{ flex: 1 }}
              >
                {m === 'CASH'
                  ? <><Banknote size={14} /> Cash</>
                  : <><QrCodeIcon size={14} /> QRIS</>}
              </button>
            ))}
          </div>

          {/* Bayar button */}
          <button
            id={`${uid}-bayar`}
            onClick={() => setShowPayment(true)}
            className="btn btn-primary"
            disabled={cart.length === 0}
            style={{ width: '100%', minHeight: 52, fontSize: 'var(--text-base)', gap: 'var(--space-2)' }}
          >
            <CheckCircle size={20} />
            {cart.length === 0 ? 'Pilih Produk Dulu' : `Bayar ${rp(total)}`}
          </button>
        </div>
      </aside>

      {/* Modals */}
      {showPayment && (
        <PaymentModal
          total={total}
          method={paymentMethod}
          qrisInfo={session?.qris ?? null}
          onClose={() => setShowPayment(false)}
          onConfirm={handleConfirmPayment}
          loading={processingTx}
        />
      )}
      {showSuccess && lastTx && (
        <SuccessModal
          invoiceNumber={lastTx.invoiceNumber}
          total={lastTx.total}
          change={lastTx.change}
          method={lastTx.method}
          onClose={() => setShowSuccess(false)}
        />
      )}
    </div>
  );
}
