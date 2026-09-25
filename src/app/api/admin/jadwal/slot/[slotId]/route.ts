// =============================================================
// /api/admin/jadwal/slot/[slotId]
//
// GET  → Info detail slot (siapa yang menempati, dll)
// PATCH → Admin kelola slot:
//   action: 'free'     → bebaskan slot (set employee_id = NULL)
//   action: 'reassign' → pindahkan ke karyawan lain
//   action: 'swap'     → tukar slot antara dua karyawan
//
// AUTH: Admin only (requireAdmin)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// GET — Info slot detail
// ─────────────────────────────────────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slotId: string }> },
): Promise<Response> {
  try { await requireAdmin(); }
  catch { return apiError('Akses ditolak.', 'UNAUTHORIZED', 401); }

  const { slotId } = await params;

  const slot = await db
    .select({
      id:              shiftSchedules.id,
      dayOfWeek:       shiftSchedules.dayOfWeek,
      slotStart:       shiftSchedules.slotStart,
      slotEnd:         shiftSchedules.slotEnd,
      orderInSlot:     shiftSchedules.orderInSlot,
      coordinatorName: shiftSchedules.coordinatorName,
      isActive:        shiftSchedules.isActive,
      employeeId:      shiftSchedules.employeeId,
      employeeName:    employees.fullName,
      employeeNim:     employees.nim,
      employeeProdi:   employees.programStudi,
    })
    .from(shiftSchedules)
    .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .where(eq(shiftSchedules.id, slotId))
    .limit(1);

  if (!slot[0]) return apiError('Slot tidak ditemukan.', 'NOT_FOUND', 404);

  return apiOk({
    slot: {
      ...slot[0],
      isFilled: !!slot[0].employeeId,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// PATCH — Admin kelola slot (free / reassign / swap)
// ─────────────────────────────────────────────────────────────
const patchSchema = z.discriminatedUnion('action', [
  // Bebaskan slot → employee_id = NULL (karyawan bisa daftar lagi)
  z.object({ action: z.literal('free') }),
  // Pindahkan ke karyawan lain (by employeeId)
  z.object({ action: z.literal('reassign'), newEmployeeId: z.string().uuid() }),
  // Tukar slot dua karyawan (swap slot A ↔ slot B)
  z.object({ action: z.literal('swap'), targetSlotId: z.string().uuid() }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slotId: string }> },
): Promise<Response> {
  try { await requireAdmin(); }
  catch { return apiError('Akses ditolak.', 'UNAUTHORIZED', 401); }

  const { slotId } = await params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format tidak valid', 'INVALID_JSON', 400); }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Action tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  try {
    const resultMsg = await db.transaction(async (tx) => {

      // Ambil slot yang akan diubah (dengan lock)
      const [slot] = await tx
        .select()
        .from(shiftSchedules)
        .where(eq(shiftSchedules.id, slotId))
        .limit(1)
        .for('update');

      if (!slot) throw new AppError('Slot tidak ditemukan.', 'NOT_FOUND', 404);

      // ── ACTION: free ──────────────────────────────────────────
      if (parsed.data.action === 'free') {
        await tx
          .update(shiftSchedules)
          .set({ employeeId: null, updatedAt: new Date() })
          .where(eq(shiftSchedules.id, slotId));

        return `Slot ${slot.dayOfWeek} ${slot.slotStart}–${slot.slotEnd} berhasil dibebaskan. Karyawan dapat mendaftar kembali.`;
      }

      // ── ACTION: reassign ──────────────────────────────────────
      if (parsed.data.action === 'reassign') {
        const { newEmployeeId } = parsed.data;

        // Validasi: karyawan target ada
        const targetEmployee = await tx.query.employees.findFirst({
          where: and(eq(employees.id, newEmployeeId), isNull(employees.deletedAt)),
          columns: { id: true, fullName: true, nim: true },
        });
        if (!targetEmployee) {
          throw new AppError('Karyawan target tidak ditemukan.', 'EMPLOYEE_NOT_FOUND', 404);
        }

        // Cek: karyawan target tidak sedang menempati slot LAIN
        const alreadyHasSlot = await tx.query.shiftSchedules.findFirst({
          where: and(
            eq(shiftSchedules.employeeId, newEmployeeId),
            eq(shiftSchedules.isActive, true),
          ),
          columns: { id: true, dayOfWeek: true, slotStart: true, slotEnd: true },
        });

        if (alreadyHasSlot && alreadyHasSlot.id !== slotId) {
          throw new AppError(
            `${targetEmployee.fullName} sudah memiliki slot di ` +
            `${alreadyHasSlot.dayOfWeek} ${alreadyHasSlot.slotStart}–${alreadyHasSlot.slotEnd}. ` +
            `Gunakan action "swap" untuk tukar slot, atau bebaskan slot mereka dulu.`,
            'EMPLOYEE_HAS_SLOT',
            409,
          );
        }

        await tx
          .update(shiftSchedules)
          .set({ employeeId: newEmployeeId, updatedAt: new Date() })
          .where(eq(shiftSchedules.id, slotId));

        return `Slot ${slot.dayOfWeek} ${slot.slotStart}–${slot.slotEnd} ` +
               `berhasil dipindahkan ke ${targetEmployee.fullName} (NIM: ${targetEmployee.nim}).`;
      }

      // ── ACTION: swap ──────────────────────────────────────────
      if (parsed.data.action === 'swap') {
        const { targetSlotId } = parsed.data;

        if (slotId === targetSlotId) {
          throw new AppError('Tidak bisa swap slot dengan dirinya sendiri.', 'SAME_SLOT', 400);
        }

        // Ambil slot target (dengan lock)
        const [targetSlot] = await tx
          .select()
          .from(shiftSchedules)
          .where(eq(shiftSchedules.id, targetSlotId))
          .limit(1)
          .for('update');

        if (!targetSlot) throw new AppError('Slot target tidak ditemukan.', 'TARGET_NOT_FOUND', 404);

        // Tukar employee_id kedua slot
        const tempEmployeeId = slot.employeeId;

        await tx
          .update(shiftSchedules)
          .set({ employeeId: targetSlot.employeeId, updatedAt: new Date() })
          .where(eq(shiftSchedules.id, slotId));

        await tx
          .update(shiftSchedules)
          .set({ employeeId: tempEmployeeId, updatedAt: new Date() })
          .where(eq(shiftSchedules.id, targetSlotId));

        return (
          `Swap berhasil: ` +
          `${slot.dayOfWeek} ${slot.slotStart}–${slot.slotEnd} ↔ ` +
          `${targetSlot.dayOfWeek} ${targetSlot.slotStart}–${targetSlot.slotEnd}`
        );
      }

      throw new AppError('Action tidak dikenali.', 'UNKNOWN_ACTION', 400);
    });

    return apiOk({ message: resultMsg });

  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
