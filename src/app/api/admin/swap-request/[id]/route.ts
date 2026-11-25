// =============================================================
// PATCH /api/admin/swap-request/[id] — Approve atau Reject
// Auth: sk_admin
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  shiftSwapRequests,
  shiftSchedules,
  auditLogs,
} from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

const reviewSchema = z.object({
  action:    z.enum(['APPROVE', 'REJECT'], { message: 'Action harus APPROVE atau REJECT' }),
  adminNote: z.string().max(500).trim().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin.', 403);
  }

  const { id: swapId } = await params;
  if (!swapId?.match(/^[0-9a-f-]{36}$/i)) {
    return apiError('ID swap request tidak valid.', 422);
  }

  // Parse body
  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Format request tidak valid.', 400); }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.format(), 422);
  }

  const { action, adminNote } = parsed.data;

  // Ambil swap request
  const swapReq = await db.query.shiftSwapRequests.findFirst({
    where: eq(shiftSwapRequests.id, swapId),
    with: {
      fromSchedule: true,
      toSchedule:   true,
      requester:    { columns: { id: true, fullName: true, nim: true } },
    },
  });

  if (!swapReq) return apiError('Swap request tidak ditemukan.', 404);
  if (swapReq.status !== 'PENDING') {
    return apiError(`Request ini sudah berstatus ${swapReq.status}. Tidak bisa diubah lagi.`, 409);
  }

  const now = new Date();

  if (action === 'REJECT') {
    // ── REJECT: Hanya update status ──────────────────────────
    await db
      .update(shiftSwapRequests)
      .set({
        status:              'REJECTED',
        reviewedByAdminId:   session.sub,
        reviewedAt:          now,
        adminNote:           adminNote ?? null,
        updatedAt:           now,
      })
      .where(eq(shiftSwapRequests.id, swapId));

    return apiOk({
      message: `Pengajuan swap dari ${swapReq.requester.fullName} telah ditolak.`,
    });
  }

  // ── APPROVE: Atomik dalam 1 transaksi (FOR UPDATE anti double-approve, tanpa pre-insert attendances masa depan) ─
  try {
    await db.transaction(async (tx) => {
      const [lockedSwap] = await tx
        .select({
          id: shiftSwapRequests.id,
          status: shiftSwapRequests.status,
          requesterId: shiftSwapRequests.requesterId,
          fromScheduleId: shiftSwapRequests.fromScheduleId,
          toScheduleId: shiftSwapRequests.toScheduleId,
        })
        .from(shiftSwapRequests)
        .where(eq(shiftSwapRequests.id, swapId))
        .for('update')
        .limit(1);

      if (!lockedSwap || lockedSwap.status !== 'PENDING') {
        throw new Error('SWAP_ALREADY_PROCESSED');
      }

      const [lockedTo] = await tx
        .select({ id: shiftSchedules.id, employeeId: shiftSchedules.employeeId, orderInSlot: shiftSchedules.orderInSlot })
        .from(shiftSchedules)
        .where(eq(shiftSchedules.id, lockedSwap.toScheduleId))
        .for('update')
        .limit(1);

      if (!lockedTo || lockedTo.orderInSlot === 99) {
        throw new Error('SWAP_INVALID_SLOT');
      }

      // A. Update swap request secara atomik dengan guard PENDING
      await tx
        .update(shiftSwapRequests)
        .set({
          status:            'APPROVED',
          reviewedByAdminId: session.sub,
          reviewedAt:        now,
          adminNote:         adminNote ?? null,
          updatedAt:         now,
        })
        .where(and(eq(shiftSwapRequests.id, swapId), eq(shiftSwapRequests.status, 'PENDING')));

      // B. Tukar employeeId di kedua shiftSchedules (gunakan nilai terkunci terbaru)
      const toScheduleCurrentEmployeeId = lockedTo.employeeId;

      await tx
        .update(shiftSchedules)
        .set({
          employeeId: toScheduleCurrentEmployeeId ?? null,
          updatedAt:  now,
        })
        .where(eq(shiftSchedules.id, lockedSwap.fromScheduleId));

      await tx
        .update(shiftSchedules)
        .set({
          employeeId: lockedSwap.requesterId,
          updatedAt:  now,
        })
        .where(eq(shiftSchedules.id, lockedSwap.toScheduleId));

      // C. Audit log (tidak melakukan pre-insert attendances agar pengganti tetap absen normal di hari H tanpa 409)
      await tx.insert(auditLogs).values({
        tableName:  'shift_swap_requests',
        recordId:   swapId,
        action:     'UPDATE',
        oldValues:  JSON.stringify({ status: 'PENDING' }),
        newValues:  JSON.stringify({
          status: 'APPROVED',
          fromSchedule: lockedSwap.fromScheduleId,
          toSchedule: lockedSwap.toScheduleId,
          swappedWithEmployeeId: toScheduleCurrentEmployeeId,
        }),
        actorType:  'ADMIN',
        actorId:    session.sub,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'SWAP_ALREADY_PROCESSED') {
      return apiError('Permintaan swap ini sudah diproses pada sesi lain.', 409);
    }
    if (err instanceof Error && err.message === 'SWAP_INVALID_SLOT') {
      return apiError('Slot tujuan tidak valid atau merupakan slot Koordinator Dosen.', 422);
    }
    throw err;
  }

  return apiOk({
    message: `Swap shift ${swapReq.requester.fullName} dari ${swapReq.fromSchedule.dayOfWeek} ke ${swapReq.toSchedule.dayOfWeek} berhasil disetujui dan jadwal telah dipertukarkan.`,
  });
}
