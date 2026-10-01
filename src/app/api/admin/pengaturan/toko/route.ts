// =============================================================
// GET  /api/admin/pengaturan/toko — Ambil info toko
// PATCH /api/admin/pengaturan/toko — Update info toko (nama, alamat, telp)
// Auth: Admin only
// Singleton row: id = 00000000-0000-0000-0000-000000000002
// =============================================================

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { qrisSettings } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// Singleton ID — sama dengan QRIS settings (satu row bersama)
const SETTINGS_SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

// ─────────────────────────────────────────────────────────────
// GET — Ambil info toko
// ─────────────────────────────────────────────────────────────
export async function GET(): Promise<Response> {
  try {
    await requireAdmin();

    const row = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, SETTINGS_SINGLETON_ID),
      columns: {
        storeName:    true,
        storeAddress: true,
        storePhone:   true,
      },
    });

    return apiOk({
      storeName:    row?.storeName    ?? '',
      storeAddress: row?.storeAddress ?? '',
      storePhone:   row?.storePhone   ?? '',
    });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Gagal mengambil info toko', 'SERVER_ERROR', 500);
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH — Update info toko
// ─────────────────────────────────────────────────────────────
const tokoSchema = z.object({
  storeName:    z.string().max(200).optional(),
  storeAddress: z.string().max(500).optional(),
  storePhone:   z.string().max(30).optional(),
});

export async function PATCH(req: Request): Promise<Response> {
  try {
    await requireAdmin();

    const body = await req.json() as unknown;
    const parsed = tokoSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('Data tidak valid', 'VALIDATION_ERROR', 422);
    }

    const { storeName, storeAddress, storePhone } = parsed.data;

    // Upsert: insert jika belum ada, update jika sudah
    await db
      .insert(qrisSettings)
      .values({
        id:           SETTINGS_SINGLETON_ID,
        storeName:    storeName    ?? null,
        storeAddress: storeAddress ?? null,
        storePhone:   storePhone   ?? null,
        updatedAt:    new Date(),
      })
      .onConflictDoUpdate({
        target: qrisSettings.id,
        set: {
          ...(storeName    !== undefined && { storeName }),
          ...(storeAddress !== undefined && { storeAddress }),
          ...(storePhone   !== undefined && { storePhone }),
          updatedAt: new Date(),
        },
      });

    return apiOk({ message: 'Info toko berhasil disimpan' });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Gagal menyimpan info toko', 'SERVER_ERROR', 500);
  }
}
