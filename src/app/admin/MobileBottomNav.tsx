'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
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
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Produk',    href: '/admin/produk',    icon: Package },
  { label: 'Karyawan',  href: '/admin/karyawan',  icon: Users },
  { label: 'Absensi',   href: '/admin/absensi',   icon: ClipboardList },
  { label: 'Laporan',   href: '/admin/laporan',   icon: BarChart3 },
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

export default function MobileBottomNav({ adminRole = 'ADMIN_SHIFT' }: { adminRole?: AdminRole }) {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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
          href === '/admin/dashboard'
            ? pathname === '/admin/dashboard'
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

