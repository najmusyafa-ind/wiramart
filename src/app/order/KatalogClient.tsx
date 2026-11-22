'use client';

// =============================================================
// Wiramart v2.0 — KatalogClient
// Client view interaktif untuk search, filter kategori & grid produk.
// =============================================================

import React, { useState, useMemo, useEffect, useSyncExternalStore } from 'react';
import Image from 'next/image';
import type { KatalogItem } from '@/features/order/katalog.service';
import KatalogHeader from './components/KatalogHeader';
import CategoryBar, { type CategoryInfo } from './components/CategoryBar';
import ProductCard from './components/ProductCard';
import CartFloatingBar from './components/CartFloatingBar';
import {
  SearchX,
  RefreshCw,
  Sparkles,
  Footprints,
  ShieldCheck,
  Store,
  ArrowRight,
  Download,
  Smartphone,
  CheckCircle2,
  X,
  Copy,
} from 'lucide-react';

interface KatalogClientProps {
  initialItems: KatalogItem[];
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const WELCOME_SEEN_KEY = 'wiramart_pwa_intro_seen_v3';
const INTRO_EVENT = 'wiramart-pwa-intro-seen-change';
const PWA_INSTALL_EVENT = 'wiramart-pwa-install-state-change';
const SPLASH_DURATION_MS = 2700;

// In-memory guard agar navigasi client-side (/order <-> /order/login <-> /order/profile) tidak pernah memicu ulang splash
let hasPlayedIntroInRuntime = false;
let deferredPwaPrompt: BeforeInstallPromptEvent | null = null;
let isPwaInstalledInRuntime = false;
let swListenerInitialized = false;

function initPwaInstallListeners(): void {
  if (typeof window === 'undefined' || swListenerInitialized) return;
  swListenerInitialized = true;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => {
        // Service worker registration optional fallback
      });
  }

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPwaPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(PWA_INSTALL_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    isPwaInstalledInRuntime = true;
    window.dispatchEvent(new Event(PWA_INSTALL_EVENT));
  });
}

if (typeof window !== 'undefined') {
  initPwaInstallListeners();
}

function subscribePwaInstallState(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  initPwaInstallListeners();
  window.addEventListener(PWA_INSTALL_EVENT, callback);
  const mq = window.matchMedia('(display-mode: standalone)');
  mq.addEventListener?.('change', callback);
  return () => {
    window.removeEventListener(PWA_INSTALL_EVENT, callback);
    mq.removeEventListener?.('change', callback);
  };
}

function getIsStandaloneSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaInstalledInRuntime) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function getHasNativePromptSnapshot(): boolean {
  return deferredPwaPrompt !== null;
}

function subscribeIntroSeen(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(INTRO_EVENT, callback);
  return () => window.removeEventListener(INTRO_EVENT, callback);
}

function getIntroSeenSnapshot(): boolean {
  if (hasPlayedIntroInRuntime) return true;
  try {
    return sessionStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroAsSeen(): void {
  hasPlayedIntroInRuntime = true;
  try {
    sessionStorage.setItem(WELCOME_SEEN_KEY, '1');
    window.dispatchEvent(new Event(INTRO_EVENT));
  } catch {
    // ignore
  }
}

function getTimeGreetingWib(): string {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return 'Selamat Pagi';
  if (hour >= 11 && hour < 15) return 'Selamat Siang';
  if (hour >= 15 && hour < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}

const emptySubscribe = () => () => {};

type IntroPhase = 'splash' | 'welcome' | 'closed';

export default function KatalogClient({ initialItems }: KatalogClientProps) {
  const [items, setItems] = useState<KatalogItem[]>(initialItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Mengecek apakah intro sudah pernah tampil di sesi tab ini (SSR default: true/closed agar tidak berkedip saat balik dari /order/login atau /order/profile)
  const hasSeenIntro = useSyncExternalStore(subscribeIntroSeen, getIntroSeenSnapshot, () => true);
  const isStandalonePwa = useSyncExternalStore(subscribePwaInstallState, getIsStandaloneSnapshot, () => false);
  const hasNativeInstallPrompt = useSyncExternalStore(subscribePwaInstallState, getHasNativePromptSnapshot, () => false);

  // manualPhase dipakai hanya saat pertama kali auto-run atau saat tombol "Sambutan" diklik manual
  const [manualPhase, setManualPhase] = useState<IntroPhase | null>(null);
  const [isTransitioningSplash, setIsTransitioningSplash] = useState(false);
  const [isClosingWelcome, setIsClosingWelcome] = useState(false);
  const [showInstallGuideModal, setShowInstallGuideModal] = useState(false);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(false);
  const [copiedLinkToast, setCopiedLinkToast] = useState(false);

  const handleTriggerInstallPwa = async () => {
    if (deferredPwaPrompt) {
      try {
        await deferredPwaPrompt.prompt();
        const choice = await deferredPwaPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          deferredPwaPrompt = null;
          isPwaInstalledInRuntime = true;
          window.dispatchEvent(new Event(PWA_INSTALL_EVENT));
        }
        return;
      } catch {
        // fallback ke panduan visual bila prompt gagal dipanggil
      }
    }
    setShowInstallGuideModal(true);
  };

  const handleCopyOrderUrl = async () => {
    try {
      const targetUrl = typeof window !== 'undefined' ? `${window.location.origin}/order` : '';
      await navigator.clipboard.writeText(targetUrl);
      setCopiedLinkToast(true);
      window.setTimeout(() => setCopiedLinkToast(false), 2400);
    } catch {
      // ignore
    }
  };

  const greeting = useSyncExternalStore(emptySubscribe, getTimeGreetingWib, () => 'Selamat Datang');
  const introPhase: IntroPhase = manualPhase ?? (hasSeenIntro ? 'closed' : 'splash');

  useEffect(() => {
    if (introPhase !== 'splash') return;

    // Begitu splash mulai berjalan pertama kali, langsung kunci sesi agar saat pindah ke /order/login atau /order/profile lalu kembali ke /order TIDAK muncul splash lagi
    const fadeTimer = window.setTimeout(() => {
      setIsTransitioningSplash(true);
    }, SPLASH_DURATION_MS - 340);

    const nextTimer = window.setTimeout(() => {
      markIntroAsSeen();
      setIsTransitioningSplash(false);
      setManualPhase('welcome');
    }, SPLASH_DURATION_MS);

    return () => {
      markIntroAsSeen();
      window.clearTimeout(fadeTimer);
      window.clearTimeout(nextTimer);
    };
  }, [introPhase]);

  const handleSkipSplashToWelcome = () => {
    setManualPhase('splash');
    markIntroAsSeen();
    setIsTransitioningSplash(true);
    window.setTimeout(() => {
      setIsTransitioningSplash(false);
      setManualPhase('welcome');
    }, 260);
  };

  const handleCloseWelcome = () => {
    markIntroAsSeen();
    setIsClosingWelcome(true);
    window.setTimeout(() => {
      setManualPhase('closed');
      setIsClosingWelcome(false);
    }, 280);
  };

  useEffect(() => {
    if (introPhase === 'closed') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && introPhase === 'welcome') {
        markIntroAsSeen();
        setIsClosingWelcome(true);
        window.setTimeout(() => {
          setManualPhase('closed');
          setIsClosingWelcome(false);
        }, 280);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [introPhase]);

  // Tombol "Sambutan" di header: putar ulang rangkaian lengkap (Fullscreen Splash -> Kartu Sambutan), tetapi tetap terkunci di sessionStorage agar navigasi ke halaman lain tidak mengulanginya lagi
  const handleReplayFullIntro = () => {
    markIntroAsSeen();
    setIsClosingWelcome(false);
    setIsTransitioningSplash(false);
    setManualPhase('splash');
  };

  // Dynamic Categories from available products
  const categories: CategoryInfo[] = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();

    for (const item of items) {
      const existing = map.get(item.categoryId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(item.categoryId, {
          id: item.categoryId,
          name: item.categoryName,
          count: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return items.filter((product) => {
      const matchesCategory =
        selectedCategoryId === 'ALL' || product.categoryId === selectedCategoryId;
      const matchesSearch =
        q.length === 0 ||
        product.name.toLowerCase().includes(q) ||
        product.categoryName.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [items, searchQuery, selectedCategoryId]);

  // Pull-to-refresh or reload catalog
  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/order/katalog', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.items) {
          setItems(json.data.items);
        }
      }
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* TAHAP 1: Fullscreen Animated Launch Splash (~2.7 detik) */}
      {introPhase === 'splash' && (
        <div
          className={`pwa-native-splash${isTransitioningSplash ? ' pwa-native-splash--closing' : ''}`}
          onClick={handleSkipSplashToWelcome}
          role="status"
          aria-live="polite"
          aria-label="Memuat Wiramart Campus Delivery"
        >
          {/* Ambient Glow Orbs */}
          <div className="pwa-splash-orb pwa-splash-orb--top" aria-hidden="true" />
          <div className="pwa-splash-orb pwa-splash-orb--bottom" aria-hidden="true" />

          {/* Top Official Pill */}
          <div className="pwa-native-splash__top-pill">
            <Sparkles size={13} />
            <span>OFFICIAL CAMPUS DELIVERY &bull; UNPERBA</span>
          </div>

          {/* Center Animated Logo & Ripple Rings */}
          <div className="pwa-native-splash__center">
            <div className="pwa-native-splash__ring-wrap">
              <span className="pwa-native-splash__pulse-ring pwa-native-splash__pulse-ring--1" aria-hidden="true" />
              <span className="pwa-native-splash__pulse-ring pwa-native-splash__pulse-ring--2" aria-hidden="true" />
              <div className="pwa-native-splash__icon-box">
                <Image
                  src="/logo.png"
                  alt="Logo Wiramart UNPERBA"
                  width={74}
                  height={74}
                  priority
                  style={{ objectFit: 'contain' }}
                />
              </div>
            </div>

            <div className="pwa-native-splash__brand-block">
              <div className="pwa-native-splash__title">WIRAMART UNPERBA</div>
              <div className="pwa-native-splash__tagline">
                Pesan Antar Makanan, Minuman &amp; Jajanan Sampai Kelas
              </div>
            </div>
          </div>

          {/* Bottom Animated Progress Bar & Footer */}
          <div className="pwa-native-splash__footer">
            <div className="pwa-native-splash__progress-track" aria-hidden="true">
              <div className="pwa-native-splash__progress-fill" />
            </div>
            <div className="pwa-native-splash__sub">
              Menghubungkan Katalog Realtime ({items.length} Produk Aktif)...
            </div>
          </div>
        </div>
      )}

      {/* TAHAP 2: Kartu Sambutan Interaktif (Muncul Otomatis Setelah Splash Selesai) */}
      {introPhase === 'welcome' && (
        <div
          className={`pwa-welcome-overlay${isClosingWelcome ? ' pwa-welcome-overlay--closing' : ''}`}
          onClick={handleCloseWelcome}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-welcome-title"
        >
          <div className="pwa-welcome-card" onClick={(e) => e.stopPropagation()}>
            {/* Hero Visual Header */}
            <div className="pwa-welcome-hero">
              <Image
                src="/unperba_campus.jpg"
                alt="Kampus Universitas Perwira Purbalingga (UNPERBA)"
                fill
                sizes="440px"
                style={{ objectFit: 'cover' }}
                priority
              />
              <div className="pwa-welcome-hero-gradient" />

              <div className="pwa-welcome-floating-badge">
                <Sparkles size={13} />
                <span>RESMI &bull; UKM KEWIRAUSAHAAN UNPERBA</span>
              </div>

              <div className="pwa-welcome-logo-orb">
                <Image
                  src="/logo.png"
                  alt="Logo Wiramart UNPERBA"
                  width={54}
                  height={54}
                  style={{ objectFit: 'contain' }}
                />
              </div>
            </div>

            {/* Body */}
            <div className="pwa-welcome-body">
              <span className="pwa-welcome-greeting">{greeting}, Warga UNPERBA!</span>
              <h2 id="pwa-welcome-title" className="pwa-welcome-title">
                Belanja Jajanan &amp; Minuman,{' '}
                <span className="pwa-welcome-highlight">Diantar Sampai Kelas</span>
              </h2>
              <p className="pwa-welcome-desc">
                Tidak perlu turun tangga saat jeda kuliah. Pilih menu favoritmu dari katalog
                <strong> {items.length} produk</strong> Wiramart yang siap diantar Runner kami.
              </p>

              {/* 3 Interactive Feature Highlights */}
              <div className="pwa-welcome-features">
                <div className="pwa-welcome-feature-item">
                  <div className="pwa-welcome-feature-icon pwa-welcome-feature-icon--green">
                    <Footprints size={18} />
                  </div>
                  <div>
                    <strong>Runner Antar ke Lantai 2, 3, 4 &amp; Auditorium</strong>
                    <span>Ongkir hemat Rp 1.000 (Lt. 2) &bull; Rp 2.000 (Lt. 3–4 &amp; Aud)</span>
                  </div>
                </div>

                <div className="pwa-welcome-feature-item">
                  <div className="pwa-welcome-feature-icon pwa-welcome-feature-icon--amber">
                    <Store size={18} />
                  </div>
                  <div>
                    <strong>Ambil Sendiri di Store Lantai 1 (Gratis Rp 0)</strong>
                    <span>Pesan dulu dari HP, tinggal ambil tanpa antre lama</span>
                  </div>
                </div>

                <div className="pwa-welcome-feature-item">
                  <div className="pwa-welcome-feature-icon pwa-welcome-feature-icon--blue">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <strong>Transaksi Aman dengan PIN Serah Terima 6-Digit</strong>
                    <span>Bayar via QRIS / Transfer, barang tiba tepat di tanganmu</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseWelcome}
                className="pwa-welcome-cta"
              >
                <span>Mulai Belanja Sekarang</span>
                <ArrowRight size={18} className="pwa-welcome-cta-arrow" />
              </button>

              {!isStandalonePwa && (
                <button
                  type="button"
                  onClick={() => {
                    handleCloseWelcome();
                    void handleTriggerInstallPwa();
                  }}
                  className="pwa-welcome-install-btn"
                >
                  <Download size={16} />
                  <span>
                    {hasNativeInstallPrompt
                      ? 'Download & Install Aplikasi Wiramart di HP'
                      : 'Pasang Aplikasi Wiramart ke Layar Utama HP'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Panduan Install PWA (Muncul jika browser HP butuh klik menu Chrome / Safari atau dibuka dari WhatsApp) */}
      {showInstallGuideModal && (
        <div
          className="pwa-welcome-overlay"
          onClick={() => setShowInstallGuideModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="pwa-install-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="pwa-install-modal-header">
              <div className="pwa-install-modal-badge">
                <Smartphone size={16} />
                <span>INSTALASI APLIKASI WIRAMART</span>
              </div>
              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="pwa-install-modal-close"
                aria-label="Tutup panduan install"
              >
                <X size={18} />
              </button>
            </div>

            <h3 id="pwa-install-guide-title" className="pwa-install-modal-title">
              Pasang Aplikasi Wiramart di HP Anda
            </h3>
            <p className="pwa-install-modal-desc">
              Nikmati pengalaman penuh layar dengan animasi logo sambutan seperti aplikasi native tanpa perlu mengetik alamat web lagi.
            </p>

            {hasNativeInstallPrompt && (
              <button
                type="button"
                onClick={() => {
                  setShowInstallGuideModal(false);
                  void handleTriggerInstallPwa();
                }}
                className="pwa-welcome-cta"
                style={{ marginBottom: 14 }}
              >
                <Download size={17} />
                <span>Instal Sekarang (1-Klik Otomatis)</span>
              </button>
            )}

            <div className="pwa-install-steps-list">
              <div className="pwa-install-step-box">
                <div className="pwa-install-step-title">
                  <CheckCircle2 size={16} />
                  <span>HP Android (Google Chrome)</span>
                </div>
                <ol className="pwa-install-step-ol">
                  <li>Pastikan halaman ini dibuka di aplikasi <strong>Google Chrome</strong> (bukan browser di dalam WhatsApp/Instagram).</li>
                  <li>Ketuk ikon <strong>Titik Tiga (⋮)</strong> di pojok kanan atas Chrome.</li>
                  <li>Pilih <strong>&ldquo;Instal aplikasi&rdquo; (Install app)</strong> atau <strong>&ldquo;Tambahkan ke Layar Utama&rdquo;</strong>, lalu ketuk <strong>Instal</strong>.</li>
                </ol>
              </div>

              <div className="pwa-install-step-box">
                <div className="pwa-install-step-title">
                  <CheckCircle2 size={16} />
                  <span>iPhone / iPad (Safari)</span>
                </div>
                <ol className="pwa-install-step-ol">
                  <li>Buka halaman ini di browser <strong>Safari</strong>.</li>
                  <li>Ketuk ikon <strong>Bagikan (Share)</strong> di bilah bawah layar.</li>
                  <li>Geser ke bawah dan pilih <strong>&ldquo;Tambahkan ke Layar Utama&rdquo; (Add to Home Screen)</strong>.</li>
                </ol>
              </div>
            </div>

            <div className="pwa-install-modal-actions">
              <button
                type="button"
                onClick={handleCopyOrderUrl}
                className="pwa-install-copy-btn"
              >
                <Copy size={15} />
                <span>{copiedLinkToast ? 'Link /order Tersalin!' : 'Salin Link untuk Dibuka di Chrome'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="pwa-install-done-btn"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Header with Search */}
      <KatalogHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenWelcome={handleReplayFullIntro}
        onInstallPwa={handleTriggerInstallPwa}
        canShowInstallBtn={!isStandalonePwa}
        hasNativeInstallPrompt={hasNativeInstallPrompt}
      />

      {/* Smart Install App Strip (Hanya muncul bila belum di-install sebagai PWA standalone) */}
      {!isStandalonePwa && !installBannerDismissed && (
        <div className="pwa-install-smart-strip">
          <button
            type="button"
            onClick={handleTriggerInstallPwa}
            className="pwa-install-smart-strip__main"
          >
            <div className="pwa-install-smart-strip__icon">
              <Download size={16} />
            </div>
            <div className="pwa-install-smart-strip__text">
              <strong>
                {hasNativeInstallPrompt
                  ? 'Aplikasi Wiramart Siap Di-download!'
                  : 'Pasang Aplikasi Wiramart di HP'}
              </strong>
              <span>
                {hasNativeInstallPrompt
                  ? 'Ketuk di sini untuk instal aplikasi langsung ke layar utama HP'
                  : 'Ketuk untuk instal ke layar utama HP (akses 1-klik & layar penuh)'}
              </span>
            </div>
            <span className="pwa-install-smart-strip__cta">Instal</span>
          </button>
          <button
            type="button"
            onClick={() => setInstallBannerDismissed(true)}
            className="pwa-install-smart-strip__close"
            aria-label="Sembunyikan banner instal aplikasi"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Categories Horizontal Scroll */}
      <CategoryBar
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
      />

      {/* Catalog Meta Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px 12px 16px',
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--pwa-text-muted)', fontWeight: 500 }}>
          Menampilkan <strong>{filteredProducts.length}</strong> produk
        </span>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="pwa-refresh-btn"
          title="Segarkan data stok"
        >
          <RefreshCw
            size={12}
            style={{
              animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
            }}
          />
          <span>{isRefreshing ? 'Memuat...' : 'Segarkan'}</span>
        </button>
      </div>

      {/* Product Grid / Empty Search */}
      {filteredProducts.length === 0 ? (
        <div className="pwa-empty-state" style={{ margin: 'auto 0' }}>
          <div className="pwa-empty-icon">
            <SearchX size={32} />
          </div>
          <h3 className="pwa-empty-title">Produk Tidak Ditemukan</h3>
          <p className="pwa-empty-desc">
            {searchQuery
              ? `Tidak ada produk dengan kata kunci "${searchQuery}". Coba kata kunci lain.`
              : 'Belum ada produk aktif di kategori ini.'}
          </p>
        </div>
      ) : (
        <div className="pwa-product-grid" key={`${selectedCategoryId}-${searchQuery.slice(0, 12)}`}>
          {filteredProducts.map((product, index) => (
            <ProductCard key={product.id} product={product} index={index} />
          ))}
        </div>
      )}

      {/* Floating Cart Indicator */}
      <CartFloatingBar />
    </main>
  );
}
