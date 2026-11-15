import type { Metadata } from 'next';
import { requireManagerActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: 'Export Data Sistem',
};

export default async function ExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireManagerActor();
  return <>{children}</>;
}
