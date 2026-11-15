// =============================================================
// Smartkasir Perwira — Custom 404 Not Found Page (App Router)
// Ditampilkan ketika rute tidak ditemukan atau memanggil notFound().
// =============================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { FileQuestion, Home, LogIn } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Halaman Tidak Ditemukan',
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding:
          'calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px))',
        background: 'var(--color-bg)',
      }}
    >
      <section className="card" style={{ width: '100%', maxWidth: 420 }}>
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
              background: 'var(--color-primary-light)',
              color: 'var(--color-primary)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <FileQuestion size={26} aria-hidden="true" />
          </div>

          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              letterSpacing: '0.08em',
              color: 'var(--color-primary)',
              background: 'var(--color-primary-light)',
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
            }}
          >
            HTTP 404
          </span>

          <h1
            style={{
              margin: 0,
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text)',
            }}
          >
            Halaman Tidak Ditemukan
          </h1>

          <p
            style={{
              margin: 0,
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              lineHeight: 'var(--leading-normal)',
            }}
          >
            URL yang Anda tuju tidak tersedia, sudah dipindahkan, atau memerlukan login dengan peran yang sesuai.
          </p>

          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-2)',
            }}
          >
            <Link
              href="/"
              className="btn btn-primary btn-full"
              style={{ minHeight: 44 }}
            >
              <Home size={16} aria-hidden="true" />
              <span>Ke Beranda</span>
            </Link>
            <Link
              href="/login"
              className="btn btn-ghost btn-full"
              style={{ minHeight: 44 }}
            >
              <LogIn size={16} aria-hidden="true" />
              <span>Halaman Login</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
