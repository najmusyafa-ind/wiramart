import type { Metadata } from 'next';
import PortalLayoutClient from '@/features/portal/PortalLayoutClient';
import { requireAdminShiftActor } from '@/features/portal/server-auth';

export const metadata: Metadata = {
  title: {
    template: '%s | Admin Shift — Smartkasir Perwira',
    default: 'Dashboard Admin Shift — Smartkasir Perwira',
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireAdminShiftActor();

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
