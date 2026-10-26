// =============================================================
// POST /api/order/auth/register
// Daftarkan buyer baru — NIM + Nama + WA
// Controller ≤ 30 baris (PEP). Logic ada di buyer.service.ts
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { BuyerRegisterSchema } from '@/features/order/order.types';
import { registerBuyer } from '@/features/order/buyer.service';
import { buyerRegisterLimiter } from '@/lib/utils/rate-limit';

export async function POST(req: NextRequest) {
  // Rate limit per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limited = await buyerRegisterLimiter.check(ip);
  if (!limited.allowed) {
    return apiError(
      `Terlalu banyak percobaan daftar. Coba lagi dalam ${Math.ceil((limited.resetAt - Date.now()) / 60000)} menit.`,
      'RATE_LIMITED',
      429,
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = BuyerRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Input tidak valid', 'VALIDATION_ERROR', 422);
  }

  try {
    const result = await registerBuyer(parsed.data);
    return apiOk({ buyer: result }, undefined, 201);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; statusCode?: number };
    return apiError(e.message ?? 'Terjadi kesalahan', e.code, e.statusCode ?? 500);
  }
}
