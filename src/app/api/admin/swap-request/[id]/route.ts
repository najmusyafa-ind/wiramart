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
  attendances,
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
  const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD

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

  // ── APPROVE: Atomik dalam 1 transaksi ────────────────────
  // Langkah:
  //   A. Update status swap request → APPROVED
  //   B. Swap employeeId di kedua shiftSchedules
  //   C. Upsert attendance PENGGANTI untuk requester di slot toSchedule
  //   D. Insert audit log
  await db.transaction(async (tx) => {
    // A. Update swap request
    await tx
      .update(shiftSwapRequests)
      .set({
        status:            'APPROVED',
        reviewedByAdminId: session.sub,
        reviewedAt:        now,
        adminNote:         adminNote ?? null,
        updatedAt:         now,
      })
      .where(eq(shiftSwapRequests.id, swapId));

    // B1. fromSchedule: clear employeeId (atau assign ke pengganti jika ada)
    // Jika toSchedule punya employeeId lain → pertukarkan
    const toScheduleCurrentEmployeeId = swapReq.toSchedule.employeeId;

    await tx
      .update(shiftSchedules)
      .set({
        employeeId: toScheduleCurrentEmployeeId ?? null, // pindahkan pemilik lama ke slot lama
        updatedAt:  now,
      })
      .where(eq(shiftSchedules.id, swapReq.fromScheduleId));

    // B2. toSchedule: assign ke requester
    await tx
      .update(shiftSchedules)
      .set({
        employeeId: swapReq.requesterId,
        updatedAt:  now,
      })
      .where(eq(shiftSchedules.id, swapReq.toScheduleId));

    // C. Upsert attendance PENGGANTI untuk requester di slot baru (hari ini)
    // ON CONFLICT DO UPDATE karena mungkin sudah ada record attendance
    await tx
      .insert(attendances)
      .values({
        employeeId:          swapReq.requesterId,
        scheduleId:          swapReq.toScheduleId,
        attendanceDate:      todayDate,
        status:              'PENGGANTI',
        notes:               `Swap dari ${swapReq.fromSchedule.dayOfWeek} ${swapReq.fromSchedule.slotStart} — disetujui Admin`,
        recordedByAdminId:   session.sub,
        fromSwapRequestId:   swapId,
      })
      .onConflictDoUpdate({
        target: [attendances.employeeId, attendances.scheduleId, attendances.attendanceDate],
        set: {
          status:            'PENGGANTI',
          notes:             `Swap disetujui Admin ${now.toISOString()}`,
          fromSwapRequestId: swapId,
          updatedAt:         now,
        },
      });

    // D. Audit log
    await tx.insert(auditLogs).values({
      tableName:  'shift_swap_requests',
      recordId:   swapId,
      action:     'UPDATE',
      oldValues:  JSON.stringify({ status: 'PENDING' }),
      newValues:  JSON.stringify({ status: 'APPROVED', fromSchedule: swapReq.fromScheduleId, toSchedule: swapReq.toScheduleId }),
      actorType:  'ADMIN',
      actorId:    session.sub,
    });
  });

  return apiOk({
    message: `Swap shift ${swapReq.requester.fullName} dari ${swapReq.fromSchedule.dayOfWeek} ke ${swapReq.toSchedule.dayOfWeek} berhasil disetujui dan jadwal telah dipertukarkan.`,
  });
}
