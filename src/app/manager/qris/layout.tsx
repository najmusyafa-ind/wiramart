import type { Metadata } from 'next';
import { requireManagerActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: 'Rekonsiliasi QRIS',
};

export default async function QrisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerActor();
  return <>{children}</>;
}
