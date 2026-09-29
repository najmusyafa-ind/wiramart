// =============================================================
// GET /api/admin/database/backup — Unduh Snapshot Utuh Database
// Auth: Admin Only (requireAdmin)
// Output: JSON Snapshot Terverifikasi (Content-Disposition: attachment)
// =============================================================

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { admins } from '@/lib/db/schema';
import { databaseBackupService } from '@/lib/db/backup/DatabaseBackupService';
import { apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const session = await requireAdmin();
    const adminRecord = await db.query.admins.findFirst({
      where: eq(admins.id, session.sub),
    });

    const result = await databaseBackupService.createBackup({
      id: session.sub,
      nidn: session.username,
      fullName: adminRecord?.fullName ?? 'Administrator',
    });

    const jsonContent = JSON.stringify(result.payload, null, 2);

    return new NextResponse(jsonContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'X-Backup-Checksum': result.summary.checksum,
        'X-Backup-Total-Rows': String(result.summary.totalRows),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gagal membuat file backup database';
    return apiError(message, 'BACKUP_FAILED', 500);
  }
}
