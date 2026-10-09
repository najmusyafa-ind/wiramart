// =============================================================
// GET /api/maintenance/status — Maintenance mode check
// Called by middleware (lightweight — no auth required)
// POST /api/maintenance/status — Toggle maintenance mode (Admin only)
// =============================================================

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { maintenanceSettings } from '@/lib/db/schema';
import { requireManager } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// Singleton maintenance settings ID (seeded saat init)
const MAINTENANCE_ID = '00000000-0000-0000-0000-000000000001';

export async function GET(request: Request): Promise<Response> {
  // Lightweight check for middleware — skip heavy auth
  const isMiddlewareCheck = request.headers.get('x-middleware-check') === '1';

  try {
    const settings = await db.query.maintenanceSettings.findFirst({
      where: eq(maintenanceSettings.id, MAINTENANCE_ID),
      columns: { isMaintenance: true, maintenanceMessage: true },
    });

    return Response.json(
      {
        isMaintenance: settings?.isMaintenance ?? false,
        message: settings?.maintenanceMessage ?? 'Sistem sedang dalam pemeliharaan.',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    // If DB is down, don't block — assume not in maintenance
    if (isMiddlewareCheck) {
      return Response.json({ isMaintenance: false });
    }
    return apiError('Gagal membaca status maintenance', 'DB_ERROR', 503);
  }
}

const toggleSchema = z.object({
  isMaintenance: z.boolean(),
  message: z.string().max(500).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireManager();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('Format request tidak valid', 'INVALID_JSON', 400);
    }

    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('Data tidak valid', 'VALIDATION_ERROR', 422, parsed.error.format());
    }

    const { isMaintenance, message } = parsed.data;

    // Upsert singleton row
    await db
      .insert(maintenanceSettings)
      .values({
        id: MAINTENANCE_ID,
        isMaintenance,
        maintenanceMessage: message ?? null,
        toggledByAdminId: session.sub,
        toggledAt: new Date(),
      })
      .onConflictDoUpdate({
        target: maintenanceSettings.id,
        set: {
          isMaintenance,
          maintenanceMessage: message ?? null,
          toggledByAdminId: session.sub,
          toggledAt: new Date(),
          updatedAt: new Date(),
        },
      });

    // Set cookie 'sk_maintenance' agar middleware bisa cek tanpa fetch internal
    const response = apiOk({
      isMaintenance,
      message: isMaintenance
        ? 'Maintenance mode diaktifkan'
        : 'Maintenance mode dinonaktifkan',
    });

    const cookieHeader = isMaintenance
      ? `sk_maintenance=1; Path=/; HttpOnly; SameSite=Lax`
      : `sk_maintenance=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

    response.headers.append('Set-Cookie', cookieHeader);
    return response;
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server', 'INTERNAL_ERROR', 500);
  }
}

