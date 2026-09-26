'use client';

import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Users,
  ClipboardList,
  BarChart3,
} from 'lucide-react';

const BOTTOM_NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: (s: number) => <LayoutDashboard size={s} aria-hidden="true" /> },
  { label: 'Produk',    href: '/admin/produk',     icon: (s: number) => <Package         size={s} aria-hidden="true" /> },
  { label: 'Karyawan',  href: '/admin/karyawan',   icon: (s: number) => <Users            size={s} aria-hidden="true" /> },
  { label: 'Absensi',   href: '/admin/absensi',    icon: (s: number) => <ClipboardList    size={s} aria-hidden="true" /> },
  { label: 'Laporan',   href: '/admin/laporan',    icon: (s: number) => <BarChart3        size={s} aria-hidden="true" /> },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigasi bawah" className="mobile-bottom-nav">
      {BOTTOM_NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <a
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '3px',
              flex: 1,
              padding: '8px 4px 10px',
              textDecoration: 'none',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              position: 'relative',
              transition: 'color 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {isActive && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: '6px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'var(--color-primary)',
                  opacity: 0.12,
                  pointerEvents: 'none',
                }}
              />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>
              {item.icon(isActive ? 22 : 20)}
            </span>
            <span style={{
              fontSize: '0.62rem',
              fontWeight: isActive ? 700 : 500,
              letterSpacing: isActive ? '0.01em' : '0',
              lineHeight: 1,
            }}>
              {item.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
