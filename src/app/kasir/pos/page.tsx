'use client';

import { useState, useEffect, useCallback, useId, useRef, useMemo } from 'react';
import Image from 'next/image';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Banknote,
  CheckCircle, X, Loader2, Package, LogOut, ArrowLeftRight,
  User, Clock, AlertTriangle, ScanLine, MoreVertical, ChevronRight,
  Receipt, Calculator, Coins, Utensils, KeyRound, Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import KalkulatorPecahan, { type DenominasiMap } from './KalkulatorPecahan';
import KasGerakModal from './KasGerakModal';
import SisaMakananModal from './SisaMakananModal';

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
  barcode?: string | null;
  sellingPrice: string;
  stockQty: number;
  unit: string;
  categoryId: string;
  categoryName: string | null;
  photoUrl: string | null;
};
type CartItem = Product & { qty: number };
type PaymentMethod = 'CASH' | 'QRIS' | 'SPLIT';
type SplitPaymentDetail = {
  paymentMethod: 'CASH' | 'QRIS';
  amount: number;
  cashReceived?: number;
  changeAmount?: number;
};

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

function getProductEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('cilok') || n.includes('sate')) return '🍢';
  if (n.includes('sando') || n.includes('roti') || n.includes('burger')) return '🥪';
  if (n.includes('nasi') || n.includes('kebuli') || n.includes('uduk') || n.includes('cokot') || n.includes('krawu') || n.includes('jinggo')) return '🍙';
  if (n.includes('tahu') || n.includes('bakso')) return '🥟';
  if (n.includes('pentol')) return '🧆';
  if (n.includes('ades') || n.includes('air') || n.includes('mineral') || n.includes('aqua')) return '💧';
  if (n.includes('teh') || n.includes('frestea') || n.includes('tea')) return '🍵';
  if (n.includes('kopi')) return '☕';
  if (n.includes('susu') || n.includes('yakult') || n.includes('nutri') || n.includes('power ade') || n.includes('fanta') || n.includes('coca') || n.includes('pulpy')) return '🥤';
  if (n.includes('ayam') || n.includes('geprek')) return '🍗';
  if (n.includes('klepon') || n.includes('kue') || n.includes('cake') || n.includes('bagelen')) return '🧁';
  if (n.includes('basreng') || n.includes('macaroni') || n.includes('pangsit') || n.includes('kripik') || n.includes('klanting') || n.includes('kongstik') || n.includes('snack') || n.includes('rosta') || n.includes('duosus')) return '🍿';
  return '🍱';
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
  // Default modal awal paten dari owner: Rp 100.000
  const [modalInput, setModalInput] = useState('100000');
  const [breakdown, setBreakdown]   = useState<DenominasiMap>({});
  const [inputMode, setInputMode]   = useState<'QUICK' | 'CALCULATOR'>('QUICK');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  // Fase handover: jika ada kasir lain aktif, tampilkan konfirmasi dulu
  const [handoverConfirmed, setHandoverConfirmed] = useState(false);

  const hasOtherShift = otherActiveShifts.length > 0;
  // Tampilkan warning handover jika ada kasir lain & belum dikonfirmasi
  const showHandoverWarning = hasOtherShift && !handoverConfirmed;

  const rp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');
  const quickAmounts = [0, 50000, 100000, 200000, 500000];
  const modalNominal = modalInput ? parseFloat(modalInput.replace(/\D/g, '')) : NaN;

  const handleCalculatorChange = useCallback((total: number, counts: DenominasiMap) => {
    setBreakdown(counts);
    setModalInput(total.toString());
  }, []);

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
        body: JSON.stringify({
          modalAwal: nominal,
          breakdown: Object.keys(breakdown).length > 0 ? breakdown : undefined,
        }),
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
                <strong>ℹ️ Modal Paten Owner:</strong> Default modal uang kembalian di laci kasir adalah <strong>Rp 100.000</strong>. Sesuaikan nominal jika menerima serah terima saldo berbeda.
              </div>

              {/* Mode Switcher */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--color-surface-elevated)', padding: 4, borderRadius: 'var(--radius-md)' }}>
                <button
                  type="button"
                  onClick={() => setInputMode('QUICK')}
                  style={{
                    background: inputMode === 'QUICK' ? 'var(--color-surface)' : 'transparent',
                    boxShadow: inputMode === 'QUICK' ? 'var(--shadow-xs)' : 'none',
                    color: inputMode === 'QUICK' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: 700,
                    border: 'none',
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Banknote size={14} />
                  Input Cepat
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('CALCULATOR')}
                  style={{
                    background: inputMode === 'CALCULATOR' ? 'var(--color-surface)' : 'transparent',
                    boxShadow: inputMode === 'CALCULATOR' ? 'var(--shadow-xs)' : 'none',
                    color: inputMode === 'CALCULATOR' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: 700,
                    border: 'none',
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Calculator size={14} />
                  Hitung Fisik (Pecahan)
                </button>
              </div>

              {inputMode === 'QUICK' ? (
                <>
                  {/* Input nominal cepat */}
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
                        type="button"
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
                </>
              ) : (
                <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                  <KalkulatorPecahan initialBreakdown={breakdown} onChange={handleCalculatorChange} />
                </div>
              )}

              {/* Preview */}
              {!isNaN(modalNominal) && (
                <div style={{
                  textAlign: 'center', padding: 'var(--space-3)',
                  background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)',
                }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Modal tercatat di laci</div>
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
  total, method: initialMethod, qrisInfo, onClose, onConfirm, loading,
}: {
  total: number;
  method: PaymentMethod;
  qrisInfo: SessionInfo['qris'];
  onClose: () => void;
  onConfirm: (cashReceived?: number, payments?: SplitPaymentDetail[]) => void;
  loading: boolean;
}) {
  const uid = useId();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(initialMethod);

  // Tunai state
  const [cashInput, setCashInput] = useState('');
  const cashAmount = cashInput ? parseFloat(cashInput) : 0;
  const cashChange = cashInput ? cashAmount - total : null;

  // Split (Campuran QRIS + Tunai) state
  const [splitQrisInput, setSplitQrisInput] = useState('');
  const [splitCashReceivedInput, setSplitCashReceivedInput] = useState('');
  const splitQrisAmount = splitQrisInput ? parseFloat(splitQrisInput) : 0;
  const splitCashNeeded = Math.max(0, total - splitQrisAmount);
  const splitCashReceived = splitCashReceivedInput ? parseFloat(splitCashReceivedInput) : 0;
  const splitCashChange = splitCashReceivedInput ? splitCashReceived - splitCashNeeded : null;

  // Split validation flags
  const isSplitQrisValid = splitQrisAmount > 0 && splitQrisAmount < total;
  const isSplitCashValid = isSplitQrisValid && splitCashReceivedInput !== '' && splitCashReceived >= splitCashNeeded;
  const isSplitReady = isSplitQrisValid && isSplitCashValid;

  const quickAmountsCash = [total, 20000, 50000, 100000, 150000, 200000]
    .filter((a, i, arr) => arr.indexOf(a) === i && a >= total)
    .slice(0, 4);

  const quickQrisSplit = [
    Math.round(total / 2 / 1000) * 1000,
    10000, 20000, 30000, 50000, 100000,
  ].filter((a, i, arr) => arr.indexOf(a) === i && a > 0 && a < total).slice(0, 4);

  const quickCashSplit = [
    splitCashNeeded,
    10000, 20000, 50000, 100000,
  ].filter((a, i, arr) => arr.indexOf(a) === i && a >= splitCashNeeded).slice(0, 4);

  function handleTriggerConfirm() {
    if (selectedMethod === 'CASH') {
      const payments: SplitPaymentDetail[] = [{
        paymentMethod: 'CASH',
        amount: total,
        cashReceived: cashAmount,
        changeAmount: Math.max(0, cashAmount - total),
      }];
      onConfirm(cashAmount, payments);
    } else if (selectedMethod === 'QRIS') {
      const payments: SplitPaymentDetail[] = [{
        paymentMethod: 'QRIS',
        amount: total,
      }];
      onConfirm(undefined, payments);
    } else if (selectedMethod === 'SPLIT') {
      const payments: SplitPaymentDetail[] = [
        {
          paymentMethod: 'QRIS',
          amount: splitQrisAmount,
        },
        {
          paymentMethod: 'CASH',
          amount: splitCashNeeded,
          cashReceived: splitCashReceived,
          changeAmount: Math.max(0, splitCashReceived - splitCashNeeded),
        },
      ];
      onConfirm(splitCashReceived, payments);
    }
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
      <div className="card" style={{ width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto', margin: 0, boxShadow: 'var(--shadow-xl)' }}>
        <div className="card-header" style={{ paddingBottom: 'var(--space-2)' }}>
          <h2 id={`${uid}-title`} className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {selectedMethod === 'CASH' && <><Banknote size={18} style={{ color: 'var(--color-accent)' }} /> Pembayaran Tunai</>}
            {selectedMethod === 'QRIS' && <><QrCodeIcon size={18} /> Pembayaran QRIS</>}
            {selectedMethod === 'SPLIT' && <><ArrowLeftRight size={18} style={{ color: 'var(--color-primary)' }} /> Pembayaran Campuran (Split)</>}
          </h2>
          <button
            onClick={onClose}
            aria-label="Tutup"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab switcher agar kasir bisa ganti metode langsung tanpa tutup modal */}
        <div style={{ display: 'flex', gap: 6, padding: '0 var(--space-4)', marginTop: -4 }}>
          {(['CASH', 'QRIS', 'SPLIT'] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSelectedMethod(m)}
              className={`pos-method-btn${selectedMethod === m ? ' active' : ''}`}
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 'var(--text-xs)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {m === 'CASH' && <><Banknote size={13} /> Tunai</>}
              {m === 'QRIS' && <><QrCodeIcon size={13} /> QRIS</>}
              {m === 'SPLIT' && <><ArrowLeftRight size={13} /> Split</>}
            </button>
          ))}
        </div>

        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
          {/* Total Tagihan */}
          <div style={{
            textAlign: 'center', padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 2 }}>Total Tagihan Belanja</div>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
              {rp(total)}
            </div>
          </div>

          {/* 1. Cash section */}
          {selectedMethod === 'CASH' && (
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
                {quickAmountsCash.map((a) => (
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

          {/* 2. QRIS section */}
          {selectedMethod === 'QRIS' && (
            <div style={{ textAlign: 'center' }}>
              {qrisInfo?.qrImageUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{
                    border: '2px solid var(--color-primary)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3)',
                    background: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    maxWidth: 270,
                    margin: '0 auto',
                    boxShadow: 'var(--shadow-sm)',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrisInfo.qrImageUrl}
                      alt="QR Code Pembayaran QRIS"
                      style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: 300,
                        objectFit: 'contain',
                        display: 'block',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    />
                  </div>
                  {(qrisInfo.bankName || qrisInfo.accountName) && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      {qrisInfo.bankName && <div style={{ fontWeight: 'var(--weight-semibold)' }}>{qrisInfo.bankName}</div>}
                      {qrisInfo.accountName && <div>{qrisInfo.accountName}</div>}
                    </div>
                  )}
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: 300 }}>
                    Silakan minta pembeli scan QR di atas nominal <strong>{rp(total)}</strong>, lalu klik <strong>Konfirmasi Diterima</strong>.
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

          {/* 3. SPLIT section (QRIS + Tunai) */}
          {selectedMethod === 'SPLIT' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Langkah 1: Porsi QRIS */}
              <div style={{
                background: 'hsl(var(--color-primary-h, 220), 40%, 97%)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-2)' }}>
                  <QrCodeIcon size={16} />
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                    1. Porsi Dibayar QRIS
                  </span>
                </div>
                <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                  <input
                    id={`${uid}-split-qris`}
                    type="number"
                    className="form-input"
                    placeholder="Contoh: 20000"
                    value={splitQrisInput}
                    onChange={(e) => setSplitQrisInput(e.target.value)}
                    min={1}
                    max={total - 1}
                    step={1000}
                    autoFocus
                    style={{ fontSize: 'var(--text-lg)', textAlign: 'center', fontWeight: 'var(--weight-bold)' }}
                  />
                </div>
                {/* Quick pills QRIS */}
                {quickQrisSplit.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                    {quickQrisSplit.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setSplitQrisInput(a.toString())}
                        className="btn btn-secondary"
                        style={{ flex: 1, minWidth: 60, padding: '3px 6px', fontSize: 'var(--text-xs)' }}
                      >
                        {rp(a)}
                      </button>
                    ))}
                  </div>
                )}
                {splitQrisAmount >= total && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginTop: 2 }}>
                    ⚠ Porsi QRIS tidak boleh menyamai atau melebihi total tagihan. Gunakan tab QRIS jika ingin bayar penuh non-tunai.
                  </div>
                )}
              </div>

              {/* Langkah 2: Sisa Tunai */}
              <div style={{
                background: 'hsl(var(--color-accent-h, 142), 40%, 97%)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Banknote size={16} style={{ color: 'var(--color-accent)' }} />
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
                      2. Sisa Tagihan Tunai
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                    {rp(splitCashNeeded)}
                  </span>
                </div>
                <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                  <label htmlFor={`${uid}-split-cash`} className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                    Uang Tunai Diterima (Rp)
                  </label>
                  <input
                    id={`${uid}-split-cash`}
                    type="number"
                    className="form-input"
                    placeholder={`Min. ${rp(splitCashNeeded)}`}
                    value={splitCashReceivedInput}
                    onChange={(e) => setSplitCashReceivedInput(e.target.value)}
                    min={splitCashNeeded}
                    step={1000}
                    disabled={!isSplitQrisValid}
                    style={{ fontSize: 'var(--text-lg)', textAlign: 'center', fontWeight: 'var(--weight-bold)' }}
                  />
                </div>
                {/* Quick pills Cash */}
                {isSplitQrisValid && quickCashSplit.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                    {quickCashSplit.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setSplitCashReceivedInput(a.toString())}
                        className="btn btn-secondary"
                        style={{ flex: 1, minWidth: 60, padding: '3px 6px', fontSize: 'var(--text-xs)' }}
                      >
                        {rp(a)}
                      </button>
                    ))}
                  </div>
                )}
                {/* Kembalian Tunai */}
                {isSplitQrisValid && splitCashReceivedInput !== '' && splitCashChange !== null && (
                  <div style={{
                    padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                    background: splitCashChange >= 0 ? 'var(--color-success-light)' : 'var(--color-error-light)',
                    textAlign: 'center', marginTop: 4,
                  }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Kembalian Tunai: </span>
                    <strong style={{ fontSize: 'var(--text-base)', color: splitCashChange >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                      {splitCashChange >= 0 ? rp(splitCashChange) : `Kurang ${rp(Math.abs(splitCashChange))}`}
                    </strong>
                  </div>
                )}
              </div>

              {/* Ringkasan Akuntansi & Laci */}
              <div style={{
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                background: 'var(--color-surface-muted)',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                lineHeight: 1.4,
              }}>
                💡 <strong>Catatan Laci:</strong> Uang fisik masuk laci kasir bertambah <strong>{rp(splitCashNeeded)}</strong>. Nominal QRIS <strong>{rp(splitQrisAmount)}</strong> langsung masuk rekening bank toko.
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }} disabled={loading}>
              Batal
            </button>
            <button
              id={`${uid}-confirm`}
              onClick={handleTriggerConfirm}
              className="btn btn-primary"
              style={{ flex: 2 }}
              disabled={
                loading ||
                (selectedMethod === 'CASH' && (!cashInput || cashAmount < total)) ||
                (selectedMethod === 'SPLIT' && !isSplitReady)
              }
            >
              {loading
                ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Memproses...</>
                : <><CheckCircle size={16} /> {
                  selectedMethod === 'CASH' ? 'Konfirmasi Bayar'
                  : selectedMethod === 'QRIS' ? 'Konfirmasi Diterima'
                  : 'Konfirmasi Split'
                }</>}
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
  items, payments, onClose,
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
  payments?: SplitPaymentDetail[];
  onClose: () => void;
}) {
  const uid = useId();
  const now = new Date().toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const isSplit = method === 'SPLIT' || (payments && payments.length > 1);
  const qrisDetail = payments?.find((p) => p.paymentMethod === 'QRIS');
  const cashDetail = payments?.find((p) => p.paymentMethod === 'CASH');

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
              {isSplit
                ? '🔀 Pembayaran Campuran (QRIS + Tunai)'
                : method === 'CASH'
                ? '💵 Pembayaran Tunai'
                : '📱 Pembayaran QRIS'}
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
              <span style={{ fontWeight: 'bold' }}>{isSplit ? 'CAMPURAN (SPLIT)' : method}</span>
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

            {/* Rincian Pembayaran */}
            {isSplit ? (
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dotted #888' }}>
                {qrisDetail && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>• QRIS</span>
                    <span>{rp(qrisDetail.amount)}</span>
                  </div>
                )}
                {cashDetail && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>• Tunai Tagihan</span>
                    <span>{rp(cashDetail.amount)}</span>
                  </div>
                )}
                {cashDetail?.cashReceived != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>  Tunai Diterima</span>
                    <span>{rp(cashDetail.cashReceived)}</span>
                  </div>
                )}
                {change !== null && change >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontWeight: 'bold', color: '#166534' }}>
                    <span>Kembalian Tunai</span>
                    <span>{rp(change)}</span>
                  </div>
                )}
              </div>
            ) : method === 'CASH' ? (
              <>
                {change !== null && change >= 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                    <span>Kembalian</span>
                    <span style={{ fontWeight: 'bold', color: '#166534' }}>{rp(change)}</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span>Status</span>
                <span style={{ fontWeight: 'bold', color: '#166534' }}>LUNAS (QRIS)</span>
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
  const [showKasGerak, setShowKasGerak] = useState(false);
  const [showSisaMakanan, setShowSisaMakanan] = useState(false);
  const [tutupActualCash, setTutupActualCash] = useState<string>('');
  const [tutupBreakdown, setTutupBreakdown]   = useState<DenominasiMap>({});
  const [tutupNotes, setTutupNotes]           = useState<string>('');
  const [tutupMode, setTutupMode]             = useState<'QUICK' | 'CALCULATOR'>('QUICK');
  const [tutupResult, setTutupResult] = useState<{
    txCount: number;
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
    payments?: SplitPaymentDetail[];
  } | null>(null);
  const [shiftDuration, setShiftDuration] = useState('');
  const [showPosScanner, setShowPosScanner] = useState(false);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const [unknownBarcodePrompt, setUnknownBarcodePrompt] = useState<string | null>(null);
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
      const isQuickFood = catId === 'QUICK_NON_BARCODE';
      const actualCatId = isQuickFood ? '' : catId;
      const params = new URLSearchParams({ q, ...(actualCatId && { categoryId: actualCatId }) });
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

  const displayedProducts = products.filter((p) => {
    if (activeCategory === 'QUICK_NON_BARCODE') {
      const isNoBarcode = !p.barcode || p.barcode.trim() === '';
      const catLower = (p.categoryName ?? '').toLowerCase();
      const nameLower = p.name.toLowerCase();
      const isFood =
        catLower.includes('makan') ||
        catLower.includes('kue') ||
        catLower.includes('snack') ||
        catLower.includes('basah') ||
        catLower.includes('konsinyasi') ||
        catLower.includes('jajan') ||
        catLower.includes('titip') ||
        nameLower.includes('cilok') ||
        nameLower.includes('siomai') ||
        nameLower.includes('gorengan') ||
        nameLower.includes('ricebowl') ||
        nameLower.includes('nasi') ||
        nameLower.includes('tahu') ||
        nameLower.includes('pentol') ||
        nameLower.includes('sando') ||
        nameLower.includes('klepon') ||
        nameLower.includes('burger') ||
        nameLower.includes('macaroni') ||
        nameLower.includes('ades');
      return isNoBarcode || isFood;
    }
    return true;
  });


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
    setScanToast(`Barcode ${cleanCode} belum terdaftar di sistem.`);
    setUnknownBarcodePrompt(cleanCode);
    setTimeout(() => setScanToast(null), 3000);
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

  const handleDirectQtyChange = (id: string, val: string, stockQty: number, name: string) => {
    if (val === '') {
      // Biarkan 0 sementara saat kasir sedang mengetik/menghapus
      applyCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: 0 } : i)));
      return;
    }
    let num = parseInt(val, 10);
    if (isNaN(num)) return;
    // Guard E1: Scanner anti-overflow (maks. 999)
    if (num > 999) {
      showCartToast('Kuantitas melebihi batas wajar (maks. 999)');
      num = Math.min(999, stockQty);
    }
    if (num > stockQty) {
      showCartToast(`Stok "${name}" hanya tersisa ${stockQty}`);
      num = stockQty;
    }
    if (num < 1) num = 1;
    applyCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: num } : i)));
  };

  const handleDirectQtyBlur = (id: string, currentQty: number) => {
    if (currentQty <= 0) {
      // Kembalikan ke 1 jika ditinggal kosong / 0
      applyCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty: 1 } : i)));
    }
  };

  const clearCart = () => applyCart(() => []);
  const total = cart.reduce((sum, i) => sum + parseFloat(i.sellingPrice) * (i.qty || 0), 0);
  const totalItems = cart.reduce((sum, i) => sum + (i.qty || 0), 0);
  const hasInvalidQty = cart.some((i) => !i.qty || i.qty <= 0);

  // Submit transaksi
  async function handleConfirmPayment(cashReceived?: number, payments?: SplitPaymentDetail[]) {
    setProcessingTx(true);
    try {
      const res = await fetch('/api/kasir/transaksi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((i) => ({ productId: i.id, qty: i.qty })),
          paymentMethod: payments && payments.length > 1 ? undefined : (paymentMethod === 'SPLIT' ? 'CASH' : paymentMethod),
          cashReceived,
          payments,
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
        method: payments && payments.length > 1 ? 'SPLIT' : paymentMethod,
        payments: json.data.payments ?? payments,
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
      const nominalFisik = tutupActualCash ? parseFloat(tutupActualCash.replace(/\D/g, '')) : undefined;
      const res = await fetch('/api/kasir/shift/tutup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualCash: nominalFisik !== undefined && !isNaN(nominalFisik) ? nominalFisik : undefined,
          breakdown: Object.keys(tutupBreakdown).length > 0 ? tutupBreakdown : undefined,
          notes: tutupNotes.trim() ? tutupNotes.trim() : undefined,
        }),
      });
      const json = await res.json() as {
        success: boolean;
        data?: {
          txCount: number;
        };
        error?: string;
      };
      if (!res.ok) {
        alert(json.error ?? 'Gagal menutup shift.');
        return;
      }
      setTutupResult(json.data ?? null);
      setShowTutupConfirm(false);
      setTutupActualCash('');
      setTutupBreakdown({});
      setTutupNotes('');
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

      {/* ── Tutup Shift Konfirmasi Modal (Blind Count Uang Fisik Laci) ─────────────────────────── */}
      {showTutupConfirm && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="tutup-shift-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 1800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4)', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            overflowY: 'auto',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 'auto', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-xl)' }}>
            <div className="card-body" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflowY: 'auto' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 4 }}>🔐</div>
                <h2 id="tutup-shift-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: '0 0 4px' }}>
                  Tutup Shift &amp; Rekap Laci
                </h2>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                  Hitung uang tunai di laci (Blind Count). Data akan dicocokkan otomatis oleh sistem Manajer.
                </p>
              </div>

              {/* Mode Switcher */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--color-surface-elevated)', padding: 4, borderRadius: 'var(--radius-md)' }}>
                <button
                  type="button"
                  onClick={() => setTutupMode('QUICK')}
                  style={{
                    background: tutupMode === 'QUICK' ? 'var(--color-surface)' : 'transparent',
                    boxShadow: tutupMode === 'QUICK' ? 'var(--shadow-xs)' : 'none',
                    color: tutupMode === 'QUICK' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: 700,
                    border: 'none',
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Banknote size={14} />
                  Input Saldo Langsung
                </button>
                <button
                  type="button"
                  onClick={() => setTutupMode('CALCULATOR')}
                  style={{
                    background: tutupMode === 'CALCULATOR' ? 'var(--color-surface)' : 'transparent',
                    boxShadow: tutupMode === 'CALCULATOR' ? 'var(--shadow-xs)' : 'none',
                    color: tutupMode === 'CALCULATOR' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: 700,
                    border: 'none',
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Calculator size={14} />
                  Hitung Lembar &amp; Koin
                </button>
              </div>

              {tutupMode === 'QUICK' ? (
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                    Total Uang Fisik di Laci (Rp) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="form-input"
                    placeholder="Contoh: 350.000"
                    value={tutupActualCash}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      setTutupActualCash(v ? parseInt(v, 10).toLocaleString('id-ID') : '');
                    }}
                    style={{
                      fontSize: '1.2rem',
                      textAlign: 'center',
                      fontWeight: 800,
                      minHeight: 48,
                    }}
                  />
                </div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
                  <KalkulatorPecahan
                    initialBreakdown={tutupBreakdown}
                    onChange={(tot, counts) => {
                      setTutupBreakdown(counts);
                      setTutupActualCash(tot > 0 ? tot.toLocaleString('id-ID') : '');
                    }}
                  />
                </div>
              )}

              {/* Catatan Handover */}
              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                  Catatan Handover / Keterangan (Opsional):
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Catatan serah terima kunci, uang titipan, dll."
                  value={tutupNotes}
                  onChange={(e) => setTutupNotes(e.target.value)}
                  maxLength={300}
                  style={{ fontSize: '0.8rem', resize: 'none' }}
                />
              </div>



              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowTutupConfirm(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  disabled={tutupLoading}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleTutupShift}
                  className="btn btn-primary"
                  disabled={tutupLoading}
                  style={{ flex: 2, background: 'hsl(0 70% 50%)', minHeight: 46, fontWeight: 700 }}
                >
                  {tutupLoading
                    ? <><Loader2 size={16} className="spin" /> Menutup Shift...</>
                    : <><X size={16} /> Tutup Shift &amp; Simpan</>}
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
              {/* Tabel ringkasan — D2: hanya angka yang tidak bisa dipakai menghitung kas laci */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Total Transaksi</span>
                <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>{tutupResult.txCount} txn</span>
              </div>

              {/* Status Operasional Shift (K2: Laba & Bagi Hasil hanya dikelola Manajer/Dosen) */}
              <div style={{
                padding: 'var(--space-3)',
                background: 'var(--color-surface-muted, #f8fafc)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                fontSize: '0.78rem',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)', marginBottom: 2 }}>
                  📋 Status Operasional
                </div>
                Sesi shift telah ditutup. Seluruh data transaksi tersimpan aman di server untuk rekapitulasi berkala Manajer.
              </div>

              {/* Instruksi Blind Count — D2 Fix: angka expected TIDAK ditampilkan ke kasir */}
              <div style={{
                padding: 'var(--space-3)',
                background: 'var(--color-warning-light, #fffbeb)',
                border: '1.5px solid var(--color-warning, #f59e0b)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-warning, #92400e)', marginBottom: 4 }}>
                  ⚠️ Hitung Uang di Laci
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  Hitung uang secara fisik, lalu laporkan jumlahnya ke Manajer.
                  Jangan cocokkan dengan angka di sistem.
                </div>
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

      {/* ── Modal Cepat: Barcode Belum Terdaftar ────────── */}
      {unknownBarcodePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 2100,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={() => setUnknownBarcodePrompt(null)}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-xl)',
              padding: 'var(--space-6)',
              maxWidth: 400,
              width: '100%',
              boxShadow: 'var(--shadow-xl)',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 'var(--radius-full)',
              background: 'var(--color-primary-light)', color: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto var(--space-3)',
            }}>
              <Package size={26} />
            </div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', marginBottom: 6 }}>
              Barcode Belum Terdaftar
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Barcode <code style={{ fontWeight: 700, color: 'var(--color-text)' }}>{unknownBarcodePrompt}</code> belum ada di sistem katalog toko.
            </p>
            <div style={{
              background: 'var(--color-surface-muted)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              marginBottom: 'var(--space-5)',
              fontSize: 12,
              color: 'var(--color-text)',
            }}>
              Mau langsung input nama barang, HPP, harga jual, dan stoknya sekarang?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a
                href={`/kasir/produk?barcode=${encodeURIComponent(unknownBarcodePrompt)}`}
                className="btn btn-primary"
                style={{
                  width: '100%', padding: '12px', fontSize: 13, fontWeight: 700,
                  textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Plus size={16} /> + Daftarkan Produk Ini Sekarang
              </a>
              <button
                type="button"
                onClick={() => setUnknownBarcodePrompt(null)}
                className="btn btn-secondary"
                style={{ width: '100%', padding: '10px', fontSize: 12 }}
              >
                Batal / Nanti Saja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar ────────────────────────────────────── */}
      <header className="pos-topbar">
        {/* Brand & Kasir + Shift Duration Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{
              color: 'var(--color-text-inverse)', fontWeight: 'var(--weight-bold)',
              fontSize: 'var(--text-sm)', letterSpacing: 'var(--tracking-wide)',
            }}>
              🏪 WIRAMART
            </span>
            <span style={{ color: 'var(--color-sidebar-muted)', fontSize: '10px' }}>
              UKM UNPERBA
            </span>
          </div>

          {/* Jam Shift & Kasir Info — Selalu tampil di desktop & mobile */}
          {session?.shift && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 'var(--radius-full)',
              padding: '3px 8px',
              color: 'white',
              fontSize: '11px',
              fontWeight: 600,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'hsl(142, 70%, 50%)',
                boxShadow: '0 0 6px hsl(142, 70%, 50%)',
                display: 'inline-block',
                flexShrink: 0,
              }} />
              <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {kasirName || 'Kasir'}
              </span>
              <span style={{ opacity: 0.5 }}>•</span>
              <span style={{ color: 'hsl(142, 80%, 75%)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                {shiftDuration}
              </span>
            </div>
          )}
        </div>

        {/* Search — desktop only (Ctrl+K) */}
        <div style={{ flex: 1, maxWidth: 360, position: 'relative' }} className="pos-search-wrap">
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
            placeholder="Cari produk / barcode... (Ctrl+K)"
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

        {/* Action buttons (Clean POS Toolbar: Scan, Cart, Fitur) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Tombol Scan Barcode Kamera */}
          <button
            onClick={startPosScanner}
            aria-label="Scan barcode produk"
            title="Scan Barcode Kamera"
            style={{
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 'var(--radius-md)', padding: '6px 10px', cursor: 'pointer',
              color: 'white', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
              minHeight: 34,
            }}
          >
            <ScanLine size={15} aria-hidden="true" />
            <span>Scan</span>
          </button>

          {/* Tombol Keranjang Mobile (< 800px) */}
          <button
            id="btn-show-cart"
            onClick={() => setShowCart((v) => !v)}
            className="pos-cart-toggle"
            aria-label="Buka keranjang"
            title="Keranjang Belanja"
          >
            <ShoppingCart size={18} />
            {totalItems > 0 && (
              <span className="pos-cart-badge">{totalItems}</span>
            )}
          </button>

          {/* Tombol [⚡ FITUR] — Menyimpan semua fitur operasional kasir */}
          <button
            id="btn-kasir-fitur"
            onClick={() => setShowKasirMenu(true)}
            aria-label="Menu Fitur Kasir"
            title="Menu Fitur Kasir Lengkap"
            style={{
              background: 'linear-gradient(135deg, hsl(142, 65%, 26%) 0%, hsl(142, 70%, 20%) 100%)',
              border: '1px solid hsl(142, 60%, 42%)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              minHeight: 34,
              transition: 'transform 0.12s ease',
            }}
          >
            <Zap size={14} style={{ color: 'hsl(45 95% 65%)' }} />
            <span>Fitur</span>
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
              padding: '7px 12px 7px 32px',
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
          <button
            role="tab"
            aria-selected={activeCategory === 'QUICK_NON_BARCODE'}
            onClick={() => setActiveCategory(activeCategory === 'QUICK_NON_BARCODE' ? '' : 'QUICK_NON_BARCODE')}
            className={`pos-cat-btn${activeCategory === 'QUICK_NON_BARCODE' ? ' active' : ''}`}
            id={`${uid}-cat-makanan-cepat`}
            style={{
              whiteSpace: 'nowrap',
              fontWeight: 700,
              background: activeCategory === 'QUICK_NON_BARCODE' ? 'hsl(32, 95%, 44%)' : 'hsl(32, 95%, 94%)',
              color: activeCategory === 'QUICK_NON_BARCODE' ? 'white' : 'hsl(32, 95%, 30%)',
              border: '1px solid hsl(32, 90%, 75%)',
            }}
          >
            ⚡ Makanan &amp; Non-Barcode
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
          ) : displayedProducts.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Package size={48} style={{ margin: '0 auto var(--space-4)', opacity: 0.2 }} />
              <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
                {search ? `Tidak ada produk untuk "${search}"` : 'Tidak ada produk tersedia'}
              </p>
              {search && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <button onClick={() => setSearch('')} className="btn btn-secondary btn-sm" style={{ fontSize: 'var(--text-sm)' }}>
                    Reset pencarian
                  </button>
                  <a
                    href={`/kasir/produk?tambah=1&nama=${encodeURIComponent(search)}`}
                    className="btn btn-primary btn-sm"
                    style={{ fontSize: 'var(--text-sm)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Plus size={14} /> + Tambah Produk "{search}"
                  </a>
                </div>
              )}
            </div>
          ) : (
            displayedProducts.map((p) => (
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
                  {/* Qty controls: Ketik langsung + tombol - / + */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
                    <button
                      onClick={() => updateQty(item.id, -1)}
                      aria-label={`Kurangi ${item.name}`}
                      className="pos-qty-btn"
                    >
                      <Minus size={11} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={item.stockQty}
                      value={item.qty === 0 ? '' : item.qty}
                      onChange={(e) => handleDirectQtyChange(item.id, e.target.value, item.stockQty, item.name)}
                      onBlur={() => handleDirectQtyBlur(item.id, item.qty)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                          searchRef.current?.focus();
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Kuantitas ${item.name}`}
                      className="pos-qty-input"
                    />
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
            {(['CASH', 'QRIS', 'SPLIT'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                id={`${uid}-method-${m.toLowerCase()}`}
                onClick={() => setPaymentMethod(m)}
                aria-pressed={paymentMethod === m}
                className={`pos-method-btn${paymentMethod === m ? ' active' : ''}`}
                style={{ flex: 1, padding: 'var(--space-2) var(--space-1)', fontSize: 'var(--text-xs)' }}
              >
                {m === 'CASH'
                  ? <><Banknote size={14} /> Cash</>
                  : m === 'QRIS'
                  ? <><QrCodeIcon size={14} /> QRIS</>
                  : <><ArrowLeftRight size={14} /> Split</>}
              </button>
            ))}
          </div>

          {/* Bayar button */}
          <button
            id={`${uid}-bayar`}
            onClick={() => setShowPayment(true)}
            className="btn btn-primary"
            disabled={cart.length === 0 || hasInvalidQty}
            style={{ width: '100%', minHeight: 52, fontSize: 'var(--text-base)', gap: 'var(--space-2)' }}
          >
            <CheckCircle size={20} />
            {cart.length === 0
              ? 'Pilih Produk Dulu'
              : hasInvalidQty
              ? 'Lengkapi Jumlah Item'
              : `Bayar ${rp(total)}`}
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
          payments={lastTx.payments}
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

              {session?.shift && (
                <button
                  type="button"
                  className="pos-drawer-link"
                  onClick={() => {
                    setShowKasirMenu(false);
                    setShowKasGerak(true);
                  }}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div className="pos-drawer-icon-box" style={{ background: 'hsl(45 95% 90%)', color: 'hsl(45 90% 35%)' }}>
                    <Receipt size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="pos-drawer-link-title">Kas Keluar / Masuk Laci</div>
                    <div className="pos-drawer-link-sub">Petty Cash: Galon, Bensin, ATK, Receh</div>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--color-text-muted)' }} />
                </button>
              )}

              {session?.shift && (
                <button
                  type="button"
                  className="pos-drawer-link"
                  onClick={() => {
                    setShowKasirMenu(false);
                    setShowSisaMakanan(true);
                  }}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div className="pos-drawer-icon-box" style={{ background: 'hsl(32 95% 90%)', color: 'hsl(32 90% 35%)' }}>
                    <Utensils size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="pos-drawer-link-title">Opname Makanan Jam 15:00</div>
                    <div className="pos-drawer-link-sub">Catat sisa cilok, siomai, gorengan sebelum tutup</div>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--color-text-muted)' }} />
                </button>
              )}

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
                  if (session?.shift) {
                    alert('Sesi shift laci masih aktif. Silakan lakukan Tutup Sesi Kasir & Rekap Laci terlebih dahulu.');
                    setShowTutupConfirm(true);
                  } else {
                    handleLogout();
                  }
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

      {/* ── Modal Kas Keluar & Masuk Laci (Petty Cash) ─────────── */}
      <KasGerakModal
        isOpen={showKasGerak}
        onClose={() => setShowKasGerak(false)}
      />

      {/* ── Modal Cut-Off Sisa Makanan Jam 15:00 ────────────────── */}
      <SisaMakananModal
        isOpen={showSisaMakanan}
        onClose={() => setShowSisaMakanan(false)}
        onSuccess={() => fetchProducts(search, activeCategory)}
      />
    </div>
  );
}
