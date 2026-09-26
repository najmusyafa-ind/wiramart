'use client';

// ─────────────────────────────────────────────────────────────
// BarcodeDetector Web API — Shape Detection API
// Belum masuk TypeScript stdlib (TS 5.x). Deklarasi manual.
// Ref: https://wicg.github.io/shape-detection-api/
// ─────────────────────────────────────────────────────────────
interface DetectedBarcode {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
}

declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(options?: { formats?: string[] });
  detect(
    source:
      | HTMLVideoElement
      | HTMLImageElement
      | ImageBitmap
      | ImageData
      | HTMLCanvasElement,
  ): Promise<DetectedBarcode[]>;
}

import {
  useState, useEffect, useId, useCallback, useRef,
} from 'react';
import {
  Plus, Search, Package, Edit2, Trash2, Loader2, X, Tag,
  ScanLine, Camera, CameraOff, CheckCircle, AlertCircle,
  ClipboardList, ImageIcon, RefreshCw, AlertTriangle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  description?: string;
  costPrice: string;
  sellingPrice: string;
  stockQty: number;
  unit: string;
  isActive: boolean;
  categoryId: string;
  categoryName: string;
  photoUrl?: string | null;
  barcode?: string | null;
};

type OpenFoodFactsResult = {
  status: number;
  product?: {
    product_name_id?: string;
    product_name?: string;
    brands?: string;
    quantity?: string;
  };
};

// ─────────────────────────────────────────────────────────────
// StokAdjModal — Koreksi stok manual
// ─────────────────────────────────────────────────────────────
function StokAdjModal({
  product,
  onClose,
  onSuccess,
}: {
  product: Product;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uid = useId();
  const [qtyAfter, setQtyAfter] = useState(product.stockQty.toString());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const diff = parseInt(qtyAfter) - product.stockQty;
  const diffLabel = isNaN(diff) ? '' : diff > 0 ? `+${diff}` : diff === 0 ? '±0' : `${diff}`;
  const diffColor = diff > 0 ? 'var(--color-success)' : diff < 0 ? 'var(--color-error)' : 'var(--color-text-muted)';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseInt(qtyAfter);
    if (isNaN(qty) || qty < 0) { setError('Stok harus angka >= 0.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/stok-adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, qtyAfter: qty, reason }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (res.ok && json.success) { onSuccess(); onClose(); }
      else setError(typeof json.error === 'string' ? json.error : 'Gagal menyesuaikan stok.');
    } catch { setError('Kesalahan jaringan.'); }
    finally { setLoading(false); }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-adj-title`}
      style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--color-overlay)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <div className="card-header">
          <h2 id={`${uid}-adj-title`} className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ClipboardList size={16} aria-hidden="true" /> Koreksi Stok — {product.name}
          </h2>
          <button onClick={onClose} aria-label="Tutup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}><X size={18} /></button>
        </div>
        <div className="card-body">
          {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Info stok saat ini */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)', backgroundColor: 'var(--color-surface-alt)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Stok saat ini</span>
              <strong style={{ fontSize: 'var(--text-lg)' }}>{product.stockQty} {product.unit}</strong>
            </div>
            <div className="form-group">
              <label htmlFor={`${uid}-qty`} className="form-label">Stok Baru *</label>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <input id={`${uid}-qty`} type="number" min="0" className="form-input" style={{ flex: 1 }}
                  value={qtyAfter} onChange={(e) => setQtyAfter(e.target.value)} required disabled={loading} autoFocus />
                {qtyAfter !== '' && !isNaN(diff) && (
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', color: diffColor, minWidth: 36, textAlign: 'right' }}>
                    {diffLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={`${uid}-reason`} className="form-label">Alasan Koreksi *</label>
              <textarea id={`${uid}-reason`} className="form-input form-textarea" rows={3}
                placeholder="Contoh: Stock opname, barang rusak, koreksi input awal..."
                value={reason} onChange={(e) => setReason(e.target.value)} required disabled={loading} maxLength={300} />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>Batal</button>
              <button type="submit" className="btn btn-primary" disabled={loading || !reason.trim()} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {loading ? <><Loader2 size={14} className="spin-icon" /> Menyimpan...</> : <><RefreshCw size={14} /> Simpan Koreksi</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FotoUploadModal — Upload foto produk
// ─────────────────────────────────────────────────────────────
function FotoUploadModal({
  product,
  onClose,
  onSuccess,
}: {
  product: Product;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const uid = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) setPreview(URL.createObjectURL(f));
    else setPreview(null);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Pilih file foto terlebih dahulu.'); return; }
    setLoading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('foto', file);
      const res = await fetch(`/api/admin/produk/${product.id}/foto`, { method: 'POST', body: fd });
      const json = await res.json() as { success?: boolean; error?: string };
      if (res.ok && json.success) { onSuccess(); onClose(); }
      else setError(typeof json.error === 'string' ? json.error : 'Gagal upload foto.');
    } catch { setError('Kesalahan jaringan.'); }
    finally { setLoading(false); }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-foto-title`}
      style={{ position: 'fixed', inset: 0, zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', backgroundColor: 'var(--color-overlay)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 400 }}>
        <div className="card-header">
          <h2 id={`${uid}-foto-title`} className="card-title" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ImageIcon size={16} aria-hidden="true" /> Upload Foto — {product.name}
          </h2>
          <button onClick={onClose} aria-label="Tutup" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}><X size={18} /></button>
        </div>
        <div className="card-body">
          {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}
          <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Preview */}
            {(preview ?? product.photoUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview ?? product.photoUrl!} alt="Preview foto produk"
                style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-alt)' }} />
            )}
            {/* Drop zone */}
            <label htmlFor={`${uid}-foto-input`} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-5)', border: `2px dashed ${file ? 'var(--color-primary)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--color-text-muted)',
              backgroundColor: file ? 'var(--color-primary-surface)' : 'transparent',
              transition: 'all var(--duration-fast)',
            }}>
              <ImageIcon size={22} aria-hidden="true" />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
                {file ? file.name : 'Klik untuk pilih foto produk'}
              </span>
              <span style={{ fontSize: 'var(--text-xs)' }}>JPEG, PNG, WebP — Maks 5MB</span>
            </label>
            <input ref={fileInputRef} id={`${uid}-foto-input`} type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp" style={{ display: 'none' }}
              onChange={handleFileChange} aria-label="Upload foto produk" />
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>Batal</button>
              <button type="submit" className="btn btn-primary" disabled={loading || !file} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {loading ? <><Loader2 size={14} className="spin-icon" /> Uploading...</> : <><ImageIcon size={14} /> Upload Foto</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BarcodeScanner Modal Component
// Strategy: BarcodeDetector (native) first → quagga2 fallback
// ─────────────────────────────────────────────────────────────
type BarcodeScannerProps = {
  onDetected: (barcode: string, productName?: string) => void;
  onClose: () => void;
};

function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const uid = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetector | null>(null);

  const [status, setStatus] = useState<'requesting' | 'scanning' | 'detected' | 'error'>('requesting');
  const [errorMsg, setErrorMsg] = useState('');
  const [fetchingOff, setFetchingOff] = useState(false);
  const [detectedCode, setDetectedCode] = useState('');

  // ── Mulai kamera ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Pilih engine: BarcodeDetector (native) atau quagga2 (fallback)
        if ('BarcodeDetector' in window) {
          const supported = await BarcodeDetector.getSupportedFormats();
          detectorRef.current = new BarcodeDetector({
            formats: supported.filter((f) =>
              ['ean_13', 'ean_8', 'qr_code', 'code_128', 'upc_a', 'upc_e'].includes(f),
            ),
          });
          setStatus('scanning');
          scanLoop();
        } else {
          // Fallback: quagga2 — tidak ada BarcodeDetector di browser ini
          await startQuagga();
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          setErrorMsg('Akses kamera ditolak. Izinkan kamera di pengaturan browser.');
        } else if (e.name === 'NotFoundError') {
          setErrorMsg('Kamera tidak ditemukan di perangkat ini.');
        } else {
          setErrorMsg(`Gagal membuka kamera: ${e.message}`);
        }
        setStatus('error');
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Scan loop (BarcodeDetector) ──────────────────────────
  function scanLoop() {
    if (!videoRef.current || !detectorRef.current) return;
    const video = videoRef.current;

    async function detect() {
      if (video.readyState < 2) { rafRef.current = requestAnimationFrame(detect); return; }
      try {
        const barcodes = await detectorRef.current!.detect(video);
        if (barcodes.length > 0) {
          const code = barcodes[0]!.rawValue;
          handleBarcode(code);
          return;
        }
      } catch {
        // frame decode error — continue loop
      }
      rafRef.current = requestAnimationFrame(detect);
    }

    rafRef.current = requestAnimationFrame(detect);
  }

  // ── Quagga2 fallback (dynamic import) ───────────────────
  async function startQuagga() {
    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      setStatus('scanning');

      Quagga.init(
        {
          inputStream: {
            type: 'LiveStream',
            target: videoRef.current!.parentElement as HTMLElement,
            constraints: { facingMode: 'environment', width: 1280, height: 720 },
          },
          decoder: {
            readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'upc_reader'],
          },
        },
        (err: Error | null) => {
          if (err) { setErrorMsg('Gagal init scanner (Quagga2).'); setStatus('error'); return; }
          Quagga.start();
          // Biarkan TypeScript infer type dari QuaggaJSResultCallbackFunction
          Quagga.onDetected((result) => {
            const code = result.codeResult?.code ?? '';
            if (code) { Quagga.stop(); handleBarcode(code); }
          });
        },
      );
    } catch {
      setErrorMsg('Browser tidak mendukung Barcode Scanner. Gunakan Chrome atau Edge terbaru.');
      setStatus('error');
    }
  }

  // ── Handle barcode terdeteksi ────────────────────────────
  async function handleBarcode(code: string) {
    // Stop kamera
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setDetectedCode(code);
    setStatus('detected');
    setFetchingOff(true);

    // Fetch Open Food Facts
    let productName: string | undefined;
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name_id,product_name,brands,quantity`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = await res.json() as OpenFoodFactsResult;
        if (data.status === 1 && data.product) {
          productName = data.product.product_name_id
            || data.product.product_name
            || (data.product.brands ? `${data.product.brands} (${data.product.quantity ?? ''})`.trim() : undefined);
        }
      }
    } catch {
      // Timeout atau tidak ada koneksi — lanjut tanpa nama produk
    } finally {
      setFetchingOff(false);
    }

    onDetected(code, productName);
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-scanner-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 460, overflow: 'hidden' }}
      >
        {/* Header */}
        <div className="card-header">
          <h2
            id={`${uid}-scanner-title`}
            className="card-title"
            style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <ScanLine size={16} aria-hidden="true" />
            Scan Barcode Produk
          </h2>
          <button
            onClick={onClose}
            aria-label="Tutup scanner"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Camera view */}
        <div style={{ position: 'relative', backgroundColor: '#000', aspectRatio: '4/3', overflow: 'hidden' }}>
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Tampilan kamera untuk scan barcode"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: status === 'error' ? 'none' : 'block' }}
          />

          {/* Scan frame overlay */}
          {status === 'scanning' && (
            <>
              {/* Corner brackets */}
              {[
                { top: '20%', left: '20%', borderTop: '3px solid', borderLeft: '3px solid' },
                { top: '20%', right: '20%', borderTop: '3px solid', borderRight: '3px solid' },
                { bottom: '20%', left: '20%', borderBottom: '3px solid', borderLeft: '3px solid' },
                { bottom: '20%', right: '20%', borderBottom: '3px solid', borderRight: '3px solid' },
              ].map((style, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  style={{
                    position: 'absolute', width: 28, height: 28,
                    borderColor: 'var(--color-primary)',
                    ...style,
                  }}
                />
              ))}
              {/* Animasi scan line */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: '20%', right: '20%',
                  height: 2,
                  backgroundColor: 'var(--color-primary)',
                  boxShadow: '0 0 8px var(--color-primary)',
                  animation: 'scanLine 2s ease-in-out infinite',
                  top: '20%',
                }}
              />
              <p
                style={{
                  position: 'absolute', bottom: 'var(--space-4)',
                  left: 0, right: 0, textAlign: 'center',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 'var(--text-xs)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}
              >
                Arahkan kamera ke barcode produk
              </p>
            </>
          )}

          {/* Loading state */}
          {status === 'requesting' && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 'var(--space-3)', color: 'white',
            }}>
              <Camera size={36} aria-hidden="true" style={{ opacity: 0.7 }} />
              <span style={{ fontSize: 'var(--text-sm)' }}>Membuka kamera...</span>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div style={{
              padding: 'var(--space-6)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 'var(--space-3)', textAlign: 'center', minHeight: 200,
            }}>
              <CameraOff size={36} style={{ color: 'var(--color-error)', opacity: 0.7 }} aria-hidden="true" />
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{errorMsg}</p>
            </div>
          )}

          {/* Detected state */}
          {status === 'detected' && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 'var(--space-3)', backgroundColor: 'rgba(0,0,0,0.7)',
            }}>
              {fetchingOff ? (
                <>
                  <Loader2 size={32} className="spin-icon" aria-hidden="true" style={{ color: 'white' }} />
                  <p style={{ color: 'white', fontSize: 'var(--text-sm)' }}>
                    Mencari data produk...
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle size={36} aria-hidden="true" style={{ color: 'var(--color-success)' }} />
                  <p style={{ color: 'white', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                    Barcode terdeteksi!
                  </p>
                  <code style={{ color: 'var(--color-primary)', fontSize: 'var(--text-xs)' }}>
                    {detectedCode}
                  </code>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
            Mendukung EAN-13, EAN-8, QR Code, Code 128, UPC
          </p>
        </div>
      </div>

      {/* Inline keyframes untuk scan line & fade */}
      <style>{`
        @keyframes scanLine {
          0%, 100% { top: 20%; opacity: 1; }
          50% { top: 70%; opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ProdukModal — tambah/edit produk
// prefillName + prefillBarcode untuk auto-fill dari barcode scanner
// ─────────────────────────────────────────────────────────────
function ProdukModal({
  onClose, onSuccess, categories, editData, prefillName, prefillBarcode,
}: {
  onClose: () => void;
  onSuccess: () => void;
  categories: Category[];
  editData?: Product | null;
  prefillName?: string;
  prefillBarcode?: string;
}) {
  const uid = useId();
  const isEdit = !!editData;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    categoryId:   editData?.categoryId ?? '',
    name:         editData?.name ?? prefillName ?? '',
    description:  editData?.description ?? '',
    barcode:      editData?.barcode ?? prefillBarcode ?? '',
    costPrice:    editData?.costPrice ?? '',
    sellingPrice: editData?.sellingPrice ?? '',
    stockQty:     editData?.stockQty?.toString() ?? '0',
    unit:         editData?.unit ?? 'pcs',
  });

  // Update nama jika prefill berubah setelah mount (saat fetch OFF selesai)
  useEffect(() => {
    if (prefillName && !isEdit) {
      setForm((f) => ({ ...f, name: f.name || prefillName }));
    }
  }, [prefillName, isEdit]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const body = {
        ...form,
        costPrice:    parseFloat(form.costPrice),
        sellingPrice: parseFloat(form.sellingPrice),
        stockQty:     parseInt(form.stockQty),
      };
      const res = await fetch(
        isEdit ? `/api/admin/produk/${editData!.id}` : '/api/admin/produk',
        { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const json = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        setError(typeof json.error === 'string' ? json.error : 'Gagal menyimpan');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('Kesalahan jaringan');
    } finally {
      setLoading(false);
    }
  }

  const margin = form.sellingPrice && form.costPrice
    ? parseFloat(form.sellingPrice) - parseFloat(form.costPrice)
    : null;
  const marginPct = margin !== null && parseFloat(form.sellingPrice) > 0
    ? ((margin / parseFloat(form.sellingPrice)) * 100).toFixed(1)
    : null;

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)', backgroundColor: 'var(--color-overlay)',
        backdropFilter: 'blur(4px)', animation: 'fade-in 0.2s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 520, margin: 0, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-header">
          <h2 id={`${uid}-title`} className="card-title" style={{ fontSize: 'var(--text-base)' }}>
            {isEdit ? 'Edit Produk' : 'Tambah Produk Baru'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Tutup form produk"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="card-body">
          {error && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <AlertCircle size={14} aria-hidden="true" /> {error}
            </div>
          )}
          {/* Indikator prefill barcode */}
          {prefillName && !isEdit && (
            <div style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-info-light)',
              color: 'var(--color-info)',
              fontSize: 'var(--text-xs)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
              <ScanLine size={13} aria-hidden="true" />
              Nama produk diisi otomatis dari Open Food Facts
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label htmlFor={`${uid}-cat`} className="form-label">Kategori *</label>
              <select id={`${uid}-cat`} className="form-input form-select" value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} required disabled={loading}>
                <option value="">— Pilih Kategori —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={`${uid}-name`} className="form-label">Nama Produk *</label>
              <input id={`${uid}-name`} type="text" className="form-input" placeholder="Contoh: Es Teh Manis"
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required disabled={loading} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label htmlFor={`${uid}-hpp`} className="form-label">Harga HPP (Rp) *</label>
                <input id={`${uid}-hpp`} type="number" min="0" step="100" className="form-input"
                  placeholder="2000" value={form.costPrice}
                  onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))} required disabled={loading} />
              </div>
              <div className="form-group">
                <label htmlFor={`${uid}-sell`} className="form-label">Harga Jual (Rp) *</label>
                <input id={`${uid}-sell`} type="number" min="0" step="100" className="form-input"
                  placeholder="5000" value={form.sellingPrice}
                  onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))} required disabled={loading} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label htmlFor={`${uid}-stock`} className="form-label">Stok Awal</label>
                <input id={`${uid}-stock`} type="number" min="0" className="form-input"
                  value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: e.target.value }))} disabled={loading} />
              </div>
              <div className="form-group">
                <label htmlFor={`${uid}-unit`} className="form-label">Satuan</label>
                <input id={`${uid}-unit`} type="text" className="form-input" placeholder="pcs"
                  value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} disabled={loading} />
              </div>
            </div>
            {/* Barcode opsional */}
            <div className="form-group">
              <label htmlFor={`${uid}-barcode`} className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ScanLine size={13} aria-hidden="true" /> Barcode <span style={{ fontWeight: 'var(--weight-normal)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>(opsional — EAN-13 / Code128)</span>
              </label>
              <input id={`${uid}-barcode`} type="text" className="form-input"
                placeholder="Scan atau ketik kode barcode..."
                value={form.barcode}
                onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                disabled={loading}
                style={{ fontFamily: 'var(--font-mono)', letterSpacing: 1 }} />
            </div>
            {margin !== null && marginPct !== null && (
              <div style={{
                padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                backgroundColor: margin >= 0 ? 'var(--color-success-light)' : 'var(--color-error-light)',
                fontSize: 'var(--text-sm)',
                color: margin >= 0 ? 'var(--color-success)' : 'var(--color-error)',
              }}>
                {margin >= 0 ? '✅' : '⚠️'} Margin: Rp {margin.toLocaleString('id-ID')} ({marginPct}%)
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>Batal</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                id={`${uid}-submit`}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                {loading
                  ? <><Loader2 size={14} className="spin-icon" aria-hidden="true" /> Menyimpan...</>
                  : (isEdit ? 'Simpan' : 'Tambah Produk')
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Halaman Utama
// ─────────────────────────────────────────────────────────────
export default function ProdukPage() {
  const uid = useId();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState<Product | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Confirm Dialog state (mengganti browser confirm()) ────
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  // ── Scanner state ────────────────────────────────────────
  const [showScanner, setShowScanner] = useState(false);
  const [scanPrefillName, setScanPrefillName] = useState<string | undefined>();
  const [scanPrefillBarcode, setScanPrefillBarcode] = useState<string | undefined>();

  // ── Stok Adjustment state ──────────────────────────────
  const [adjProduct, setAdjProduct] = useState<Product | null>(null);

  // ── Foto Upload state ──────────────────────────────────
  const [fotoProduct, setFotoProduct] = useState<Product | null>(null);

  const fetchProducts = useCallback(async (q = '', cat = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, ...(cat && { categoryId: cat }) });
      const res = await fetch(`/api/admin/produk?${params}`);
      const json = await res.json() as { success?: boolean; data?: { products?: Product[]; categories?: Category[] } };
      if (res.ok && json.success) {
        setProducts(json.data?.products ?? []);
        setCategories(json.data?.categories ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // FIXED: satu useEffect dengan debounce 350ms menggantikan double fetch.
  // search='' + filterCat='' saat mount → initial load dengan debounce singkat.
  // Tidak ada lagi 2x fetch saat komponen pertama kali render.
  useEffect(() => {
    const t = setTimeout(() => fetchProducts(search, filterCat), 350);
    return () => clearTimeout(t);
  }, [search, filterCat, fetchProducts]);

  async function handleDelete(id: string, name: string) {
    // FIXED: gunakan state-based confirm dialog (menggantikan browser confirm())
    // Browser confirm() tidak aksesibel, tidak bisa di-style, tidak support screen reader.
    setConfirmDelete({ id, name });
  }

  async function executeDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/produk/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setDeleteError(json.error ?? 'Gagal menghapus produk. Coba lagi.');
        return;
      }
      fetchProducts(search, filterCat);
    } catch {
      setDeleteError('Gagal menghapus produk. Periksa koneksi dan coba lagi.');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  // ── Scanner callback ────────────────────────────────────
  function handleBarcodeDetected(barcode: string, productName?: string) {
    setShowScanner(false);
    setEditData(null);
    // Selalu pass barcode ke form agar bisa disimpan
    setScanPrefillBarcode(barcode);
    // Nama dari Open Food Facts jika ada, fallback ke kosong
    setScanPrefillName(productName ?? '');
    setShowModal(true);
  }

  return (
    <>
      {/* ── Confirm Delete Dialog (a11y: mengganti browser confirm()) */}
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          aria-describedby="confirm-delete-desc"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--color-backdrop-blur)',
            backdropFilter: 'blur(8px)',
            animation: 'fade-in 0.15s ease',
          }}
        >
          <div className="card" style={{ maxWidth: 420, width: '100%', boxShadow: 'var(--shadow-xl)' }}>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-6)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <AlertTriangle size={24} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                <div>
                  <p id="confirm-delete-title" style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)' }}>
                    Hapus Produk?
                  </p>
                  <p id="confirm-delete-desc" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    Produk <strong>&ldquo;{confirmDelete.name}&rdquo;</strong> akan disembunyikan dari kasir.
                    Data histori transaksi tetap tersimpan.
                  </p>
                </div>
              </div>
              {deleteError && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)', background: 'var(--color-error-light)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
                  {deleteError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setConfirmDelete(null); setDeleteError(null); }}
                  className="btn btn-secondary"
                  disabled={deletingId === confirmDelete.id}
                  autoFocus
                >
                  Batal
                </button>
                <button
                  onClick={() => executeDelete(confirmDelete.id)}
                  className="btn btn-danger"
                  disabled={deletingId === confirmDelete.id}
                >
                  {deletingId === confirmDelete.id
                    ? <><Loader2 size={15} className="spin-icon" aria-hidden="true" /> Menghapus...</>
                    : 'Ya, Hapus'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scanner Modal */}
      {showScanner && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ── Produk Modal */}
      {showModal && (
        <ProdukModal
          categories={categories}
          editData={editData}
          prefillName={scanPrefillName}
          prefillBarcode={scanPrefillBarcode}
          onClose={() => { setShowModal(false); setScanPrefillName(undefined); setScanPrefillBarcode(undefined); }}
          onSuccess={() => fetchProducts(search, filterCat)}
        />
      )}

      {/* ── Stok Adjustment Modal */}
      {adjProduct && (
        <StokAdjModal
          product={adjProduct}
          onClose={() => setAdjProduct(null)}
          onSuccess={() => fetchProducts(search, filterCat)}
        />
      )}

      {/* ── Foto Upload Modal */}
      {fotoProduct && (
        <FotoUploadModal
          product={fotoProduct}
          onClose={() => setFotoProduct(null)}
          onSuccess={() => fetchProducts(search, filterCat)}
        />
      )}

      <div>
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Manajemen Produk</h1>
            <p className="page-subtitle">{products.length} produk ditemukan</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              id={`${uid}-scan-barcode`}
              onClick={() => { setScanPrefillName(undefined); setShowScanner(true); }}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <ScanLine size={16} aria-hidden="true" />
              Scan Barcode
            </button>
            <button
              id="btn-tambah-produk"
              onClick={() => { setEditData(null); setScanPrefillName(undefined); setShowModal(true); }}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Plus size={16} aria-hidden="true" />
              Tambah Produk
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="card-body" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="form-input-icon" style={{ flex: 1, minWidth: 200 }}>
              <Search size={16} className="form-input-icon__icon" aria-hidden="true" />
              <input
                type="search"
                className="form-input form-input-icon__input"
                placeholder="Cari nama produk..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Cari produk"
              />
            </div>
            <select
              id={`${uid}-filter-cat`}
              className="form-input form-select"
              style={{ minWidth: 160 }}
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              aria-label="Filter kategori"
            >
              <option value="">Semua Kategori</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Products table */}
        {/* aria-live="polite": screen reader announce saat konten berubah (loading → hasil) */}
        <div className="card" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Loader2 size={32} className="spin-icon" style={{ margin: '0 auto' }} aria-hidden="true" />
              <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }} role="status">Memuat produk...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
              <Package size={40} style={{ margin: '0 auto var(--space-4)', opacity: 0.3 }} aria-hidden="true" />
              <p style={{ fontSize: 'var(--text-sm)' }}>
                {search ? `Tidak ada produk untuk "${search}"` : 'Belum ada produk. Tambah produk pertama!'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
              <table className="table" aria-label="Daftar produk">
                <thead>
                  <tr>
                    <th scope="col">Produk</th>
                    <th scope="col">Kategori</th>
                    <th scope="col" className="text-right">HPP</th>
                    <th scope="col" className="text-right">Harga Jual</th>
                    <th scope="col" className="text-right">Stok</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 'var(--weight-medium)' }}>{p.name}</div>
                        {p.description && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            {p.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          <Tag size={11} aria-hidden="true" /> {p.categoryName}
                        </span>
                      </td>
                      <td className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        Rp {parseFloat(p.costPrice).toLocaleString('id-ID')}
                      </td>
                      <td className="text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-primary)' }}>
                        Rp {parseFloat(p.sellingPrice).toLocaleString('id-ID')}
                      </td>
                      <td className="text-right">
                        <span style={{
                          color: p.stockQty <= 5 ? 'var(--color-error)' : 'inherit',
                          fontWeight: p.stockQty <= 5 ? 'var(--weight-bold)' : undefined,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--space-1)',
                        }}>
                          {/* FIXED: ikon + teks sebagai indikator — tidak hanya warna (WCAG color-contrast) */}
                          {p.stockQty <= 5 && (
                            <AlertTriangle size={12} aria-hidden="true" />
                          )}
                          {p.stockQty} {p.unit}
                          {p.stockQty <= 5 && (
                            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-normal)', marginLeft: 2 }}>
                              (Rendah)
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${p.isActive ? 'badge-success' : 'badge-error'}`}>
                          {p.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => { setEditData(p); setScanPrefillName(undefined); setShowModal(true); }}
                              className="btn btn-ghost btn-sm"
                              title={`Edit produk ${p.name}`}
                              aria-label={`Edit produk ${p.name}`}
                            >
                              <Edit2 size={15} aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setAdjProduct(p)}
                              className="btn btn-ghost btn-sm"
                              title={`Koreksi stok ${p.name}`}
                              aria-label={`Koreksi stok ${p.name}`}
                              style={{ color: 'var(--color-info)' }}
                            >
                              <ClipboardList size={15} aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setFotoProduct(p)}
                              className="btn btn-ghost btn-sm"
                              title={`Upload foto ${p.name}`}
                              aria-label={`Upload foto ${p.name}`}
                            >
                              <ImageIcon size={15} aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="btn btn-ghost btn-sm"
                              disabled={deletingId === p.id}
                              style={{ color: 'var(--color-error)' }}
                              title={`Hapus produk ${p.name}`}
                              aria-label={`Hapus produk ${p.name}`}
                            >
                              {deletingId === p.id
                                ? <Loader2 size={15} className="spin-icon" aria-hidden="true" />
                                : <Trash2 size={15} aria-hidden="true" />
                              }
                            </button>
                          </div>
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
