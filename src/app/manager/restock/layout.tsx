import type { Metadata } from 'next';
import { requireManagerActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: 'Restock Barcode',
};

export default async function RestockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerActor();
  return <>{children}</>;
}
