import type { Metadata } from 'next';
import PortalLayoutClient from '@/features/portal/PortalLayoutClient';
import { requireManagerActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: {
    template: '%s | Manager — Smartkasir Perwira',
    default: 'Dashboard Manajer — Smartkasir Perwira',
  },
};

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireManagerActor();

  return (
    <PortalLayoutClient
      adminName={actor.adminName}
      adminRole={actor.adminRole}
      sessionIssuedAtMs={actor.sessionIssuedAtMs}
    >
      {children}
    </PortalLayoutClient>
  );
}

