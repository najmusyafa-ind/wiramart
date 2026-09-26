'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  Store,
  Users,
  Award,
  ShieldCheck,
  TrendingUp,
  Sparkles,
  ShoppingBag,
  Calendar,
  ArrowRight,
  GraduationCap,
  QrCode,
  BookOpen,
  Briefcase,
  Megaphone,
  Handshake,
  Camera,
  Layers,
  Home,
  LogIn,
  ChevronDown,
  MapPin,
  Phone,
  Star,
} from 'lucide-react';

/* ── TYPE DEFINITIONS ───────────────────────────────────────── */
interface DivisionItem {
  id: string;
  number: number;
  name: string;
  role: string;
  icon: typeof Users;
  duties: string[];
}

/* ── DATA ───────────────────────────────────────────────────── */
const DIVISIONS: DivisionItem[] = [
  {
    id: 'ketua',
    number: 1,
    name: 'Ketua',
    role: 'Pimpinan Eksekutif Unit',
    icon: Award,
    duties: [
      'Memimpin dan mengawasi seluruh kegiatan operasional unit.',
      'Bertanggung jawab atas keputusan strategis dan kebijakan umum.',
      'Mengkoordinasikan sinergi dan kolaborasi aktif antar seluruh divisi.',
    ],
  },
  {
    id: 'wakil-ketua',
    number: 2,
    name: 'Wakil Ketua',
    role: 'Wakil Pimpinan Eksekutif',
    icon: ShieldCheck,
    duties: [
      'Membantu ketua dalam menjalankan tugas-tugas harian unit.',
      'Mengambil alih mandat kepemimpinan ketua saat berhalangan hadir.',
      'Membantu supervisi teknis dan koordinasi lintas divisi.',
    ],
  },
  {
    id: 'sekretaris',
    number: 3,
    name: 'Sekretaris',
    role: 'Administrasi & Tata Kelola',
    icon: BookOpen,
    duties: [
      'Mengelola tata kelola administrasi, persuratan, dan dokumentasi unit.',
      'Mengatur jadwal rapat internal/eksternal dan kalender agenda.',
      'Menangani alur korespondensi serta komunikasi internal anggota.',
    ],
  },
  {
    id: 'bendahara',
    number: 4,
    name: 'Bendahara',
    role: 'Keuangan & Perbendaharaan',
    icon: TrendingUp,
    duties: [
      'Mengelola arus kas masuk dan keluar unit secara transparan.',
      'Menyusun rancangan anggaran belanja serta kontrol pengeluaran.',
      'Menyusun laporan pembukuan keuangan berkala untuk evaluasi.',
    ],
  },
  {
    id: 'pelatihan-inkubasi',
    number: 5,
    name: 'Divisi Pelatihan & Inkubasi',
    role: 'Pengembangan Talenta Bisnis',
    icon: GraduationCap,
    duties: [
      'Mengembangkan kompetensi wirausaha anggota via workshop dan pelatihan.',
      'Membimbing dan memvalidasi ide bisnis mahasiswa dari konsep hingga siap jual.',
      'Menyediakan fasilitas inkubator dan sumber daya akselerasi proyek bisnis.',
    ],
  },
  {
    id: 'kreativitas-produksi',
    number: 6,
    name: 'Divisi Kreativitas & Produksi',
    role: 'Inovasi & R&D Produk',
    icon: Sparkles,
    duties: [
      'Mengembangkan ide kreatif dan inovatif untuk unit usaha baru.',
      'Memproduksi aset kreatif, kemasan, dan materi promosi visual.',
      'Mengelola rantai produksi serta standarisasi mutu produk Wiramart.',
    ],
  },
  {
    id: 'pemasaran-branding',
    number: 7,
    name: 'Divisi Pemasaran & Branding',
    role: 'Strategi Penjualan & Citra',
    icon: Megaphone,
    duties: [
      'Menyusun dan mengeksekusi strategi promosi terukur online & offline.',
      'Mengelola media sosial resmi dan kanal pemasaran digital kampus.',
      'Membangun serta menjaga reputasi citra merek Wiramart UNPERBA.',
    ],
  },
  {
    id: 'kemitraan-eksternal',
    number: 8,
    name: 'Divisi Kemitraan & Eksternal',
    role: 'Hubungan Kerjasama & Stakeholder',
    icon: Handshake,
    duties: [
      'Menjalin dan merawat kemitraan strategis dengan vendor serta UMKM mitra.',
      'Membuka peluang kolaborasi dengan instansi swasta, pemerintah, dan kampus lain.',
      'Memelihara jejaring relasi dengan alumni dan stakeholder kewirausahaan.',
    ],
  },
  {
    id: 'humas-dokumentasi',
    number: 9,
    name: 'Divisi Humas & Dokumentasi',
    role: 'Komunikasi Publik & Media',
    icon: Camera,
    duties: [
      'Menjadi garda depan komunikasi publik, pers, dan media massa.',
      'Merekam jejak dokumentasi visual/audio kegiatan unit secara terstruktur.',
      'Mengelola persepsi publik serta keterbukaan informasi di ruang publik.',
    ],
  },
];

const ECOSYSTEM_FEATURES = [
  {
    icon: Store,
    title: 'Smart Retail & Kantin Mahasiswa',
    desc: 'Wiramart hadir sebagai minimarket dan pusat jajanan kampus UNPERBA yang menyajikan kebutuhan harian, perlengkapan kuliah, dan produk karya mahasiswa.',
  },
  {
    icon: QrCode,
    title: 'POS Kasir Digital & Multi-Payment',
    desc: 'Dilengkapi sistem kasir modern dengan pemindai barcode kamera, pencatatan otomatis, struk digital, serta pembayaran Tunai dan QRIS instan.',
  },
  {
    icon: Calendar,
    title: 'Manajemen Shift Mandiri Anti-Bentrok',
    desc: 'Mahasiswa petugas kasir bebas memilih jadwal shift fleksibel di luar jam kuliah dengan sistem kuota terproteksi otomatis.',
  },
  {
    icon: Briefcase,
    title: 'Laboratorium Praktik Bisnis Riil',
    desc: 'Bukan sekadar kasir — Wiramart adalah inkubator langsung bagi mahasiswa untuk belajar manajemen stok, akuntansi ritel, dan kepemimpinan tim.',
  },
];

const STATS = [
  { value: '9', label: 'Divisi Aktif', sub: 'Struktur Organisasi UKM' },
  { value: 'POS', label: 'Realtime Kasir', sub: 'Barcode & Multi-Payment' },
  { value: 'QRIS', label: 'Pembayaran Digital', sub: 'Tanpa Ribet, Langsung Bayar' },
  { value: '24/7', label: 'Monitoring', sub: 'Laporan & Dashboard Admin' },
];

/* ── COMPONENT ──────────────────────────────────────────────── */
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileNavActive, setMobileNavActive] = useState<string>('home');

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="lp-root">
      {/* ── SKIP TO CONTENT (a11y) ─── */}
      <a href="#main-content" className="lp-skip-link">
        Lewati ke konten utama
      </a>

      {/* ── ANNOUNCEMENT BAR ─────────────────────────────────── */}
      <aside className="lp-announcement" aria-label="Informasi resmi kampus">
        <span className="lp-announcement__badge">RESMI</span>
        <span>Unit Kegiatan Mahasiswa Kewirausahaan — Universitas Perwira M. Purbalingga (UNPERBA)</span>
        <Star size={12} aria-hidden="true" className="lp-announcement__star" />
      </aside>

      {/* ── STICKY HEADER ─────────────────────────────────────── */}
      <header className={`lp-header${scrolled ? ' lp-header--scrolled' : ''}`} role="banner">
        <div className="lp-header__inner">
          {/* Logo & Brand */}
          <Link href="/" className="lp-brand" aria-label="Wiramart UNPERBA — Beranda">
            <div className="lp-brand__logo">
              <Image
                src="/logo.png"
                alt="Logo Wiramart UNPERBA"
                fill
                sizes="40px"
                style={{ objectFit: 'contain', padding: '3px' }}
                priority
              />
            </div>
            <div className="lp-brand__text">
              <span className="lp-brand__name">WIRAMART</span>
              <span className="lp-brand__sub">UKM Kewirausahaan UNPERBA</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="lp-nav" aria-label="Navigasi utama">
            <Link href="#tentang" className="lp-nav__link">Tentang</Link>
            <Link href="#divisi" className="lp-nav__link">9 Divisi</Link>
            <Link href="#ekosistem" className="lp-nav__link">Ekosistem</Link>
            <Link href="/daftar" className="btn btn-secondary btn-sm">
              <Calendar size={15} aria-hidden="true" />
              <span>Daftar Shift</span>
            </Link>
            <Link href="/kasir/pos" className="btn btn-primary btn-sm lp-nav__cta">
              <ShoppingBag size={15} aria-hidden="true" />
              <span>Buka Kasir</span>
            </Link>
            <Link href="/login" className="lp-nav__admin" title="Portal Admin / Dosen">
              <LogIn size={14} aria-hidden="true" />
              <span>Admin</span>
            </Link>
          </nav>
        </div>
      </header>

      {/* ── MAIN CONTENT ──────────────────────────────────────── */}
      <main id="main-content">

        {/* ═══════════════════════════════════════════════════════
            HERO — CINEMATIC CAMPUS PHOTO SECTION
            ═══════════════════════════════════════════════════════ */}
        <section className="lp-hero" aria-label="Selamat datang di Wiramart UNPERBA">
          {/* Campus Background Image */}
          <div className="lp-hero__bg" aria-hidden="true">
            <Image
              src="/unperba_campus.jpg"
              alt="Gedung kampus Universitas Perwira Purbalingga (UNPERBA) — tampak depan dengan tulisan besar kuning UNIVERSITAS PERWIRA PURBALINGGA"
              fill
              sizes="100vw"
              style={{ objectFit: 'cover', objectPosition: 'center 60%' }}
              priority
              loading="eager"
              quality={75}
            />
            {/* Multi-layer gradient overlay for text legibility */}
            <div className="lp-hero__overlay" />
          </div>

          {/* Hero Content */}
          <div className="lp-hero__content">
            {/* Pill Badge */}
            <div className="lp-hero__badge" aria-hidden="true">
              <Sparkles size={13} />
              <span>Inkubator Bisnis & Sistem POS Digital Kampus</span>
            </div>

            {/* Main Headline */}
            <h1 className="lp-hero__title">
              Pusat Wirausaha{' '}
              <span className="lp-hero__title-highlight">Mahasiswa</span>
              {' & '}
              <span className="lp-hero__title-accent">Kasir Cerdas</span>
              {' '}WIRAMART
            </h1>

            {/* Sub Headline */}
            <p className="lp-hero__desc">
              Wiramart adalah wadah inkubasi bisnis resmi di bawah{' '}
              <strong>UKM Kewirausahaan UNPERBA</strong>. Mengintegrasikan operasional
              minimarket kampus dengan sistem kasir digital modern, absensi shift cerdas,
              dan pembinaan bisnis dari hulu ke hilir.
            </p>

            {/* CTA Buttons */}
            <div className="lp-hero__ctas">
              <Link href="/kasir/pos" className="btn btn-primary btn-lg lp-hero__cta-primary">
                <Store size={20} aria-hidden="true" />
                <span>Masuk Terminal Kasir POS</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/daftar" className="btn lp-hero__cta-secondary btn-lg">
                <Calendar size={18} aria-hidden="true" />
                <span>Daftar / Pilih Shift Kasir</span>
              </Link>
            </div>

            {/* Campus Info Chips */}
            <div className="lp-hero__chips">
              <span className="lp-hero__chip">
                <MapPin size={12} aria-hidden="true" />
                Purbalingga, Jawa Tengah
              </span>
              <span className="lp-hero__chip">
                <GraduationCap size={12} aria-hidden="true" />
                Universitas Perwira M. Purbalingga
              </span>
              <span className="lp-hero__chip">
                <Users size={12} aria-hidden="true" />
                UKM Kewirausahaan Aktif
              </span>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="lp-hero__scroll" aria-hidden="true">
            <ChevronDown size={20} />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            STAT BAR — Key Metrics
            ═══════════════════════════════════════════════════════ */}
        <section className="lp-stats" aria-label="Statistik Wiramart">
          <div className="lp-stats__inner">
            {STATS.map((stat, idx) => (
              <div key={idx} className="lp-stats__item">
                <div className="lp-stats__value">{stat.value}</div>
                <div className="lp-stats__label">{stat.label}</div>
                <div className="lp-stats__sub">{stat.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            TENTANG SECTION — Campus Identity Block
            ═══════════════════════════════════════════════════════ */}
        <section id="tentang" className="lp-about" aria-labelledby="about-heading">
          <div className="lp-about__inner">
            {/* Left: Campus Photo */}
            <div className="lp-about__visual">
              <div className="lp-about__img-frame">
                <Image
                  src="/unperba_campus.jpg"
                  alt="Gedung kampus Universitas Perwira Purbalingga (UNPERBA) — tulisan kuning besar UNIVERSITAS PERWIRA PURBALINGGA di depan gedung"
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  style={{ objectFit: 'cover', objectPosition: 'center 55%' }}
                />
              </div>
              {/* Floating Badge */}
              <div className="lp-about__badge" aria-hidden="true">
                <div className="lp-about__badge-icon">
                  <GraduationCap size={22} />
                </div>
                <div>
                  <div className="lp-about__badge-title">UNPERBA</div>
                  <div className="lp-about__badge-sub">Universitas Perwira M. Purbalingga</div>
                </div>
              </div>
            </div>

            {/* Right: Content */}
            <div className="lp-about__content">
              <div className="lp-section-badge">
                <Star size={13} aria-hidden="true" />
                <span>Tentang Kami</span>
              </div>
              <h2 id="about-heading" className="lp-about__title">
                Dari Kampus UNPERBA,<br />
                untuk <span className="lp-text-primary">Wirausahawan Muda</span> Indonesia
              </h2>
              <p className="lp-about__desc">
                Berlokasi di jantung kota Purbalingga, <strong>Universitas Perwira M. Purbalingga (UNPERBA)</strong> adalah kampus yang berkomitmen mencetak lulusan unggul dan berjiwa wirausaha.
              </p>
              <p className="lp-about__desc">
                Wiramart hadir sebagai unit bisnis riil di dalam kampus — sebuah ekosistem di mana mahasiswa bukan hanya belajar teori, melainkan langsung mempraktikkan manajemen ritel, keuangan digital, dan kepemimpinan organisasi.
              </p>

              <div className="lp-about__features">
                {[
                  { icon: MapPin, text: 'Jl. Letnan Kusni No. 52, Purbalingga Lor, Jawa Tengah' },
                  { icon: GraduationCap, text: 'Di bawah naungan resmi UKM Kewirausahaan UNPERBA' },
                  { icon: ShieldCheck, text: 'Sistem kasir digital terintegrasi & terverifikasi' },
                ].map(({ icon: Icon, text }, idx) => (
                  <div key={idx} className="lp-about__feature">
                    <div className="lp-about__feature-icon">
                      <Icon size={16} aria-hidden="true" />
                    </div>
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div className="lp-about__actions">
                <Link href="/daftar" className="btn btn-primary">
                  <Calendar size={16} aria-hidden="true" />
                  <span>Daftar Jadi Kasir</span>
                </Link>
                <Link href="#divisi" className="btn btn-secondary">
                  <Users size={16} aria-hidden="true" />
                  <span>Lihat 9 Divisi</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            EKOSISTEM SECTION — Feature Cards
            ═══════════════════════════════════════════════════════ */}
        <section id="ekosistem" className="lp-ecosystem" aria-labelledby="ecosystem-heading">
          <div className="lp-ecosystem__inner">
            <div className="lp-section-header">
              <div className="lp-section-badge">
                <Layers size={13} aria-hidden="true" />
                <span>Ekosistem Terintegrasi</span>
              </div>
              <h2 id="ecosystem-heading" className="lp-section-title">
                Solusi Terpadu Retail &amp; Pembinaan Kampus
              </h2>
              <p className="lp-section-desc">
                Dirancang untuk memfasilitasi kebutuhan seluruh sivitas akademika Universitas Perwira M. Purbalingga.
              </p>
            </div>

            <div className="lp-ecosystem__grid">
              {ECOSYSTEM_FEATURES.map((item, idx) => {
                const IconComp = item.icon;
                return (
                  <article key={idx} className="lp-feature-card">
                    <div className="lp-feature-card__icon">
                      <IconComp size={26} aria-hidden="true" />
                    </div>
                    <h3 className="lp-feature-card__title">{item.title}</h3>
                    <p className="lp-feature-card__desc">{item.desc}</p>
                    <div className="lp-feature-card__accent" aria-hidden="true" />
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            9 DIVISI SECTION
            ═══════════════════════════════════════════════════════ */}
        <section id="divisi" className="lp-divisions" aria-labelledby="divisions-heading">
          <div className="lp-divisions__inner">
            <div className="lp-section-header">
              <div className="lp-section-badge">
                <Layers size={13} aria-hidden="true" />
                <span>Struktur Organisasi</span>
              </div>
              <h2 id="divisions-heading" className="lp-section-title">
                9 Divisi Unit Kegiatan Mahasiswa Kewirausahaan
              </h2>
              <p className="lp-section-desc">
                Setiap divisi memegang peranan krusial dalam menggerakkan ekosistem bisnis Wiramart serta mencetak wirausahawan muda yang tangguh, adaptif, dan berdaya saing dari kampus UNPERBA.
              </p>
            </div>

            <div className="lp-divisions__grid">
              {DIVISIONS.map((divisi) => {
                const IconComp = divisi.icon;
                return (
                  <article key={divisi.id} className="lp-division-card">
                    <div className="lp-division-card__header">
                      <div className="lp-division-card__icon">
                        <IconComp size={22} aria-hidden="true" />
                      </div>
                      <div className="lp-division-card__meta">
                        <div className="lp-division-card__badges">
                          <span className="lp-division-card__num">#{divisi.number}</span>
                          <span className="lp-division-card__role">{divisi.role}</span>
                        </div>
                        <h3 className="lp-division-card__name">{divisi.name}</h3>
                      </div>
                    </div>
                    <div className="lp-division-card__divider" aria-hidden="true" />
                    <div className="lp-division-card__body">
                      <p className="lp-division-card__duties-label">Fokus &amp; Tanggung Jawab:</p>
                      <ul className="lp-division-card__duties">
                        {divisi.duties.map((duty, idx) => (
                          <li key={idx}>{duty}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            CTA SECTION — Final Call to Action
            ═══════════════════════════════════════════════════════ */}
        <section className="lp-cta" aria-labelledby="cta-heading">
          <div className="lp-cta__inner">
            {/* Background Image with overlay */}
            <div className="lp-cta__bg" aria-hidden="true">
              <Image
                src="/wiramart_showcase.jpg"
                alt=""
                fill
                sizes="100vw"
                style={{ objectFit: 'cover', objectPosition: 'center 40%' }}
              />
              <div className="lp-cta__overlay" />
            </div>

            <div className="lp-cta__content">
              <div className="lp-section-badge lp-cta__badge">
                <Sparkles size={13} aria-hidden="true" />
                <span>Bergabung Sekarang</span>
              </div>
              <h2 id="cta-heading" className="lp-cta__title">
                Mulai Terlibat di Ekosistem<br />
                Wiramart UNPERBA Sekarang
              </h2>
              <p className="lp-cta__desc">
                Baik Anda mahasiswa yang ingin mendaftar jadwal shift kasir, anggota UKM yang menjalankan proyek bisnis, ataupun dosen pembimbing yang memantau laporan.
              </p>

              <div className="lp-cta__actions">
                <Link href="/kasir/pos" className="btn btn-lg lp-cta__btn-primary">
                  <Store size={18} aria-hidden="true" />
                  <span>Buka Terminal Kasir</span>
                </Link>
                <Link href="/daftar" className="btn btn-lg lp-cta__btn-glass">
                  <Calendar size={18} aria-hidden="true" />
                  <span>Registrasi &amp; Shift Mahasiswa</span>
                </Link>
                <Link href="/login" className="btn btn-lg lp-cta__btn-outline">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <span>Portal Dosen / Admin</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="lp-footer" role="contentinfo">
        <div className="lp-footer__inner">
          <div className="lp-footer__grid">
            {/* Identity */}
            <div className="lp-footer__brand">
              <div className="lp-footer__logo">
                <div className="lp-footer__logo-img">
                  <Image
                    src="/logo.png"
                    alt="Logo Wiramart UNPERBA"
                    fill
                    sizes="36px"
                    style={{ objectFit: 'contain' }}
                  />
                </div>
                <span className="lp-footer__logo-text">WIRAMART UNPERBA</span>
              </div>
              <p className="lp-footer__brand-desc">
                Unit Kegiatan Mahasiswa Kewirausahaan & Sistem Kasir Retail Digital Universitas Perwira M. Purbalingga.
              </p>
              <div className="lp-footer__location">
                <MapPin size={14} aria-hidden="true" />
                <span>Jl. Letnan Kusni No. 52, Purbalingga Lor, Jawa Tengah</span>
              </div>
            </div>

            {/* Links */}
            <div className="lp-footer__links">
              <div className="lp-footer__link-group">
                <div className="lp-footer__link-title">Layanan Utama</div>
                <ul>
                  <li><Link href="/kasir/pos">Terminal Kasir POS</Link></li>
                  <li><Link href="/daftar">Pendaftaran &amp; Jadwal Shift</Link></li>
                  <li><Link href="/login">Masuk Portal Dosen / Admin</Link></li>
                </ul>
              </div>
              <div className="lp-footer__link-group">
                <div className="lp-footer__link-title">Navigasi</div>
                <ul>
                  <li><Link href="#tentang">Tentang Wiramart</Link></li>
                  <li><Link href="#ekosistem">Ekosistem & Fitur</Link></li>
                  <li><Link href="#divisi">9 Divisi UKM</Link></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="lp-footer__bottom">
            <div>&copy; {new Date().getFullYear()} WIRAMART — UKM Kewirausahaan UNPERBA. All rights reserved.</div>
            <div>Sistem Kasir Digital Terintegrasi</div>
          </div>
        </div>
      </footer>

      {/* ═══════════════════════════════════════════════════════
          MOBILE BOTTOM NAVIGATION — Floating Pill
          ═══════════════════════════════════════════════════════ */}
      <nav className="lp-mobile-nav" aria-label="Navigasi mobile" role="navigation">
        <div className="lp-mobile-nav__pill">
          <Link
            href="/"
            id="mobile-nav-home"
            className={`lp-mobile-nav__item${mobileNavActive === 'home' ? ' lp-mobile-nav__item--active' : ''}`}
            onClick={() => setMobileNavActive('home')}
            aria-label="Beranda"
            aria-current={mobileNavActive === 'home' ? 'page' : undefined}
          >
            <div className="lp-mobile-nav__icon-wrap">
              <Home size={20} aria-hidden="true" />
            </div>
            <span className="lp-mobile-nav__label">Beranda</span>
          </Link>

          <Link
            href="#divisi"
            id="mobile-nav-divisi"
            className={`lp-mobile-nav__item${mobileNavActive === 'divisi' ? ' lp-mobile-nav__item--active' : ''}`}
            onClick={() => setMobileNavActive('divisi')}
            aria-label="Lihat 9 Divisi"
          >
            <div className="lp-mobile-nav__icon-wrap">
              <Users size={20} aria-hidden="true" />
            </div>
            <span className="lp-mobile-nav__label">9 Divisi</span>
          </Link>

          {/* CENTER CTA — Prominent Kasir Button */}
          <Link
            href="/kasir/pos"
            id="mobile-nav-kasir"
            className="lp-mobile-nav__cta"
            aria-label="Buka Terminal Kasir POS"
            onClick={() => setMobileNavActive('kasir')}
          >
            <div className="lp-mobile-nav__cta-ring" aria-hidden="true" />
            <Store size={24} aria-hidden="true" />
            <span className="lp-mobile-nav__label">Kasir</span>
          </Link>

          <Link
            href="/daftar"
            id="mobile-nav-shift"
            className={`lp-mobile-nav__item${mobileNavActive === 'shift' ? ' lp-mobile-nav__item--active' : ''}`}
            onClick={() => setMobileNavActive('shift')}
            aria-label="Daftar Shift Kasir"
          >
            <div className="lp-mobile-nav__icon-wrap">
              <Calendar size={20} aria-hidden="true" />
            </div>
            <span className="lp-mobile-nav__label">Shift</span>
          </Link>

          <Link
            href="/login"
            id="mobile-nav-admin"
            className={`lp-mobile-nav__item${mobileNavActive === 'admin' ? ' lp-mobile-nav__item--active' : ''}`}
            onClick={() => setMobileNavActive('admin')}
            aria-label="Portal Admin atau Dosen"
          >
            <div className="lp-mobile-nav__icon-wrap">
              <LogIn size={20} aria-hidden="true" />
            </div>
            <span className="lp-mobile-nav__label">Admin</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
