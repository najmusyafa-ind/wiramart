// =============================================================
// Wiramart v2.0 — PWA Consumer Catalog Entry (/order)
// Server Component dengan cache 30s + SSR data hydration.
// =============================================================

import { getKatalog, type KatalogItem } from '@/features/order/katalog.service';
import KatalogClient from './KatalogClient';

export const revalidate = 30;

export default async function OrderPage() {
  let initialItems: KatalogItem[] = [];

  try {
    const catalogData = await getKatalog();
    initialItems = catalogData.items;
  } catch (err) {
    console.error('[OrderPage] Gagal mengambil katalog produk:', err);
    initialItems = [];
  }

  return <KatalogClient initialItems={initialItems} />;
}
