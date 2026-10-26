'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, createContext, useContext } from 'react';
import MobileBottomNav from './MobileBottomNav';

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
  Boxes,
  ShieldCheck,
  UserCheck,
  Clock,
  Sparkles,
  ShoppingBag,
} from 'lucide-react';

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  section?: string;
  managerOnly?: boolean;
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
    label: 'Pesanan Online',
    href: '/admin/pesanan-online',
    icon: <ShoppingBag size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Portal Gudang (FEFO)',
    href: '/kasir/gudang',
    icon: <Boxes size={18} aria-hidden="true" />,
    section: 'Menu Utama',
  },
  {
    label: 'Persetujuan Barang Masuk',
    href: '/admin/gudang-approval',
    icon: <ShieldCheck size={18} aria-hidden="true" />,
    section: 'Menu Utama',
    managerOnly: true,
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
    managerOnly: true,
  },
  {
    label: 'Rekonsiliasi QRIS',
    href: '/admin/qris',
    icon: <QrCode size={18} aria-hidden="true" />,
    section: 'Menu Utama',
    managerOnly: true,
  },
  {
    label: 'Pengaturan',
    href: '/admin/pengaturan',
    icon: <Settings size={18} aria-hidden="true" />,
    section: 'Sistem',
    managerOnly: true,
  },
  {
    label: 'Export Data',
    href: '/admin/export',
    icon: <Download size={18} aria-hidden="true" />,
    section: 'Sistem',
    managerOnly: true,
  },
];

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
  // ── Mounted guard: hindari SSR/CSR mismatch pada elemen yang bergantung
  // pada pathname atau adminRole yang mungkin berbeda saat hydration ──
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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

  // Group nav items by section.
  // useMemo → hanya dihitung ulang jika adminRole berubah (stabil saat hydration)
  const sections = useMemo(() =>
    NAV_ITEMS
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
          <div key={section} role="group" aria-label={section}>
            <div className="sidebar-section-label">{section}</div>
            {items.map((item) => {
              // isActive hanya dihitung setelah mounted agar SSR dan CSR konsisten
              // SSR: semua item non-active (className stabil) → tidak ada mismatch
              const isActive = mounted &&
                (item.href === '/admin/dashboard'
                  ? pathname === '/admin/dashboard'
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
              {adminRole === 'MANAGER' ? '👑 Manager (Dosen)' : '🛡️ Admin Shift'}
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
  pageTitle?: string;
};

export default function AdminLayoutClient({
  children,
  adminName,
  adminRole = 'ADMIN_SHIFT',
  pageTitle,
}: AdminLayoutClientProps) {
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  async function fetchModStatus() {
    try {
      const res = await fetch('/api/admin/duty');
      const json = await res.json();
      if (res.ok && json.success && json.data?.today) {
        setModStatus(json.data.today);
      }
    } catch {
      // silent
    }
  }

  useEffect(() => {
    setMounted(true);
    fetchModStatus();
  }, []);

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
        fetchModStatus();
      } else {
        alert(json.error ?? 'Gagal memproses sesi Manager on Duty.');
      }
    } catch {
      alert('Terjadi kesalahan jaringan.');
    } finally {
      setIsSubmittingMod(false);
    }
  }

  // ── Role-based Idle & Tab Close / Off Timeout ──────────────────────────────
  // Manager: 5 menit (300 dtk) — Warning pada 4 menit (sisa 60 dtk)
  // Admin Shift: 2.5 menit (150 dtk) — Warning pada 2 menit (sisa 30 dtk)
  // Menggunakan localStorage wall-clock agar tetap terdeteksi meski tab ditutup/minimize.
  useEffect(() => {
    const isManager = adminRole === 'MANAGER';
    const LOGOUT_MS = isManager ? 5 * 60 * 1000 : 2.5 * 60 * 1000;
    const WARN_MS   = isManager ? 4 * 60 * 1000 : 2 * 60 * 1000;
    const TIMEOUT_LABEL = isManager ? '5 menit' : '2.5 menit';
    const STORAGE_KEY = 'sk_admin_last_active';
    const LOGOUT_SYNC_KEY = 'sk_admin_logout_sync';
    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

    let banner: HTMLDivElement | null = null;
    let isLoggingOut = false;

    function removeBanner() {
      if (banner && document.body.contains(banner)) {
        document.body.removeChild(banner);
      }
      banner = null;
    }

    async function doLogout() {
      if (isLoggingOut) return;
      isLoggingOut = true;
      removeBanner();
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(LOGOUT_SYNC_KEY, Date.now().toString());
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        });
      } catch {
        // Abaikan kegagalan jaringan saat logout
      }
      window.location.href = `/login?reason=idle&timeout=${encodeURIComponent(TIMEOUT_LABEL)}&role=${encodeURIComponent(adminRole)}`;
    }

    function showWarning(remainingSeconds: number) {
      if (isLoggingOut) return;
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'idle-warn-banner';
        Object.assign(banner.style, {
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: '99999',
          background: 'var(--color-surface, #fff)',
          borderRadius: '12px',
          padding: '16px 20px',
          boxShadow: '0 10px 36px rgba(0,0,0,0.22)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13.5px',
          fontFamily: 'inherit',
          border: '1.5px solid var(--color-warning, #f59e0b)',
          animation: 'slideIn .25s cubic-bezier(0.16, 1, 0.3, 1)',
          maxWidth: '340px',
        });
        document.body.appendChild(banner);
      }

      banner.innerHTML = `
        <span style="font-size:22px; flex-shrink:0;">⏳</span>
        <div style="flex:1;">
          <div style="font-weight:700; color:var(--color-text, #111); margin-bottom:2px;">Sesi Hampir Berakhir</div>
          <div style="color:var(--color-text-muted, #6b7280); font-size:12px; line-height:1.35;">
            Tidak aktif. Logout otomatis dalam <strong style="color:var(--color-error, #dc2626);">${remainingSeconds}s</strong>.
          </div>
        </div>
        <button id="idle-stay-btn" style="background:var(--color-primary, #16a34a); color:#fff; border:none; border-radius:8px; padding:7px 12px; cursor:pointer; font-size:12.5px; font-weight:700; flex-shrink:0;">
          Lanjut
        </button>
      `;

      banner.querySelector('#idle-stay-btn')?.addEventListener('click', () => {
        updateActivity();
        removeBanner();
      });
    }

    function updateActivity() {
      const now = Date.now();
      localStorage.setItem(STORAGE_KEY, now.toString());
      removeBanner();
    }

    // Periksa selisih waktu dari localStorage
    function checkTimeout() {
      const saved = localStorage.getItem(STORAGE_KEY);
      const lastActive = saved ? parseInt(saved, 10) : Date.now();
      const elapsed = Date.now() - lastActive;

      if (elapsed >= LOGOUT_MS) {
        doLogout();
      } else if (elapsed >= WARN_MS) {
        const remainingSec = Math.max(1, Math.ceil((LOGOUT_MS - elapsed) / 1000));
        showWarning(remainingSec);
      } else {
        removeBanner();
      }
    }

    // 1. Initial check saat mount (misal tab baru dibuka setelah ditutup lama)
    const initialSaved = localStorage.getItem(STORAGE_KEY);
    if (initialSaved) {
      const elapsed = Date.now() - parseInt(initialSaved, 10);
      if (elapsed >= LOGOUT_MS) {
        doLogout();
        return;
      }
    }
    updateActivity();

    // 2. Throttled activity listener (setiap 2 detik agar hemat operasi I/O)
    let lastThrottled = 0;
    function onUserInteraction() {
      const now = Date.now();
      if (now - lastThrottled > 2000) {
        lastThrottled = now;
        updateActivity();
      }
    }
    EVENTS.forEach((ev) => window.addEventListener(ev, onUserInteraction, { passive: true }));

    // 3. Heartbeat interval setiap 1 detik
    const timerInterval = setInterval(checkTimeout, 1000);

    // 4. Deteksi perpindahan tab / browser aktif kembali (Visibility API & Window Focus)
    function onTabFocus() {
      checkTimeout();
    }
    document.addEventListener('visibilitychange', onTabFocus);
    window.addEventListener('focus', onTabFocus);

    // 5. Simpan timestamp saat tab akan ditutup (beforeunload)
    function onUnload() {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    }
    window.addEventListener('beforeunload', onUnload);

    // 6. Sinkronisasi antar-tab admin via storage event
    function onStorageChange(e: StorageEvent) {
      if (e.key === LOGOUT_SYNC_KEY) {
        window.location.href = `/login?reason=idle&timeout=${encodeURIComponent(TIMEOUT_LABEL)}&role=${encodeURIComponent(adminRole)}`;
      }
    }
    window.addEventListener('storage', onStorageChange);

    return () => {
      removeBanner();
      clearInterval(timerInterval);
      EVENTS.forEach((ev) => window.removeEventListener(ev, onUserInteraction));
      document.removeEventListener('visibilitychange', onTabFocus);
      window.removeEventListener('focus', onTabFocus);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [adminRole]);
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
            {adminRole === 'MANAGER' && (
              <a
                href="/admin/pengaturan"
                title="Pengaturan Sistem (Manager Khusus)"
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
            )}
            {/* ── MANAGER ON DUTY (MOD) BADGE & QUICK TRIGGER ── */}
            {modStatus?.isCheckedIn ? (
              <button
                id="btn-mod-header"
                type="button"
                onClick={() => setIsModModalOpen(true)}
                title="Klik untuk detail Manager on Duty hari ini"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  color: '#15803d',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
                <span>Aktif: {modStatus.managerName}</span>
              </button>
            ) : adminRole === 'MANAGER' ? (
              <button
                id="btn-mod-header"
                type="button"
                onClick={() => setIsModModalOpen(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  color: '#b45309',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                <Sparkles size={12} color="#d97706" />
                <span>Mulai Sesi Kerja</span>
              </button>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  color: '#94a3b8',
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
              >
                Sesi Kerja: Belum Mulai
              </span>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: adminRole === 'MANAGER' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(37, 99, 235, 0.12)',
                  color: adminRole === 'MANAGER' ? '#d97706' : '#2563eb',
                  border: adminRole === 'MANAGER' ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(37, 99, 235, 0.25)',
                }}
              >
                {adminRole === 'MANAGER' ? '👑 MANAGER' : '🛡️ ADMIN SHIFT'}
              </span>
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
          </div>
        </header>

        {/* ── MODAL SESI MANAGER ON DUTY (MOD) ── */}
        {isModModalOpen && (
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
                padding: '22px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                boxShadow: '0 25px 30px -5px rgba(0,0,0,0.25)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                    }}
                  >
                    <UserCheck size={22} />
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
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                >
                  <X size={18} />
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
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setIsModModalOpen(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.8rem',
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
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#dc2626',
                        fontSize: '0.8rem',
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
                        padding: '8px 18px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#d97706',
                        color: '#ffffff',
                        fontSize: '0.8rem',
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

      {/* Mobile bottom nav — hanya tampil di layar < 1024px.
          Dibungkus mounted guard agar tidak ada hydration mismatch. */}
      {mounted && <MobileBottomNav adminRole={adminRole} />}
    </div>
    </AdminContext.Provider>
  );
}
