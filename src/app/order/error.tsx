'use client';

// =============================================================
// Wiramart v2.0 — PWA Order Segment Error Boundary
// Menangkap error runtime di rute /order/* dengan aksi pemulihan jelas.
// =============================================================

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, ShoppingBag } from 'lucide-react';

interface OrderErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function OrderErrorBoundary({ error, reset }: OrderErrorProps) {
  useEffect(() => {
    console.error('[OrderErrorBoundary]', error);
  }, [error]);

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="pwa-page-body">
        <section className="pwa-section" role="alert" style={{ textAlign: 'center', padding: '28px 18px' }}>
          <div
            className="pwa-empty-icon"
            style={{
              margin: '0 auto 6px',
              background: 'hsl(0, 85%, 96%)',
              color: 'hsl(0, 65%, 35%)',
            }}
          >
            <AlertTriangle size={28} aria-hidden="true" />
          </div>

          <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--pwa-text-main)' }}>
            Halaman Gagal Dimuat
          </h1>
          <p className="pwa-empty-desc">
            Terjadi gangguan saat memuat layanan pesan antar. Coba muat ulang halaman ini.
          </p>
          {error.digest && (
            <span className="pwa-hint">Kode referensi: {error.digest}</span>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={reset} className="pwa-btn-primary">
              <RotateCcw size={16} aria-hidden="true" />
              <span>Coba Lagi</span>
            </button>
            <Link href="/order" className="pwa-btn-secondary">
              <ShoppingBag size={16} aria-hidden="true" />
              <span>Kembali ke Katalog</span>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

