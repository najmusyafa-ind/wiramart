import type { Metadata } from 'next';
import ProdukPageClient from '@/features/portal/produk/ProdukPageClient';

export const metadata: Metadata = { title: 'Produk & Stok' };

export default function AdminProdukPage() {
  return <ProdukPageClient />;
}

