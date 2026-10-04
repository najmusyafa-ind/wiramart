// =============================================================
// DELETE /api/admin/biaya/[id] — Hapus biaya (SOFT-DELETE)
// Body: { alasan: string (5–200) }
// Auth: Admin only. Baris tidak pernah di-hard-delete; pelaku + alasan wajib
// (juga dijaga CHECK constraint di DB) dan tercatat di audit_logs.
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { operatingExpenses, auditLogs } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DeleteSchema = z.object({
  alasan: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(200, 'Alasan maksimal 200 karakter'),
});

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  const adminId = payload.sub as string;

  const { id } = await params;
  if (!UUID_RE.test(id)) return apiError('ID biaya tidak valid', 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 400);
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 422);
  }
  const { alasan } = parsed.data;

  try {
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(operatingExpenses)
        .set({ deletedAt: new Date(), deletedByAdminId: adminId, deleteReason: alasan })
        .where(and(eq(operatingExpenses.id, id), isNull(operatingExpenses.deletedAt)))
        .returning({
          id:          operatingExpenses.id,
          expenseDate: operatingExpenses.expenseDate,
          category:    operatingExpenses.category,
          description: operatingExpenses.description,
          amount:      operatingExpenses.amount,
        });
      if (!row) return null;

      await tx.insert(auditLogs).values({
        tableName: 'operating_expenses',
        recordId:  row.id,
        action:    'SOFT_DELETE',
        oldValues: JSON.stringify(row),
        newValues: JSON.stringify({ deleteReason: alasan }),
        actorType: 'ADMIN',
        actorId:   adminId,
      });
      return row;
    });

    if (!deleted) return apiError('Biaya tidak ditemukan atau sudah dihapus', 404);
    return apiOk({ id: deleted.id });
  } catch {
    return apiError('Gagal menghapus biaya. Silakan coba lagi.', 500);
  }
}
