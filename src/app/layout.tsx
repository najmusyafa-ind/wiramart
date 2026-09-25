import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | Smartkasir Perwira',
    default: 'Smartkasir Perwira — Sistem Kasir Digital UNPERBA',
  },
  description:
    'Sistem Point of Sale (POS) digital untuk Universitas Perwira (UNPERBA). Kelola transaksi, rekap omzet, dan laporan penjualan dengan mudah.',
  keywords: ['kasir', 'POS', 'UNPERBA', 'Perwira', 'sistem kasir', 'point of sale'],
  authors: [{ name: 'Smartkasir Perwira' }],
  robots: { index: false, follow: false }, // Internal app — tidak perlu diindex search engine
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
