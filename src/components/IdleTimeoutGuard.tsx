'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import {
  clearIdleStorage,
  evaluateIdleStatus,
  resolveEffectiveLastActive,
  serializeIdleActivity,
  serializeLogoutSyncPayload,
  shouldHonorLogoutSync,
  type IdleTimeoutPolicy,
} from '@/lib/utils/idle-timeout';

type IdleTimeoutGuardProps = {
  policy: IdleTimeoutPolicy;
  /** Timestamp terbitnya JWT sesi aktif (ms sejak epoch, dari claim `iat * 1000`) */
  sessionIssuedAtMs?: number;
};

/**
 * Penjaga sesi berbasis idle & perpindahan tab untuk Manager, Admin Shift, dan Gudang.
 * Terikat penuh ke `sessionIssuedAtMs` sehingga login baru tidak pernah terbaca sebagai sesi kadaluarsa.
 */
export default function IdleTimeoutGuard({
  policy,
  sessionIssuedAtMs,
}: IdleTimeoutGuardProps) {
  const [fallbackIssuedAt] = useState(() => Date.now());
  const effectiveSessionIssuedAt =
    sessionIssuedAtMs && sessionIssuedAtMs > 0 ? sessionIssuedAtMs : fallbackIssuedAt;

  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  const isWarning = warningSeconds !== null;

  // Mulai dari 0 agar evaluasi pertama menghargai timestamp valid di localStorage untuk sesi yang sama
  const lastActiveRef = useRef<number>(0);
  const lastStorageWriteRef = useRef<number>(0);
  const isLoggingOutRef = useRef<boolean>(false);

  useEffect(() => {
    isLoggingOutRef.current = false;

    const writeSharedActivity = (timestamp: number, force = false) => {
      if (isLoggingOutRef.current || timestamp <= 0) return;
      if (!force && timestamp - lastStorageWriteRef.current < 3000) return;
      lastStorageWriteRef.current = timestamp;
      try {
        window.localStorage.setItem(
          policy.storageKey,
          serializeIdleActivity(timestamp, effectiveSessionIssuedAt),
        );
      } catch {
        // Abaikan error storage
      }
    };

    const performIdleLogout = async (broadcastToOtherTabs = true) => {
      if (isLoggingOutRef.current) return;
      isLoggingOutRef.current = true;
      setWarningSeconds(null);

      clearIdleStorage(policy.scope);
      if (broadcastToOtherTabs) {
        try {
          window.localStorage.setItem(
            policy.logoutSyncKey,
            serializeLogoutSyncPayload(Date.now(), effectiveSessionIssuedAt),
          );
        } catch {
          // Abaikan error storage
        }
      }

      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: policy.logoutRole }),
        });
      } catch {
        // Tetap redirect meski jaringan lambat/putus
      } finally {
        window.location.href = policy.redirectUrl;
      }
    };

    const evaluateNow = () => {
      if (isLoggingOutRef.current) return;

      let rawStored: string | null = null;
      try {
        rawStored = window.localStorage.getItem(policy.storageKey);
      } catch {
        rawStored = null;
      }

      const now = Date.now();
      const effectiveLastActive = resolveEffectiveLastActive({
        inMemoryActiveAt: lastActiveRef.current,
        rawStored,
        sessionIssuedAtMs: effectiveSessionIssuedAt,
        now,
      });

      const wasUninitialized = lastActiveRef.current <= 0;
      lastActiveRef.current = effectiveLastActive;
      if (wasUninitialized && effectiveLastActive === now) {
        writeSharedActivity(effectiveLastActive, true);
      }

      const status = evaluateIdleStatus(effectiveLastActive, now, policy);
      if (status.status === 'expired') {
        void performIdleLogout(true);
        return;
      }

      if (status.status === 'warning') {
        setWarningSeconds(status.remainingSeconds);
      } else {
        setWarningSeconds((prev) => (prev !== null ? null : prev));
      }
    };

    const initialTimerId = window.setTimeout(evaluateNow, 0);
    const intervalId = window.setInterval(evaluateNow, isWarning ? 1000 : 5000);

    const recordActivity = () => {
      if (isLoggingOutRef.current) return;
      const now = Date.now();
      lastActiveRef.current = now;
      setWarningSeconds((prev) => (prev !== null ? null : prev));
      writeSharedActivity(now, false);
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        evaluateNow();
      } else {
        writeSharedActivity(lastActiveRef.current, true);
      }
    };

    const onPageHideOrUnload = () => {
      // Jangan pernah menulis ulang aktivitas setelah logout dimulai (mencegah bug login 2x)
      if (isLoggingOutRef.current) return;
      writeSharedActivity(lastActiveRef.current, true);
    };

    const onStorageSync = (e: StorageEvent) => {
      if (
        e.key === policy.logoutSyncKey &&
        shouldHonorLogoutSync(e.newValue, effectiveSessionIssuedAt)
      ) {
        void performIdleLogout(false);
        return;
      }
      if (e.key === policy.storageKey) {
        evaluateNow();
      }
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const evt of activityEvents) {
      window.addEventListener(evt, recordActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('pagehide', onPageHideOrUnload);
    window.addEventListener('beforeunload', onPageHideOrUnload);
    window.addEventListener('storage', onStorageSync);

    return () => {
      window.clearTimeout(initialTimerId);
      window.clearInterval(intervalId);
      for (const evt of activityEvents) {
        window.removeEventListener(evt, recordActivity);
      }
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('pagehide', onPageHideOrUnload);
      window.removeEventListener('beforeunload', onPageHideOrUnload);
      window.removeEventListener('storage', onStorageSync);
    };
  }, [policy, effectiveSessionIssuedAt, isWarning]);

  const handleContinueSession = () => {
    const now = Date.now();
    lastActiveRef.current = now;
    lastStorageWriteRef.current = now;
    setWarningSeconds(null);
    try {
      window.localStorage.setItem(
        policy.storageKey,
        serializeIdleActivity(now, effectiveSessionIssuedAt),
      );
    } catch {
      // Abaikan error storage
    }
  };

  if (warningSeconds === null) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Peringatan sesi hampir berakhir"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        maxWidth: 380,
        background: '#1e293b',
        color: '#f8fafc',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.28)',
        border: '1px solid rgba(251, 191, 36, 0.45)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: '0.85rem',
        lineHeight: 1.45,
      }}
    >
      <Clock size={20} style={{ color: '#fbbf24', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Sesi Hampir Berakhir</div>
        <div style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>
          Tidak ada aktivitas. Keluar otomatis dalam{' '}
          <strong style={{ color: '#fde68a' }}>{warningSeconds} detik</strong>.
        </div>
      </div>
      <button
        type="button"
        onClick={handleContinueSession}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderRadius: 8,
          border: 'none',
          background: '#f59e0b',
          color: '#0f172a',
          fontWeight: 700,
          fontSize: '0.78rem',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <RefreshCw size={14} />
        <span>Lanjut</span>
      </button>
    </div>
  );
}
