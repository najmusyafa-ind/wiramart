import type { Metadata } from 'next';
import { getKasirSession } from '@/lib/utils/auth';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Kasir POS — Smartkasir Perwira',
  description: 'Sistem kasir digital UNPERBA',
};

export default async function KasirLayout({ children }: { children: React.ReactNode }) {
  // Server-side auth check — hanya baca cookie sk_kasir
  const session = await getKasirSession();
  if (!session) {
    redirect('/kasir/login');
  }

  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      {children}
    </div>
  );
}
