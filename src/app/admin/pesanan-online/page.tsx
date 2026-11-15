import type { Metadata } from 'next';
import PesananOnlinePageClient from '@/features/portal/pesanan-online/PesananOnlinePageClient';

export const metadata: Metadata = { title: 'Pesanan Online' };

export default function AdminPesananOnlinePage() {
  return <PesananOnlinePageClient />;
}

