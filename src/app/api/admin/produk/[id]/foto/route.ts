// =============================================================
// POST /api/admin/produk/[id]/foto — Upload foto produk
// Body: multipart/form-data, field 'foto' (image/jpeg, image/png, image/webp)
// Auth: Admin only
//
// Upload ke Supabase Storage bucket 'product-photos'
// Path: {productId}.{ext} — overwrite jika sudah ada
// Update products.photoUrl setelah upload sukses
// =============================================================

import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// FinOps: foto produk max 5MB
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  try {
    await requireAdmin();
    const { id: productId } = await params;

    // Validasi UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return apiError('ID produk tidak valid.', 'INVALID_ID', 400);
    }

    // ── Cek produk exist ────────────────────────────────────
    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
      columns: { id: true, name: true, deletedAt: true },
    });

    if (!product || product.deletedAt !== null) {
      return apiError('Produk tidak ditemukan.', 'NOT_FOUND', 404);
    }

    // ── Parse FormData ──────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return apiError('Format request tidak valid. Gunakan multipart/form-data.', 'INVALID_FORM', 400);
    }

    const fotoFile = formData.get('foto');
    if (!(fotoFile instanceof File) || fotoFile.size === 0) {
      return apiError('File foto wajib disertakan (field: foto).', 'MISSING_FILE', 400);
    }

    // ── Validasi tipe file ──────────────────────────────────
    if (!ALLOWED_MIME.includes(fotoFile.type)) {
      return apiError(
        'Tipe file tidak didukung. Gunakan JPEG, PNG, atau WebP.',
        'INVALID_FILE_TYPE',
        400,
      );
    }

    // ── Validasi ukuran file ────────────────────────────────
    if (fotoFile.size > MAX_FILE_BYTES) {
      return apiError(
        `Ukuran file terlalu besar. Maksimum 5MB. File Anda: ${(fotoFile.size / 1024 / 1024).toFixed(1)}MB`,
        'FILE_TOO_LARGE',
        400,
      );
    }

    // ── Upload ke Supabase Storage ──────────────────────────
    const supabase = getSupabaseAdmin();

    // Ext berdasarkan MIME type — normalize jpg
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg':  'jpg',
      'image/png':  'png',
      'image/webp': 'webp',
    };
    const ext = extMap[fotoFile.type] ?? 'jpg';
    const storagePath = `${productId}.${ext}`;

    const arrayBuffer = await fotoFile.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('product-photos')
      .upload(storagePath, arrayBuffer, {
        contentType: fotoFile.type,
        upsert: true, // overwrite jika sudah ada foto lama
      });

    if (uploadError) {
      return apiError(
        `Gagal upload foto: ${uploadError.message}`,
        'STORAGE_UPLOAD_ERROR',
        500,
      );
    }

    // ── Dapatkan public URL ─────────────────────────────────
    const { data: urlData } = supabase.storage
      .from('product-photos')
      .getPublicUrl(storagePath);

    // Cache-buster agar browser tidak tampilkan foto lama
    const photoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // ── Update products.photoUrl ────────────────────────────
    await db
      .update(products)
      .set({ photoUrl, updatedAt: new Date() })
      .where(eq(products.id, productId));

    return apiOk({
      productId,
      productName: product.name,
      photoUrl,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
