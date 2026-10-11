// =============================================================
// src/app/api/kasir/gudang/route.ts
// Route Handler: Portal Petugas Gudang (Ringkasan, List FEFO, & Restock)
// NASA-Grade Decoupling: Zod DTO Validation & Delegasi ke warehouseService
// Mendukung akses sesi Karyawan Gudang maupun Admin (Manager/Admin Shift)
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { db } from '@/lib/db/client';
import { employees, admins } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  getWarehouseSummary,
  getWarehouseProducts,
  restockProductByWarehouse,
  getWarehouseActivityLogs,
} from '@/lib/services/warehouseService';

export const runtime = 'nodejs';

// ── GET: Ambil ringkasan status stok, daftar produk FEFO, dan log aktivitas ──
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses khusus petugas toko / admin', 401);
  }

  let actorInfo = {
    id: payload.sub,
    name: 'Petugas Gudang',
    nim: 'GUDANG',
    jabatan: 'Gudang & Logistik',
  };

  if (payload.role === 'employee') {
    const employee = await db.query.employees.findFirst({
      where: and(eq(employees.id, payload.sub), eq(employees.isActive, true)),
      columns: { id: true, fullName: true, nim: true, jabatan: true },
    });

    if (!employee) {
      return apiError('Data karyawan tidak ditemukan atau dinonaktifkan', 403);
    }

    actorInfo = {
      id: employee.id,
      name: employee.fullName,
      nim: employee.nim,
      jabatan: employee.jabatan ?? 'Gudang',
    };
  } else if (payload.role === 'admin') {
    const adminRow = await db.query.admins.findFirst({
      where: and(eq(admins.id, payload.sub), eq(admins.isActive, true)),
      columns: { id: true, fullName: true, nidn: true, role: true },
    });

    if (adminRow) {
      actorInfo = {
        id: adminRow.id,
        name: adminRow.fullName,
        nim: adminRow.nidn ?? 'ADMIN',
        jabatan: adminRow.role === 'MANAGER' ? 'Manager (Dosen)' : 'Admin Shift',
      };
    }
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const filterParam = searchParams.get('filter');
  const validFilters = ['semua', 'kritis', 'habis', 'fefo'] as const;
  const filter = validFilters.includes(filterParam as (typeof validFilters)[number])
    ? (filterParam as (typeof validFilters)[number])
    : 'semua';

  try {
    const [summary, productsResult, activities] = await Promise.all([
      getWarehouseSummary(),
      getWarehouseProducts({ search, filter, limit: 120 }),
      getWarehouseActivityLogs(10),
    ]);

    return apiOk({
      employee: actorInfo,
      summary,
      items: productsResult.items,
      total: productsResult.total,
      activities,
    });
  } catch (error) {
    console.error('[API Gudang GET Error]:', error);
    return apiError('Gagal memuat data inventaris gudang', 500);
  }
}

// ── POST: Inbound Restock Barang Masuk oleh Petugas Gudang / Admin ─────────
const restockSchema = z.object({
  productId: z.string().uuid('ID produk tidak valid'),
  qtyAdd: z.number().int().min(1, 'Jumlah restock minimal 1').max(100_000, 'Maksimal 100.000'),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
    .optional()
    .nullable(),
  batchCode: z.string().max(50).optional().nullable(),
  notes: z.string().max(255).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses khusus petugas toko / admin', 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON request tidak valid', 400);
  }

  const parsed = restockSchema.safeParse(body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message ?? 'Validasi input restock gagal';
    return apiError(errorMsg, 422);
  }

  try {
    const result = await restockProductByWarehouse({
      productId: parsed.data.productId,
      qtyAdd: parsed.data.qtyAdd,
      expiryDate: parsed.data.expiryDate,
      batchCode: parsed.data.batchCode,
      notes: parsed.data.notes,
      employeeId: payload.sub,
    });

    return apiOk(result, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal memproses restock';
    return apiError(msg, 400);
  }
}
