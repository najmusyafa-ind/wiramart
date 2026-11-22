// =============================================================
// PATCH /api/kasir/shift/koreksi-fisik
// Hitung ulang uang fisik laci (maksimal 1x) selama Jeda 5 Menit (PENDING_GRACE)
// Menangkap typo angka (mis. ketik 195 padahal 195.000) dengan jejak audit permanen.
// Auth: Employee JWT required
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import {
  MAX_GRACE_RECOUNTS,
  findActiveGraceShift,
  recalculateGraceShiftShortage,
  writeGraceAuditLog,
} from '@/lib/services/shiftShortageService';

export const runtime = 'nodejs';

const koreksiFisikSchema = z.object({
  shiftId: z.string().uuid('ID shift tidak valid').optional(),
  actualCash: z
    .number()
    .finite('Nominal tidak valid')
    .min(0, 'Saldo fisik tidak boleh negatif')
    .max(50_000_000, 'Nilai terlalu besar'),
  breakdown: z.record(z.string(), z.number()).optional(),
  reason: z.string().min(3, 'Isi alasan koreksi singkat').max(300).optional(),
});

export async function PATCH(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = koreksiFisikSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data koreksi fisik tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { actualCash, breakdown, reason } = parsed.data;
  const now = new Date();

  const graceShift = await findActiveGraceShift();
  const targetShiftId = parsed.data.shiftId ?? graceShift?.id;

  if (!targetShiftId) {
    return apiError('Tidak ada shift dalam masa jeda koreksi 5 menit.', 'NO_GRACE_SHIFT', 404);
  }

  const existing = await db.query.shifts.findFirst({
    where: eq(shifts.id, targetShiftId),
    columns: {
      id: true,
      actualCash: true,
      shortageStatus: true,
      shortageGraceUntil: true,
      shortageRecountCount: true,
    },
  });

  if (!existing || existing.shortageStatus !== 'PENDING_GRACE') {
    return apiError('Shift ini tidak sedang berada di masa jeda koreksi.', 'INVALID_STATE', 409);
  }

  if (!existing.shortageGraceUntil || now >= new Date(existing.shortageGraceUntil)) {
    return apiError('Masa jeda koreksi 5 menit sudah berakhir.', 'GRACE_EXPIRED', 409);
  }

  if (existing.shortageRecountCount >= MAX_GRACE_RECOUNTS) {
    return apiError(
      `Hitung ulang uang fisik hanya diizinkan maksimal ${MAX_GRACE_RECOUNTS} kali per shift.`,
      'RECOUNT_LIMIT_REACHED',
      422,
    );
  }

  const updated = await db
    .update(shifts)
    .set({
      actualCash: actualCash.toString(),
      ...(breakdown ? { cashBreakdownClose: breakdown } : {}),
      shortageRecountCount: sql`${shifts.shortageRecountCount} + 1`,
    })
    .where(
      and(
        eq(shifts.id, targetShiftId),
        eq(shifts.shortageStatus, 'PENDING_GRACE'),
        gt(shifts.shortageGraceUntil, now),
        lt(shifts.shortageRecountCount, MAX_GRACE_RECOUNTS),
      ),
    )
    .returning({ id: shifts.id });

  if (updated.length === 0) {
    return apiError('Koreksi tidak dapat diproses (jeda habis atau batas hitung ulang tercapai).', 'CONFLICT', 409);
  }

  await writeGraceAuditLog({
    tableName: 'shifts',
    recordId: targetShiftId,
    actorType: 'EMPLOYEE',
    actorId: payload.sub as string,
    oldValues: { actualCash: existing.actualCash },
    newValues: {
      tag: 'KOREKSI_JEDA_5M_FISIK',
      actualCash,
      reason: reason?.trim() || 'Hitung ulang fisik dalam masa jeda 5 menit',
    },
  });

  const recalc = await recalculateGraceShiftShortage(targetShiftId);

  return apiOk({
    message:
      recalc?.status === 'AUTO_VERIFIED'
        ? 'Uang fisik berhasil diperbarui dan laci sudah klop.'
        : `Uang fisik diperbarui. Sisa selisih kurang: Rp ${(recalc?.shortageAmount ?? 0).toLocaleString('id-ID')}.`,
    shiftId: targetShiftId,
    recalc,
    recountRemaining: 0,
  });
}
