import Image from 'next/image';
import Link from 'next/link';
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
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

interface DivisionItem {
  id: string;
  number: number;
  name: string;
  role: string;
  icon: typeof Users;
  duties: string[];
  badgeColor?: string;
}

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
    name: 'Divisi Pelatihan dan Inkubasi',
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
    name: 'Divisi Kreativitas dan Produksi',
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
    name: 'Divisi Pemasaran dan Branding',
    role: 'Strategi Penjualan & Citra',
    icon: Megaphone,
    duties: [
      'Menyusun dan mengeksekusi strategi promosi terukur baik online maupun offline.',
      'Mengelola media sosial resmi dan kanal pemasaran digital kampus.',
      'Membangun serta menjaga reputasi citra merek Wiramart UNPERBA.',
    ],
  },
  {
    id: 'kemitraan-eksternal',
    number: 8,
    name: 'Divisi Kemitraan dan Eksternal',
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
    name: 'Divisi Humas dan Dokumentasi',
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
    desc: 'Bukan sekadar kasir, Wiramart adalah inkubator langsung bagi mahasiswa untuk belajar manajemen stok, akuntansi ritel, dan kepemimpinan tim.',
  },
];

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* ── TOP ANNOUNCEMENT BAR ─────────────────────────────────────── */}
      <aside
        style={{
          background: 'var(--color-sidebar-bg)',
          color: 'var(--color-sidebar-text)',
          fontSize: 'var(--text-xs)',
          padding: 'var(--space-2) var(--space-4)',
          textAlign: 'center',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 'var(--space-2)',
          borderBottom: '1px solid hsl(145, 55%, 22%)',
        }}
        aria-label="Informasi Kampus"
      >
        <span
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-accent-text)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 'var(--weight-bold)',
          }}
        >
          RESMI
        </span>
        <span>Unit Kegiatan Mahasiswa Kewirausahaan — Universitas Perwira M. Purbalingga (UNPERBA)</span>
      </aside>

      {/* ── HEADER NAVIGATION ────────────────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'hsla(0, 0%, 100%, 0.88)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: 'var(--space-3) var(--space-5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          {/* Logo & Brand Identity */}
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                position: 'relative',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                background: 'var(--color-surface)',
                boxShadow: '0 2px 8px hsla(145, 63%, 32%, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Image
                src="/logo.png"
                alt="Logo Wiramart UNPERBA"
                fill
                sizes="44px"
                style={{ objectFit: 'contain', padding: '2px' }}
                priority
              />
            </div>
            <div>
              <div
                style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 'var(--weight-bold)',
                  letterSpacing: '0.04em',
                  color: 'var(--color-primary)',
                  lineHeight: 1.1,
                }}
              >
                WIRAMART
              </div>
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 'var(--weight-medium)',
                }}
              >
                UKM Kewirausahaan UNPERBA
              </div>
            </div>
          </Link>

          {/* Quick Actions */}
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
            aria-label="Menu Utama"
          >
            <Link
              href="#divisi"
              className="btn btn-ghost"
              style={{
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-2) var(--space-3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <Users size={16} aria-hidden="true" />
              <span>9 Divisi</span>
            </Link>

            <Link
              href="/daftar"
              className="btn btn-secondary"
              style={{
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-2) var(--space-3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <span>Daftar Shift</span>
            </Link>

            <Link
              href="/kasir/pos"
              className="btn btn-primary"
              style={{
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-2) var(--space-4)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                boxShadow: '0 4px 14px hsla(145, 63%, 32%, 0.25)',
              }}
            >
              <ShoppingBag size={16} aria-hidden="true" />
              <span>Buka Kasir</span>
            </Link>

            <Link
              href="/login"
              className="btn btn-ghost"
              style={{
                fontSize: 'var(--text-xs)',
                padding: 'var(--space-2) var(--space-2)',
                color: 'var(--color-text-muted)',
              }}
              title="Portal Dosen / Admin"
            >
              <span>Admin</span>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ── HERO SECTION ───────────────────────────────────────────── */}
        <section
          style={{
            position: 'relative',
            overflow: 'hidden',
            padding: 'clamp(3rem, 7vw, 6rem) var(--space-5)',
            background: 'linear-gradient(180deg, hsla(145, 30%, 96%, 0.9) 0%, var(--color-bg) 100%)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {/* Subtle Background Glows */}
          <div
            style={{
              position: 'absolute',
              top: '-15%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '650px',
              height: '350px',
              background: 'radial-gradient(circle, hsla(145, 63%, 32%, 0.08) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          />

          <div
            style={{
              maxWidth: '1100px',
              margin: '0 auto',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            {/* Pill Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-primary-light)',
                border: '1px solid hsla(145, 63%, 32%, 0.2)',
                color: 'var(--color-primary)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>Inkubator Bisnis & Digital POS Kampus</span>
            </div>

            {/* Main Headline */}
            <h1
              style={{
                fontSize: 'clamp(2.1rem, 5vw, 3.75rem)',
                fontWeight: 800,
                lineHeight: 1.15,
                color: 'var(--color-text)',
                letterSpacing: '-0.02em',
                marginBottom: 'var(--space-4)',
              }}
            >
              Pusat Wirausaha Mahasiswa &amp; Kasir Cerdas{' '}
              <span
                style={{
                  color: 'var(--color-primary)',
                  position: 'relative',
                  display: 'inline-block',
                }}
              >
                WIRAMART
              </span>
            </h1>

            {/* Sub-headline */}
            <p
              style={{
                fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.6,
                maxWidth: '780px',
                margin: '0 auto var(--space-8)',
              }}
            >
              Wiramart adalah wadah inkubasi bisnis resmi di bawah <strong>Unit Kegiatan Mahasiswa Kewirausahaan UNPERBA</strong>. 
              Mengintegrasikan operasional minimarket kampus dengan sistem kasir digital modern, absensi shift cerdas, dan pembinaan bisnis dari hulu ke hilir.
            </p>

            {/* Hero CTA Buttons */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-8)',
              }}
            >
              <Link
                href="/kasir/pos"
                className="btn btn-primary btn-lg"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-4) var(--space-6)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 'var(--text-base)',
                  boxShadow: '0 8px 20px hsla(145, 63%, 32%, 0.28)',
                }}
              >
                <Store size={20} aria-hidden="true" />
                <span>Masuk Terminal Kasir POS</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>

              <Link
                href="/daftar"
                className="btn btn-secondary btn-lg"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-4) var(--space-6)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 'var(--text-base)',
                }}
              >
                <Calendar size={18} aria-hidden="true" />
                <span>Daftar / Pilih Shift Kasir</span>
              </Link>
            </div>

            {/* Quick Metrics Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-4)',
                maxWidth: '920px',
                margin: '0 auto',
                padding: 'var(--space-5)',
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 4px 16px hsla(145, 15%, 12%, 0.04)',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-primary)' }}>
                  9 Divisi
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Struktur Organisasi UKM Terintegrasi
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-accent)' }}>
                  Realtime POS
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Barcode Scanner &amp; Multi-Payment
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-primary)' }}>
                  Anti-Bentrok
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Slot Shift Terkunci Otomatis
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--color-text)' }}>
                  UNPERBA
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Universitas Perwira M. Purbalingga
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── EKOSISTEM WIRAMART ─────────────────────────────────────── */}
        <section
          style={{
            padding: 'clamp(3rem, 6vw, 5rem) var(--space-5)',
            maxWidth: '1200px',
            margin: '0 auto',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Ekosistem Terintegrasi
            </span>
            <h2
              style={{
                fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)',
                fontWeight: 700,
                color: 'var(--color-text)',
                marginTop: 'var(--space-1)',
              }}
            >
              Solusi Terpadu Retail &amp; Pembinaan Kampus
            </h2>
            <p
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--text-base)',
                maxWidth: '640px',
                margin: 'var(--space-2) auto 0',
              }}
            >
              Dirancang untuk memfasilitasi kebutuhan seluruh sivitas akademika Universitas Perwira M. Purbalingga.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--space-5)',
            }}
          >
            {ECOSYSTEM_FEATURES.map((item, idx) => {
              const IconComp = item.icon;
              return (
                <div
                  key={idx}
                  style={{
                    background: 'var(--color-surface)',
                    padding: 'var(--space-6)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 2px 10px hsla(145, 15%, 12%, 0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-primary-light)',
                      color: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IconComp size={24} aria-hidden="true" />
                  </div>
                  <h3
                    style={{
                      fontSize: 'var(--text-lg)',
                      fontWeight: 'var(--weight-semibold)',
                      color: 'var(--color-text)',
                      marginTop: 'var(--space-1)',
                    }}
                  >
                    {item.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.6,
                    }}
                  >
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 9 DIVISI UKM KEWIRAUSAHAAN ─────────────────────────────── */}
        <section
          id="divisi"
          style={{
            padding: 'clamp(3.5rem, 7vw, 6rem) var(--space-5)',
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-10)' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-bold)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                <Layers size={14} aria-hidden="true" />
                <span>Struktur Organisasi</span>
              </div>
              <h2
                style={{
                  fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)',
                  fontWeight: 800,
                  color: 'var(--color-text)',
                  letterSpacing: '-0.01em',
                }}
              >
                9 Divisi Unit Kegiatan Mahasiswa Kewirausahaan
              </h2>
              <p
                style={{
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--text-base)',
                  maxWidth: '720px',
                  margin: 'var(--space-2) auto 0',
                  lineHeight: 1.6,
                }}
              >
                Setiap divisi memegang peranan krusial dalam menggerakkan ekosistem bisnis Wiramart serta 
                mencetak wirausahawan muda yang tangguh, adaptif, dan berdaya saing dari kampus UNPERBA.
              </p>
            </div>

            {/* Grid 9 Divisi */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 'var(--space-5)',
              }}
            >
              {DIVISIONS.map((divisi) => {
                const IconComp = divisi.icon;
                return (
                  <article
                    key={divisi.id}
                    style={{
                      background: 'var(--color-bg)',
                      border: '1.5px solid var(--color-border)',
                      borderRadius: 'var(--radius-xl)',
                      padding: 'var(--space-6)',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      boxShadow: '0 2px 8px hsla(145, 15%, 12%, 0.03)',
                    }}
                  >
                    {/* Header Divisi */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-3)',
                        marginBottom: 'var(--space-4)',
                      }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: '0 2px 6px hsla(145, 15%, 12%, 0.04)',
                        }}
                      >
                        <IconComp size={22} aria-hidden="true" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            marginBottom: '2px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              fontWeight: 'var(--weight-bold)',
                              color: 'var(--color-primary)',
                              background: 'var(--color-primary-light)',
                              padding: '1px 7px',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            #{divisi.number}
                          </span>
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            {divisi.role}
                          </span>
                        </div>
                        <h3
                          style={{
                            fontSize: 'var(--text-lg)',
                            fontWeight: 700,
                            color: 'var(--color-text)',
                            lineHeight: 1.25,
                          }}
                        >
                          {divisi.name}
                        </h3>
                      </div>
                    </div>

                    {/* Pembatas halus */}
                    <div
                      style={{
                        height: '1px',
                        background: 'var(--color-border)',
                        marginBottom: 'var(--space-4)',
                      }}
                      aria-hidden="true"
                    />

                    {/* Deskripsi Tugas */}
                    <div style={{ flex: 1 }}>
                      <p
                        style={{
                          fontSize: 'var(--text-xs)',
                          fontWeight: 'var(--weight-bold)',
                          color: 'var(--color-text-secondary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          marginBottom: 'var(--space-2)',
                        }}
                      >
                        Fokus &amp; Tanggung Jawab:
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 'var(--space-4)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-2)',
                        }}
                      >
                        {divisi.duties.map((duty, idx) => (
                          <li
                            key={idx}
                            style={{
                              fontSize: 'var(--text-sm)',
                              color: 'var(--color-text-secondary)',
                              lineHeight: 1.5,
                            }}
                          >
                            {duty}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── PORTAL AKSES KAMPUS / CALL TO ACTION ──────────────────── */}
        <section
          style={{
            padding: 'clamp(3rem, 6vw, 5rem) var(--space-5)',
            maxWidth: '1000px',
            margin: '0 auto',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, hsl(145, 63%, 28%) 0%, hsl(145, 55%, 18%) 100%)',
              color: 'var(--color-text-inverse)',
              borderRadius: 'var(--radius-xl)',
              padding: 'clamp(2.5rem, 5vw, 4rem) var(--space-6)',
              boxShadow: '0 12px 36px hsla(145, 63%, 20%, 0.3)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '-30%',
                right: '-10%',
                width: '300px',
                height: '300px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, hsla(40, 96%, 50%, 0.15) 0%, transparent 70%)',
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            />

            <h2
              style={{
                fontSize: 'clamp(1.75rem, 3vw, 2.35rem)',
                fontWeight: 800,
                marginBottom: 'var(--space-3)',
                lineHeight: 1.2,
              }}
            >
              Mulai Terlibat di Ekosistem Wiramart Sekarang
            </h2>
            <p
              style={{
                fontSize: 'var(--text-base)',
                color: 'hsla(0, 0%, 100%, 0.82)',
                maxWidth: '620px',
                margin: '0 auto var(--space-6)',
                lineHeight: 1.6,
              }}
            >
              Baik Anda mahasiswa yang ingin mendaftar jadwal shift kasir, anggota UKM yang menjalankan proyek bisnis, ataupun dosen pembimbing yang memantau laporan.
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 'var(--space-3)',
              }}
            >
              <Link
                href="/kasir/pos"
                className="btn btn-lg"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-accent-text)',
                  fontWeight: 'var(--weight-bold)',
                  padding: 'var(--space-3) var(--space-6)',
                  borderRadius: 'var(--radius-md)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  border: 'none',
                }}
              >
                <Store size={18} aria-hidden="true" />
                <span>Buka Terminal Kasir</span>
              </Link>

              <Link
                href="/daftar"
                className="btn btn-lg"
                style={{
                  background: 'hsla(0, 0%, 100%, 0.15)',
                  color: 'var(--color-text-inverse)',
                  border: '1px solid hsla(0, 0%, 100%, 0.3)',
                  padding: 'var(--space-3) var(--space-6)',
                  borderRadius: 'var(--radius-md)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <Calendar size={18} aria-hidden="true" />
                <span>Registrasi &amp; Shift Mahasiswa</span>
              </Link>

              <Link
                href="/login"
                className="btn btn-lg"
                style={{
                  background: 'transparent',
                  color: 'hsla(0, 0%, 100%, 0.9)',
                  border: '1px solid hsla(0, 0%, 100%, 0.2)',
                  padding: 'var(--space-3) var(--space-5)',
                  borderRadius: 'var(--radius-md)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <ShieldCheck size={18} aria-hidden="true" />
                <span>Portal Dosen / Admin</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer
        style={{
          background: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
          padding: 'var(--space-8) var(--space-5) var(--space-6)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'var(--space-8)',
            marginBottom: 'var(--space-8)',
          }}
        >
          {/* Identity */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                marginBottom: 'var(--space-3)',
              }}
            >
              <div style={{ width: 32, height: 32, position: 'relative' }}>
                <Image
                  src="/logo.png"
                  alt="Logo Wiramart"
                  fill
                  sizes="32px"
                  style={{ objectFit: 'contain' }}
                />
              </div>
              <span
                style={{
                  fontWeight: 'var(--weight-bold)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--color-primary)',
                }}
              >
                WIRAMART UNPERBA
              </span>
            </div>
            <p style={{ lineHeight: 1.6, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Unit Kegiatan Mahasiswa Kewirausahaan &amp; Sistem Kasir Retail Digital Universitas Perwira M. Purbalingga.
            </p>
          </div>

          {/* Akses Cepat */}
          <div>
            <div
              style={{
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-text)',
                marginBottom: 'var(--space-3)',
              }}
            >
              Layanan Utama
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <li>
                <Link href="/kasir/pos" style={{ color: 'inherit', textDecoration: 'none' }}>
                  Terminal Kasir POS
                </Link>
              </li>
              <li>
                <Link href="/daftar" style={{ color: 'inherit', textDecoration: 'none' }}>
                  Pendaftaran &amp; Jadwal Shift
                </Link>
              </li>
              <li>
                <Link href="/login" style={{ color: 'inherit', textDecoration: 'none' }}>
                  Masuk Portal Dosen / Admin
                </Link>
              </li>
            </ul>
          </div>

          {/* Kontak & Lokasi */}
          <div>
            <div
              style={{
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-text)',
                marginBottom: 'var(--space-3)',
              }}
            >
              Kampus UNPERBA
            </div>
            <p style={{ lineHeight: 1.6, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Universitas Perwira M. Purbalingga (UNPERBA)<br />
              Jl. Letnan Kusni No. 52, Purbalingga Lor, Jawa Tengah<br />
              Kantin &amp; Koperasi Kampus Wiramart
            </p>
          </div>
        </div>

        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            gap: 'var(--space-2)',
          }}
        >
          <div>
            &copy; {new Date().getFullYear()} WIRAMART — Unit Kegiatan Mahasiswa Kewirausahaan UNPERBA. All rights reserved.
          </div>
          <div>
            Sistem Kasir Digital Terintegrasi
          </div>
        </div>
      </footer>
    </div>
  );
}
