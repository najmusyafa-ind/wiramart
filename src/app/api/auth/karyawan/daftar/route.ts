// =============================================================
// POST /api/auth/karyawan/daftar
// Self-register karyawan (mahasiswa/siswi):
//   Body: { fullName, nim, programStudi, slotId }
//
// PROTEKSI BERLAPIS:
//   1. Slot harus kosong (employee_id IS NULL) + row-level lock
//   2. NIM yang sama tidak boleh mendaftar 2x (sudah punya slot)
//   3. Satu NIM hanya boleh punya 1 slot aktif
//   4. Slot tidak bisa diubah oleh karyawan sendiri — hanya admin
// ATOMIC: db.transaction() untuk race-condition safety
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shiftSchedules } from '@/lib/db/schema';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const daftarSchema = z.object({
  fullName:     z.string().min(2, 'Nama minimal 2 karakter').max(200).trim(),
  nim:          z.string()
                  .regex(/^\d{8}$/, 'NIM harus tepat 8 angka (contoh: 22101010)')
                  .trim(),
  programStudi: z.string().max(100).trim().optional().default('Umum'),
  slotId:       z.string().uuid('Slot jadwal tidak valid'),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format request tidak valid', 'INVALID_JSON', 400); }

  const parsed = daftarSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 'VALIDATION_ERROR', 422);
  }

  const { fullName, nim, programStudi, slotId } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {

      // ──────────────────────────────────────────────────────────
      // GUARD 1: Cek NIM sudah ada di DB atau belum
      // ──────────────────────────────────────────────────────────
      const existingEmployee = await tx.query.employees.findFirst({
        where: and(
          eq(employees.nim, nim),
          isNull(employees.deletedAt),
        ),
        columns: { id: true, fullName: true, programStudi: true },
      });

      if (existingEmployee) {
        // Cek apakah NIM ini sudah punya slot
        const existingSlot = await tx.query.shiftSchedules.findFirst({
          where: and(
            eq(shiftSchedules.employeeId, existingEmployee.id),
            eq(shiftSchedules.isActive, true),
          ),
          columns: {
            dayOfWeek: true,
            slotStart: true,
            slotEnd: true,
          },
        });

        if (existingSlot) {
          // NIM sudah terdaftar DAN sudah punya slot → tolak tegas
          throw new AppError(
            `NIM ${nim} sudah terdaftar di shift ${existingSlot.dayOfWeek} ` +
            `${existingSlot.slotStart}–${existingSlot.slotEnd}. ` +
            `Silakan login langsung. Jika ingin pindah shift, hubungi admin.`,
            'NIM_HAS_SLOT',
            409,
          );
        } else {
          // NIM ada tapi belum punya slot (edge case: employee tanpa slot)
          throw new AppError(
            `NIM ${nim} sudah terdaftar tapi belum memiliki slot shift. ` +
            `Silakan login dan hubungi admin untuk pengaturan jadwal.`,
            'NIM_EXISTS_NO_SLOT',
            409,
          );
        }
      }

      // ──────────────────────────────────────────────────────────
      // GUARD 2: Cek target slot masih kosong + row-level lock
      //          (cegah race condition 2 orang klaim slot bersamaan)
      // ──────────────────────────────────────────────────────────
      const [slot] = await tx
        .select()
        .from(shiftSchedules)
        .where(
          and(
            eq(shiftSchedules.id, slotId),
            eq(shiftSchedules.isActive, true),
            isNull(shiftSchedules.employeeId),      // harus kosong
          ),
        )
        .limit(1)
        .for('update');                              // row-level lock

      if (!slot) {
        throw new AppError(
          'Slot ini sudah diambil orang lain atau tidak tersedia. Pilih slot lain.',
          'SLOT_TAKEN',
          409,
        );
      }

      // ──────────────────────────────────────────────────────────
      // GUARD 3: Slot koordinator (order = 99) tidak bisa diklaim
      // ──────────────────────────────────────────────────────────
      if (slot.orderInSlot === 99) {
        throw new AppError(
          'Slot ini adalah slot koordinator dosen, tidak bisa diklaim.',
          'SLOT_COORDINATOR',
          403,
        );
      }

      // ──────────────────────────────────────────────────────────
      // AKSI: Buat employee baru + klaim slot (dalam 1 transaksi)
      // ──────────────────────────────────────────────────────────
      const [newEmployee] = await tx
        .insert(employees)
        .values({
          fullName,
          nim,
          programStudi,
          jabatan:          'Kasir',
          isActive:         true,
          isSelfRegistered: true,
          createdByAdminId: null,
        })
        .returning({ id: employees.id, fullName: employees.fullName });

      if (!newEmployee) throw new AppError('Gagal membuat akun.', 'INSERT_FAILED', 500);

      // Klaim slot — atomik dalam transaksi yang sama
      await tx
        .update(shiftSchedules)
        .set({ employeeId: newEmployee.id, updatedAt: new Date() })
        .where(
          and(
            eq(shiftSchedules.id, slotId),
            isNull(shiftSchedules.employeeId), // double-check masih kosong
          ),
        );

      return {
        employeeId: newEmployee.id,
        fullName:   newEmployee.fullName,
        slotDay:    slot.dayOfWeek,
        slotStart:  slot.slotStart,
        slotEnd:    slot.slotEnd,
      };
    });

    return apiOk({
      message: `Selamat, ${result.fullName}! Berhasil terdaftar di shift ` +
               `${result.slotDay} ${result.slotStart}–${result.slotEnd}. ` +
               `Slot ini sudah terkunci. Untuk pergeseran jadwal, hubungi admin.`,
      ...result,
      info: 'Slot terkunci setelah diklaim. Perubahan jadwal hanya bisa dilakukan oleh admin.',
    });

  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
