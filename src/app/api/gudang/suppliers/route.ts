// =============================================================
// src/app/api/gudang/suppliers/route.ts
// Route Handler: Daftar Supplier Aktif untuk Dropdown Form Gudang (GET)
// Wiramart v3.0 — Fase 5.4: Integrasi Manajemen Supplier
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { suppliers } from '@/lib/db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload) {
    return apiError('Unauthorized: Silakan login terlebih dahulu', 401);
  }

  try {
    const list = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        contactPerson: suppliers.contactPerson,
        phone: suppliers.phone,
      })
      .from(suppliers)
      .where(and(eq(suppliers.isActive, true), isNull(suppliers.deletedAt)))
      .orderBy(asc(suppliers.name));

    return apiOk(list);
  } catch (error) {
    console.error('[API Gudang Suppliers GET Error]:', error);
    return apiError('Gagal memuat daftar pemasok / distributor', 500);
  }
}
