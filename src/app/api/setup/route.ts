// =============================================================
// POST /api/setup — Install Wizard: Buat Admin Pertama
// SECURITY RULES:
//   1. Hanya bisa diakses jika COUNT(admins) = 0
//   2. Setelah 1 admin dibuat, endpoint ini return 403 selamanya
//   3. Tidak butuh auth (karena belum ada admin)
// =============================================================

import { z } from 'zod';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { hashPassword } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

const setupSchema = z.object({
  nidn:        z.string().min(4, 'NIDN minimal 4 karakter').max(20).trim(),
  fullName:    z.string().min(3, 'Nama minimal 3 karakter').max(200).trim(),
  password:    z.string().min(6, 'Password minimal 6 karakter').max(200),
  confirmPass: z.string().min(1),
}).refine(
  (d) => d.password === d.confirmPass,
  { message: 'Konfirmasi password tidak cocok.', path: ['confirmPass'] },
);

export async function GET(): Promise<Response> {
  // Cek apakah setup masih boleh dilakukan
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(admins);

  return apiOk({ setupAvailable: count === 0, adminCount: count });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Cek ketersediaan setup (guard paling kritis)
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(admins);

  if (count > 0) {
    return apiError(
      'Setup sudah selesai. Sistem sudah memiliki admin aktif.',
      'SETUP_LOCKED',
      403,
    );
  }

  // 2. Parse + validasi
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format tidak valid', 'INVALID_JSON', 400); }

  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 'VALIDATION_ERROR', 422);
  }

  const { nidn, fullName, password } = parsed.data;

  // 3. Buat admin pertama
  const passwordHash = await hashPassword(password);

  const [newAdmin] = await db
    .insert(admins)
    .values({
      nidn,
      fullName,
      passwordHash,
      isActivated: true,  // langsung aktif (setup wizard)
      isActive:    true,
    })
    .returning({ id: admins.id, fullName: admins.fullName });

  if (!newAdmin) {
    return apiError('Gagal membuat akun admin.', 'INSERT_FAILED', 500);
  }

  return apiOk({
    message: `Selamat datang, ${newAdmin.fullName}! Akun admin berhasil dibuat. Silakan login.`,
    adminId: newAdmin.id,
  });
}
