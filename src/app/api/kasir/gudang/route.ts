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
import { employees, admins, products } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  getWarehouseSummary,
  getWarehouseProducts,
  getActiveWarehouseCategories,
  restockProductByWarehouse,
  getWarehouseActivityLogs,
} from '@/lib/services/warehouseService';
import { createStockReceiveDraft } from '@/lib/services/stockReceiveService';
import { AppError, getTodayWib } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// ── GET: Ambil ringkasan status stok, daftar produk FEFO, dan log aktivitas ──
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses khusus petugas toko / admin', 401);
  }

  const sessionIssuedAtMs = payload.iat ? payload.iat * 1000 : undefined;
  let actorInfo: {
    id: string;
    name: string;
    nim: string;
    jabatan: string;
    canMutateStock: boolean;
    actorRole: 'EMPLOYEE' | 'MANAGER' | 'ADMIN_SHIFT';
    sessionIssuedAtMs?: number;
  } = {
    id: payload.sub,
    name: 'Petugas Gudang',
    nim: 'GUDANG',
    jabatan: 'Gudang & Logistik',
    canMutateStock: true,
    actorRole: 'EMPLOYEE',
    sessionIssuedAtMs,
  };

  if (payload.role === 'employee') {
    const employee = await db.query.employees.findFirst({
      where: and(
        eq(employees.id, payload.sub),
        eq(employees.isActive, true),
        isNull(employees.deletedAt),
      ),
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
      canMutateStock: true,
      actorRole: 'EMPLOYEE',
      sessionIssuedAtMs,
    };
  } else if (payload.role === 'admin') {
    const adminRow = await db.query.admins.findFirst({
      where: and(
        eq(admins.id, payload.sub),
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
      ),
      columns: { id: true, fullName: true, nidn: true, role: true },
    });

    if (!adminRow) {
      return apiError('Sesi admin tidak aktif atau sudah dinonaktifkan', 403);
    }

    const isManager = adminRow.role === 'MANAGER';
    actorInfo = {
      id: adminRow.id,
      name: adminRow.fullName,
      nim: adminRow.nidn ?? 'ADMIN',
      jabatan: isManager ? 'Manager (Dosen)' : 'Admin Shift (Pantau)',
      canMutateStock: isManager,
      actorRole: isManager ? 'MANAGER' : 'ADMIN_SHIFT',
      sessionIssuedAtMs,
    };
  } else {
    return apiError('Unauthorized: Peran tidak diizinkan mengakses portal gudang', 403);
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const filterParam = searchParams.get('filter');
  const validFilters = ['semua', 'kritis', 'habis', 'fefo', 'perishable'] as const;
  const filter = validFilters.includes(filterParam as (typeof validFilters)[number])
    ? (filterParam as (typeof validFilters)[number])
    : 'semua';

  try {
    const [summary, productsResult, activities, categoriesList] = await Promise.all([
      getWarehouseSummary(),
      getWarehouseProducts({ search, filter, limit: 500 }),
      getWarehouseActivityLogs(50),
      getActiveWarehouseCategories(),
    ]);

    return apiOk({
      employee: actorInfo,
      summary,
      items: productsResult.items,
      total: productsResult.total,
      activities,
      categories: categoriesList,
    });
  } catch (error) {
    console.error('[API Gudang GET Error]:', error);
    return apiError('Gagal memuat data inventaris gudang', 500);
  }
}

// ── POST: Inbound Restock Barang Masuk oleh Petugas Gudang (Approval Manager) / Manager (Langsung) ──
const restockSchema = z.object({
  productId: z.string().uuid('ID produk tidak valid'),
  qtyAdd: z.number().int().min(1, 'Jumlah restock minimal 1').max(100_000, 'Maksimal 100.000'),
  expiryDate: z
    .string({ message: 'Tanggal kedaluwarsa wajib diisi untuk semua barang masuk' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal kedaluwarsa harus YYYY-MM-DD'),
  batchCode: z.string().max(50).optional().nullable(),
  notes: z.string().max(255).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses khusus petugas gudang / Manager', 401);
  }

  // Separation of Duty: ADMIN_SHIFT hanya akses baca (monitoring); mutasi langsung hanya MANAGER / Petugas Gudang
  if (payload.role === 'admin') {
    const adminRow = await db.query.admins.findFirst({
      where: and(
        eq(admins.id, payload.sub),
        eq(admins.isActive, true),
        isNull(admins.deletedAt),
      ),
      columns: { role: true },
    });
    if (!adminRow) {
      return apiError('Akun admin tidak aktif atau tidak ditemukan', 403);
    }
    if (adminRow.role !== 'MANAGER') {
      return apiError(
        'Akses ditolak: Admin Shift hanya memiliki akses pantau gudang (read-only). Persetujuan barang masuk/restock langsung hanya oleh Manager (Dosen).',
        403,
      );
    }
  } else {
    const employee = await db.query.employees.findFirst({
      where: and(
        eq(employees.id, payload.sub),
        eq(employees.isActive, true),
        isNull(employees.deletedAt),
      ),
      columns: { id: true },
    });
    if (!employee) {
      return apiError('Data petugas gudang tidak aktif atau tidak ditemukan', 403);
    }
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

  const todayStr = getTodayWib();
  if (parsed.data.expiryDate < todayStr) {
    return apiError(
      `Tanggal kedaluwarsa (${parsed.data.expiryDate}) sudah terlewat. Tidak dapat menerima barang kedaluwarsa.`,
      422,
    );
  }

  try {
    // 2-Layer Approval Guard (Evaluasi Pak Afif):
    // Petugas Gudang (employee) WAJIB melalui antrian Approval Manager -> stok di Kasir tidak naik sebelum di-ACC Manager!
    if (payload.role === 'employee') {
      const [prod] = await db
        .select({
          id: products.id,
          name: products.name,
          costPrice: products.costPrice,
          stockQty: products.stockQty,
          isActive: products.isActive,
        })
        .from(products)
        .where(and(eq(products.id, parsed.data.productId), isNull(products.deletedAt)))
        .limit(1);

      if (!prod || !prod.isActive) {
        return apiError('Produk tidak ditemukan atau nonaktif.', 404);
      }

      const compactDate = todayStr.replace(/-/g, '');
      const resolvedBatchCode =
        parsed.data.batchCode?.trim() ||
        `IN-${compactDate}-${String(Math.floor(1000 + Math.random() * 9000))}`;

      const draft = await createStockReceiveDraft(
        payload.sub,
        {
          supplierName: 'Restock Gudang',
          deliveryNote: parsed.data.notes?.trim()
            ? `[RESTOCK CEPAT] ${parsed.data.notes.trim()}`
            : `[RESTOCK CEPAT] Pengajuan stok masuk ${prod.name}`,
          invoiceDate: todayStr,
          autoSubmit: true,
          items: [
            {
              productId: prod.id,
              productName: prod.name,
              batchCode: resolvedBatchCode,
              qty: parsed.data.qtyAdd,
              costPrice: Number(prod.costPrice ?? 0),
              expiryDate: parsed.data.expiryDate,
              conditionNote: parsed.data.notes?.trim() || 'Pengajuan restock cepat dari portal gudang',
            },
          ],
        },
        'employee',
      );

      return apiOk(
        {
          mode: 'SUBMITTED_FOR_APPROVAL',
          draftId: draft.id,
          receiveNumber: draft.receiveNumber,
          productId: prod.id,
          productName: prod.name,
          qtyBefore: prod.stockQty,
          qtyAfter: prod.stockQty,
          qtyDiff: parsed.data.qtyAdd,
          expiryDate: parsed.data.expiryDate,
          message: `Pengajuan restock +${parsed.data.qtyAdd} ${prod.name} (#${draft.receiveNumber}) berhasil dikirim ke antrian Approval Manager. Stok di Kasir akan bertambah setelah di-ACC Manager.`,
        },
        201,
      );
    }

    // Jika pemanggil adalah MANAGER langsung -> eksekusi restock instan dengan validasi ED wajib
    const result = await restockProductByWarehouse({
      productId: parsed.data.productId,
      qtyAdd: parsed.data.qtyAdd,
      expiryDate: parsed.data.expiryDate,
      batchCode: parsed.data.batchCode,
      notes: parsed.data.notes,
      employeeId: payload.sub,
    });

    return apiOk({ ...result, mode: 'APPROVED_DIRECT' }, 201);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.statusCode);
    }
    const msg = err instanceof Error ? err.message : 'Gagal memproses restock';
    return apiError(msg, 400);
  }
}
