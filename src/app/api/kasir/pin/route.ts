// =============================================================
// POST /api/kasir/pin — Atur / Ganti PIN Mandiri dari Sesi POS Aktif
// Auth: Employee JWT required (cookie sk_kasir)
// Aturan:
//   - Jika pinHash masih NULL (Opsi B1): Boleh langsung buat PIN 6–8 digit.
//   - Jika pinHash sudah ada: Wajib verifikasi currentPin + proteksi lockout 5x/15m.
// =============================================================

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, and, isNull } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PIN_REGEX = /^\d{6,8}$/;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

const kasirPinSchema = z
  .object({
    currentPin: z.string().trim().optional(),
    newPin: z.string().trim().regex(PIN_REGEX, 'PIN baru harus berupa 6 hingga 8 digit angka'),
    confirmPin: z
      .string()
      .trim()
      .regex(PIN_REGEX, 'Konfirmasi PIN harus berupa 6 hingga 8 digit angka'),
  })
  .superRefine((data, ctx) => {
    if (data.newPin !== data.confirmPin) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPin'],
        message: 'Konfirmasi PIN tidak cocok dengan PIN baru',
      });
    }
    if (data.currentPin && !PIN_REGEX.test(data.currentPin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['currentPin'],
        message: 'PIN lama harus berupa 6 hingga 8 digit angka',
      });
    }
  });

export async function POST(req: NextRequest): Promise<Response> {
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

  const parsed = kasirPinSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data PIN tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const currentPin = parsed.data.currentPin || undefined;
  const { newPin } = parsed.data;

  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.id, payload.sub as string),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: {
      id: true,
      fullName: true,
      pinHash: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
    },
  });

  if (!employee) {
    return apiError('Akun kasir tidak aktif atau tidak ditemukan', 'FORBIDDEN', 403);
  }

  const now = new Date();
  const hadPin = Boolean(employee.pinHash);

  if (employee.pinHash) {
    if (employee.pinLockedUntil && new Date(employee.pinLockedUntil) > now) {
      const diffMs = new Date(employee.pinLockedUntil).getTime() - now.getTime();
      const remainingMins = Math.max(1, Math.ceil(diffMs / 60000));
      return apiError(
        `Akses ubah PIN terkunci sementara. Coba lagi dalam ${remainingMins} menit atau minta Dosen/Pengelola mereset PIN.`,
        'PIN_LOCKED',
        423,
      );
    }

    if (!currentPin) {
      return apiError(
        'Masukkan PIN lama Anda terlebih dahulu untuk mengganti PIN.',
        'CURRENT_PIN_REQUIRED',
        422,
      );
    }

    const isMatch = await bcrypt.compare(currentPin, employee.pinHash);
    if (!isMatch) {
      const nextFailed = (employee.pinFailedAttempts || 0) + 1;
      const shouldLock = nextFailed >= MAX_PIN_ATTEMPTS;
      const lockUntil = shouldLock ? new Date(now.getTime() + PIN_LOCK_MINUTES * 60 * 1000) : null;

      await db
        .update(employees)
        .set({
          pinFailedAttempts: shouldLock ? MAX_PIN_ATTEMPTS : nextFailed,
          pinLockedUntil: lockUntil,
          updatedAt: now,
        })
        .where(eq(employees.id, employee.id));

      if (shouldLock) {
        return apiError(
          `PIN lama salah ${MAX_PIN_ATTEMPTS} kali. Perubahan PIN dikunci ${PIN_LOCK_MINUTES} menit.`,
          'PIN_LOCKED',
          423,
        );
      }

      return apiError(
        `PIN lama tidak sesuai. Sisa ${MAX_PIN_ATTEMPTS - nextFailed} percobaan.`,
        'INVALID_CURRENT_PIN',
        401,
      );
    }

    if (currentPin === newPin) {
      return apiError('PIN baru harus berbeda dari PIN lama.', 'SAME_PIN', 422);
    }
  }

  const hashedPin = await bcrypt.hash(newPin, 12);

  // Optimistic CAS guard memastikan state pinHash tidak berubah di tengah request paralel
  const condition = employee.pinHash
    ? and(eq(employees.id, employee.id), eq(employees.pinHash, employee.pinHash))
    : and(eq(employees.id, employee.id), isNull(employees.pinHash));

  const [updated] = await db
    .update(employees)
    .set({
      pinHash: hashedPin,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(condition)
    .returning({ id: employees.id });

  if (!updated) {
    return apiError(
      'Status PIN berubah secara bersamaan. Muat ulang halaman lalu coba lagi.',
      'PIN_CONFLICT',
      409,
    );
  }

  return apiOk({
    message: hadPin
      ? 'PIN login berhasil diperbarui.'
      : 'PIN pribadi berhasil dibuat! Mulai login berikutnya Anda cukup ketik NIM + PIN.',
    hasPin: true,
  });
}

