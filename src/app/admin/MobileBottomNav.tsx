'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Users,
  ClipboardList,
  BarChart3,
} from 'lucide-react';

const BOTTOM_NAV = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Produk',    href: '/admin/produk',    icon: Package },
  { label: 'Karyawan',  href: '/admin/karyawan',  icon: Users },
  { label: 'Absensi',   href: '/admin/absensi',   icon: ClipboardList },
  { label: 'Laporan',   href: '/admin/laporan',   icon: BarChart3 },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="admin-bottom-nav"
      aria-label="Navigasi bawah mobile"
    >
      {BOTTOM_NAV.map(({ label, href, icon: Icon }) => {
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
