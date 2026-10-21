// =============================================================
// src/app/api/admin/duty/route.ts
// API Route Handler: Manager on Duty (MOD) Sesi Harian
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

// ── GET: Ambil status MOD hari ini beserta riwayat ───────────
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireManager();

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const targetDate = dateParam && DATE_REGEX.test(dateParam) ? dateParam : getWibDate();

    const [todayStatus, history] = await Promise.all([
      ManagerDutyService.getTodayDutyStatus(targetDate),
      ManagerDutyService.getDutyHistory(14),
    ]);

    return apiOk({
      today: todayStatus,
      history,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[api/admin/duty GET]', err);
    return apiError('Gagal memuat status Manager on Duty.', 'SERVER_ERROR', 500);
  }
}

// ── Skema Validasi Body Aksi MOD ─────────────────────────────
const dutyActionSchema = z.object({
  action: z.enum(['CHECK_IN', 'CHECK_OUT']),
  notes: z.string().max(1000).optional(),
  date: z.string().regex(DATE_REGEX, 'Format tanggal harus YYYY-MM-DD').optional(),
});

// ── POST: Eksekusi Check-In atau Check-Out MOD ───────────────
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const admin = await requireManager();

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return apiError('Format JSON request tidak valid.', 'INVALID_JSON', 400);
    }

    const parsed = dutyActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? 'Validasi request gagal.',
        'VALIDATION_ERROR',
        422,
      );
    }

    const { action, notes, date } = parsed.data;
    const targetDate = date || getWibDate();

    if (action === 'CHECK_IN') {
      const dutyLog = await ManagerDutyService.checkIn(admin.sub, notes, targetDate);
      return apiOk({
        message: `Berhasil check-in sebagai Manager on Duty untuk tanggal ${targetDate}.`,
        dutyLog,
      });
    }

    const dutyLog = await ManagerDutyService.checkOut(admin.sub, notes, targetDate);
    return apiOk({
      message: `Berhasil check-out Manager on Duty untuk tanggal ${targetDate}.`,
      dutyLog,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    console.error('[api/admin/duty POST]', err);
    return apiError('Gagal memproses sesi Manager on Duty.', 'SERVER_ERROR', 500);
  }
}
