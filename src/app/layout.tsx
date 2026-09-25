import type { Metadata } from 'next';
import './globals.css';

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
