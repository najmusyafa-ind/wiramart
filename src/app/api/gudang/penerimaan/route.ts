// =============================================================
// src/app/api/gudang/penerimaan/route.ts
// Route Handler: Antrian Penerimaan Barang (GET) & Buat Draft Baru (POST)
// STANDAR: NASA-Grade Decoupling (≤ 50 baris controller), Zero-Trust Anti-IDOR
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  createStockReceiveDraft,
  getStockReceiveDrafts,
  getSupplierInvoiceTableRows,
  CreateStockReceiveDraftSchema,
} from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';
import { z, ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GetPenerimaanQuerySchema = z.object({
  status: z.string().max(50).optional(),
  view: z.enum(['drafts', 'table']).optional().default('drafts'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(300).default(20),
});

// ── GET: Ambil Daftar Penerimaan Barang / Tabel Buku Nota Lengkap ──
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  const { searchParams } = new URL(req.url);
  const rawParams: Record<string, string> = {};
  searchParams.forEach((val, key) => {
    if (val) rawParams[key] = val;
  });

  const parsed = GetPenerimaanQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return apiError(
      `Parameter tidak valid: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      400
    );
  }

  const { status, view, page, limit } = parsed.data;
  const employeeId = payload.role === 'employee' ? payload.sub : undefined;

  try {
    if (view === 'table') {
      const tableRows = await getSupplierInvoiceTableRows({
        employeeId,
        status,
        limit,
      });
      return apiOk({ items: tableRows });
    }

    const data = await getStockReceiveDrafts({
      employeeId,
      status,
      page,
      limit,
    });
    return apiOk(data);
  } catch (error) {
    if (error instanceof AppError) return apiError(error.message, error.statusCode);
    console.error('[API Gudang Penerimaan GET Error]:', error);
    return apiError('Gagal memuat daftar penerimaan barang', 500);
  }
}

// ── POST: Buat Draft / Simpan Nota Supplier Baru (Gudang & Admin Kasir) ──
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Forbidden: Pembuatan nota penerimaan hanya untuk Petugas Gudang atau Admin Kasir', 403);
  }

  try {
    const body = await req.json();
    const validatedBody = CreateStockReceiveDraftSchema.parse(body);
    const result = await createStockReceiveDraft(payload.sub, validatedBody, payload.role);
    return apiOk(result, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Format data tidak valid', 400);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Penerimaan POST Error]:', error);
    return apiError('Gagal membuat draft penerimaan barang', 500);
  }
}
