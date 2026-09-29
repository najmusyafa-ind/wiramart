'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const IDLE_WARN_MS  = 29 * 60 * 1000;
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const IDLE_EVENTS   = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export default function IdleSessionGuard({ role }: { role: 'admin' | 'employee' }) {
  const router = useRouter();
  const [showWarn, setShowWarn]   = useState(false);
  const [countdown, setCountdown] = useState(60);
  const warnRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doLogout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).catch(() => {});
    router.push('/login?reason=idle');
  }, [role, router]);

  const resetTimers = useCallback(() => {
    if (warnRef.current)   clearTimeout(warnRef.current);
    if (logoutRef.current) clearTimeout(logoutRef.current);
    warnRef.current   = setTimeout(() => setShowWarn(true), IDLE_WARN_MS);
    logoutRef.current = setTimeout(() => doLogout(), IDLE_LIMIT_MS);
  }, [doLogout]);

  function handleStay() {
    setShowWarn(false);
    if (countdownRef.current) clearInterval(countdownRef.current);
    resetTimers();
  }

  useEffect(() => {
    IDLE_EVENTS.forEach((ev) => window.addEventListener(ev, resetTimers, { passive: true }));
    resetTimers();
    return () => {
      IDLE_EVENTS.forEach((ev) => window.removeEventListener(ev, resetTimers));
      if (warnRef.current)      clearTimeout(warnRef.current);
      if (logoutRef.current)    clearTimeout(logoutRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [resetTimers]);

  useEffect(() => {
    if (!showWarn) return;
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(countdownRef.current!); doLogout(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [showWarn, doLogout]);

  if (!showWarn) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warn-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
      }}
    >
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
        padding: '2rem', maxWidth: 380, width: '90%',
        boxShadow: 'var(--shadow-xl)', textAlign: 'center',
        display: 'flex', flexDirection: 'column', gap: '1rem',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'hsl(38 92% 95%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto', fontSize: 28,
        }}>⏱️</div>
        <h2 id="idle-warn-title" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
          Sesi Hampir Berakhir
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.6 }}>
          Anda tidak aktif. Sistem akan <strong>logout otomatis</strong> dalam:
        </p>
        <div style={{
          fontSize: 52, fontWeight: 'var(--weight-bold)',
          color: countdown <= 10 ? 'var(--color-error)' : 'var(--color-primary)',
          lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          transition: 'color 0.3s',
        }}>
          {countdown}
          <span style={{ fontSize: 16, fontWeight: 'normal', color: 'var(--color-text-muted)', marginLeft: 6 }}>detik</span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={doLogout} className="btn btn-secondary" style={{ flex: 1 }}>Logout</button>
          <button id="btn-stay-logged-in" onClick={handleStay} className="btn btn-primary" style={{ flex: 2 }} autoFocus>
            Tetap Login
          </button>
        </div>
      </div>
    </div>
  );
}
