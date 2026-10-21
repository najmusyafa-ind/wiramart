// =============================================================
// src/app/api/gudang/penerimaan/[id]/route.ts
// Route Handler: Detail Penerimaan Barang (GET) & Edit Draft (PATCH)
// STANDAR: Next.js 15+ Async Params, NASA-Grade Decoupling, Anti-IDOR Guard
// =============================================================

import { NextRequest } from 'next/server';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  getStockReceiveDraftDetail,
  updateStockReceiveDraft,
} from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

// ── GET: Ambil Detail Lengkap Draft & Seluruh Item ─────────────
export async function GET(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID draft tidak valid', 400);
  }

  // Jika employee, batasi hanya draft miliknya sendiri (IDOR safe)
  const requesterEmployeeId = payload.role === 'employee' ? payload.sub : undefined;

  try {
    const detail = await getStockReceiveDraftDetail(id, requesterEmployeeId);
    return apiOk(detail);
  } catch (error) {
    if (error instanceof AppError) return apiError(error.message, error.statusCode);
    console.error('[API Gudang Penerimaan [id] GET Error]:', error);
    return apiError('Gagal memuat detail penerimaan barang', 500);
  }
}

// ── PATCH: Update Konten Draft Penerimaan Barang ───────────────
export async function PATCH(req: NextRequest, context: Context) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Forbidden: Hanya petugas toko / gudang yang dapat mengubah draft', 403);
  }

  const { id } = await context.params;
  if (!id) {
    return apiError('ID draft tidak valid', 400);
  }

  try {
    const body = await req.json();
    const updated = await updateStockReceiveDraft(id, payload.sub, body);
    return apiOk(updated);
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(error.issues[0]?.message || 'Format data tidak valid', 400);
    }
    if (error instanceof AppError) {
      return apiError(error.message, error.statusCode);
    }
    console.error('[API Gudang Penerimaan [id] PATCH Error]:', error);
    return apiError('Gagal memperbarui draft penerimaan barang', 500);
  }
}
