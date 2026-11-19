'use client';

// =============================================================
// Wiramart v2.0 — KatalogHeader Component
// Header PWA dengan info delivery kampus, search bar & user status.
// =============================================================

import React, { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, Search, X, User, Footprints, ArrowRight, Sparkles } from 'lucide-react';
import { useCart } from '@/features/order/cart.context';

interface KatalogHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenWelcome?: () => void;
}

const BANNER_KEY = 'wiramart_banner_dismissed_v1';
const BANNER_EVENT = 'wiramart-banner-visibility-change';

function subscribeBanner(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BANNER_KEY) callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(BANNER_EVENT, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(BANNER_EVENT, callback);
  };
}

function getBannerSnapshot(): boolean {
  try {
    return !localStorage.getItem(BANNER_KEY);
  } catch {
    return true;
  }
}

export default function KatalogHeader({
  searchQuery,
  onSearchChange,
  onOpenWelcome,
}: KatalogHeaderProps) {
  const { buyer, isLoadingBuyer } = useCart();
  const [dismissedInSession, setDismissedInSession] = useState(false);
  const storedBannerVisible = useSyncExternalStore(subscribeBanner, getBannerSnapshot, () => false);
  const bannerVisible = !dismissedInSession && storedBannerVisible;

  const dismissBanner = () => {
    setDismissedInSession(true);
    try {
      localStorage.setItem(BANNER_KEY, '1');
    } catch {
      // private browsing safeguard
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(BANNER_EVENT));
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onOpenWelcome && (
            <button
              type="button"
              onClick={onOpenWelcome}
              className="pwa-welcome-trigger"
              title="Tampilkan layar sambutan Wiramart"
              aria-label="Sambutan Wiramart"
            >
              <Sparkles size={13} />
              <span>Sambutan</span>
            </button>
          )}
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

      {/* Campus Hero Showcase Banner — dismissible */}
      {bannerVisible && (
        <div className="pwa-campus-banner pwa-campus-banner--hero">
          <div className="pwa-campus-banner-bg" aria-hidden="true">
            <Image
              src="/wiramart_showcase.jpg"
              alt=""
              fill
              sizes="480px"
              style={{ objectFit: 'cover', opacity: 0.22 }}
            />
          </div>
          <div className="pwa-campus-banner-icon">
            <Footprints size={18} />
          </div>
          <div className="pwa-campus-banner-content">
            <div className="pwa-hero-pill-tag">
              <Sparkles size={11} />
              <span>RUNNER KAMPUS SIAP ANTAR</span>
            </div>
            <strong>Pesan dari Kelas, Diantar Naik Tangga!</strong>
            <span>Lt. 1 Ambil Gratis &bull; Lt. 2 Rp 1.000 &bull; Lt. 3, 4 &amp; Aud Rp 2.000</span>
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
