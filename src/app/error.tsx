'use client';

// =============================================================
// Smartkasir Perwira — Root App Router Error Boundary
// Menangkap error runtime tak terduga di seluruh rute aplikasi.
// =============================================================

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

interface RootErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootErrorBoundary({ error, reset }: RootErrorProps) {
  useEffect(() => {
    console.error('[RootErrorBoundary]', error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: '100svh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
      }}
    >
      <section
        className="card"
        role="alert"
        style={{ width: '100%', maxWidth: 420 }}
      >
        <div
          className="card-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-error-light)',
              color: 'var(--color-error)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <AlertTriangle size={26} aria-hidden="true" />
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text)',
            }}
          >
            Terjadi Kesalahan Sistem
          </h1>

          <p
            style={{
              margin: 0,
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 'var(--leading-normal)',
            }}
          >
            Halaman mengalami kendala saat dimuat. Silakan coba muat ulang atau kembali ke beranda.
          </p>

          {error.digest && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Kode referensi: {error.digest}
            </span>
          )}

          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-2)',
            }}
          >
            <button type="button" onClick={reset} className="btn btn-primary btn-full">
              <RotateCcw size={16} aria-hidden="true" />
              <span>Coba Lagi</span>
            </button>
            <Link href="/" className="btn btn-ghost btn-full">
              <Home size={16} aria-hidden="true" />
              <span>Ke Beranda</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

