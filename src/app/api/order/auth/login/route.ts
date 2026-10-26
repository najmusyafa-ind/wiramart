// =============================================================
// POST /api/order/auth/login
// Login buyer — NIM + Nama Lengkap (tanpa password)
// =============================================================

import { type NextRequest } from 'next/server';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { BuyerLoginSchema } from '@/features/order/order.types';
import { loginBuyer } from '@/features/order/buyer.service';
import { buyerLoginLimiter } from '@/lib/utils/rate-limit';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BuyerLoginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Input tidak valid', 'VALIDATION_ERROR', 422);
  }

  // Rate limit per NIM (bukan IP — satu kampus bisa banyak user dari 1 IP/WiFi)
  const limitKey = `nim:${parsed.data.nim}`;
  const limited = await buyerLoginLimiter.check(limitKey);
  if (!limited.allowed) {
    return apiError(
      `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil((limited.resetAt - Date.now()) / 60000)} menit.`,
      'RATE_LIMITED',
      429,
    );
  }

  try {
    const result = await loginBuyer(parsed.data);
    return apiOk({ buyer: result });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; statusCode?: number };
    return apiError(e.message ?? 'Terjadi kesalahan', e.code, e.statusCode ?? 500);
  }
}
