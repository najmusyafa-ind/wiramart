import { cache } from 'react';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { getAdminSession } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import {
  ADMIN_DASHBOARD_PATH,
  ADMIN_LOGIN_PATH,
  MANAGER_DASHBOARD_PATH,
  type PortalAdminRole,
} from '@/lib/utils/routes';

export interface VerifiedPortalActor {
  adminId: string;
  adminName: string;
  adminRole: PortalAdminRole;
  sessionIssuedAtMs?: number;
}

/**
 * Verifikasi sesi + status aktif akun pengelola langsung ke database (Zero-Trust),
 * di-deduplikasi per HTTP request via React cache() agar parent/child layout
 * tidak melakukan query DB berulang.
 */
export const getVerifiedPortalActor = cache(async (): Promise<VerifiedPortalActor | null> => {
  const session = await getAdminSession();
  if (!session) return null;

  const admin = await db.query.admins.findFirst({
    where: and(
      eq(admins.id, session.sub),
      eq(admins.isActive, true),
      isNull(admins.deletedAt),
    ),
    columns: { fullName: true, role: true },
  });

  if (!admin) return null;

  return {
    adminId: session.sub,
    adminName: admin.fullName ?? 'Admin',
    adminRole: admin.role === 'MANAGER' ? 'MANAGER' : 'ADMIN_SHIFT',
    sessionIssuedAtMs: session.iat ? session.iat * 1000 : undefined,
  };
});

export async function requirePortalActor(): Promise<VerifiedPortalActor> {
  const actor = await getVerifiedPortalActor();
  if (!actor) redirect(ADMIN_LOGIN_PATH);
  return actor;
}

export async function requireManagerActor(): Promise<VerifiedPortalActor> {
  const actor = await requirePortalActor();
  if (actor.adminRole !== 'MANAGER') redirect(ADMIN_DASHBOARD_PATH);
  return actor;
}

export async function requireAdminShiftActor(): Promise<VerifiedPortalActor> {
  const actor = await requirePortalActor();
  if (actor.adminRole === 'MANAGER') redirect(MANAGER_DASHBOARD_PATH);
  return actor;
}

