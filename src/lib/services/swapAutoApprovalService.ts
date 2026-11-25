// =============================================================
// src/lib/services/swapAutoApprovalService.ts
// Auto-Checklist & Jeda 5 Menit untuk Tukar Shift ke Slot Kosong
// (Tukar 2 arah sudah otomatis disetujui saat rekan kerja menyetujui)
// Zero Cron: dieksekusi lazy & atomik saat halaman/API swap diakses.
// =============================================================

import { and, eq, isNull, lte, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  shiftSwapRequests,
  shiftSchedules,
  auditLogs,
} from '@/lib/db/schema';

export const SWAP_AUTO_APPROVE_GRACE_MS = 5 * 60 * 1000;

/**
 * Menyelesaikan pengajuan pindah shift ke SLOT KOSONG (peerEmployeeId IS NULL)
 * yang sudah melewati jeda 5 menit tanpa penolakan Admin Shift / Manager.
 */
export async function finalizeExpiredEmptySlotSwaps(): Promise<number> {
  const cutoff = new Date(Date.now() - SWAP_AUTO_APPROVE_GRACE_MS);

  const candidates = await db.query.shiftSwapRequests.findMany({
    where: and(
      eq(shiftSwapRequests.status, 'PENDING'),
      isNull(shiftSwapRequests.peerEmployeeId),
      lte(shiftSwapRequests.createdAt, cutoff),
    ),
    with: {
      fromSchedule: true,
      toSchedule: true,
    },
    limit: 15,
  });

  if (candidates.length === 0) return 0;

  let processed = 0;

  for (const swap of candidates) {
    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        const [lockedSwap] = await tx
          .select()
          .from(shiftSwapRequests)
          .where(and(eq(shiftSwapRequests.id, swap.id), eq(shiftSwapRequests.status, 'PENDING')))
          .for('update')
          .limit(1);

        if (!lockedSwap) return;

        const [fromSlot] = await tx
          .select()
          .from(shiftSchedules)
          .where(eq(shiftSchedules.id, swap.fromScheduleId))
          .for('update')
          .limit(1);

        const [toSlot] = await tx
          .select()
          .from(shiftSchedules)
          .where(eq(shiftSchedules.id, swap.toScheduleId))
          .for('update')
          .limit(1);

        // Auto-Checklist Validasi Slot Kosong
        let rejectReason: string | null = null;
        if (!fromSlot || !fromSlot.isActive || fromSlot.employeeId !== swap.requesterId) {
          rejectReason = 'Auto-Checklist gagal: Slot asal sudah tidak aktif atau berubah kepemilikan.';
        } else if (!toSlot || !toSlot.isActive) {
          rejectReason = 'Auto-Checklist gagal: Slot tujuan sudah tidak aktif.';
        } else if (toSlot.orderInSlot === 99) {
          rejectReason = 'Auto-Checklist gagal: Slot Koordinator Dosen tidak dapat diambil untuk tukar shift.';
        } else if (toSlot.employeeId !== null) {
          rejectReason = 'Auto-Checklist gagal: Slot tujuan sudah terisi mahasiswa lain.';
        } else {
          // Cek apakah pemohon sudah terjadwal di hari & jam yang sama pada slot lain
          const [dupSlot] = await tx
            .select({ id: shiftSchedules.id })
            .from(shiftSchedules)
            .where(
              and(
                eq(shiftSchedules.employeeId, swap.requesterId),
                eq(shiftSchedules.dayOfWeek, toSlot.dayOfWeek),
                eq(shiftSchedules.slotStart, toSlot.slotStart),
                eq(shiftSchedules.isActive, true),
                ne(shiftSchedules.id, fromSlot.id),
              ),
            )
            .limit(1);
          if (dupSlot) {
            rejectReason = 'Auto-Checklist gagal: Anda sudah terjadwal pada hari dan sesi yang sama.';
          }
        }

        if (rejectReason) {
          await tx
            .update(shiftSwapRequests)
            .set({
              status: 'REJECTED',
              reviewedAt: now,
              adminNote: rejectReason,
              updatedAt: now,
            })
            .where(eq(shiftSwapRequests.id, swap.id));

          await tx.insert(auditLogs).values({
            tableName: 'shift_swap_requests',
            recordId: swap.id,
            action: 'UPDATE',
            oldValues: JSON.stringify({ status: 'PENDING' }),
            newValues: JSON.stringify({
              status: 'REJECTED',
              tag: 'AUTO_REJECTED_5M',
              reason: rejectReason,
            }),
            actorType: 'SYSTEM',
            actorId: swap.requesterId,
          });
          processed += 1;
          return;
        }

        // LOLOS AUTO-CHECKLIST -> Pindahkan slot atomik (tanpa pre-insert attendances masa depan agar tidak 409 saat absen hari H)
        await tx
          .update(shiftSchedules)
          .set({ employeeId: null, updatedAt: now })
          .where(eq(shiftSchedules.id, swap.fromScheduleId));

        await tx
          .update(shiftSchedules)
          .set({ employeeId: swap.requesterId, updatedAt: now })
          .where(eq(shiftSchedules.id, swap.toScheduleId));

        await tx
          .update(shiftSwapRequests)
          .set({
            status: 'APPROVED',
            reviewedAt: now,
            adminNote: 'Disetujui otomatis (lolos Auto-Checklist slot kosong + jeda 5 menit)',
            updatedAt: now,
          })
          .where(eq(shiftSwapRequests.id, swap.id));

        await tx.insert(auditLogs).values({
          tableName: 'shift_swap_requests',
          recordId: swap.id,
          action: 'UPDATE',
          oldValues: JSON.stringify({ status: 'PENDING' }),
          newValues: JSON.stringify({
            status: 'APPROVED',
            tag: 'AUTO_APPROVED_5M',
            fromSchedule: swap.fromScheduleId,
            toSchedule: swap.toScheduleId,
          }),
          actorType: 'SYSTEM',
          actorId: swap.requesterId,
        });

        processed += 1;
      });
    } catch (err) {
      console.error(`[finalizeExpiredEmptySlotSwaps] skip ${swap.id}:`, err);
    }
  }

  return processed;
}
