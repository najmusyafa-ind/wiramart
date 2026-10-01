// =============================================================
// GET  /api/admin/pengaturan/operasional — Ambil settings operasional
// PATCH /api/admin/pengaturan/operasional — Update toleransi & threshold
// Auth: Admin only
// Singleton row: id = 00000000-0000-0000-0000-000000000002 (sama dgn qrisSettings)
// =============================================================

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { qrisSettings } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const SETTINGS_SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

// ─────────────────────────────────────────────────────────────
// GET — Ambil pengaturan operasional
// ─────────────────────────────────────────────────────────────
export async function GET(): Promise<Response> {
  try {
    await requireAdmin();

    const row = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, SETTINGS_SINGLETON_ID),
      columns: {
        attendanceTolerance: true,
        lowStockThreshold:   true,
      },
    });

    return apiOk({
      attendanceTolerance: row?.attendanceTolerance ?? 15,
      lowStockThreshold:   row?.lowStockThreshold   ?? 5,
    });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Gagal mengambil pengaturan operasional', 'SERVER_ERROR', 500);
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH — Update pengaturan operasional
// ─────────────────────────────────────────────────────────────
const operasionalSchema = z.object({
  attendanceTolerance: z.number().int().min(0).max(120).optional(),
  lowStockThreshold:   z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(req: Request): Promise<Response> {
  try {
    await requireAdmin();

    const body = await req.json() as unknown;
    const parsed = operasionalSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('Data tidak valid: toleransi 0–120 menit, threshold 0–9999', 'VALIDATION_ERROR', 422);
    }

    const { attendanceTolerance, lowStockThreshold } = parsed.data;

    await db
      .insert(qrisSettings)
      .values({
        id:                  SETTINGS_SINGLETON_ID,
        attendanceTolerance: attendanceTolerance ?? 15,
        lowStockThreshold:   lowStockThreshold   ?? 5,
        updatedAt:           new Date(),
      })
      .onConflictDoUpdate({
        target: qrisSettings.id,
        set: {
          ...(attendanceTolerance !== undefined && { attendanceTolerance }),
          ...(lowStockThreshold   !== undefined && { lowStockThreshold }),
          updatedAt: new Date(),
        },
      });

    return apiOk({ message: 'Pengaturan operasional berhasil disimpan' });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Gagal menyimpan pengaturan operasional', 'SERVER_ERROR', 500);
  }
}
