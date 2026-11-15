'use client';

// =============================================================
// Smartkasir Perwira — Root Global Error Boundary (App Router)
// Menangkap error fatal pada root layout & menyediakan pemulihan aman.
// =============================================================

import './globals.css';
import React, { useEffect } from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: 'var(--color-bg, hsl(150, 20%, 97%))',
          color: 'var(--color-text, hsl(145, 15%, 12%))',
        }}
      >
        <main
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            padding:
              'calc(var(--space-4, 16px) + env(safe-area-inset-top, 0px)) var(--space-4, 16px) calc(var(--space-4, 16px) + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <section
            className="card"
            role="alert"
            style={{
              width: '100%',
              maxWidth: 420,
              background: 'var(--color-surface, hsl(0, 0%, 100%))',
              border: '1px solid var(--color-border, hsl(145, 20%, 86%))',
              borderRadius: 'var(--radius-xl, 16px)',
              padding: 'var(--space-6, 24px)',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 'var(--space-3, 12px)',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 'var(--radius-full, 9999px)',
                  background: 'var(--color-error-light, hsl(0, 72%, 95%))',
                  color: 'var(--color-error, hsl(0, 72%, 51%))',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <AlertTriangle size={26} aria-hidden="true" />
              </div>

              <h1
                style={{
                  margin: 0,
                  fontSize: 'var(--text-lg, 1.125rem)',
                  fontWeight: 700,
                  color: 'var(--color-text, hsl(145, 15%, 12%))',
                }}
              >
                Gangguan Sistem Kritis
              </h1>

              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--text-sm, 0.875rem)',
                  color: 'var(--color-text-secondary, hsl(145, 10%, 38%))',
                  lineHeight: 1.5,
                }}
              >
                Aplikasi mengalami kegagalan tak terduga. Silakan coba muat ulang sesi atau kembali ke beranda.
              </p>

              {error.digest && (
                <span
                  style={{
                    fontSize: 'var(--text-xs, 0.75rem)',
                    color: 'var(--color-text-muted, hsl(145, 8%, 40%))',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  Kode referensi: {error.digest}
                </span>
              )}

              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2, 8px)',
                  marginTop: 'var(--space-2, 8px)',
                }}
              >
                <button
                  type="button"
                  onClick={reset}
                  className="btn btn-primary btn-full"
                  style={{ minHeight: 44 }}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  <span>Coba Lagi</span>
                </button>
                {/* Hard navigation disengaja untuk reset root layout yang gagal */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/"
                  className="btn btn-ghost btn-full"
                  style={{ minHeight: 44 }}
                >
                  <Home size={16} aria-hidden="true" />
                  <span>Muat Ulang Beranda</span>
                </a>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
