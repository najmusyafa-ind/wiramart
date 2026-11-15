import type { Metadata } from 'next';
import { requireManagerActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: 'Laporan Keuangan',
};

export default async function LaporanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerActor();
  return <>{children}</>;
}
