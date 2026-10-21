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
} from '@/lib/services/stockReceiveService';
import { AppError } from '@/lib/utils/helpers';
import { ZodError } from 'zod';

export const runtime = 'nodejs';

// ── GET: Ambil Daftar Penerimaan Barang ─────────────────────────
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || (payload.role !== 'employee' && payload.role !== 'admin')) {
    return apiError('Unauthorized: Akses ditolak', 401);
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

  // Zero-Trust IDOR Protection:
  // Karyawan hanya bisa melihat draft milik sendiri. Admin/Manager bisa melihat semua antrian.
  const employeeId = payload.role === 'employee' ? payload.sub : undefined;

  try {
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

// ── POST: Buat Draft Penerimaan Barang Baru ─────────────────────
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Forbidden: Pembuatan draft penerimaan hanya untuk akun petugas toko / gudang', 403);
  }

  try {
    const body = await req.json();
    const result = await createStockReceiveDraft(payload.sub, body);
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
