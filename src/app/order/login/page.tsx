'use client';

// =============================================================
// Wiramart v2.0 — /order/login
// Satu halaman, dua tab: Masuk (NIM + Nama) & Daftar (+ WA).
// API sudah ada: /api/order/auth/login | /register (set cookie sk_buyer).
// =============================================================

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

type Mode = 'login' | 'daftar';

/** Hanya izinkan redirect internal ke /order/* (anti open-redirect). */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return next.startsWith('/order') && !next.startsWith('//') ? next : '/order';
}

export default function BuyerAuthPage() {
  const router = useRouter();
  const { refreshBuyer } = useCart();
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return; // cegah double-submit
    const f = new FormData(e.currentTarget);
    const body =
      mode === 'login'
        ? { nim: String(f.get('nim')), fullName: String(f.get('fullName')) }
        : {
            nim: String(f.get('nim')),
            fullName: String(f.get('fullName')),
            whatsapp: String(f.get('whatsapp')),
          };

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/order/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(typeof json?.error === 'string' ? json.error : 'Terjadi kesalahan. Coba lagi.');
        // NIM sudah terdaftar → arahkan ke tab Masuk, bukan buntu
        if (json?.code === 'NIM_ALREADY_REGISTERED') setMode('login');
        return;
      }
      await refreshBuyer();
      router.replace(safeNext());
    } catch {
      setError('Koneksi bermasalah. Periksa internet kamu lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="pwa-page-bar">
        <Link href="/order" className="pwa-back-btn" aria-label="Kembali ke katalog">
          <ArrowLeft size={18} />
        </Link>
        <h1>{mode === 'login' ? 'Masuk' : 'Daftar Akun'}</h1>
      </div>

      <div className="pwa-page-body">
        <div className="pwa-tabs" role="tablist" aria-label="Masuk atau daftar">
          {(['login', 'daftar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              id={`tab-${m}`}
              aria-selected={mode === m}
              className="pwa-tab"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === 'login' ? 'Masuk' : 'Daftar'}
            </button>
          ))}
        </div>

        <p className="pwa-hint" style={{ margin: 0 }}>
          {mode === 'login'
            ? 'Tanpa password. Cukup NIM dan nama lengkap sesuai saat mendaftar.'
            : 'Sekali daftar, 7 hari tidak perlu masuk lagi di HP ini.'}
        </p>

        <form className="pwa-section" onSubmit={onSubmit} aria-labelledby={`tab-${mode}`} noValidate>
          {error && (
            <div className="pwa-alert" role="alert">
              {error}
            </div>
          )}

          <div className="pwa-field">
            <label className="pwa-label" htmlFor="nim">NIM</label>
            <input
              id="nim"
              name="nim"
              className="pwa-input"
              inputMode="numeric"
              autoComplete="username"
              pattern="\d{8,15}"
              maxLength={15}
              placeholder="contoh: 2021110123"
              required
            />
          </div>

          <div className="pwa-field">
            <label className="pwa-label" htmlFor="fullName">Nama Lengkap</label>
            <input
              id="fullName"
              name="fullName"
              className="pwa-input"
              autoComplete="name"
              maxLength={200}
              placeholder="sesuai KTM"
              required
            />
          </div>

          {mode === 'daftar' && (
            <div className="pwa-field">
              <label className="pwa-label" htmlFor="whatsapp">Nomor WhatsApp</label>
              <input
                id="whatsapp"
                name="whatsapp"
                className="pwa-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={16}
                placeholder="08123456789"
                required
              />
              <span className="pwa-hint">Dipakai untuk PIN serah terima & info pesanan.</span>
            </div>
          )}

          <button type="submit" className="pwa-btn-primary" disabled={loading}>
            {loading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            <span>{loading ? 'Memproses...' : mode === 'login' ? 'Masuk' : 'Daftar & Lanjut'}</span>
          </button>
        </form>
      </div>
    </main>
  );
}
