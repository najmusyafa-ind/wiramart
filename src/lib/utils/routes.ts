// =============================================================
// Smartkasir Perwira — Route Constants & Role Path SSOT
// Memisahkan namespace halaman per peran secara eksplisit:
//   - MANAGER     → /manager/*
//   - ADMIN_SHIFT → /admin/*
//   - GUDANG      → /gudang/*
//   - KASIR / CS  → /kasir/*
// =============================================================

export type PortalAdminRole = 'MANAGER' | 'ADMIN_SHIFT';

export const ADMIN_LOGIN_PATH = '/login';
export const KASIR_LOGIN_PATH = '/kasir/login';

export const GUDANG_BASE_PATH = '/gudang';
export const GUDANG_LOGIN_PATH = '/gudang/login';

export const MANAGER_BASE_PATH = '/manager';
export const MANAGER_DASHBOARD_PATH = '/manager/dashboard';

export const ADMIN_BASE_PATH = '/admin';
export const ADMIN_DASHBOARD_PATH = '/admin/dashboard';

/** Daftar path sub-halaman khusus Manager (tidak boleh diakses ADMIN_SHIFT). */
export const MANAGER_ONLY_SEGMENTS = [
  'restock',
  'laporan',
  'qris',
  'pengaturan',
  'export',
] as const;

export function normalizePortalRole(role?: string | null): PortalAdminRole {
  return role === 'MANAGER' ? 'MANAGER' : 'ADMIN_SHIFT';
}

export function getPortalBasePath(role?: string | null): typeof MANAGER_BASE_PATH | typeof ADMIN_BASE_PATH {
  return normalizePortalRole(role) === 'MANAGER' ? MANAGER_BASE_PATH : ADMIN_BASE_PATH;
}

export function getDashboardPathForRole(
  role?: string | null,
): typeof MANAGER_DASHBOARD_PATH | typeof ADMIN_DASHBOARD_PATH {
  return normalizePortalRole(role) === 'MANAGER'
    ? MANAGER_DASHBOARD_PATH
    : ADMIN_DASHBOARD_PATH;
}

export function getPortalPath(role: string | null | undefined, segment: string): string {
  const cleanSegment = segment.replace(/^\/+/, '');
  return `${getPortalBasePath(role)}/${cleanSegment}`;
}

