/**
 * Konfigurasi & helper deterministik Idle Timeout per Role.
 *
 * Kebijakan resmi:
 * - MANAGER: 10 menit (warning pada menit ke-9, sisa 60 detik), termasuk saat buka tab lain.
 * - ADMIN_SHIFT: 15 menit (warning pada menit ke-14, sisa 60 detik).
 * - GUDANG (EMPLOYEE di /kasir/gudang): 15 menit (warning pada menit ke-14, sisa 60 detik).
 * - KASIR (POS /kasir/* selain Gudang): TANPA TIMEOUT sama sekali.
 *
 * Setiap timestamp aktivitas diikat ke `sessionIssuedAt` (JWT `iat` dalam ms)
 * agar sisa aktivitas dari sesi lama tidak pernah menyebabkan auto-logout pada login pertama.
 */

export type IdleTimeoutRole = 'MANAGER' | 'ADMIN_SHIFT' | 'GUDANG';
export type IdleStorageScope = 'admin' | 'gudang';

export type IdleTimeoutPolicy = {
  role: IdleTimeoutRole;
  scope: IdleStorageScope;
  logoutMs: number;
  warnMs: number;
  timeoutLabel: string;
  logoutRole: 'admin' | 'employee';
  storageKey: string;
  logoutSyncKey: string;
  redirectUrl: string;
};

export type StoredIdleActivity = {
  activeAt: number;
  sessionIssuedAt: number;
};

export type LogoutSyncPayload = {
  triggeredAt: number;
  sessionIssuedAt: number;
};

const STORAGE_KEYS: Record<IdleStorageScope, { active: string; sync: string }> = {
  admin: {
    active: 'sk_admin_last_active',
    sync: 'sk_admin_logout_sync',
  },
  gudang: {
    active: 'sk_gudang_last_active',
    sync: 'sk_gudang_logout_sync',
  },
};

export const ROLE_IDLE_TIMEOUTS: Record<IdleTimeoutRole, IdleTimeoutPolicy> = {
  MANAGER: {
    role: 'MANAGER',
    scope: 'admin',
    logoutMs: 10 * 60 * 1000,
    warnMs: 9 * 60 * 1000,
    timeoutLabel: '10 menit',
    logoutRole: 'admin',
    storageKey: STORAGE_KEYS.admin.active,
    logoutSyncKey: STORAGE_KEYS.admin.sync,
    redirectUrl: '/login?reason=idle&timeout=10%20menit&role=MANAGER',
  },
  ADMIN_SHIFT: {
    role: 'ADMIN_SHIFT',
    scope: 'admin',
    logoutMs: 15 * 60 * 1000,
    warnMs: 14 * 60 * 1000,
    timeoutLabel: '15 menit',
    logoutRole: 'admin',
    storageKey: STORAGE_KEYS.admin.active,
    logoutSyncKey: STORAGE_KEYS.admin.sync,
    redirectUrl: '/login?reason=idle&timeout=15%20menit&role=ADMIN_SHIFT',
  },
  GUDANG: {
    role: 'GUDANG',
    scope: 'gudang',
    logoutMs: 15 * 60 * 1000,
    warnMs: 14 * 60 * 1000,
    timeoutLabel: '15 menit',
    logoutRole: 'employee',
    storageKey: STORAGE_KEYS.gudang.active,
    logoutSyncKey: STORAGE_KEYS.gudang.sync,
    redirectUrl: '/gudang/login?reason=idle&timeout=15%20menit',
  },
};

export function getAdminIdleTimeoutPolicy(
  adminRole: 'MANAGER' | 'ADMIN_SHIFT',
): IdleTimeoutPolicy {
  return adminRole === 'MANAGER'
    ? ROLE_IDLE_TIMEOUTS.MANAGER
    : ROLE_IDLE_TIMEOUTS.ADMIN_SHIFT;
}

export function getWarehouseIdleTimeoutPolicy(
  actorRole: 'EMPLOYEE' | 'MANAGER' | 'ADMIN_SHIFT',
): IdleTimeoutPolicy {
  if (actorRole === 'MANAGER') return ROLE_IDLE_TIMEOUTS.MANAGER;
  if (actorRole === 'ADMIN_SHIFT') return ROLE_IDLE_TIMEOUTS.ADMIN_SHIFT;
  return ROLE_IDLE_TIMEOUTS.GUDANG;
}

/**
 * Parse catatan aktivitas dari localStorage.
 * Mengembalikan null bila record rusak, format lama, atau berasal dari sesi JWT berbeda.
 */
export function parseStoredIdleActivity(
  raw: string | null,
  expectedSessionIssuedAtMs: number,
): StoredIdleActivity | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const activeAt = Number(record.activeAt);
      const sessionIssuedAt = Number(record.sessionIssuedAt);

      if (!Number.isFinite(activeAt) || activeAt <= 0) return null;

      if (expectedSessionIssuedAtMs > 0) {
        if (!Number.isFinite(sessionIssuedAt) || sessionIssuedAt <= 0) {
          return null;
        }
        if (sessionIssuedAt !== expectedSessionIssuedAtMs) {
          return null;
        }
      }

      return {
        activeAt,
        sessionIssuedAt: Number.isFinite(sessionIssuedAt) ? sessionIssuedAt : 0,
      };
    }

    // Record numerik versi lama tidak memiliki sessionIssuedAt — tolak jika sesi baru teridentifikasi
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0) {
      if (expectedSessionIssuedAtMs > 0) return null;
      return { activeAt: parsed, sessionIssuedAt: 0 };
    }
  } catch {
    return null;
  }

  return null;
}

export function serializeIdleActivity(
  activeAt: number,
  sessionIssuedAt: number,
): string {
  return JSON.stringify({ activeAt, sessionIssuedAt } satisfies StoredIdleActivity);
}

export function resolveEffectiveLastActive(params: {
  inMemoryActiveAt: number;
  rawStored: string | null;
  sessionIssuedAtMs: number;
  now: number;
}): number {
  const { inMemoryActiveAt, rawStored, sessionIssuedAtMs, now } = params;
  const stored = parseStoredIdleActivity(rawStored, sessionIssuedAtMs);
  const candidate = Math.max(inMemoryActiveAt, stored?.activeAt ?? 0);
  if (candidate <= 0 || candidate > now) {
    return now;
  }
  return candidate;
}

export function evaluateIdleStatus(
  lastActiveAt: number,
  now: number,
  policy: Pick<IdleTimeoutPolicy, 'logoutMs' | 'warnMs'>,
): { status: 'active' | 'warning' | 'expired'; remainingSeconds: number; elapsedMs: number } {
  const elapsedMs = Math.max(0, now - lastActiveAt);
  if (elapsedMs >= policy.logoutMs) {
    return { status: 'expired', remainingSeconds: 0, elapsedMs };
  }
  if (elapsedMs >= policy.warnMs) {
    const remainingSeconds = Math.max(1, Math.ceil((policy.logoutMs - elapsedMs) / 1000));
    return { status: 'warning', remainingSeconds, elapsedMs };
  }
  const remainingSeconds = Math.ceil((policy.logoutMs - elapsedMs) / 1000);
  return { status: 'active', remainingSeconds, elapsedMs };
}

export function serializeLogoutSyncPayload(
  triggeredAt: number,
  sessionIssuedAt: number,
): string {
  return JSON.stringify({ triggeredAt, sessionIssuedAt } satisfies LogoutSyncPayload);
}

export function shouldHonorLogoutSync(
  rawValue: string | null,
  expectedSessionIssuedAtMs: number,
): boolean {
  if (!rawValue) return false;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const record = parsed as Record<string, unknown>;
    const triggeredAt = Number(record.triggeredAt);
    const sessionIssuedAt = Number(record.sessionIssuedAt);
    if (!Number.isFinite(triggeredAt) || triggeredAt <= 0) return false;
    if (expectedSessionIssuedAtMs > 0) {
      return Number.isFinite(sessionIssuedAt) && sessionIssuedAt === expectedSessionIssuedAtMs;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Bersihkan state idle timeout di localStorage saat login baru / logout manual.
 */
export function clearIdleStorage(scope: IdleStorageScope): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = STORAGE_KEYS[scope];
    window.localStorage.removeItem(keys.active);
    window.localStorage.removeItem(keys.sync);
  } catch {
    // Abaikan error storage (misal private browsing restricted)
  }
}

