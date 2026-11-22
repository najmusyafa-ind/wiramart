// =============================================================
// PATCH  /api/admin/absensi/[id] — Koreksi status, menit telat, peran, & catatan
// DELETE /api/admin/absensi/[id] — Hapus duplikat/kesalahan input absensi
// Auth: sk_admin (MANAGER atau ADMIN_SHIFT)
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { attendances, auditLogs } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

const patchAttendanceSchema = z.object({
  status:      z.enum(['HADIR', 'TELAT', 'PENGGANTI', 'IJIN', 'TIDAK_HADIR']).optional(),
  lateMinutes: z.number().int().min(0).max(480).optional(),
  roleTask:    z.string().trim().max(50).optional(),
  notes:       z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Khusus Admin Shift atau Manager.', 403);
  }

  const { id } = await context.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return apiError('ID absensi tidak valid.', 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid.', 400);
  }

  const parsed = patchAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data koreksi tidak valid.', 422);
  }

  const existing = await db.query.attendances.findFirst({
    where: eq(attendances.id, id),
  });

  if (!existing) {
    return apiError('Catatan absensi tidak ditemukan.', 404);
  }

  const nextStatus = parsed.data.status ?? existing.status;
  const nextLate =
    nextStatus === 'HADIR' || nextStatus === 'PENGGANTI' || nextStatus === 'IJIN' || nextStatus === 'TIDAK_HADIR'
      ? 0
      : (parsed.data.lateMinutes ?? existing.lateMinutes);
  const nextRole = parsed.data.roleTask ?? existing.roleTask ?? null;
  const nextNotes = parsed.data.notes !== undefined ? parsed.data.notes : existing.notes;

  const [updated] = await db
    .update(attendances)
    .set({
      status: nextStatus,
      lateMinutes: nextLate,
      roleTask: nextRole,
      notes: nextNotes,
      isSubstitute: nextStatus === 'PENGGANTI' ? true : existing.isSubstitute,
      verificationSource: 'MANUAL_CROSSCHECK',
      recordedByAdminId: session.sub,
      updatedAt: new Date(),
    })
    .where(eq(attendances.id, id))
    .returning();

  await db
    .insert(auditLogs)
    .values({
      tableName: 'attendances',
      recordId: id,
      action: 'UPDATE',
      oldValues: JSON.stringify({
        status: existing.status,
        lateMinutes: existing.lateMinutes,
        roleTask: existing.roleTask,
        notes: existing.notes,
      }),
      newValues: JSON.stringify({
        status: nextStatus,
        lateMinutes: nextLate,
        roleTask: nextRole,
        notes: nextNotes,
      }),
      actorType: 'ADMIN',
      actorId: session.sub,
    })
    .catch(() => {});

  return apiOk({
    record: updated,
    message: 'Data absensi berhasil dikoreksi.',
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak.', 403);
  }

  const { id } = await context.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return apiError('ID absensi tidak valid.', 400);
  }

  const existing = await db.query.attendances.findFirst({
    where: eq(attendances.id, id),
  });
  if (!existing) {
    return apiError('Catatan absensi tidak ditemukan.', 404);
  }

  await db.delete(attendances).where(eq(attendances.id, id));

  await db
    .insert(auditLogs)
    .values({
      tableName: 'attendances',
      recordId: id,
      action: 'SOFT_DELETE',
      oldValues: JSON.stringify(existing),
      newValues: JSON.stringify({ deletedBy: session.sub }),
      actorType: 'ADMIN',
      actorId: session.sub,
    })
    .catch(() => {});

  return apiOk({ id, message: 'Catatan absensi berhasil dihapus.' });
}
