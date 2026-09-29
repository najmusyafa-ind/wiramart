// =============================================================
// POST /api/admin/database/restore — Restore Atomic Database
// Auth: Admin Only (requireAdmin)
// Body: BackupPayload (JSON snapshot dengan checksum SHA-256)
// Output: RestoreResultSummary
// =============================================================

import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { databaseBackupService } from '@/lib/db/backup/DatabaseBackupService';
import { backupPayloadSchema, type BackupPayload } from '@/lib/db/backup/backup.types';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdmin();

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return apiError('Format payload bukan JSON yang valid', 'INVALID_JSON', 400);
    }

    // Ekstrak payload dari body langsung atau dari wrapper { payload: ... }
    const candidateData =
      rawBody && typeof rawBody === 'object' && 'payload' in rawBody
        ? (rawBody as { payload: unknown }).payload
        : rawBody;

    const parsed = backupPayloadSchema.safeParse(candidateData);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'Struktur file backup tidak valid';
      return apiError(`[SCHEMA_MISMATCH] ${issue}`, 'VALIDATION_ERROR', 422);
    }

    const payload: BackupPayload = parsed.data;

    const adminRecord = await db.query.admins.findFirst({
      where: eq(admins.id, session.sub),
    });

    const actor = {
      id: session.sub,
      nidn: session.username,
      fullName: adminRecord?.fullName ?? 'Administrator',
    };

    const restoreSummary = await databaseBackupService.restoreBackup(payload, actor);

    return apiOk(restoreSummary, undefined, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Terjadi kegagalan saat proses restore database';
    return apiError(message, 'RESTORE_FAILED', 500);
  }
}
