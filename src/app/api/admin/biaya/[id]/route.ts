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
import { operatingExpenses, auditLogs, dailyClosings } from '@/lib/db/schema';
import { requireManager, apiOk, apiError } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DeleteSchema = z.object({
  alasan: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(200, 'Alasan maksimal 200 karakter'),
});

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireManager();
    const adminId = admin.sub;

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

    const deleted = await db.transaction(async (tx) => {
      // 1. Ambil data biaya untuk verifikasi tanggal
      const existing = await tx.query.operatingExpenses.findFirst({
        where: and(eq(operatingExpenses.id, id), isNull(operatingExpenses.deletedAt)),
        columns: { id: true, expenseDate: true },
      });

      if (!existing) return null;

      // 2. Financial Integrity Guard: Cek apakah tanggal biaya sudah terkunci di daily_closings
      const existingClosing = await tx.query.dailyClosings.findFirst({
        where: eq(dailyClosings.closingDate, existing.expenseDate),
        columns: { status: true },
      });

      if (existingClosing && (existingClosing.status === 'LOCKED' || existingClosing.status === 'AUDITED')) {
        throw new Error(
          `PERIOD_LOCKED: Tanggal ${existing.expenseDate} telah dikunci oleh Tutup Buku Harian (${existingClosing.status}). Biaya operasional tidak dapat dihapus.`,
        );
      }

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
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.statusCode);
    }
    if (err instanceof Error && err.message.startsWith('PERIOD_LOCKED:')) {
      return apiError(err.message.replace('PERIOD_LOCKED: ', ''), 403);
    }
    return apiError('Gagal menghapus biaya. Silakan coba lagi.', 500);
  }
}
