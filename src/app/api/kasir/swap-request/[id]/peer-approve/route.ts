// =============================================================
// POST /api/kasir/swap-request/[id]/peer-approve
// Persetujuan Tukar Shift 2-Arah oleh Rekan Kerja (K4)
//
// Aturan K4: Tukar shift cukup 2 karyawan setuju (pemohon & rekan).
// Begitu rekan setujui -> jadwal otomatis bertukar (efektif),
// dan Admin mendapat notifikasi serta jendela audit/veto.
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSwapRequests, shiftSchedules, auditLogs } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const ActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(300).optional(),
});

export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'employee') {
    return apiError('Akses ditolak. Silakan login sebagai kasir.', 401);
  }

  const { id } = await ctx.params;
  const peerEmployeeId = session.sub;

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('Format JSON tidak valid.', 400); }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.flatten().fieldErrors, 422);
  }

  const { action, note } = parsed.data;

  // 1. Ambil data pengajuan swap
  const swap = await db.query.shiftSwapRequests.findFirst({
    where: and(
      eq(shiftSwapRequests.id, id),
      eq(shiftSwapRequests.peerEmployeeId, peerEmployeeId),
    ),
    with: {
      requester: { columns: { id: true, fullName: true, nim: true } },
      fromSchedule: true,
      toSchedule: true,
    },
  });

  if (!swap) {
    return apiError('Pengajuan tukar shift tidak ditemukan atau bukan ditujukan untuk Anda.', 404);
  }

  if (swap.status !== 'PENDING') {
    return apiError(`Pengajuan ini sudah berstatus ${swap.status}.`, 409);
  }

  const now = new Date();

  if (action === 'REJECT') {
    await db
      .update(shiftSwapRequests)
      .set({
        status: 'REJECTED',
        peerRejectedAt: now,
        adminNote: note ? `Ditolak rekan: ${note}` : 'Ditolak oleh rekan shift',
        updatedAt: now,
      })
      .where(eq(shiftSwapRequests.id, id));

    return apiOk({ message: 'Permintaan tukar shift berhasil ditolak.' });
  }

  // action === 'APPROVE'
  // K4: Cukup 2 karyawan setuju -> jadwal bertukar atomik di DB (FOR UPDATE anti double-approve).
  // TIDAK melakukan pre-insert attendances di masa depan agar pengganti tidak kena 409 ALREADY_ATTENDED saat absen hari H.
  try {
    await db.transaction(async (tx) => {
      const [lockedSwap] = await tx
        .select({
          id: shiftSwapRequests.id,
          status: shiftSwapRequests.status,
          requesterId: shiftSwapRequests.requesterId,
          peerEmployeeId: shiftSwapRequests.peerEmployeeId,
          fromScheduleId: shiftSwapRequests.fromScheduleId,
          toScheduleId: shiftSwapRequests.toScheduleId,
        })
        .from(shiftSwapRequests)
        .where(eq(shiftSwapRequests.id, id))
        .for('update')
        .limit(1);

      if (!lockedSwap || lockedSwap.status !== 'PENDING') {
        throw new Error('SWAP_ALREADY_PROCESSED');
      }

      // Lock ordering deterministik berdasarkan UUID agar 2 tukar shift silang tidak deadlock
      const [firstSchedId, secondSchedId] =
        lockedSwap.fromScheduleId <= lockedSwap.toScheduleId
          ? [lockedSwap.fromScheduleId, lockedSwap.toScheduleId]
          : [lockedSwap.toScheduleId, lockedSwap.fromScheduleId];

      const [firstLocked] = await tx
        .select({ id: shiftSchedules.id, employeeId: shiftSchedules.employeeId, orderInSlot: shiftSchedules.orderInSlot })
        .from(shiftSchedules)
        .where(eq(shiftSchedules.id, firstSchedId))
        .for('update')
        .limit(1);

      const [secondLocked] =
        secondSchedId !== firstSchedId
          ? await tx
              .select({ id: shiftSchedules.id, employeeId: shiftSchedules.employeeId, orderInSlot: shiftSchedules.orderInSlot })
              .from(shiftSchedules)
              .where(eq(shiftSchedules.id, secondSchedId))
              .for('update')
              .limit(1)
          : [firstLocked];

      const lockedFrom = lockedSwap.fromScheduleId === firstSchedId ? firstLocked : secondLocked;
      const lockedTo = lockedSwap.toScheduleId === firstSchedId ? firstLocked : secondLocked;

      if (
        !lockedFrom ||
        !lockedTo ||
        lockedTo.orderInSlot === 99 ||
        lockedFrom.employeeId !== lockedSwap.requesterId ||
        lockedTo.employeeId !== peerEmployeeId
      ) {
        throw new Error('SWAP_SLOT_CHANGED');
      }

      // 1. Tukar employee_id di kedua jadwal template
      await tx
        .update(shiftSchedules)
        .set({
          employeeId: lockedSwap.peerEmployeeId,
          updatedAt: now,
        })
        .where(eq(shiftSchedules.id, lockedSwap.fromScheduleId));

      await tx
        .update(shiftSchedules)
        .set({
          employeeId: lockedSwap.requesterId,
          updatedAt: now,
        })
        .where(eq(shiftSchedules.id, lockedSwap.toScheduleId));

      // 2. Update status swap request menjadi APPROVED
      await tx
        .update(shiftSwapRequests)
        .set({
          status: 'APPROVED',
          peerApprovedAt: now,
          reviewedAt: now,
          adminNote: note ? `Disetujui rekan: ${note} (K4 Auto-Swap 2-Arah)` : 'Disetujui rekan (K4 Auto-Swap 2-Arah)',
          updatedAt: now,
        })
        .where(eq(shiftSwapRequests.id, id));

      // 3. Audit log
      await tx.insert(auditLogs).values({
        action: 'UPDATE',
        tableName: 'shift_swap_requests',
        recordId: id,
        actorType: 'EMPLOYEE',
        actorId: session.sub,
        oldValues: JSON.stringify({ status: lockedSwap.status }),
        newValues: JSON.stringify({
          status: 'APPROVED',
          peerApprovedBy: session.sub,
          fromScheduleId: lockedSwap.fromScheduleId,
          toScheduleId: lockedSwap.toScheduleId,
        }),
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'SWAP_ALREADY_PROCESSED') {
      return apiError('Permintaan tukar shift ini sudah diproses sebelumnya.', 409);
    }
    if (err instanceof Error && err.message === 'SWAP_SLOT_CHANGED') {
      return apiError('Kepemilikan slot jadwal sudah berubah atau slot tidak valid untuk ditukar.', 409);
    }
    throw err;
  }

  return apiOk({
    message: 'Tukar shift berhasil disetujui! Jadwal shift telah diperbarui.',
  });
}
