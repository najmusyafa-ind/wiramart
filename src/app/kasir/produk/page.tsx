'use client';

// ─────────────────────────────────────────────────────────────
// BarcodeDetector Web API — Shape Detection API
// Belum masuk TypeScript stdlib (TS 5.x). Deklarasi manual.
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
    source: HTMLVideoElement | HTMLImageElement | ImageBitmap | ImageData | HTMLCanvasElement,
  ): Promise<DetectedBarcode[]>;
}

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Edit2, Package, X, Loader2, ChevronLeft,
  Camera, CameraOff, ScanLine, CheckCircle, AlertCircle, Eye,
} from 'lucide-react';

type Category = { id: string; name: string };
type Product = {
  id: string; name: string; description?: string;
  costPrice: string; sellingPrice: string; stockQty: number;
  unit: string; photoUrl?: string; isActive: boolean;
  categoryId: string; categoryName?: string; barcode?: string | null;
};
type OpenFoodFactsResult = {
  status: number;
  product?: { product_name_id?: string; product_name?: string; brands?: string; quantity?: string };
};

// ────────────────────────────────────────────────
// Toast
// ────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
      background: type === 'success' ? 'hsl(142 60% 38%)' : 'hsl(0 72% 51%)',
      color: '#fff', padding: '10px 20px', borderRadius: 12,
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 9999,
      fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

// ────────────────────────────────────────────────
// BarcodeScanner — identik dengan admin/produk
// Strategy: BarcodeDetector (native) → quagga2 fallback
// ────────────────────────────────────────────────
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scanLoop() {
    if (!videoRef.current || !detectorRef.current) return;
    const video = videoRef.current;
    async function detect() {
      if (video.readyState < 2) { rafRef.current = requestAnimationFrame(detect); return; }
      try {
        const barcodes = await detectorRef.current!.detect(video);
        if (barcodes.length > 0) { handleBarcode(barcodes[0]!.rawValue); return; }
      } catch { /* frame decode error — continue */ }
      rafRef.current = requestAnimationFrame(detect);
    }
    rafRef.current = requestAnimationFrame(detect);
  }

  async function startQuagga() {
    try {
      const Quagga = (await import('@ericblade/quagga2')).default;
      setStatus('scanning');
      Quagga.init({
        inputStream: {
          type: 'LiveStream',
          target: videoRef.current!.parentElement as HTMLElement,
          constraints: { facingMode: 'environment', width: 1280, height: 720 },
        },
        decoder: { readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'upc_reader'] },
      }, (err: Error | null) => {
        if (err) { setErrorMsg('Gagal init scanner (Quagga2).'); setStatus('error'); return; }
        Quagga.start();
        Quagga.onDetected((result) => {
          const code = result.codeResult?.code ?? '';
          if (code) { Quagga.stop(); handleBarcode(code); }
        });
      });
    } catch {
      setErrorMsg('Browser tidak mendukung Barcode Scanner. Gunakan Chrome atau Edge terbaru.');
      setStatus('error');
    }
  }

  async function handleBarcode(code: string) {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setDetectedCode(code);
    setStatus('detected');
    setFetchingOff(true);

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
    } catch { /* timeout — lanjut tanpa nama */ }
    finally { setFetchingOff(false); }

    onDetected(code, productName);
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={`${uid}-scanner-title`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 460, overflow: 'hidden' }}>
        {/* Header */}
        <div className="card-header">
          <h2 id={`${uid}-scanner-title`} className="card-title"
            style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ScanLine size={16} aria-hidden="true" />
            Scan Barcode Produk
          </h2>
          <button onClick={onClose} aria-label="Tutup scanner"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Camera view */}
        <div style={{ position: 'relative', backgroundColor: '#000', aspectRatio: '4/3', overflow: 'hidden' }}>
          <video ref={videoRef} muted playsInline
            aria-label="Tampilan kamera untuk scan barcode"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: status === 'error' ? 'none' : 'block' }}
          />
          {/* Scan frame overlay */}
          {status === 'scanning' && (
            <>
              {[
                { top: '20%', left: '20%', borderTop: '3px solid', borderLeft: '3px solid' },
                { top: '20%', right: '20%', borderTop: '3px solid', borderRight: '3px solid' },
                { bottom: '20%', left: '20%', borderBottom: '3px solid', borderLeft: '3px solid' },
                { bottom: '20%', right: '20%', borderBottom: '3px solid', borderRight: '3px solid' },
              ].map((s, i) => (
                <div key={i} aria-hidden="true" style={{
                  position: 'absolute', width: 28, height: 28,
                  borderColor: 'var(--color-primary)', ...s,
                }} />
              ))}
              <div aria-hidden="true" style={{
                position: 'absolute', left: '20%', right: '20%', height: 2,
                backgroundColor: 'var(--color-primary)', boxShadow: '0 0 8px var(--color-primary)',
                animation: 'scanLine 2s ease-in-out infinite', top: '20%',
              }} />
              <p style={{
                position: 'absolute', bottom: 'var(--space-4)', left: 0, right: 0,
                textAlign: 'center', color: 'rgba(255,255,255,0.85)',
                fontSize: 'var(--text-xs)', textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              }}>
                Arahkan kamera ke barcode produk
              </p>
            </>
          )}
          {status === 'requesting' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', color: 'white' }}>
              <Camera size={36} aria-hidden="true" style={{ opacity: 0.7 }} />
              <span style={{ fontSize: 'var(--text-sm)' }}>Membuka kamera...</span>
            </div>
          )}
          {status === 'error' && (
            <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', textAlign: 'center', minHeight: 200 }}>
              <CameraOff size={36} style={{ color: 'var(--color-error)', opacity: 0.7 }} aria-hidden="true" />
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{errorMsg}</p>
            </div>
          )}
          {status === 'detected' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
              {fetchingOff ? (
                <>
                  <Loader2 size={32} className="spin-icon" aria-hidden="true" style={{ color: 'white' }} />
                  <p style={{ color: 'white', fontSize: 'var(--text-sm)' }}>Mencari data produk...</p>
                </>
              ) : (
                <>
                  <CheckCircle size={36} aria-hidden="true" style={{ color: 'var(--color-success)' }} />
                  <p style={{ color: 'white', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Barcode terdeteksi!</p>
                  <code style={{ color: 'var(--color-primary)', fontSize: 'var(--text-xs)' }}>{detectedCode}</code>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="card-body" style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Mendukung EAN-13, EAN-8, QR Code, Code-128
          </p>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Modal Tambah / Edit Produk
// ────────────────────────────────────────────────
function ProdukModal({
  categories, editData, prefillBarcode, prefillName, onClose, onSaved,
}: {
  categories: Category[];
  editData: Product | null;
  prefillBarcode?: string;
  prefillName?: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const isEdit = !!editData;
  const [form, setForm] = useState({
    categoryId: editData?.categoryId ?? (categories[0]?.id ?? ''),
    name: editData?.name ?? prefillName ?? '',
    description: editData?.description ?? '',
    sellingPrice: editData ? Number(editData.sellingPrice) : 0,
    costPrice: editData ? Number(editData.costPrice) : 0,
    stockQty: editData?.stockQty ?? 0,
    unit: editData?.unit ?? 'pcs',
    barcode: editData?.barcode ?? prefillBarcode ?? '',
  });
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(editData?.photoUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Sync prefill saat props berubah (scanner → modal)
  useEffect(() => {
    if (prefillBarcode) setForm(p => ({ ...p, barcode: prefillBarcode }));
    if (prefillName) setForm(p => ({ ...p, name: prefillName }));
  }, [prefillBarcode, prefillName]);

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFoto(f);
    setPreview(URL.createObjectURL(f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) { setErr('Nama produk wajib diisi.'); return; }
    if (!form.categoryId) { setErr('Pilih kategori.'); return; }
    setSaving(true);
    try {
      if (!isEdit) {
        // K8: Kasir hanya mengusulkan produk (nama, kategori, barcode, satuan)
        const res = await fetch('/api/kasir/produk/usulkan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            categoryId: form.categoryId,
            barcode: form.barcode?.trim() || null,
            unit: form.unit || 'pcs',
          }),
        });
        const json = await res.json();
        if (!res.ok) { setErr(json.error ?? 'Gagal mengirim usulan produk.'); setSaving(false); return; }
        onSaved('Usulan produk berhasil dikirim ke Gudang / Admin untuk penentuan HPP!');
        return;
      }

      // Mode Edit (hanya jika diizinkan)
      const payload = {
        ...form,
        barcode: form.barcode?.trim() || null,
        expectedStockQty: editData!.stockQty,
      };

      const res = await fetch(`/api/admin/produk/${editData!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? 'Gagal mengupdate produk.'); setSaving(false); return; }

      if (foto && editData?.id) {
        const fd = new FormData();
        fd.append('foto', foto);
        await fetch(`/api/admin/produk/${editData.id}/foto`, { method: 'POST', body: fd });
      }

      onSaved('Produk berhasil diperbarui!');
    } catch {
      setErr('Terjadi kesalahan jaringan. Coba lagi.');
    } finally {
      setSaving(false);
    }
  }

  const f = form;
  const set = (k: keyof typeof form, v: string | number) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--color-surface)', width: '100%', maxWidth: 520,
        borderRadius: '20px 20px 0 0', padding: 'var(--space-6)',
        maxHeight: '92dvh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
              {isEdit ? 'Detail Informasi Produk' : '💡 Usulkan Produk Baru'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
              {isEdit ? 'Informasi spesifikasi barang di sistem kasir' : 'Kirim usulan barang baru ke Gudang / Admin untuk penetapan HPP & harga jual'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} aria-label="Tutup modal">
            <X size={20} />
          </button>
        </div>

        {err && (
          <div style={{ background: 'var(--color-error-light)', color: 'var(--color-error)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            {err}
          </div>
        )}

        {/* Barcode info jika dari scan */}
        {f.barcode && !isEdit && (
          <div style={{
            background: 'var(--color-primary-light)', color: 'var(--color-primary)',
            padding: '8px 12px', borderRadius: 8, marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          }}>
            <ScanLine size={14} />
            <span>Barcode terdeteksi: <strong>{f.barcode}</strong></span>
          </div>
        )}

        {/* Penjelasan Kebijakan K8 untuk Kasir */}
        {!isEdit && (
          <div style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
            marginBottom: 12,
          }}>
            <strong style={{ color: 'var(--color-primary)', display: 'block', marginBottom: 2 }}>
              🛡️ Kebijakan Wiramart UNPERBA (K8 & K2):
            </strong>
            Kasir hanya mengusulkan nama, barcode, foto, dan kategori. HPP dan Harga Jual akan diverifikasi & ditetapkan langsung oleh Kepala Gudang / Admin sesuai margin global toko.
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Foto */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Foto Produk (opsional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 80, height: 80, borderRadius: 10,
                background: 'var(--color-surface-muted)', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1.5px dashed var(--color-border)',
              }}>
                {preview
                  ? <img src={preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Package size={28} color="var(--color-text-muted)" />}
              </div>
              {!isEdit && (
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                  padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 'var(--text-sm)', fontWeight: 600,
                }}>
                  {preview ? 'Ganti Foto' : 'Pilih Foto'}
                  <input type="file" accept="image/*" onChange={handleFoto} style={{ display: 'none' }} />
                </label>
              )}
            </div>
          </div>

          {/* Kategori */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Kategori *</label>
            {isEdit ? (
              <input className="form-input" value={categories.find(c => c.id === f.categoryId)?.name ?? '—'} disabled />
            ) : (
              <select value={f.categoryId} onChange={e => set('categoryId', e.target.value)} className="form-input" required>
                <option value="">-- Pilih Kategori --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {/* Nama */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Nama Produk *</label>
            <input className="form-input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="Contoh: Aqua Botol 600ml" required disabled={isEdit} />
          </div>

          {/* Barcode */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Barcode (opsional)</label>
            <input className="form-input" value={f.barcode} onChange={e => set('barcode', e.target.value)}
              placeholder="Scan atau ketik barcode..." disabled={isEdit} />
          </div>

          {/* Satuan */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Satuan
              <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)' }}>Bentuk kemasan / eceran</span>
            </label>
            {isEdit ? (
              <input className="form-input" value={f.unit} disabled />
            ) : (
              <select className="form-input" value={f.unit} onChange={e => set('unit', e.target.value)}>
                <option value="pcs">pcs</option>
                <option value="botol">botol</option>
                <option value="pak">pak</option>
                <option value="dus">dus</option>
                <option value="bungkus">bungkus</option>
              </select>
            )}
          </div>

          {/* Deskripsi */}
          <div>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Catatan Tambahan untuk Gudang (opsional)</label>
            <textarea className="form-input" value={f.description} onChange={e => set('description', e.target.value)}
              placeholder="Keterangan kulakan, supplier, atau lokasi rak..." rows={2} style={{ resize: 'none' }} disabled={isEdit} />
          </div>

          {/* Jika modal sedang membuka detail produk yang sudah ada */}
          {isEdit && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
              <div>
                <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Harga Jual Kasir</label>
                <input className="form-input" value={`Rp ${Number(f.sellingPrice).toLocaleString('id-ID')}`} disabled />
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Sisa Stok di Rak</label>
                <input className="form-input" value={`${f.stockQty} ${f.unit}`} disabled />
              </div>
            </div>
          )}

          {!isEdit ? (
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 8, padding: '12px 16px', fontSize: 14, fontWeight: 700 }}>
              {saving ? <><Loader2 size={16} className="spin-icon" /> Mengirim Usulan...</> : '📨 Kirim Usulan Produk ke Gudang / Admin'}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="btn btn-secondary" style={{ marginTop: 8, padding: '12px 16px', fontSize: 14, fontWeight: 600 }}>
              Tutup Detail
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Halaman utama Kelola Produk (Kasir)
// ────────────────────────────────────────────────
export default function KasirProdukPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData] = useState<Product | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [prefillBarcode, setPrefillBarcode] = useState<string | undefined>();
  const [prefillName, setPrefillName] = useState<string | undefined>();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fetchProducts = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/produk?q=${encodeURIComponent(q)}`);
      if (res.status === 401 || res.status === 403) { router.push('/kasir/login'); return; }
      const json = await res.json();
      if (json.success) {
        setProducts(json.data.products);
        setCategories(json.data.categories);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const b = params.get('barcode');
      const n = params.get('nama');
      const t = params.get('tambah');
      if (b || n || t === '1') {
        if (b) setPrefillBarcode(b);
        if (n) setPrefillName(n);
        setEditData(null);
        setShowModal(true);
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchProducts(search), 350);
    return () => clearTimeout(t);
  }, [search, fetchProducts]);

  function handleBarcodeDetected(barcode: string, productName?: string) {
    setShowScanner(false);
    setEditData(null);
    setPrefillBarcode(barcode);
    setPrefillName(productName ?? '');
    setShowModal(true);
  }

  function onSaved(msg: string) {
    setShowModal(false);
    setEditData(null);
    setPrefillBarcode(undefined);
    setPrefillName(undefined);
    setToast({ msg, type: 'success' });
    fetchProducts(search);
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 24 }}>
      {/* Header */}
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
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-secondary)', padding: 4 }}
          aria-label="Kembali ke POS"
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-bold)', lineHeight: 1.2 }}>Kelola Produk</h1>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{products.length} produk tersedia</p>
        </div>
        {/* Tombol Scan Barcode */}
        <button
          id="btn-scan-barcode-kasir"
          onClick={() => { setEditData(null); setShowScanner(true); }}
          className="btn btn-secondary btn-sm"
          title="Scan barcode untuk tambah produk"
          aria-label="Scan barcode produk"
        >
          <ScanLine size={15} />
          <span style={{ display: 'none' }}>Scan</span>
        </button>
        {/* Tombol Tambah Manual */}
        <button
          id="btn-tambah-produk-kasir"
          onClick={() => { setEditData(null); setPrefillBarcode(undefined); setPrefillName(undefined); setShowModal(true); }}
          className="btn btn-primary btn-sm"
        >
          <Plus size={15} /> Usul Produk
        </button>
      </div>

      {/* Banner 2 Tombol Aksi Utama (Sangat Jelas & Mencolok untuk Mahasiswa Shift) */}
      <div style={{
        margin: '12px 16px 6px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
      }}>
        <button
          id="btn-tambah-produk-banner"
          onClick={() => { setEditData(null); setPrefillBarcode(undefined); setPrefillName(undefined); setShowModal(true); }}
          style={{
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'transform 0.1s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={18} />
            <span>💡 Usul Produk Baru</span>
          </div>
          <span style={{ fontSize: 11, opacity: 0.9, fontWeight: 400 }}>Ajukan ke Gudang/Admin</span>
        </button>

        <button
          id="btn-scan-barcode-banner"
          onClick={() => { setEditData(null); setShowScanner(true); }}
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-primary)',
            border: '1.5px solid var(--color-primary)',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ScanLine size={18} />
            <span>📷 Scan Barcode</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>Via kamera HP</span>
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 16px' }}>
        <div className="form-input-icon">
          <Search size={16} className="form-input-icon__icon" />
          <input
            className="form-input form-input-icon__input"
            type="search"
            placeholder="Cari nama atau barcode produk..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Cari produk"
          />
        </div>
      </div>

      {/* Produk List */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div
            className="empty-state"
            style={{
              padding: 'var(--space-12)',
              color: 'var(--color-text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              width: '100%',
            }}
          >
            <Loader2 size={24} className="spin-icon" style={{ margin: '0 auto var(--space-2)' }} />
            <span style={{ fontSize: 14, textAlign: 'center' }}>Memuat produk...</span>
          </div>
        ) : products.length === 0 ? (
          <div
            className="empty-state"
            style={{
              padding: 'var(--space-12)',
              color: 'var(--color-text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              width: '100%',
            }}
          >
            <Package size={36} style={{ margin: '0 auto var(--space-2)', opacity: 0.35 }} />
            <span style={{ fontSize: 14, textAlign: 'center' }}>{search ? `Tidak ada hasil untuk "${search}"` : 'Belum ada produk.'}</span>
            <button
              onClick={() => { setEditData(null); setPrefillBarcode(undefined); setPrefillName(search); setShowModal(true); }}
              className="btn btn-primary btn-sm"
              style={{ marginTop: 12 }}
            >
              <Plus size={14} /> + Tambah Produk "{search || 'Baru'}"
            </button>
          </div>
        ) : (
          products.map(p => (
            <div key={p.id} style={{
              background: 'var(--color-surface)', borderRadius: 12,
              border: '1px solid var(--color-border)',
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              {/* Foto */}
              <div style={{
                width: 64, height: 64, borderRadius: 10, flexShrink: 0,
                background: 'var(--color-surface-muted)', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {p.photoUrl
                  ? <img src={p.photoUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Package size={28} color="var(--color-text-muted)" />}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {p.categoryName ?? '—'} · Stok: <strong style={{ color: p.stockQty <= 2 ? 'var(--color-error)' : 'inherit' }}>{p.stockQty} {p.unit}</strong>
                  {p.barcode && <span> · <code style={{ fontSize: 10 }}>{p.barcode}</code></span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 700, marginTop: 2 }}>
                  Rp {Number(p.sellingPrice).toLocaleString('id-ID')}
                </div>
              </div>
              {/* Tombol Aksi Ubah Stok & Harga (Sangat Jelas Ada Tulisannya) */}
              <button
                id={`btn-edit-produk-${p.id}`}
                onClick={() => { setEditData(p); setShowModal(true); }}
                style={{
                  background: 'var(--color-primary-light)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                title="Lihat detail spesifikasi produk"
                aria-label={`Detail produk ${p.name}`}
              >
                <Eye size={13} />
                <span>Detail Produk</span>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Floating Action Button (FAB) Tambah Produk untuk Kemudahan di HP Kasir */}
      <button
        id="fab-tambah-produk-kasir"
        onClick={() => { setEditData(null); setPrefillBarcode(undefined); setPrefillName(undefined); setShowModal(true); }}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 16,
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '12px 18px',
          borderRadius: 9999,
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
        aria-label="Usulkan produk baru"
      >
        <Plus size={18} />
        <span>💡 Usul Produk</span>
      </button>

      {/* Scanner Modal */}
      {showScanner && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Produk Modal */}
      {showModal && (
        <ProdukModal
          categories={categories}
          editData={editData}
          prefillBarcode={prefillBarcode}
          prefillName={prefillName}
          onClose={() => { setShowModal(false); setEditData(null); setPrefillBarcode(undefined); setPrefillName(undefined); }}
          onSaved={onSaved}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
