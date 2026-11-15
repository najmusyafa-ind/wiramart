import type { NextConfig } from "next";

// ─────────────────────────────────────────────────────────────────────────────
// Content Security Policy
// Referensi: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
//
// FILOSOFI:
// - default-src 'self'          → hanya resource dari origin sendiri
// - script-src: 'unsafe-eval'  → WAJIB untuk Next.js 15 App Router (module federation)
//   Untuk menghilangkan unsafe-eval, gunakan nonce-based CSP (lebih kompleks)
// - style-src: 'unsafe-inline' → Next.js inject <style> untuk CSS-in-JS / font variables
// - img-src blob: data:         → Webcam/barcode preview pakai blob URL
// - connect-src openfoodfacts  → Barcode lookup di BarcodeScanner
// - frame-ancestors 'none'     → Proteksi clickjacking
// ─────────────────────────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
const supabaseHostPattern = '*.supabase.co *.supabase.in';

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' ${supabaseHostPattern} data: blob:;
  font-src 'self';
  connect-src 'self' ${supabaseHostPattern} https://world.openfoodfacts.org https://world.openfoodfacts.net;
  media-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ${isProd ? 'upgrade-insecure-requests;' : ''}
`.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();

const nextConfig: NextConfig = {
  // Jangan bocorkan header X-Powered-By: Next.js
  poweredByHeader: false,
  // Sembunyikan floating badge "N" Next.js dev indicator agar tidak menutupi mobile bottom nav saat testing localhost
  devIndicators: false,
  // Cegah error Cross-Origin dev resources saat diakses dari 127.0.0.1 atau localhost
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    qualities: [75, 90],
    remotePatterns: [
      {
        // Supabase Storage (foto produk, QR QRIS)
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Alternative Supabase storage URL format
        protocol: 'https',
        hostname: '*.supabase.in',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // ── Security Headers ────────────────────────────────────────
  async headers() {
    return [
      {
        // Terapkan ke SEMUA route
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: ContentSecurityPolicy,
          },
          {
            // Cegah MIME type sniffing
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Proteksi XSS (legacy browser fallback)
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            // Proteksi clickjacking (CSP frame-ancestors lebih kuat, ini fallback)
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // Referrer — jangan bocorkan URL ke third-party
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Isolasi browsing context dari tab eksternal (window.opener)
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            // Nonaktifkan DNS prefetching untuk privasi
            key: 'X-DNS-Prefetch-Control',
            value: 'off',
          },
          {
            // Permissions Policy — sintaks kurung camera=(self) wajib sesuai spec modern
            // Camera hanya diizinkan pada origin sendiri untuk barcode scanner kasir/gudang
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
          },
          ...(isProd
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
