'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import {
  LayoutDashboard,
  Package,
  Users,
  ClipboardList,
  BarChart3,
  CalendarDays,
} from 'lucide-react';

type AdminRole = 'MANAGER' | 'ADMIN_SHIFT';

const BOTTOM_NAV_MANAGER = [
  { label: 'Dashboard', href: '/manager/dashboard', icon: LayoutDashboard },
  { label: 'Produk',    href: '/manager/produk',    icon: Package },
  { label: 'Karyawan',  href: '/manager/karyawan',  icon: Users },
  { label: 'Absensi',   href: '/manager/absensi',   icon: ClipboardList },
  { label: 'Laporan',   href: '/manager/laporan',   icon: BarChart3 },
];

const BOTTOM_NAV_SHIFT = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Produk',    href: '/admin/produk',    icon: Package },
  { label: 'Jadwal',    href: '/admin/jadwal',    icon: CalendarDays },
  { label: 'Absensi',   href: '/admin/absensi',   icon: ClipboardList },
  { label: 'Karyawan',  href: '/admin/karyawan',  icon: Users },
];

// matchMedia — identik dengan cara CSS @media query bekerja,
// tidak terpengaruh lebar scrollbar seperti window.innerWidth
const MOBILE_MQ = '(max-width: 1023px)';

function subscribeMobileMq(callback: () => void): () => void {
  const mq = window.matchMedia(MOBILE_MQ);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getMobileSnapshot(): boolean {
  return window.matchMedia(MOBILE_MQ).matches;
}

function getMobileServerSnapshot(): boolean {
  return false;
}

export default function MobileBottomNav({ adminRole = 'ADMIN_SHIFT' }: { adminRole?: AdminRole }) {
  const pathname = usePathname();
  const isMobile = useSyncExternalStore(
    subscribeMobileMq,
    getMobileSnapshot,
    getMobileServerSnapshot
  );

  // Jika sidebar desktop tampil (≥ 1024px CSS width), nav ini tidak di-render sama sekali
  if (!isMobile) return null;

  const navItems = adminRole === 'MANAGER' ? BOTTOM_NAV_MANAGER : BOTTOM_NAV_SHIFT;

  return (
    <nav
      className="admin-bottom-nav"
      aria-label="Navigasi bawah mobile"
    >
      {navItems.map(({ label, href, icon: Icon }) => {
        const isActive =
          href === '/manager/dashboard' || href === '/admin/dashboard'
            ? pathname === href
            : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={`admin-bottom-nav__item${isActive ? ' active' : ''}`}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon
              size={22}
              aria-hidden="true"
              className="admin-bottom-nav__icon"
              strokeWidth={isActive ? 2.5 : 1.8}
            />
            <span className="admin-bottom-nav__label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

