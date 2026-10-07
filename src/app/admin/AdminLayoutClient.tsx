'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import MobileBottomNav from './MobileBottomNav';
import {
  LayoutDashboard,
  Package,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  Wrench,
  ChevronRight,
  Download,
  ScanLine,
  CalendarDays,
  ClipboardList,
  ArrowLeftRight,
  QrCode,
} from 'lucide-react';

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  section?: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/admin/dashboard',
    icon: <LayoutDashboard size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Produk',
    href: '/admin/produk',
    icon: <Package size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Restock Barcode',
    href: '/admin/restock',
    icon: <ScanLine size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Karyawan',
    href: '/admin/karyawan',
    icon: <Users size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Jadwal Shift',
    href: '/admin/jadwal',
    icon: <CalendarDays size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Absensi',
    href: '/admin/absensi',
    icon: <ClipboardList size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Riwayat Tukar Shift',
    href: '/admin/swap-request',
    icon: <ArrowLeftRight size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Laporan',
    href: '/admin/laporan',
    icon: <BarChart3 size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Rekonsiliasi QRIS',
    href: '/admin/qris',
    icon: <QrCode size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Pengaturan',
    href: '/admin/pengaturan',
    icon: <Settings size={18} aria-hidden="true" />,
    section: 'Sistem',
  },
  {
    label: 'Export Data',
    href: '/admin/export',
    icon: <Download size={18} aria-hidden="true" />,
    section: 'Sistem',
  },
];

type AdminSidebarProps = {
  adminName: string;
  isMobileOpen: boolean;
  onClose: () => void;
};

function AdminSidebar({ adminName, isMobileOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
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

  // Group nav items by section
  const sections = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    const section = item.section ?? 'Lainnya';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {});

  return (
    <nav
      id="admin-sidebar"
      className={`layout-sidebar${isMobileOpen ? ' mobile-open' : ''}`}
      aria-label="Navigasi Admin"
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
          <div key={section} role="group" aria-label={section}>
            <div className="sidebar-section-label">{section}</div>
            {items.map((item) => {
              const isActive =
                item.href === '/admin/dashboard'
                  ? pathname === '/admin/dashboard'
                  : pathname.startsWith(item.href);
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
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-sidebar-muted)' }}>
              Administrator
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
  pageTitle?: string;
};

export default function AdminLayoutClient({
  children,
  adminName,
  pageTitle,
}: AdminLayoutClientProps) {
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // ── Idle session timeout (30 menit) ──────────────────────
  // Tidak ada JSX baru — zero impact ke SSR tree
  useEffect(() => {
    const WARN_MS   = 29 * 60 * 1000;
    const LOGOUT_MS = 30 * 60 * 1000;
    const EVENTS    = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    let warnTimer: ReturnType<typeof setTimeout>;
    let logoutTimer: ReturnType<typeof setTimeout>;
    let banner: HTMLDivElement | null = null;

    function removeBanner() {
      if (banner && document.body.contains(banner)) document.body.removeChild(banner);
      banner = null;
    }

    async function doLogout() {
      removeBanner();
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      }).catch(() => {});
      window.location.href = '/login?reason=idle';
    }

    function showWarning() {
      removeBanner();
      banner = document.createElement('div');
      banner.id = 'idle-warn-banner';
      Object.assign(banner.style, {
        position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
        background: 'var(--color-surface, #fff)', borderRadius: '12px',
        padding: '16px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex', alignItems: 'center', gap: '12px',
        fontSize: '14px', fontFamily: 'inherit',
        border: '1px solid var(--color-border, #e5e7eb)',
        animation: 'slideIn .3s ease',
        maxWidth: '320px',
      });
      banner.innerHTML = `
        <span style="font-size:20px">&#9200;</span>
        <div style="flex:1">
          <div style="font-weight:600;color:var(--color-text,#111);margin-bottom:2px">Sesi hampir berakhir</div>
          <div style="color:var(--color-text-muted,#6b7280);font-size:12px">Anda tidak aktif. Logout otomatis dalam 1 menit.</div>
        </div>
        <button id="idle-stay-btn" style="background:var(--color-primary,#16a34a);color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600;flex-shrink:0">
          Tetap Login
        </button>
      `;
      document.body.appendChild(banner);
      banner.querySelector('#idle-stay-btn')?.addEventListener('click', reset);
    }

    function reset() {
      removeBanner();
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      warnTimer   = setTimeout(showWarning, WARN_MS);
      logoutTimer = setTimeout(doLogout, LOGOUT_MS);
    }

    EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset(); // mulai timer

    return () => {
      removeBanner();
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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

  return (
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
        isMobileOpen={isMobileOpen}
        onClose={() => setIsMobileOpen(false)}
      />

      {/* Main Content */}
      <div className="layout-main">
        <header className="layout-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {/* Hamburger button — inline style to prevent browser extension hydration mismatch */}
            <button
              id="btn-mobile-menu"
              onClick={() => setIsMobileOpen((v) => !v)}
              aria-label="Buka menu navigasi"
              aria-expanded={isMobileOpen}
              aria-controls="admin-sidebar"
              suppressHydrationWarning
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                minHeight: 0,
              }}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
            {pageTitle && (
              <h1
                style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-text)',
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {pageTitle}
              </h1>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <a
              href="/admin/pengaturan"
              title="Pengaturan Sistem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                color: 'var(--color-text-muted)',
                textDecoration: 'none',
              }}
            >
              <Wrench size={16} aria-hidden="true" />
            </a>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
                fontWeight: 'var(--weight-medium)',
              }}
            >
              {adminName}
            </div>
          </div>
        </header>

        <main className="layout-content" id="main-content">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — hanya tampil di layar < 1024px.
          Dibungkus mounted guard agar tidak ada hydration mismatch. */}
      {mounted && <MobileBottomNav />}
    </div>
  );
}
