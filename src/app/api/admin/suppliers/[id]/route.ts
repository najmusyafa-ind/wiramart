// =============================================================
// src/app/api/admin/suppliers/[id]/route.ts
// Route Handler: Update & Hapus Pemasok / Supplier (PATCH, DELETE)
// Wiramart v3.0 — Fase 5.2: Supplier Management
// =============================================================

import { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/lib/db/client';
import { suppliers, auditLogs } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const UpdateSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Nama pemasok minimal 2 karakter').max(200).optional(),
  contactPerson: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses khusus Admin / Manager', 401);
  }

  const { id } = await context.params;
  if (!id) return apiError('ID pemasok tidak valid', 400);

  try {
    const [existing] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);

    if (!existing) {
      return apiError('Data pemasok tidak ditemukan', 404);
    }

    const body = await req.json();
    const data = UpdateSupplierSchema.parse(body);

    const [updated] = await db
      .update(suppliers)
      .set({
        ...(data.name && { name: data.name }),
        ...(data.contactPerson !== undefined && { contactPerson: data.contactPerson?.trim() || null }),
        ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
        ...(data.address !== undefined && { address: data.address?.trim() || null }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();

    // Catat audit log
    await db.insert(auditLogs).values({
      tableName: 'suppliers',
      recordId: id,
      action: 'UPDATE',
      oldValues: JSON.stringify(existing),
      newValues: JSON.stringify(updated),
      actorType: 'ADMIN',
      actorId: payload.sub,
    });

    return apiOk({
      message: `Pemasok "${updated.name}" berhasil diperbarui.`,
      data: updated,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Data update tidak valid', 400);
    }
    console.error('[API Admin Suppliers PATCH Error]:', error);
    return apiError('Gagal memperbarui data pemasok', 500);
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses khusus Admin / Manager', 401);
  }

  const { id } = await context.params;
  if (!id) return apiError('ID pemasok tidak valid', 400);

  try {
    const [existing] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);

    if (!existing) {
      return apiError('Data pemasok tidak ditemukan', 404);
    }

    // Soft delete
    const [deleted] = await db
      .update(suppliers)
      .set({
        deletedAt: new Date(),
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();

    // Catat audit log
    await db.insert(auditLogs).values({
      tableName: 'suppliers',
      recordId: id,
      action: 'SOFT_DELETE',
      oldValues: JSON.stringify(existing),
      actorType: 'ADMIN',
      actorId: payload.sub,
    });

    return apiOk({
      message: `Pemasok "${deleted.name}" berhasil dihapus.`,
      data: deleted,
    });
  } catch (error) {
    console.error('[API Admin Suppliers DELETE Error]:', error);
    return apiError('Gagal menghapus data pemasok', 500);
  }
}
