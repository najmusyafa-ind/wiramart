// =============================================================
// src/app/api/admin/suppliers/route.ts
// Route Handler: Manajemen Data Supplier oleh Admin / Manager (GET, POST)
// Wiramart v3.0 — Fase 5.2 & 5.4: Supplier Management
// =============================================================

import { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/lib/db/client';
import { suppliers, admins, auditLogs } from '@/lib/db/schema';
import { eq, and, isNull, ilike, desc } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Nama pemasok minimal 2 karakter').max(200),
  contactPerson: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses khusus Admin / Manager', 401);
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status'); // 'active' | 'inactive' | 'all'

  try {
    const conditions = [isNull(suppliers.deletedAt)];

    if (search.trim()) {
      conditions.push(ilike(suppliers.name, `%${search.trim()}%`));
    }

    if (status === 'active') {
      conditions.push(eq(suppliers.isActive, true));
    } else if (status === 'inactive') {
      conditions.push(eq(suppliers.isActive, false));
    }

    const items = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        contactPerson: suppliers.contactPerson,
        phone: suppliers.phone,
        address: suppliers.address,
        notes: suppliers.notes,
        isActive: suppliers.isActive,
        createdAt: suppliers.createdAt,
        updatedAt: suppliers.updatedAt,
        creatorName: admins.fullName,
      })
      .from(suppliers)
      .leftJoin(admins, eq(suppliers.createdByAdminId, admins.id))
      .where(and(...conditions))
      .orderBy(desc(suppliers.createdAt));

    return apiOk(items);
  } catch (error) {
    console.error('[API Admin Suppliers GET Error]:', error);
    return apiError('Gagal memuat data pemasok', 500);
  }
}

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized: Akses khusus Admin / Manager', 401);
  }

  try {
    const body = await req.json();
    const data = CreateSupplierSchema.parse(body);

    const [created] = await db
      .insert(suppliers)
      .values({
        name: data.name,
        contactPerson: data.contactPerson?.trim() || null,
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        isActive: data.isActive,
        createdByAdminId: payload.sub,
      })
      .returning();

    // Catat audit log
    await db.insert(auditLogs).values({
      tableName: 'suppliers',
      recordId: created.id,
      action: 'INSERT',
      newValues: JSON.stringify(created),
      actorType: 'ADMIN',
      actorId: payload.sub,
    });

    return apiOk({
      message: `Pemasok "${created.name}" berhasil ditambahkan.`,
      data: created,
    }, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Data supplier tidak valid', 400);
    }
    console.error('[API Admin Suppliers POST Error]:', error);
    return apiError('Gagal menambahkan data pemasok', 500);
  }
}
