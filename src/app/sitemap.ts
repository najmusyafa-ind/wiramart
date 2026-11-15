// =============================================================
// Smartkasir Perwira — Sitemap Policy (App Router)
// Selama aplikasi bertanda noindex (layout.tsx) & Disallow: / (robots.ts),
// sitemap sengaja dikosongkan agar tidak mengekspos rute operasional internal.
// =============================================================

import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
