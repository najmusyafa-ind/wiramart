// =============================================================
// PATCH /api/admin/shifts/[id]/shortage-override
// Pembatalan atau pengaktifan ulang potongan tekor shift setelah lewat Jeda 5 Menit
// Auth: sk_admin (MANAGER atau ADMIN_SHIFT — agar operasional mahasiswa tidak macet)
// Wajib menyertakan alasan tertulis; tercatat permanen di audit_logs.
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { writeGraceAuditLog } from '@/lib/services/shiftShortageService';

export const runtime = 'nodejs';

const overrideSchema = z.object({
  action: z.enum(['CANCEL_DEDUCTION', 'RESTORE_DEDUCTION']),
  reason: z.string().trim().min(5, 'Alasan wajib diisi minimal 5 karakter').max(400),
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
    return apiError('ID shift tidak valid.', 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid.', 400);
  }

  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid.', 422);
  }

  const existing = await db.query.shifts.findFirst({
    where: eq(shifts.id, id),
    columns: {
      id: true,
      shortageStatus: true,
      shortageAmount: true,
      shortageOverrideReason: true,
    },
  });

  if (!existing) {
    return apiError('Shift tidak ditemukan.', 404);
  }

  const now = new Date();
  const nextStatus = parsed.data.action === 'CANCEL_DEDUCTION' ? 'OVERRIDDEN' : 'AUTO_LOCKED';

  await db
    .update(shifts)
    .set({
      shortageStatus: nextStatus,
      shortageGraceUntil: null,
      shortageOverrideReason: parsed.data.reason,
      shortageOverrideByAdminId: session.sub,
      shortageOverrideAt: now,
    })
    .where(eq(shifts.id, id));

  await writeGraceAuditLog({
    tableName: 'shifts',
    recordId: id,
    actorType: 'ADMIN',
    actorId: session.sub,
    oldValues: {
      shortageStatus: existing.shortageStatus,
      shortageAmount: existing.shortageAmount,
    },
    newValues: {
      tag: 'SHORTAGE_OVERRIDE',
      action: parsed.data.action,
      shortageStatus: nextStatus,
      reason: parsed.data.reason,
      adminRole: session.adminRole ?? 'ADMIN_SHIFT',
    },
  });

  return apiOk({
    shiftId: id,
    shortageStatus: nextStatus,
    reason: parsed.data.reason,
    message:
      nextStatus === 'OVERRIDDEN'
        ? 'Selisih ditandai wajar (bebas potong gaji) dan dicatat di log audit.'
        : 'Potongan tekor resmi diterapkan dan dicatat di log audit.',
  });
}
