'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useSyncExternalStore, createContext, useContext } from 'react';
import MobileBottomNav from './MobileBottomNav';
import IdleTimeoutGuard from '@/components/IdleTimeoutGuard';
import { clearIdleStorage, getAdminIdleTimeoutPolicy } from '@/lib/utils/idle-timeout';
import { getPortalBasePath, GUDANG_BASE_PATH, MANAGER_BASE_PATH } from '@/lib/utils/routes';

export interface AdminContextValue {
  adminName: string;
  adminRole: 'MANAGER' | 'ADMIN_SHIFT';
  isManager: boolean;
}

export const AdminContext = createContext<AdminContextValue>({
  adminName: 'Admin',
  adminRole: 'ADMIN_SHIFT',
  isManager: false,
});

export function useAdmin() {
  return useContext(AdminContext);
}
import {
  LayoutDashboard,
  Package,
  Users,
  BarChart3,
  Settings,
  LogOut,
  LayoutGrid,
  X,
  Wrench,
  ChevronRight,
  Download,
  ScanLine,
  CalendarDays,
  ClipboardList,
  ArrowLeftRight,
  Boxes,
  ShieldCheck,
  UserCheck,
  Sparkles,
  ShoppingBag,
  Receipt,
} from 'lucide-react';

async function requestModStatusData(signal?: AbortSignal) {
  const res = await fetch('/api/admin/duty', { signal });
  const json = await res.json();
  return res.ok && json.success && json.data?.today ? json.data.today : null;
}

const emptySubscribe = () => () => {};
function useIsMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  section?: string;
  managerOnly?: boolean;
};

function buildPortalNavItems(adminRole: 'MANAGER' | 'ADMIN_SHIFT'): NavItem[] {
  const basePath = getPortalBasePath(adminRole);
  return [
    // ── 1. Ringkasan & Order ──────────────────────────────────
    {
      label: 'Dashboard',
      href: `${basePath}/dashboard`,
      icon: <LayoutDashboard size={18} aria-hidden="true" />,
      section: 'Ringkasan & Order',
    },
    {
      label: 'Pesanan Online',
      href: `${basePath}/pesanan-online`,
      icon: <ShoppingBag size={18} aria-hidden="true" />,
      section: 'Ringkasan & Order',
    },

    // ── 2. Produk & Gudang ────────────────────────────────────
    {
      label: 'Produk',
      href: `${basePath}/produk`,
      icon: <Package size={18} aria-hidden="true" />,
      section: 'Produk & Gudang',
    },
    {
      label: 'Portal Gudang',
      href: GUDANG_BASE_PATH,
      icon: <Boxes size={18} aria-hidden="true" />,
      section: 'Produk & Gudang',
    },
    {
      label: 'Persetujuan Barang Masuk',
      href: `${basePath}/gudang-approval`,
      icon: <ShieldCheck size={18} aria-hidden="true" />,
      section: 'Produk & Gudang',
    },
    {
      label: 'Nota Belanja',
      href: `${basePath}/nota-belanja`,
      icon: <Receipt size={18} aria-hidden="true" />,
      section: 'Produk & Gudang',
    },
    {
      label: 'Restock Barcode',
      href: `${MANAGER_BASE_PATH}/restock`,
      icon: <ScanLine size={18} aria-hidden="true" />,
      section: 'Produk & Gudang',
      managerOnly: true,
    },

    // ── 3. Tim & Kehadiran ────────────────────────────────────
    {
      label: 'Karyawan',
      href: `${basePath}/karyawan`,
      icon: <Users size={18} aria-hidden="true" />,
      section: 'Tim & Kehadiran',
    },
    {
      label: 'Jadwal Shift',
      href: `${basePath}/jadwal`,
      icon: <CalendarDays size={18} aria-hidden="true" />,
      section: 'Tim & Kehadiran',
    },
    {
      label: 'Absensi',
      href: `${basePath}/absensi`,
      icon: <ClipboardList size={18} aria-hidden="true" />,
      section: 'Tim & Kehadiran',
    },
    {
      label: 'Riwayat Tukar Shift',
      href: `${basePath}/swap-request`,
      icon: <ArrowLeftRight size={18} aria-hidden="true" />,
      section: 'Tim & Kehadiran',
    },

    // ── 4. Keuangan & Sistem ──────────────────────────────────
    {
      label: 'Laporan',
      href: `${MANAGER_BASE_PATH}/laporan`,
      icon: <BarChart3 size={18} aria-hidden="true" />,
      section: 'Keuangan & Sistem',
      managerOnly: true,
    },
    {
      label: 'Export Data',
      href: `${MANAGER_BASE_PATH}/export`,
      icon: <Download size={18} aria-hidden="true" />,
      section: 'Keuangan & Sistem',
      managerOnly: true,
    },
    {
      label: 'Pengaturan',
      href: `${MANAGER_BASE_PATH}/pengaturan`,
      icon: <Settings size={18} aria-hidden="true" />,
      section: 'Keuangan & Sistem',
      managerOnly: true,
    },
  ];
}

type AdminSidebarProps = {
  adminName: string;
  adminRole?: 'MANAGER' | 'ADMIN_SHIFT';
  isMobileOpen: boolean;
  onClose: () => void;
};

function AdminSidebar({ adminName, adminRole = 'ADMIN_SHIFT', isMobileOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // ── Mounted guard via useSyncExternalStore: hindari SSR/CSR mismatch tanpa cascading render ──
  const mounted = useIsMounted();

  async function handleLogout() {
    setIsLoggingOut(true);
    clearIdleStorage('admin');
    try {
      // role: 'admin' agar hanya cookie sk_admin yang dihapus
      // — tidak mengganggu sesi kasir yang aktif di tab lain
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      });
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    }
  }

  const basePath = getPortalBasePath(adminRole);

  // Group nav items by section.
  // useMemo → hanya dihitung ulang jika adminRole berubah (stabil saat hydration)
  const sections = useMemo(() =>
    buildPortalNavItems(adminRole)
      .filter((item) => !item.managerOnly || adminRole === 'MANAGER')
      .reduce<Record<string, NavItem[]>>((acc, item) => {
        const section = item.section ?? 'Lainnya';
        if (!acc[section]) acc[section] = [];
        acc[section].push(item);
        return acc;
      }, {})
  , [adminRole]);

  return (
    <nav
      id="admin-sidebar"
      className={`layout-sidebar${isMobileOpen ? ' mobile-open' : ''}`}
      aria-label="Navigasi Admin"
      suppressHydrationWarning
    >
      {/* Logo */}
      <div className="sidebar-logo">
        <div style={{ width: 36, height: 36, position: 'relative', flexShrink: 0 }}>
          <Image
            src="/logo.png"
            alt="Logo Wiramart UNPERBA"
            fill
            sizes="36px"
            style={{ objectFit: 'contain' }}
            priority
          />
        </div>
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">Wiramart</span>
          <span className="sidebar-logo-subtitle">UKM Kewirausahaan UNPERBA</span>
        </div>
        {/* Close button — conditional render to avoid SSR mismatch */}
        {isMobileOpen && (
          <button
            onClick={onClose}
            aria-label="Tutup menu"
            suppressHydrationWarning
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'var(--color-sidebar-muted)',
              cursor: 'pointer',
              display: 'flex',
              padding: 'var(--space-1)',
              minHeight: 0,
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="sidebar-nav" role="list">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="sidebar-section-group" role="group" aria-label={section}>
            <div className="sidebar-section-label">{section}</div>
            {items.map((item) => {
              // isActive hanya dihitung setelah mounted agar SSR dan CSR konsisten
              // SSR: semua item non-active (className stabil) → tidak ada mismatch
              const isActive = mounted &&
                (item.href === `${basePath}/dashboard`
                  ? pathname === item.href
                  : pathname.startsWith(item.href));
              // Item yang mengarah ke API route → gunakan <a> native untuk trigger download
              if (item.href.startsWith('/api/')) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className="sidebar-nav-item"
                    role="listitem"
                    aria-label={`${item.label} — download file`}
                    onClick={onClose}
                    style={{ textDecoration: 'none' }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    <Download size={12} aria-hidden="true" style={{ marginLeft: 'auto', opacity: 0.5 }} />
                  </a>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  role="listitem"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={onClose}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {isActive && (
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      style={{ marginLeft: 'auto', opacity: 0.6 }}
                    />
                  )}
                </Link>
              );

            })}
          </div>
        ))}
      </div>

      {/* Footer — Admin info + logout */}
      <div className="sidebar-footer">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-sidebar-hover)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: 'var(--color-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-bold)',
              color: 'white',
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {adminName.charAt(0).toUpperCase()}
          </div>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-inverse)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {adminName}
            </div>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: adminRole === 'MANAGER' ? '#f59e0b' : 'var(--color-sidebar-muted)',
                fontWeight: adminRole === 'MANAGER' ? 700 : 500,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {adminRole === 'MANAGER' ? 'Manager (Dosen)' : 'Admin Shift'}
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="sidebar-nav-item"
          style={{
            width: '100%',
            border: 'none',
            background: 'none',
            color: 'var(--color-error)',
            justifyContent: 'flex-start',
          }}
          aria-label="Keluar dari sistem"
        >
          <LogOut size={18} aria-hidden="true" />
          <span>{isLoggingOut ? 'Keluar...' : 'Logout'}</span>
        </button>
      </div>
    </nav>
  );
}

type AdminLayoutClientProps = {
  children: React.ReactNode;
  adminName: string;
  adminRole?: 'MANAGER' | 'ADMIN_SHIFT';
  sessionIssuedAtMs?: number;
  pageTitle?: string;
};

export default function AdminLayoutClient({
  children,
  adminName,
  adminRole = 'ADMIN_SHIFT',
  sessionIssuedAtMs,
  pageTitle,
}: AdminLayoutClientProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const mounted = useIsMounted();

  // ── State Manager on Duty (MOD — Wiramart v3.0) ─────────────
  const [modStatus, setModStatus] = useState<{
    isCheckedIn: boolean;
    isCheckedOut: boolean;
    managerId: string | null;
    managerName: string | null;
    checkedInAt: string | null;
    notes: string | null;
  } | null>(null);
  const [isModModalOpen, setIsModModalOpen] = useState(false);
  const [modNotesInput, setModNotesInput] = useState('');
  const [isSubmittingMod, setIsSubmittingMod] = useState(false);

  async function loadModStatusData(signal?: AbortSignal) {
    return requestModStatusData(signal);
  }

  useEffect(() => {
    if (adminRole !== 'MANAGER') return;
    const controller = new AbortController();
    requestModStatusData(controller.signal)
      .then((today) => {
        if (!controller.signal.aborted && today) setModStatus(today);
      })
      .catch(() => {
        // silent
      });
    return () => {
      controller.abort();
    };
  }, [adminRole]);

  async function handleToggleMod(action: 'CHECK_IN' | 'CHECK_OUT') {
    setIsSubmittingMod(true);
    try {
      const res = await fetch('/api/admin/duty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          notes: modNotesInput.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setIsModModalOpen(false);
        setModNotesInput('');
        const today = await loadModStatusData().catch(() => null);
        if (today) setModStatus(today);
      } else {
        alert(json.error ?? 'Gagal memproses sesi Manager on Duty.');
      }
    } catch {
      alert('Terjadi kesalahan jaringan.');
    } finally {
      setIsSubmittingMod(false);
    }
  }

  const idlePolicy = useMemo(() => getAdminIdleTimeoutPolicy(adminRole), [adminRole]);
  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobileOpen]);

  // Close sidebar on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMobileOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const adminContextValue = useMemo<AdminContextValue>(
    () => ({
      adminName,
      adminRole,
      isManager: adminRole === 'MANAGER',
    }),
    [adminName, adminRole]
  );

  return (
    <AdminContext.Provider value={adminContextValue}>
      <IdleTimeoutGuard policy={idlePolicy} sessionIssuedAtMs={sessionIssuedAtMs} />
      <div className="layout-admin">


      {/* Backdrop overlay — mobile only, saat sidebar terbuka */}
      {isMobileOpen && (
        <div
          className="admin-backdrop"
          aria-hidden="true"
          onClick={() => setIsMobileOpen(false)}
          onTouchStart={() => setIsMobileOpen(false)}
        />
      )}

      {/* Single sidebar — .mobile-open class makes it visible on mobile */}
      <AdminSidebar
        adminName={adminName}
        adminRole={adminRole}
        isMobileOpen={isMobileOpen}
        onClose={() => setIsMobileOpen(false)}
      />

      {/* Main Content */}
      <div className="layout-main">
        <header className="layout-header">
          <div className="layout-header-left" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            {/* Mobile drawer pill trigger — hanya tampil di mobile (< 1024px) via class .btn-hamburger */}
            <button
              id="btn-mobile-menu"
              type="button"
              className="btn-hamburger"
              onClick={() => setIsMobileOpen((v) => !v)}
              aria-label="Buka kategori menu"
              aria-expanded={isMobileOpen}
              aria-controls="admin-sidebar"
              suppressHydrationWarning
            >
              <LayoutGrid size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span className="btn-hamburger__label">Menu</span>
            </button>
            {pageTitle && (
              <h1
                className="layout-header-title"
                style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-text)',
                  letterSpacing: 'var(--tracking-tight)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {pageTitle}
              </h1>
            )}
          </div>

          <div
            className="layout-header-right"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}
          >
            {/* ── MANAGER ON DUTY (MOD) BADGE & QUICK TRIGGER ── */}
            {adminRole === 'MANAGER' && (modStatus?.isCheckedIn ? (
              <button
                id="btn-mod-header"
                type="button"
                className="header-mod-pill header-mod-pill--active"
                onClick={() => setIsModModalOpen(true)}
                title="Klik untuk detail Manager on Duty hari ini"
              >
                <span className="header-mod-dot" />
                <span className="header-mod-text">Aktif: {modStatus.managerName}</span>
              </button>
            ) : (
              <button
                id="btn-mod-header"
                type="button"
                className="header-mod-pill header-mod-pill--idle"
                onClick={() => setIsModModalOpen(true)}
              >
                <Sparkles size={13} color="#d97706" aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>Mulai Sesi</span>
              </button>
            ))}

            {adminRole === 'MANAGER' && (
              <Link
                href="/manager/pengaturan"
                className="header-icon-pill"
                title="Pengaturan Sistem (Manager Khusus)"
                aria-label="Pengaturan Sistem"
              >
                <Wrench size={16} aria-hidden="true" />
              </Link>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span
                className="header-role-pill"
                style={{
                  fontWeight: 700,
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                  backgroundColor: adminRole === 'MANAGER' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(37, 99, 235, 0.12)',
                  color: adminRole === 'MANAGER' ? '#b45309' : '#1d4ed8',
                  border: adminRole === 'MANAGER' ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(37, 99, 235, 0.25)',
                }}
              >
                {adminRole === 'MANAGER' ? 'MANAGER' : 'ADMIN SHIFT'}
              </span>
              <div
                className="hide-xs-text"
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 'var(--weight-medium)',
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {adminName}
              </div>
            </div>
          </div>
        </header>

        {/* ── MODAL SESI MANAGER ON DUTY (MOD) ── */}
        {adminRole === 'MANAGER' && isModModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              backdropFilter: 'blur(4px)',
              zIndex: 2000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={() => !isSubmittingMod && setIsModModalOpen(false)}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                maxWidth: 440,
                width: '100%',
                maxHeight: '90dvh',
                overflowY: 'auto',
                padding: '22px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                boxShadow: '0 25px 30px -5px rgba(0,0,0,0.25)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: '#fef3c7',
                      color: '#d97706',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <UserCheck size={22} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                      Sesi Kerja Hari Ini
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                      Penanggung jawab operasional harian Wiramart.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModModalOpen(false)}
                  aria-label="Tutup dialog"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    minWidth: 44,
                    minHeight: 44,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    flexShrink: 0,
                  }}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              {modStatus?.isCheckedIn ? (
                <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: 10, fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <span style={{ color: '#64748b' }}>Manager Bertugas: </span>
                    <strong style={{ color: '#0f172a' }}>{modStatus.managerName}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Jam Mulai Tugas: </span>
                    <strong style={{ color: '#0f172a' }}>
                      {modStatus.checkedInAt ? new Date(modStatus.checkedInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'} WIB
                    </strong>
                  </div>
                  {modStatus.notes && (
                    <div>
                      <span style={{ color: '#64748b' }}>Catatan Tugas: </span>
                      <span style={{ color: '#334155' }}>&quot;{modStatus.notes}&quot;</span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', padding: '12px 14px', borderRadius: 10, fontSize: '0.8rem', color: '#92400e' }}>
                  Belum ada Manager yang memulai sesi kerja hari ini. Klik tombol di bawah untuk memulai sesi agar bisa menyetujui barang masuk dan diskon FEFO.
                </div>
              )}

              {adminRole === 'MANAGER' && !modStatus?.isCheckedIn && (
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                    Catatan Sesi Hari Ini (Opsional)
                  </label>
                  <input
                    type="text"
                    value={modNotesInput}
                    onChange={(e) => setModNotesInput(e.target.value)}
                    placeholder="Contoh: Piket pagi s/d sore, fokus audit stok snack."
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '1rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setIsModModalOpen(false)}
                  style={{
                    minHeight: 44,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Tutup
                </button>

                {adminRole === 'MANAGER' && (
                  modStatus?.isCheckedIn ? (
                    <button
                      type="button"
                      disabled={isSubmittingMod}
                      onClick={() => handleToggleMod('CHECK_OUT')}
                      style={{
                        minHeight: 44,
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#dc2626',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {isSubmittingMod ? 'Memproses...' : 'Akhiri Sesi Kerja Hari Ini'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSubmittingMod}
                      onClick={() => handleToggleMod('CHECK_IN')}
                      style={{
                        minHeight: 44,
                        padding: '8px 18px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#d97706',
                        color: '#ffffff',
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {isSubmittingMod ? 'Memproses...' : 'Mulai Sesi Kerja Sekarang'}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        <main className="layout-content" id="main-content">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — hanya tampil di layar < 1024px dan disembunyikan saat drawer terbuka.
          Dibungkus mounted guard agar tidak ada hydration mismatch. */}
      {mounted && !isMobileOpen && <MobileBottomNav adminRole={adminRole} />}
    </div>
    </AdminContext.Provider>
  );
}
