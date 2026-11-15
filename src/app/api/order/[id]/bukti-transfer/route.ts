// =============================================================
// POST /api/order/[id]/bukti-transfer
// Upload foto bukti transfer oleh buyer (maks 2MB, JPG/PNG/WebP).
// Simpan ke Supabase Storage bucket "payment-proofs" (service role).
// Rate limit: 3x per jam per buyer_id.
// =============================================================

import { type NextRequest } from 'next/server';
import { getBuyerSessionFromRequest } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { buyerUploadLimiter } from '@/lib/utils/rate-limit';
import { expireDueOrders } from '@/features/order/pesanan.service';
import { db } from '@/lib/db/client';
import { onlineOrders } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Supabase service-role client (bypass RLS — server-side only)
function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AppError('CONFIG_ERROR', 'Supabase belum dikonfigurasi.', 500);
  return createClient(url, key, { auth: { persistSession: false } });
}

// Magic-bytes validator: hanya JPEG, PNG, WebP — turunkan ext & Content-Type dari byte asli
function validateImageMagicBytes(buf: Uint8Array): { ext: 'jpg' | 'png' | 'webp'; contentType: string } {
  if (buf.length < 12) {
    throw new AppError('INVALID_FORMAT', 'Format tidak didukung. Gunakan JPG, PNG, atau WebP.', 422);
  }
  const h = buf;
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (
    String.fromCharCode(h[0], h[1], h[2], h[3]) === 'RIFF' &&
    String.fromCharCode(h[8], h[9], h[10], h[11]) === 'WEBP'
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  throw new AppError('INVALID_FORMAT', 'Format tidak didukung. Gunakan JPG, PNG, atau WebP.', 422);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getBuyerSessionFromRequest(req);
  if (!session) return apiError('Silakan login terlebih dahulu', 'UNAUTHORIZED', 401);

  const { id: orderId } = await params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(orderId)) return apiError('ID pesanan tidak valid', 'BAD_REQUEST', 400);

  try {
    const rl = buyerUploadLimiter.check(`upload:${session.sub}`);
    if (!rl.allowed) {
      throw new AppError('RATE_LIMITED', 'Batas upload 3x per jam sudah tercapai.', 429);
    }

    // Verifikasi pesanan milik buyer & masih bisa diupload
    const [order] = await db
      .select({
        id: onlineOrders.id,
        status: onlineOrders.status,
        buyerId: onlineOrders.buyerId,
        expiredAt: onlineOrders.expiredAt,
      })
      .from(onlineOrders)
      .where(and(eq(onlineOrders.id, orderId), isNull(onlineOrders.deletedAt)))
      .limit(1);

    if (!order || order.buyerId !== session.sub) {
      return apiError('Pesanan tidak ditemukan', 'NOT_FOUND', 404);
    }
    if (order.status === 'EXPIRED') {
      return apiError('Pesanan sudah kedaluwarsa.', 'ORDER_EXPIRED', 410);
    }
    if (order.status !== 'WAITING_PAYMENT_VERIFICATION') {
      return apiError('Pesanan tidak dalam status menunggu verifikasi pembayaran.', 'INVALID_STATE', 409);
    }
    if (order.expiredAt && order.expiredAt <= new Date()) {
      await expireDueOrders({ orderId: order.id, limit: 1 });
      return apiError('Pesanan sudah kedaluwarsa.', 'ORDER_EXPIRED', 410);
    }

    // Parse multipart form
    const form = await req.formData().catch(() => null);
    const file = form?.get('file') as File | null;
    if (!file) return apiError('File tidak ditemukan dalam request.', 'VALIDATION_ERROR', 422);

    if (file.size > 2 * 1024 * 1024) {
      return apiError('Ukuran file maksimal 2MB.', 'FILE_TOO_LARGE', 422);
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    const { ext, contentType } = validateImageMagicBytes(buf);

    // Upload ke Supabase Storage
    const supabase = getStorageClient();
    const path = `${orderId}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('payment-proofs')
      .upload(path, buf, { contentType, upsert: true });

    if (uploadErr) throw new AppError('UPLOAD_FAILED', 'Gagal mengunggah file. Coba lagi.', 500);

    // Buat signed URL 1 jam agar admin bisa preview
    const { data: signed } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(path, 3600);

    // Simpan URL ke DB (hanya bila status masih WAITING_PAYMENT_VERIFICATION)
    await db
      .update(onlineOrders)
      .set({ paymentProofUrl: signed?.signedUrl ?? path, updatedAt: new Date() })
      .where(and(eq(onlineOrders.id, orderId), eq(onlineOrders.status, 'WAITING_PAYMENT_VERIFICATION')));

    return apiOk({ message: 'Bukti transfer berhasil diunggah.' });
  } catch (err) {
    if (err instanceof AppError) return apiError(err.message, err.code, err.statusCode);
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
