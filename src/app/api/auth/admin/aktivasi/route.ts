// =============================================================
// POST /api/auth/admin/register — Registrasi Mandiri Dosen
// Body: { nidn, fullName, password, confirmPassword }
// → DB kosong → dosen daftar sendiri → langsung aktif
// Developer hanya memantau di Supabase (tidak input data)
// =============================================================

import { z } from 'zod';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { getAdminSession, hashPassword } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { adminAuthLimiter } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';

const registerSchema = z.object({
  nidn:            z.string()
                    .min(4, 'NIDN/NIDK minimal 4 karakter')
                    .max(20)
                    .trim(),
  fullName:        z.string()
                    .min(3, 'Nama minimal 3 karakter')
                    .max(200)
                    .trim(),
  password:        z.string().min(6, 'Password minimal 6 karakter').max(200),
  confirmPassword: z.string().min(1),
}).refine(
  (d) => d.password === d.confirmPassword,
  { message: 'Konfirmasi password tidak cocok.', path: ['confirmPassword'] },
);

export async function POST(request: Request): Promise<Response> {
  // Zero-Trust Guard: registrasi admin hanya boleh saat DB kosong (bootstrap) ATAU oleh MANAGER aktif
  const [{ count: existingAdminCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(admins)
    .where(isNull(admins.deletedAt));

  if (existingAdminCount > 0) {
    const session = await getAdminSession();
    if (!session || session.adminRole !== 'MANAGER') {
      return apiError(
        'Pendaftaran akun pengelola baru terkunci. Hanya Manager (Dosen) aktif yang dapat menambahkan akun.',
        'FORBIDDEN',
        403,
      );
    }
    const activeMgr = await db.query.admins.findFirst({
      where: and(
        eq(admins.id, session.sub),
        eq(admins.role, 'MANAGER'),
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
      ),
      columns: { id: true },
    });
    if (!activeMgr) {
      return apiError('Sesi Manager tidak aktif.', 'FORBIDDEN', 403);
    }
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format tidak valid', 'INVALID_JSON', 400); }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 'VALIDATION_ERROR', 422);
  }

  const { nidn, fullName, password } = parsed.data;
  const rateKey = `admin-aktivasi:${nidn}`;
  const rateCheck = adminAuthLimiter.check(rateKey, false);
  if (!rateCheck.allowed) {
    return apiError(
      `Terlalu banyak percobaan. Coba lagi dalam ${rateCheck.retryAfterSeconds} detik.`,
      'RATE_LIMITED',
      429,
    );
  }
  adminAuthLimiter.check(rateKey, true);

  // Cek NIDN belum terdaftar
  const existing = await db.query.admins.findFirst({
    where: or(eq(admins.nidn, nidn), eq(admins.nidk, nidn)),
    columns: { id: true },
  });

  if (existing) {
    return apiError(
      `NIDN/NIDK ${nidn} sudah terdaftar. Jika ini milikmu, silakan login langsung atau gunakan fitur Lupa Password.`,
      'NIDN_EXISTS',
      409,
    );
  }

  const passwordHash = await hashPassword(password);

  const [newAdmin] = await db
    .insert(admins)
    .values({
      nidn,
      fullName,
      passwordHash,
      isActivated: true,   // langsung aktif — tidak perlu aktivasi lagi
      isActive:    true,
    })
    .returning({ id: admins.id, fullName: admins.fullName });

  if (!newAdmin) {
    return apiError('Gagal membuat akun. Coba lagi.', 'INSERT_FAILED', 500);
  }

  return apiOk({
    message: `Selamat datang, ${newAdmin.fullName}! Akun berhasil dibuat. Silakan login.`,
    fullName: newAdmin.fullName,
  });
}
