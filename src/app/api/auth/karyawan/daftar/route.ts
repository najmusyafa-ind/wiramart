// =============================================================
// POST /api/auth/karyawan/daftar
// Self-register karyawan (Mahasiswa UNPERBA & Mitra Luar Instansi):
//   Body: { fullName, nim, programStudi, slotId, pin?, confirmPin? }
//   - Mahasiswa UNPERBA: nim = 8 digit NIM, programStudi = Prodi UNPERBA
//   - Mitra Luar UNPERBA: nim = 10–15 digit Nomor HP, programStudi = 'Umum / Mitra Luar UNPERBA'
//   - PIN Keamanan: 6–8 digit angka (standar 8 angka), disimpan ke employees.pin_hash
//
// PROTEKSI BERLAPIS:
//   1. Slot harus kosong (employee_id IS NULL) + row-level lock
//   2. NIM / Nomor HP yang sama tidak boleh mendaftar 2x (sudah punya slot)
//   3. Satu NIM / Nomor HP hanya boleh punya 1 slot aktif
//   4. Slot tidak bisa diubah oleh karyawan sendiri — hanya admin
// ATOMIC: db.transaction() untuk race-condition safety
// =============================================================

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shiftSchedules } from '@/lib/db/schema';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { kasirAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PIN_REGEX = /^\d{6,8}$/;

const daftarSchema = z
  .object({
    fullName: z.string().min(2, 'Nama minimal 2 karakter').max(200).trim(),
    nim: z
      .string()
      .trim()
      .transform((val) => val.replace(/[\s-]/g, '').replace(/^\+62/, '0'))
      .pipe(
        z
          .string()
          .regex(
            /^\d{8,15}$/,
            'NIM harus 8 angka (contoh: 22101010) atau Nomor HP 10–15 angka (contoh: 081234567890)',
          ),
      ),
    programStudi: z.string().max(100).trim().optional().default('Umum / Mitra Luar UNPERBA'),
    slotId: z.string().uuid('Slot jadwal tidak valid'),
    pin: z.string().trim().optional(),
    confirmPin: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.pin !== undefined && data.pin !== '') {
      if (!PIN_REGEX.test(data.pin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pin'],
          message: 'PIN keamanan harus berupa 6 hingga 8 digit angka (disarankan 8 angka)',
        });
      }
      if (data.confirmPin !== undefined && data.confirmPin !== '' && data.pin !== data.confirmPin) {
        ctx.addIssue({
          code: 'custom',
          path: ['confirmPin'],
          message: 'Konfirmasi PIN tidak cocok dengan PIN baru',
        });
      }
    }
  });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format request tidak valid', 'INVALID_JSON', 400); }

  const parsed = daftarSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 'VALIDATION_ERROR', 422);
  }

  const { fullName, nim, programStudi, slotId, pin } = parsed.data;

  // Rate limit proteksi brute-force & CPU exhaustion bcrypt pada endpoint publik
  const rateCheck = kasirAuthLimiter.check(`daftar:${nim}`, true);
  if (!rateCheck.allowed) {
    return apiError(
      `Terlalu banyak percobaan pendaftaran. Silakan tunggu ${rateCheck.retryAfterSeconds} detik.`,
      'RATE_LIMITED',
      429,
    );
  }

  const hashedPin = pin ? await bcrypt.hash(pin, 10) : null;

  try {
    const result = await db.transaction(async (tx) => {

      // ──────────────────────────────────────────────────────────
      // GUARD 1: Cek NIM / Nomor HP sudah ada di DB atau belum
      // ──────────────────────────────────────────────────────────
      const existingEmployee = await tx.query.employees.findFirst({
        where: eq(employees.nim, nim),
        columns: { id: true, fullName: true, programStudi: true, deletedAt: true },
      });

      if (existingEmployee && !existingEmployee.deletedAt) {
        // Cek apakah NIM / Nomor HP ini sudah punya slot
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
          // NIM / Nomor HP sudah terdaftar DAN sudah punya slot → tolak tegas
          throw new AppError(
            `NIM / Nomor HP ${nim} sudah terdaftar di shift ${existingSlot.dayOfWeek} ` +
            `${existingSlot.slotStart}–${existingSlot.slotEnd}. ` +
            `Silakan login langsung. Jika ingin pindah shift, hubungi admin.`,
            'NIM_HAS_SLOT',
            409,
          );
        } else {
          // NIM / Nomor HP ada tapi belum punya slot (edge case: employee tanpa slot)
          throw new AppError(
            `NIM / Nomor HP ${nim} sudah terdaftar tapi belum memiliki slot shift. ` +
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
      // AKSI: Buat employee baru / re-aktivasi akun lama + klaim slot
      // ──────────────────────────────────────────────────────────
      let targetEmployeeId: string;
      let targetFullName: string;

      if (existingEmployee && existingEmployee.deletedAt) {
        // Akun sebelumnya pernah dihapus (misal akun percobaan) -> Re-aktivasi
        const [reconstituted] = await tx
          .update(employees)
          .set({
            fullName,
            programStudi,
            jabatan:          'Kasir',
            isActive:         true,
            isSelfRegistered: true,
            deletedAt:        null,
            isKetuaShift:     false,
            pinHash:          hashedPin,
            pinFailedAttempts: 0,
            pinLockedUntil:   null,
            updatedAt:        new Date(),
          })
          .where(eq(employees.id, existingEmployee.id))
          .returning({ id: employees.id, fullName: employees.fullName });

        if (!reconstituted) throw new AppError('Gagal mengaktifkan kembali akun.', 'INSERT_FAILED', 500);
        targetEmployeeId = reconstituted.id;
        targetFullName = reconstituted.fullName;
      } else {
        const [newEmployee] = await tx
          .insert(employees)
          .values({
            fullName,
            nim,
            programStudi,
            jabatan:          'Kasir',
            isActive:         true,
            isSelfRegistered: true,
            pinHash:          hashedPin,
            createdByAdminId: null,
          })
          .returning({ id: employees.id, fullName: employees.fullName });

        if (!newEmployee) throw new AppError('Gagal membuat akun.', 'INSERT_FAILED', 500);
        targetEmployeeId = newEmployee.id;
        targetFullName = newEmployee.fullName;
      }

      // Klaim slot — atomik dalam transaksi yang sama
      await tx
        .update(shiftSchedules)
        .set({ employeeId: targetEmployeeId, updatedAt: new Date() })
        .where(
          and(
            eq(shiftSchedules.id, slotId),
            isNull(shiftSchedules.employeeId), // double-check masih kosong
          ),
        );

      return {
        employeeId: targetEmployeeId,
        fullName:   targetFullName,
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
    console.error('[DAFTAR_KARYAWAN_ERROR]', err);
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
