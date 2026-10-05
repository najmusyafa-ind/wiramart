'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import Image from 'next/image';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Banknote,
  CheckCircle, X, Loader2, Package, LogOut, ArrowLeftRight,
  User, Clock, AlertTriangle, ScanLine, MoreVertical, ChevronRight,
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
  shift: { id: string; clockIn: string; modalAwal: string | null } | null;
  qris: { qrImageUrl: string | null; bankName: string | null; accountName: string | null; isActive: boolean } | null;
  store: { name: string; address: string; phone: string };
  otherActiveShifts: { kasirName: string; kasirNim: string; clockIn: string; shiftId: string }[];
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

// ── Buka Shift Overlay ───────────────────────────────────────
// Blocking overlay yang muncul setelah login jika modal awal belum diisi.
// Jika ada kasir lain yang masih aktif → tampilkan warning handover.
function BukaShiftOverlay({
  kasirName,
  otherActiveShifts,
  onSuccess,
}: {
  kasirName: string;
  otherActiveShifts: SessionInfo['otherActiveShifts'];
  onSuccess: (modalAwal: number) => void;
}) {
  const [modalInput, setModalInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fase handover: jika ada kasir lain aktif, tampilkan konfirmasi dulu
  const [handoverConfirmed, setHandoverConfirmed] = useState(false);

  const hasOtherShift = otherActiveShifts.length > 0;
  // Tampilkan warning handover jika ada kasir lain & belum dikonfirmasi
  const showHandoverWarning = hasOtherShift && !handoverConfirmed;

  const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');
  const quickAmounts = [0, 50000, 100000, 200000, 500000];
  const modalNominal = modalInput ? parseFloat(modalInput.replace(/\D/g, '')) : NaN;

  async function handleBuka() {
    const nominal = parseFloat(modalInput.replace(/\D/g, ''));
    if (isNaN(nominal) || nominal < 0) {
      setError('Masukkan nominal modal awal yang valid (boleh 0).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/kasir/shift/buka', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modalAwal: nominal }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Gagal membuka shift.');
        return;
      }
      onSuccess(nominal);
    } catch {
      setError('Kesalahan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="buka-shift-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-3)',
        background: 'linear-gradient(135deg, var(--color-primary) 0%, hsl(220, 70%, 25%) 100%)',
        overflowY: 'auto',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%', maxWidth: 420, margin: 'auto', boxShadow: 'var(--shadow-xl)',
          marginTop: 'env(safe-area-inset-top, 0)',
          marginBottom: 'env(safe-area-inset-bottom, 0)',
        }}
      >
        <div className="card-body" style={{ padding: 'clamp(var(--space-4), 5vw, var(--space-6))', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

          {/* ── HANDOVER WARNING — tampil jika kasir lain masih aktif ── */}
          {showHandoverWarning ? (
            <>
              {/* Header warning */}
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 60, height: 60, borderRadius: '50%',
                  background: 'hsl(38 95% 90%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto var(--space-2)',
                  fontSize: 28,
                }}>⚠️</div>
                <h2 id="buka-shift-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)' }}>
                  Perhatian: Ada Shift Aktif
                </h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
                  Kasir berikut masih memiliki shift yang belum ditutup:
                </p>
              </div>

              {/* Daftar kasir yang masih aktif */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {otherActiveShifts.map((s) => (
                  <div
                    key={s.shiftId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                      padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                      background: 'hsl(38 95% 96%)', border: '1px solid hsl(38 90% 75%)',
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'hsl(38 90% 85%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, flexShrink: 0,
                    }}>👤</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                        {s.kasirName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        NIM {s.kasirNim} • Masuk sejak {formatTimeShort(s.clockIn)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Instruksi */}
              <div style={{
                padding: 'var(--space-3)',
                background: 'var(--color-surface-elevated)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8rem',
                lineHeight: 1.5,
                color: 'var(--color-text-secondary)',
              }}>
                <strong>Apa yang perlu dilakukan:</strong>
                <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  <li>Minta kasir sebelumnya menutup shift mereka terlebih dahulu.</li>
                  <li>Atau hubungi Admin untuk menutup shift secara manual.</li>
                  <li>Jika sudah dikonfirmasi serah terima secara fisik, klik tombol di bawah.</li>
                </ol>
              </div>

              {error && (
                <div style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', fontSize: '0.8rem', color: 'var(--color-error)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  {error}
                </div>
              )}

              <button
                id="btn-konfirmasi-handover"
                onClick={() => setHandoverConfirmed(true)}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  minHeight: 52,
                  whiteSpace: 'normal',
                  lineHeight: 1.4,
                  padding: 'var(--space-3) var(--space-4)',
                  textAlign: 'center',
                }}
              >
                Saya Sudah Serah Terima &mdash; Lanjut Buka Shift
              </button>

              <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>
                Shift aktif yang ada akan tetap terbuka sampai kasir tsb atau Admin menutupnya.
              </p>
            </>
          ) : (
            <>
              {/* ── FORM BUKA SHIFT (normal / setelah konfirmasi handover) ── */}
              {/* Header */}
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'var(--color-primary-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto var(--space-2)',
                }}>
                  <Banknote size={28} style={{ color: 'var(--color-primary)' }} />
                </div>
                <h2 id="buka-shift-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)', margin: '0 0 var(--space-1)' }}>
                  Buka Shift
                </h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
                  Halo, <strong>{kasirName}</strong>! Masukkan uang di laci kasir.
                </p>
              </div>

              {/* Badge handover jika tadi dikonfirmasi */}
              {handoverConfirmed && hasOtherShift && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-success-light)',
                  border: '1px solid var(--color-success)',
                  fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 600,
                }}>
                  ✓ Serah terima dikonfirmasi. Masukkan modal awal yang diterima.
                </div>
              )}

              {/* Info box */}
              <div style={{
                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                background: 'var(--color-warning-light)',
                border: '1px solid var(--color-warning)',
                fontSize: '0.72rem', color: 'var(--color-text)', lineHeight: 1.4,
              }}>
                <strong>ℹ️</strong> Shift pertama? Masukkan <strong>0</strong> jika laci kosong. Serah terima? Masukkan saldo yang diterima.
              </div>

              {/* Input nominal */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="modal-awal-input" className="form-label">Modal Awal (Rp) *</label>
                <input
                  id="modal-awal-input"
                  type="number"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="0"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  min={0}
                  step={1000}
                  style={{
                    fontSize: 'clamp(1.25rem, 6vw, var(--text-2xl))',
                    textAlign: 'center',
                    fontWeight: 'var(--weight-bold)',
                    minHeight: 52,
                  }}
                />
              </div>

              {/* Quick amount buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                {quickAmounts.map((a) => (
                  <button
                    key={a}
                    onClick={() => setModalInput(a.toString())}
                    className="btn btn-secondary"
                    style={{
                      minHeight: 44,
                      padding: 'var(--space-2) var(--space-1)',
                      fontSize: '0.72rem',
                      fontWeight: 'var(--weight-semibold)',
                    }}
                  >
                    {a === 0 ? 'Kosong (Rp 0)' : rp(a)}
                  </button>
                ))}
              </div>

              {/* Preview */}
              {!isNaN(modalNominal) && (
                <div style={{
                  textAlign: 'center', padding: 'var(--space-3)',
                  background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)',
                }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Modal tercatat</div>
                  <div style={{ fontSize: 'clamp(1.25rem, 5vw, var(--text-2xl))', fontWeight: 'var(--weight-bold)', color: 'var(--color-success)' }}>
                    {rp(modalNominal)}
                  </div>
                </div>
              )}

              {error && (
                <div style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-error-light)', fontSize: '0.8rem', color: 'var(--color-error)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  {error}
                </div>
              )}

              <button
                id="btn-buka-shift"
                onClick={handleBuka}
                className="btn btn-primary"
                disabled={loading || modalInput === ''}
                style={{ width: '100%', minHeight: 52, fontSize: 'var(--text-base)', gap: 'var(--space-2)' }}
              >
                {loading
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Membuka shift...</>
                  : <><CheckCircle size={16} /> Buka Shift &amp; Mulai Jaga</>}
              </button>
            </> /* end: form normal */
          )} {/* end: ternary handover vs form */}
        </div>
      </div>
    </div>
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
                (method === 'CASH' && (!cashInput || cashAmount < total))
                // QRIS: selalu bisa konfirmasi (kasir konfirmasi manual setelah cek notif HP)
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

// ── Success Modal (Struk) ──────────────────────────────
function SuccessModal({
  invoiceNumber, total, change, method, kasirName,
  storeName, storeAddress, storePhone,
  items, onClose,
}: {
  invoiceNumber: string;
  total: number;
  change: number | null;
  method: PaymentMethod;
  kasirName: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  items: { name: string; qty: number; price: number }[];
  onClose: () => void;
}) {
  const uid = useId();
  const now = new Date().toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  function handlePrint() {
    const printContent = document.getElementById(`${uid}-struk`);
    if (!printContent) return;
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) return;
    w.document.write(`
      <html><head><title>Struk ${invoiceNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; padding: 8px; color: #000; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; }
        .total-row { display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; margin: 4px 0; }
        .footer { text-align: center; margin-top: 8px; font-size: 11px; }
      </style></head><body>
      ${printContent.innerHTML}
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  }

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
      <div className="card" style={{ width: '100%', maxWidth: 400, margin: 0, boxShadow: 'var(--shadow-xl)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-body" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          {/* Sukses badge */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'var(--color-success-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'check-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
              <CheckCircle size={34} style={{ color: 'var(--color-success)' }} />
            </div>
            <h2 id={`${uid}-title`} style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)' }}>
              Transaksi Berhasil!
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {method === 'CASH' ? '💵 Pembayaran Tunai' : '📱 Pembayaran QRIS'}
            </p>
          </div>

          {/* ── STRUK / RECEIPT ─────────────────── */}
          <div
            id={`${uid}-struk`}
            style={{
              background: '#fff',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              fontFamily: '"Courier New", monospace',
              fontSize: 'var(--text-xs)',
              color: '#000',
              lineHeight: 1.7,
            }}
          >
            {/* Header struk — dinamis dari Pengaturan Toko */}
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold', fontSize: 14 }}>🏪 {storeName}</div>
              {storeAddress && <div style={{ fontSize: 11, color: '#444' }}>{storeAddress}</div>}
              {storePhone   && <div style={{ fontSize: 11, color: '#444' }}>Telp: {storePhone}</div>}
              <div style={{ borderTop: '1px dashed #000', marginTop: 6, paddingTop: 4, fontSize: 11, color: '#555' }}>
                {now}
              </div>
            </div>

            {/* Info invoice */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Invoice</span>
              <span style={{ fontWeight: 'bold' }}>{invoiceNumber}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Kasir</span>
              <span>{kasirName}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>Metode</span>
              <span style={{ fontWeight: 'bold' }}>{method}</span>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            {/* Item list */}
            {items.map((item, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <div style={{ fontWeight: 'bold', fontSize: 11 }}>{item.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
                  <span>{item.qty} x {rp(item.price)}</span>
                  <span>{rp(item.qty * item.price)}</span>
                </div>
              </div>
            ))}

            {/* Divider */}
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            {/* Total */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 14 }}>
              <span>TOTAL</span>
              <span>{rp(total)}</span>
            </div>

            {change !== null && change >= 0 && method === 'CASH' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span>Kembalian</span>
                <span style={{ fontWeight: 'bold', color: '#166534' }}>{rp(change)}</span>
              </div>
            )}

            {/* Footer */}
            <div style={{ borderTop: '1px dashed #000', marginTop: 10, paddingTop: 6, textAlign: 'center', fontSize: 11, color: '#555' }}>
              Terima kasih sudah berbelanja! 🙏
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={handlePrint}
              className="btn btn-secondary"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-1)' }}
            >
              🖨️ Cetak Struk
            </button>
            <button
              id={`${uid}-close`}
              onClick={onClose}
              className="btn btn-primary"
              style={{ flex: 1 }}
            >
              Transaksi Berikutnya
            </button>
          </div>
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
  // Sumber kebenaran keranjang yang diperbarui SINKRON (anti closure basi saat scan beruntun)
  const cartRef = useRef<CartItem[]>([]);
  const applyCart = (fn: (prev: CartItem[]) => CartItem[]) => {
    const next = fn(cartRef.current);
    cartRef.current = next;
    setCart(next);
  };
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [showPayment, setShowPayment] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [processingTx, setProcessingTx] = useState(false);
  const [showCart, setShowCart] = useState(false); // mobile cart toggle
  const [showKasirMenu, setShowKasirMenu] = useState(false); // Option A mobile drawer menu toggle
  const [tutupLoading, setTutupLoading] = useState(false);
  const [showTutupConfirm, setShowTutupConfirm] = useState(false);
  const [tutupResult, setTutupResult] = useState<{
    totalCash: number; totalQris: number; txCount: number;
    modalAwal: number; saldoAkhirLaci: number;
  } | null>(null);
  const [lastTx, setLastTx] = useState<{
    invoiceNumber: string;
    total: number;
    change: number | null;
    method: PaymentMethod;
    items: { name: string; qty: number; price: number }[];
    kasirName: string;
    storeName: string;
    storeAddress: string;
    storePhone: string;
  } | null>(null);
  const [shiftDuration, setShiftDuration] = useState('');
  const [showPosScanner, setShowPosScanner] = useState(false);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const posCamRef = useRef<HTMLVideoElement>(null);
  const posScanInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  // mounted: mencegah hydration mismatch untuk elemen client-only di header
  const [mounted, setMounted] = useState(false);

  // Client-side mount flag — prevents hydration mismatch
  useEffect(() => { setMounted(true); }, []);

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

  // Beep sound supermarket untuk feedback audio saat barcode berhasil discan
  function playScanBeep() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      // AudioContext blocked / unsupported
    }
  }

  // Ref guard debounce mencegah double scan dalam interval singkat (< 400ms)
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  async function handleBarcodeScanned(barcode: string) {
    const cleanCode = barcode.trim();
    if (!cleanCode) return;

    const now = Date.now();
    if (lastScanRef.current.code === cleanCode && now - lastScanRef.current.time < 400) {
      return; // abaikan duplicate event
    }
    lastScanRef.current = { code: cleanCode, time: now };

    // 1. Cari di DB lokal dulu (produk yang sudah diinput admin)
    try {
      const res = await fetch(`/api/kasir/produk/barcode?code=${encodeURIComponent(cleanCode)}`);
      const json = await res.json() as { success: boolean; data?: { found: boolean; product?: Product } };
      if (json.success && json.data?.found && json.data.product) {
        // addToCart sudah menampilkan pesan sendiri jika stok habis / melebihi stok
        if (addToCart(json.data.product)) {
          playScanBeep();
          setScanToast(`Ditambahkan: ${json.data.product.name}`);
          setTimeout(() => setScanToast(null), 2500);
        }
        return;
      }
    } catch { /* jaringan error */ }
    // 2. Tidak ada di DB
    setScanToast(`Barcode ${cleanCode} belum terdaftar. Cari manual lewat nama produk, atau hubungi admin.`);
    setTimeout(() => setScanToast(null), 4500);
  }

  // ── Hardware USB Barcode Scanner Listener (HID Keyboard Mode) ─────────
  // Clabel T27H mengirim digit sangat cepat lalu diakhiri Enter.
  // Kasir bisa langsung scan produk kapan saja tanpa harus klik kolom cari.
  useEffect(() => {
    let buffer = '';
    let lastTime = 0;

    const handleHardwareScan = (e: KeyboardEvent) => {
      // Abaikan jika modal sedang terbuka
      if (showPayment || showSuccess || showTutupConfirm || showPosScanner) return;

      // Jika user sedang mengetik di input lain selain search bar, jangan intercept
      const target = e.target as HTMLElement | null;
      const isOtherInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target !== searchRef.current;
      if (isOtherInput) return;

      const now = Date.now();
      const interval = now - lastTime;
      lastTime = now;

      // Hardware barcode scanner mengirim keystroke < 60ms antar-karakter
      if (interval > 60) {
        buffer = '';
      }

      if (e.key === 'Enter') {
        const trimmed = buffer.trim();
        if (trimmed.length >= 3) {
          e.preventDefault();
          buffer = '';
          handleBarcodeScanned(trimmed);
          setSearch('');
          if (searchRef.current) searchRef.current.blur();
        }
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleHardwareScan);
    return () => window.removeEventListener('keydown', handleHardwareScan);
  }, [showPayment, showSuccess, showTutupConfirm, showPosScanner]);

  // Cart ops
  const showCartToast = (msg: string) => {
    setScanToast(msg);
    setTimeout(() => setScanToast(null), 3500);
  };

  /** @returns true jika item berhasil ditambahkan ke keranjang */
  const addToCart = (product: Product): boolean => {
    if (product.stockQty <= 0) {
      showCartToast(`"${product.name}" stok habis di sistem. Cek fisik barang / hubungi admin.`);
      return false;
    }
    const existing = cartRef.current.find((i) => i.id === product.id);
    if (existing && existing.qty >= product.stockQty) {
      showCartToast(`Stok "${product.name}" di sistem hanya ${product.stockQty}. Tidak bisa ditambah lagi.`);
      return false;
    }
    applyCart((prev) => {
      const found = prev.find((i) => i.id === product.id);
      if (found) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...product, qty: 1 }];
    });
    return true;
  };

  const updateQty = (id: string, delta: number) => {
    applyCart((prev) =>
      prev
        .map((i) => i.id === id ? { ...i, qty: Math.max(0, Math.min(i.qty + delta, i.stockQty)) } : i)
        .filter((i) => i.qty > 0),
    );
  };

  const clearCart = () => applyCart(() => []);
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
        items: cart.map((i) => ({ name: i.name, qty: i.qty, price: parseFloat(i.sellingPrice) })),
        kasirName:    session?.employee?.fullName ?? 'Kasir',
        storeName:    session?.store?.name    ?? 'WIRAMART UNPERBA',
        storeAddress: session?.store?.address ?? '',
        storePhone:   session?.store?.phone   ?? '',
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

  async function handleTutupShift() {
    setTutupLoading(true);
    try {
      const res = await fetch('/api/kasir/shift/tutup', { method: 'PATCH' });
      const json = await res.json() as {
        success: boolean;
        data?: { totalCash: number; totalQris: number; txCount: number; modalAwal: number; saldoAkhirLaci: number };
        error?: string;
      };
      if (!res.ok) {
        alert(json.error ?? 'Gagal menutup shift.');
        return;
      }
      setTutupResult(json.data ?? null);
      setShowTutupConfirm(false);
      // Update session: shift = null setelah tutup
      setSession((prev) => prev ? { ...prev, shift: null } : prev);
    } catch {
      alert('Kesalahan jaringan. Coba lagi.');
    } finally {
      setTutupLoading(false);
    }
  }

  const kasirName = session?.employee?.fullName ?? '...';
  // True jika shift ada tapi modal awal belum diisi → tampilkan overlay
  const shiftPerluModal = session !== null && session.shift !== null && session.shift.modalAwal === null;

  // Handler: setelah kasir berhasil input modal awal, update local session state
  function handleBukaShiftSuccess(modalAwal: number) {
    setSession((prev) => prev && prev.shift
      ? { ...prev, shift: { ...prev.shift, modalAwal: modalAwal.toString() } }
      : prev,
    );
  }

  return (
    <div className="layout-pos">

      {/* ── Buka Shift Overlay — blocking jika modal awal belum diisi ── */}
      {shiftPerluModal && (
        <BukaShiftOverlay
          kasirName={kasirName}
          otherActiveShifts={session?.otherActiveShifts ?? []}
          onSuccess={handleBukaShiftSuccess}
        />
      )}

      {/* ── Tutup Shift Konfirmasi Modal ─────────────────────────── */}
      {showTutupConfirm && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="tutup-shift-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 1800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4)', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 380, margin: 'auto', boxShadow: 'var(--shadow-xl)' }}>
            <div className="card-body" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <h2 id="tutup-shift-title" style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', textAlign: 'center', margin: 0 }}>
                ⚠️ Tutup Kasir?
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textAlign: 'center', margin: 0 }}>
                Shift akan ditutup sekarang. Yakin ingin menutup sesi ini?
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button onClick={() => setShowTutupConfirm(false)} className="btn btn-secondary" style={{ flex: 1 }} disabled={tutupLoading}>
                  Batal
                </button>
                <button
                  onClick={handleTutupShift}
                  className="btn btn-primary"
                  disabled={tutupLoading}
                  style={{ flex: 2, background: 'hsl(0 70% 50%)', minHeight: 44 }}
                >
                  {tutupLoading
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Menutup...</>
                    : <><X size={14} /> Ya, Tutup Kasir</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Ringkasan Shift Setelah Tutup ───────────────────────── */}
      {tutupResult && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="ringkasan-shift-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 1800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4)', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 400, margin: 'auto', boxShadow: 'var(--shadow-xl)' }}>
            <div className="card-body" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 'var(--space-2)' }}>✅</div>
                <h2 id="ringkasan-shift-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                  Shift Ditutup!
                </h2>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 'var(--space-1) 0 0' }}>
                  Ringkasan sesi kasir hari ini
                </p>
              </div>
              {/* Tabel ringkasan */}
              {([
                { label: 'Modal Awal Laci', val: rp(tutupResult.modalAwal) },
                { label: 'Total Cash Masuk', val: rp(tutupResult.totalCash), green: true },
                { label: 'Total QRIS', val: rp(tutupResult.totalQris) },
                { label: 'Total Transaksi', val: `${tutupResult.txCount} txn` },
              ]).map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>{row.label}</span>
                  <span style={{ fontWeight: 'var(--weight-semibold)', color: row.green ? 'var(--color-success)' : 'var(--color-text)' }}>{row.val}</span>
                </div>
              ))}
              {/* Saldo akhir */}
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>💰 Saldo Expected di Laci</div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-success)' }}>
                  {rp(tutupResult.saldoAkhirLaci)}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>(Modal Awal + Cash Masuk)</div>
              </div>
              <button
                onClick={() => { setTutupResult(null); handleLogout(); }}
                className="btn btn-primary"
                style={{ minHeight: 44 }}
              >
                <LogOut size={14} /> Selesai &amp; Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scan Toast ────────────────────────────────────── */}
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
              🏪 WIRAMART
            </span>
            <span style={{ color: 'var(--color-sidebar-muted)', fontSize: 'var(--text-xs)' }}>
              UKM Kewirausahaan UNPERBA
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
            placeholder="Cari produk / scan barcode... (Ctrl+K)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const code = search.trim();
                if (code.length >= 3) {
                  handleBarcodeScanned(code);
                  setSearch('');
                }
              }
            }}
            aria-label="Cari produk atau scan barcode"
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


        {/* Actions Container */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Tombol Scan Barcode — selalu tampil di desktop & mobile */}
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

          {/* Tombol Keranjang — selalu tampil di desktop & mobile */}
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

          {/* DESKTOP ACTIONS ONLY (disembunyikan di mobile <= 640px) */}
          <div className="pos-desktop-actions">
            {/* Kasir info */}
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

            {/* Tombol Kelola Produk + Tukar Shift */}
            {mounted && (
              <>
                <a
                  href="/kasir/produk"
                  id="btn-kelola-produk"
                  title="Kelola Produk"
                  aria-label="Kelola produk"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-sidebar-muted)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: '6px 10px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-medium)',
                    transition: 'all var(--duration-fast)',
                    textDecoration: 'none',
                  }}
                >
                  <Package size={14} />
                  <span>Produk</span>
                </a>
                <a
                  href="/kasir/tukar-shift"
                  id="btn-tukar-shift"
                  title="Ajukan Tukar Shift"
                  aria-label="Ajukan tukar shift"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-sidebar-muted)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    padding: '6px 10px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-medium)',
                    transition: 'all var(--duration-fast)',
                    textDecoration: 'none',
                  }}
                >
                  <ArrowLeftRight size={14} />
                  <span>Tukar Shift</span>
                </a>
              </>
            )}

            {/* Tombol Tutup Kasir — hanya jika ada shift aktif */}
            {session?.shift && (
              <button
                id="btn-tutup-kasir"
                onClick={() => setShowTutupConfirm(true)}
                title="Tutup Kasir"
                aria-label="Tutup shift kasir"
                style={{
                  background: 'rgba(220, 38, 38, 0.15)',
                  border: '1px solid rgba(220, 38, 38, 0.35)',
                  borderRadius: 'var(--radius-md)',
                  color: 'hsl(0 80% 75%)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                  padding: '6px 10px',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  transition: 'all var(--duration-fast)',
                  minHeight: 36,
                }}
              >
                <X size={14} />
                <span>Tutup Kasir</span>
              </button>
            )}

            {/* Tombol Keluar */}
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
              <span>Keluar</span>
            </button>
          </div>

          {/* MOBILE ONLY MENU TRIGGER (Kebab ⋮ button — tampil hanya di mobile <= 640px) */}
          <button
            id="btn-mobile-kasir-menu"
            onClick={() => setShowKasirMenu(true)}
            className="pos-mobile-menu-btn"
            aria-label="Menu Kasir & Akun"
            title="Menu Kasir"
          >
            <MoreVertical size={20} />
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
                    onClick={() => applyCart((prev) => prev.filter((i) => i.id !== item.id))}
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
          kasirName={lastTx.kasirName}
          storeName={lastTx.storeName}
          storeAddress={lastTx.storeAddress}
          storePhone={lastTx.storePhone}
          items={lastTx.items}
          onClose={() => setShowSuccess(false)}
        />
      )}

      {/* ── Option A: Mobile Kasir Drawer (Bottom Sheet) ───────── */}
      {showKasirMenu && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-kasir-title"
          className="pos-kasir-drawer-overlay"
          onClick={() => setShowKasirMenu(false)}
        >
          <div
            className="pos-kasir-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grab Handle */}
            <div className="pos-drawer-handle" />

            {/* Profile Info Header */}
            <div className="pos-drawer-profile">
              <div className="pos-drawer-avatar">
                <User size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                  <h3 id="mobile-kasir-title" className="pos-drawer-name">
                    {kasirName}
                  </h3>
                  <button
                    onClick={() => setShowKasirMenu(false)}
                    className="pos-drawer-close-btn"
                    aria-label="Tutup menu"
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="pos-drawer-nim">
                  NIM {session?.employee?.nim ?? '—'} &bull; {session?.employee?.jabatan ?? 'Kasir'}
                </p>
                {session?.shift && (
                  <div className="pos-drawer-shift-badge">
                    <span className="pos-drawer-pulse-dot" />
                    <span>Shift Aktif &bull; {formatTimeShort(session.shift.clockIn)} ({shiftDuration})</span>
                  </div>
                )}
              </div>
            </div>

            {/* Menu Items List */}
            <div className="pos-drawer-items">
              <a
                href="/kasir/produk"
                className="pos-drawer-link"
                onClick={() => setShowKasirMenu(false)}
              >
                <div className="pos-drawer-icon-box">
                  <Package size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="pos-drawer-link-title">Kelola Katalog Produk</div>
                  <div className="pos-drawer-link-sub">Lihat daftar harga, barcode & sisa stok</div>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--color-text-muted)' }} />
              </a>

              <a
                href="/kasir/tukar-shift"
                className="pos-drawer-link"
                onClick={() => setShowKasirMenu(false)}
              >
                <div className="pos-drawer-icon-box">
                  <ArrowLeftRight size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="pos-drawer-link-title">Ajukan Tukar Shift</div>
                  <div className="pos-drawer-link-sub">Permohonan pergantian jadwal tugas kasir</div>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--color-text-muted)' }} />
              </a>

              <div className="pos-drawer-divider" />

              {session?.shift && (
                <button
                  type="button"
                  className="pos-drawer-btn-tutup"
                  onClick={() => {
                    setShowKasirMenu(false);
                    setShowTutupConfirm(true);
                  }}
                >
                  <div className="pos-drawer-icon-box danger">
                    <X size={20} />
                  </div>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div className="pos-drawer-danger-title">Tutup Sesi Kasir</div>
                    <div className="pos-drawer-danger-sub">Selesaikan shift kerja & rekap uang laci</div>
                  </div>
                  <ChevronRight size={18} style={{ opacity: 0.7 }} />
                </button>
              )}

              <button
                type="button"
                className="pos-drawer-btn-logout"
                onClick={() => {
                  setShowKasirMenu(false);
                  handleLogout();
                }}
              >
                <div className="pos-drawer-icon-box">
                  <LogOut size={20} />
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div className="pos-drawer-link-title">Keluar dari Terminal</div>
                  <div className="pos-drawer-link-sub">Logout dari akun kasir</div>
                </div>
              </button>
            </div>

            {/* Tombol Tutup */}
            <button
              type="button"
              className="pos-drawer-dismiss-btn"
              onClick={() => setShowKasirMenu(false)}
            >
              Tutup Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
