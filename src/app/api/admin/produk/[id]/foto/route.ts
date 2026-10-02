// =============================================================
// POST /api/admin/produk/[id]/foto — Upload foto produk
// Body: multipart/form-data, field 'foto' (image/jpeg, image/png, image/webp)
// Auth: Admin ATAU Kasir aktif (keduanya boleh upload)
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
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

// FinOps: terima file asli max 15MB (setelah kompresi akan jauh lebih kecil)
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  try {
    // Auth: admin ATAU kasir aktif boleh upload foto
    const payload = await verifyJwt(req);
    if (!payload) return apiError('Unauthorized', 401);

    const { id: productId } = await params;

    // Validasi UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return apiError('ID produk tidak valid.', 400);
    }

    // ── Cek produk exist ────────────────────────────────────
    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
      columns: { id: true, name: true, deletedAt: true },
    });

    if (!product || product.deletedAt !== null) {
      return apiError('Produk tidak ditemukan.', 404);
    }

    // ── Parse FormData ──────────────────────────────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return apiError('Format request tidak valid. Gunakan multipart/form-data.', 400);
    }

    const fotoFile = formData.get('foto');
    if (!(fotoFile instanceof File) || fotoFile.size === 0) {
      return apiError('File foto wajib disertakan (field: foto).', 400);
    }

    // ── Validasi tipe file ──────────────────────────────────
    if (!ALLOWED_MIME.includes(fotoFile.type)) {
      return apiError('Tipe file tidak didukung. Gunakan JPEG, PNG, atau WebP.', 400);
    }

    // ── Validasi ukuran file asli ───────────────────────────
    if (fotoFile.size > MAX_FILE_BYTES) {
      return apiError(
        `Ukuran file terlalu besar. Maksimum 15MB. File Anda: ${(fotoFile.size / 1024 / 1024).toFixed(1)}MB`,
        400,
      );
    }

    // ── Kompresi otomatis via Sharp ─────────────────────────
    // Resize max 800x800 (fit inside, tanpa distorsi) + WebP 82%
    const rawBuffer = Buffer.from(await fotoFile.arrayBuffer());
    let compressedBuffer: Buffer;
    try {
      compressedBuffer = await sharp(rawBuffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      compressedBuffer = rawBuffer;
    }

    // ── Upload ke Supabase Storage ──────────────────────────
    const supabase = getSupabaseAdmin();
    const storagePath = `${productId}.webp`;

    const { error: uploadError } = await supabase.storage
      .from('product-photos')
      .upload(storagePath, compressedBuffer, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (uploadError) {
      return apiError(`Gagal upload foto: ${uploadError.message}`, 500);
    }

    // ── Dapatkan public URL ─────────────────────────────────
    const { data: urlData } = supabase.storage
      .from('product-photos')
      .getPublicUrl(storagePath);

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
      return apiError(err.message, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 500);
  }
}
