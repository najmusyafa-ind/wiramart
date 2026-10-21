// =============================================================
// src/app/api/admin/tutup-buku/sign-off/route.ts
// API Route Handler: Pengesahan (Sign-Off) Daily Closing oleh MOD
// Wiramart v3.0: Sistem Manajemen Terintegrasi
// STANDAR: NASA-Grade Decoupling, Zod Validation, requireManager() Guard
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireManager } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { ManagerDutyService, getWibDate } from '@/lib/services/managerDutyService';

export const runtime = 'nodejs';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ── GET: Preview Rekonsiliasi Mutasi Stok Harian Sebelum Sign-Off ─
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireManager();

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const targetDate = dateParam && DATE_REGEX.test(dateParam) ? dateParam : getWibDate();

    const summary = await ManagerDutyService.calculateStockMutationSummary(targetDate);

    return apiOk({ summary });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[tutup-buku/sign-off GET]', err);
    return apiError('Gagal memuat preview mutasi stok harian.', 'SERVER_ERROR', 500);
  }
}

// ── Skema Validasi Body Sign-Off ─────────────────────────────
const signOffSchema = z.object({
  closingDate: z.string().regex(DATE_REGEX, 'Format tanggal harus YYYY-MM-DD'),
  notes: z.string().max(1000).optional(),
});

// ── POST: Eksekusi Sign-Off Daily Closing oleh MOD ───────────
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const admin = await requireManager();

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return apiError('Format JSON request tidak valid.', 'INVALID_JSON', 400);
    }

    const parsed = signOffSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? 'Validasi request gagal.',
        'VALIDATION_ERROR',
        422,
      );
    }

    const { closingDate, notes } = parsed.data;

    const auditedClosing = await ManagerDutyService.signOffDailyClosing(
      admin.sub,
      closingDate,
      notes,
    );

    return apiOk({
      message: `Daily Closing tanggal ${closingDate} berhasil disahkan oleh Manager on Duty (Status: AUDITED).`,
      closing: auditedClosing,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[tutup-buku/sign-off POST]', err);
    return apiError('Gagal mengesahkan Daily Closing.', 'SERVER_ERROR', 500);
  }
}
