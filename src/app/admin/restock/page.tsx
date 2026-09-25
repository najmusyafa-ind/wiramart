'use client';
// =============================================================
// /admin/restock — Halaman Restock Stok via Barcode
// Flow:
//   1. Admin klik Scan Barcode → kamera terbuka
//   2. Barcode terdeteksi → produk ditemukan → tampilkan detail
//   3. Admin input qty restock → submit → stok terupdate
//   4. Bisa juga input barcode manual
// =============================================================

import { useState, useRef, useId } from 'react';
import { ScanLine, Package, Plus, CheckCircle, AlertCircle, X, Loader2, Hash } from 'lucide-react';
import type { Metadata } from 'next';

// BarcodeDetector Type
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(options?: { formats?: string[] });
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

type ProductResult = {
  productId: string;
  productName: string;
  barcode: string;
  beforeQty: number;
  afterQty: number;
  deltaQty: number;
};

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'found'; barcode: string; productName: string; currentQty: number; productId: string }
  | { status: 'not_found'; barcode: string }
  | { status: 'success'; result: ProductResult }
  | { status: 'error'; message: string };

export default function RestockPage() {
  const uid = useId();
  const [state, setState] = useState<ScanState>({ status: 'idle' });
  const [manualBarcode, setManualBarcode] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const camRef = useRef<HTMLVideoElement>(null);
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cek produk berdasarkan barcode ──────────────────────
  async function lookupBarcode(barcode: string) {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    try {
      const res = await fetch(`/api/kasir/produk/barcode?code=${encodeURIComponent(trimmed)}`);
      const json = await res.json() as {
        success: boolean;
        data?: {
          found: boolean;
          product?: { id: string; name: string; stockQty: number };
          barcode?: string;
        };
      };

      if (json.success && json.data?.found && json.data.product) {
        setState({
          status: 'found',
          barcode: trimmed,
          productName: json.data.product.name,
          currentQty: json.data.product.stockQty,
          productId: json.data.product.id,
        });
      } else {
        setState({ status: 'not_found', barcode: trimmed });
      }
    } catch {
      setState({ status: 'error', message: 'Gagal menghubungi server.' });
    }
  }

  // ── Scanner kamera ───────────────────────────────────────
  async function startScan() {
    setState({ status: 'scanning' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!camRef.current) return;
      camRef.current.srcObject = stream;
      await camRef.current.play();

      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
      scanRef.current = setInterval(async () => {
        if (!camRef.current || camRef.current.readyState < 2) return;
        const codes = await detector.detect(camRef.current).catch(() => []);
        if (codes.length > 0 && codes[0]) {
          stopScan();
          await lookupBarcode(codes[0].rawValue);
        }
      }, 400);
    } catch {
      setState({ status: 'error', message: 'Kamera tidak dapat diakses. Gunakan input manual.' });
    }
  }

  function stopScan() {
    if (scanRef.current) clearInterval(scanRef.current);
    if (camRef.current?.srcObject) {
      (camRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      camRef.current.srcObject = null;
    }
    if ((state as { status: string }).status === 'scanning') {
      setState({ status: 'idle' });
    }
  }

  // ── Submit restock ───────────────────────────────────────
  async function handleRestock() {
    if (state.status !== 'found') return;
    const qtyNum = parseInt(qty);
    if (!qtyNum || qtyNum < 1) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/restock-barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: state.barcode, qty: qtyNum, notes }),
      });
      const json = await res.json() as { success: boolean; data?: ProductResult; error?: string };

      if (!res.ok || !json.success) {
        setState({ status: 'error', message: json.error ?? 'Gagal menyimpan restock.' });
        return;
      }
      setState({ status: 'success', result: json.data! });
      setQty('1');
      setNotes('');
      setManualBarcode('');
    } catch {
      setState({ status: 'error', message: 'Kesalahan jaringan.' });
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setState({ status: 'idle' });
    setManualBarcode('');
    setQty('1');
    setNotes('');
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Restock Stok</h1>
          <p className="page-subtitle">Scan barcode produk untuk menambah stok masuk</p>
        </div>
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto' }}>

        {/* ── IDLE: Pilihan scan / manual ── */}
        {state.status === 'idle' && (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {/* Scan via kamera */}
              <button
                onClick={startScan}
                className="btn btn-primary btn-lg"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-5)' }}
              >
                <ScanLine size={24} aria-hidden="true" />
                Scan Barcode via Kamera
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                ATAU INPUT MANUAL
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
              </div>

              {/* Manual barcode input */}
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Hash size={14} style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                  <input
                    id={`${uid}-manual`}
                    type="text"
                    className="form-input"
                    placeholder="Ketik kode barcode..."
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') lookupBarcode(manualBarcode); }}
                    style={{ paddingLeft: 'calc(var(--space-3) + 14px + var(--space-2))', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <button
                  onClick={() => lookupBarcode(manualBarcode)}
                  className="btn btn-secondary"
                  disabled={!manualBarcode.trim()}
                >
                  Cari
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCANNING: Kamera overlay ── */}
        {state.status === 'scanning' && (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: 340, height: 240, borderRadius: 'var(--radius-xl)', overflow: 'hidden', background: '#000' }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={camRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline />
                <div style={{ position: 'absolute', inset: 0, border: '3px solid var(--color-primary)', borderRadius: 'var(--radius-xl)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '50%', left: '10%', right: '10%', height: 2, background: 'var(--color-primary)', opacity: 0.9, animation: 'scan-line 1.5s linear infinite', pointerEvents: 'none' }} />
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Arahkan kamera ke barcode produk</p>
              <button onClick={stopScan} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <X size={16} /> Batal
              </button>
            </div>
          </div>
        )}

        {/* ── FOUND: Produk ditemukan, input qty ── */}
        {state.status === 'found' && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title" style={{ fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Package size={18} style={{ color: 'var(--color-success)' }} />
                Produk Ditemukan
              </h2>
              <button onClick={reset} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Info produk */}
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-success)' }}>
                <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-success)', fontSize: 'var(--text-base)', marginBottom: 'var(--space-1)' }}>
                  {state.productName}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', gap: 'var(--space-4)' }}>
                  <span>Barcode: <code style={{ fontFamily: 'var(--font-mono)' }}>{state.barcode}</code></span>
                  <span>Stok saat ini: <strong>{state.currentQty}</strong></span>
                </div>
              </div>

              {/* Input qty */}
              <div className="form-group">
                <label htmlFor={`${uid}-qty`} className="form-label">
                  Jumlah Masuk *
                </label>
                <input
                  id={`${uid}-qty`}
                  type="number"
                  min="1"
                  className="form-input"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  autoFocus
                  style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', textAlign: 'center' }}
                />
              </div>

              {/* Preview stok sesudah */}
              {qty && parseInt(qty) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface-muted)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Stok setelah restock</span>
                  <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)', fontSize: 'var(--text-base)' }}>
                    {state.currentQty} + {parseInt(qty)} = <strong>{state.currentQty + parseInt(qty)}</strong>
                  </span>
                </div>
              )}

              {/* Notes opsional */}
              <div className="form-group">
                <label htmlFor={`${uid}-notes`} className="form-label">
                  Catatan <span style={{ color: 'var(--color-text-muted)', fontWeight: 'var(--weight-normal)' }}>(opsional)</span>
                </label>
                <input
                  id={`${uid}-notes`}
                  type="text"
                  className="form-input"
                  placeholder="Contoh: Pengiriman dari supplier, tanggal..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button onClick={reset} className="btn btn-secondary" style={{ flex: 1 }} disabled={submitting}>
                  Batal
                </button>
                <button
                  onClick={handleRestock}
                  className="btn btn-primary"
                  style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
                  disabled={submitting || !qty || parseInt(qty) < 1}
                >
                  {submitting
                    ? <><Loader2 size={16} className="spin-icon" /> Menyimpan...</>
                    : <><Plus size={16} /> Simpan Restock</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── NOT FOUND ── */}
        {state.status === 'not_found' && (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', textAlign: 'center', padding: 'var(--space-8)' }}>
              <AlertCircle size={48} style={{ color: 'var(--color-warning)', opacity: 0.8 }} />
              <div>
                <div style={{ fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-1)' }}>Barcode Tidak Ditemukan</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  Barcode <code style={{ fontFamily: 'var(--font-mono)' }}>{state.barcode}</code> belum terdaftar di sistem.
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                  Daftarkan produk baru di halaman Produk, lalu input barcode ini.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button onClick={reset} className="btn btn-secondary">Coba Lagi</button>
                <a href="/admin/produk" className="btn btn-primary">Tambah Produk Baru</a>
              </div>
            </div>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {state.status === 'success' && (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)', textAlign: 'center', padding: 'var(--space-8)' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--color-success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'check-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                <CheckCircle size={36} style={{ color: 'var(--color-success)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-lg)', marginBottom: 'var(--space-1)' }}>
                  Restock Berhasil!
                </div>
                <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-primary)', marginBottom: 'var(--space-3)' }}>
                  {state.result.productName}
                </div>
                <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 'var(--space-2)', background: 'var(--color-surface-muted)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', minWidth: 200 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Stok sebelum</span>
                    <strong>{state.result.beforeQty}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Ditambahkan</span>
                    <strong style={{ color: 'var(--color-success)' }}>+{state.result.deltaQty}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-2)' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Stok sekarang</span>
                    <strong style={{ fontSize: 'var(--text-lg)', color: 'var(--color-primary)' }}>{state.result.afterQty}</strong>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button onClick={reset} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <ScanLine size={16} /> Scan Produk Lagi
                </button>
                <a href="/admin/produk" className="btn btn-secondary">Lihat Produk</a>
              </div>
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
        {state.status === 'error' && (
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', textAlign: 'center', padding: 'var(--space-6)' }}>
              <AlertCircle size={40} style={{ color: 'var(--color-error)' }} />
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)', fontWeight: 'var(--weight-medium)' }}>
                {state.message}
              </div>
              <button onClick={reset} className="btn btn-secondary">Coba Lagi</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
