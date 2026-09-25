import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/utils/auth';
import AdminLayoutClient from './AdminLayoutClient';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const metadata: Metadata = {
  title: {
    template: '%s | Admin — Smartkasir Perwira',
    default: 'Dashboard Admin — Smartkasir Perwira',
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check — hanya baca cookie sk_admin
  const session = await getAdminSession();

  if (!session) {
    redirect('/login');
  }

  // Fetch admin full name
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, session.sub),
    columns: { fullName: true },
  });

  const adminName = admin?.fullName ?? 'Admin';

  return (
    <AdminLayoutClient adminName={adminName}>
      {children}
    </AdminLayoutClient>
  );
}
