'use client';

// =============================================================
// Wiramart v2.0 — KatalogHeader Component
// Header PWA dengan info delivery kampus, search bar & user status.
// =============================================================

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingBag, Search, X, User, Footprints, ArrowRight } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

interface KatalogHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

const BANNER_KEY = 'wiramart_banner_dismissed_v1';

export default function KatalogHeader({ searchQuery, onSearchChange }: KatalogHeaderProps) {
  const { buyer, isLoadingBuyer } = useCart();
  const [bannerVisible, setBannerVisible] = useState(false);

  // Baca dari localStorage setelah hydration
  useEffect(() => {
    try {
      if (!localStorage.getItem(BANNER_KEY)) setBannerVisible(true);
    } catch {
      setBannerVisible(true);
    }
  }, []);

  const dismissBanner = () => {
    setBannerVisible(false);
    try {
      localStorage.setItem(BANNER_KEY, '1');
    } catch {
      // private browsing safeguard
    }
  };

  return (
    <header className="pwa-header">
      {/* Top Brand & User Bar */}
      <div className="pwa-header-top">
        <Link href="/order" className="pwa-brand">
          <div className="pwa-brand-logo">
            <ShoppingBag size={20} strokeWidth={2.5} />
          </div>
          <div className="pwa-brand-text">
            <h1>WIRAMART</h1>
            <span>Campus Delivery UNPERBA</span>
          </div>
        </Link>

        <div>
          {isLoadingBuyer ? (
            <div style={{ width: 80, height: 28, background: 'var(--pwa-surface-muted)', borderRadius: 999 }} />
          ) : buyer ? (
            <Link href="/order/profile" className="pwa-user-badge" title="Profil Pembeli">
              <User size={13} />
              <span>{(buyer.fullName || 'Akun').split(' ')[0]}</span>
            </Link>
          ) : (
            <Link href="/order/login" className="pwa-login-btn">
              <span>Masuk</span>
              <ArrowRight size={13} />
            </Link>
          )}
        </div>
      </div>

      {/* Campus Reality Banner — dismissible */}
      {bannerVisible && (
        <div className="pwa-campus-banner">
          <div className="pwa-campus-banner-icon">
            <Footprints size={18} />
          </div>
          <div className="pwa-campus-banner-content">
            <strong>Layanan Antar Sampai Kelas</strong>
            Gedung tanpa lift? Runner kami antarkan pesanan naik tangga ke Lantai 2, 3, 4 &amp; Auditorium.
          </div>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label="Tutup banner"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: 'white',
              borderRadius: 6,
              padding: '4px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Search Input */}
      <div className="pwa-search-box">
        <Search size={16} className="pwa-search-icon" />
        <input
          type="text"
          className="pwa-search-input"
          placeholder="Cari snack, kopi, roti, air mineral..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Cari produk katalog"
        />
        {searchQuery.trim().length > 0 && (
          <button
            type="button"
            className="pwa-search-clear"
            onClick={() => onSearchChange('')}
            aria-label="Hapus pencarian"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </header>
  );
}
