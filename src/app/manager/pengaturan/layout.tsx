import type { Metadata } from 'next';
import { requireManagerActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: 'Pengaturan Sistem',
};

export default async function PengaturanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerActor();
  return <>{children}</>;
}
