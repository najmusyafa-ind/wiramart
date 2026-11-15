// =============================================================
// Smartkasir Perwira — Robots Policy (App Router)
// Selaras dengan root layout (robots: index false, follow false)
// dan menghindari enumerasi rute internal (/admin, /setup, /api).
// =============================================================

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
