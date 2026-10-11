import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminSession } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const metadata: Metadata = {
  title: 'Export Data Sistem',
};

export default async function ExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) {
    redirect('/login');
  }

  // Zero-Trust: Verifikasi role aktual dari database
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, session.sub),
    columns: { role: true },
  });

  const role = (admin?.role as 'MANAGER' | 'ADMIN_SHIFT') ?? session.adminRole ?? 'ADMIN_SHIFT';
  if (role !== 'MANAGER') {
    redirect('/admin/dashboard');
  }

  return <>{children}</>;
}
