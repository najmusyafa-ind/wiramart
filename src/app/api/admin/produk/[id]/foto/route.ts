// =============================================================
// POST /api/admin/produk/[id]/foto — Upload foto produk
// Body: multipart/form-data, field 'foto' (image/jpeg, image/png, image/webp)
// Auth: Admin only
//
// Upload ke Supabase Storage bucket 'product-photos'
// Path: {productId}.webp — overwrite jika sudah ada
// Auto-compress: Sharp resize 800x800 + WebP 82% sebelum upload
// Update products.photoUrl setelah upload sukses
// =============================================================

import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

// FinOps: terima file asli max 15MB (setelah kompresi akan jauh lebih kecil)
const MAX_FILE_BYTES = 15 * 1024 * 1024;

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

    // ── Validasi ukuran file asli ───────────────────────────
    if (fotoFile.size > MAX_FILE_BYTES) {
      return apiError(
        `Ukuran file terlalu besar. Maksimum 15MB. File Anda: ${(fotoFile.size / 1024 / 1024).toFixed(1)}MB`,
        'FILE_TOO_LARGE',
        400,
      );
    }

    // ── Kompresi otomatis via Sharp ─────────────────────────
    // Resize max 800x800 (fit inside, tanpa distorsi) + WebP 82%
    // Foto HP 4MB → ~150-300KB, upload jadi instant
    const rawBuffer = Buffer.from(await fotoFile.arrayBuffer());
    let compressedBuffer: Buffer;
    try {
      compressedBuffer = await sharp(rawBuffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      // Fallback: upload file asli jika Sharp gagal (file rusak, dll)
      compressedBuffer = rawBuffer;
    }

    // ── Upload ke Supabase Storage ──────────────────────────
    const supabase = getSupabaseAdmin();
    // Selalu simpan sebagai .webp setelah kompresi
    const storagePath = `${productId}.webp`;

    const { error: uploadError } = await supabase.storage
      .from('product-photos')
      .upload(storagePath, compressedBuffer, {
        contentType: 'image/webp',
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

    const originalKB   = Math.round(fotoFile.size / 1024);
    const compressedKB = Math.round(compressedBuffer.length / 1024);

    return apiOk({
      productId,
      productName: product.name,
      photoUrl,
      compression: {
        originalKB,
        compressedKB,
        savedPercent: Math.round((1 - compressedKB / originalKB) * 100),
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
