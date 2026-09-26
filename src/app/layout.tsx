import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// next/font: self-hosted, zero FOIT, tidak blokir render
// font-display: swap otomatis diaplikasikan oleh next/font
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
  preload: false, // hanya dipakai untuk kode/barcode — tidak perlu preload
});

export const metadata: Metadata = {
  title: {
    template: '%s | Wiramart UNPERBA',
    default: 'Wiramart UNPERBA — UKM Kewirausahaan & Smart Kasir',
  },
  description:
    'Wiramart — Unit Kegiatan Mahasiswa Kewirausahaan & Sistem Kasir Digital POS Universitas Perwira M. Purbalingga (UNPERBA).',
  keywords: ['Wiramart', 'UKM Kewirausahaan', 'UNPERBA', 'kasir', 'POS', 'sistem kasir'],
  authors: [{ name: 'Wiramart UNPERBA' }],
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Terapkan font variable di <html> sehingga SEMUA elemen turunan mewarisi
    // h1, h2, p, span, button, a, input — semua inherit via var(--font-sans)
    <html lang="id" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
