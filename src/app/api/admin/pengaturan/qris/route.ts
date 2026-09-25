// =============================================================
// GET  /api/admin/pengaturan/qris — Ambil QRIS settings aktif
// POST /api/admin/pengaturan/qris — Upsert QRIS settings + upload gambar QR
// Auth: Admin only
// =============================================================

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { qrisSettings } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Singleton ID — satu baris saja di tabel qris_settings
const QRIS_SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

// Ukuran file maksimum: 2MB
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────
// GET — Ambil QRIS settings
// ─────────────────────────────────────────────────────────────
export async function GET(): Promise<Response> {
  try {
    await requireAdmin();

    const settings = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, QRIS_SINGLETON_ID),
      columns: {
        qrImageUrl: true,
        bankName: true,
        accountName: true,
        isActive: true,
        uploadedAt: true,
      },
    });

    return apiOk({
      qrImageUrl: settings?.qrImageUrl ?? null,
      bankName: settings?.bankName ?? '',
      accountName: settings?.accountName ?? '',
      isActive: settings?.isActive ?? false,
      uploadedAt: settings?.uploadedAt ?? null,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Gagal mengambil pengaturan QRIS', 'INTERNAL_ERROR', 500);
  }
}

// ─────────────────────────────────────────────────────────────
// Zod schema — field teks dari FormData
// ─────────────────────────────────────────────────────────────
const qrisTextSchema = z.object({
  bankName: z.string().max(100).optional().default(''),
  accountName: z.string().max(200).optional().default(''),
  isActive: z
    .string()
    .transform((v) => v === 'true')
    .pipe(z.boolean()),
});

// ─────────────────────────────────────────────────────────────
// POST — Upsert QRIS settings
// ─────────────────────────────────────────────────────────────
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdmin();

    // Parse multipart FormData
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiError('Format request tidak valid. Gunakan multipart/form-data.', 'INVALID_FORM', 400);
    }

    // Validasi field teks
    const textFields = {
      bankName: formData.get('bankName') as string | null,
      accountName: formData.get('accountName') as string | null,
      isActive: formData.get('isActive') as string | null,
    };

    const parsed = qrisTextSchema.safeParse(textFields);
    if (!parsed.success) {
      return apiError('Data tidak valid', 'VALIDATION_ERROR', 422, parsed.error.format());
    }

    const { bankName, accountName, isActive } = parsed.data;

    // ── Upload gambar QR (opsional) ─────────────────────────
    let qrImageUrl: string | null = null;

    const qrFile = formData.get('qrImage');
    if (qrFile instanceof File && qrFile.size > 0) {
      // Validasi tipe file
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!allowedTypes.includes(qrFile.type)) {
        return apiError(
          'Tipe file tidak didukung. Gunakan PNG atau JPG.',
          'INVALID_FILE_TYPE',
          400,
        );
      }

      // Validasi ukuran file
      if (qrFile.size > MAX_FILE_SIZE_BYTES) {
        return apiError(
          `Ukuran file terlalu besar. Maksimum 2MB. File Anda: ${(qrFile.size / 1024 / 1024).toFixed(1)}MB`,
          'FILE_TOO_LARGE',
          400,
        );
      }

      // Upload ke Supabase Storage
      const supabase = getSupabaseAdmin();
      const ext = qrFile.type === 'image/png' ? 'png' : 'jpg';
      const storagePath = `qr-code.${ext}`;

      const arrayBuffer = await qrFile.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('qris')
        .upload(storagePath, arrayBuffer, {
          contentType: qrFile.type,
          upsert: true, // overwrite jika sudah ada
        });

      if (uploadError) {
        return apiError(
          `Gagal upload gambar QR: ${uploadError.message}`,
          'STORAGE_UPLOAD_ERROR',
          500,
        );
      }

      // Dapatkan public URL
      const { data: publicUrlData } = supabase.storage
        .from('qris')
        .getPublicUrl(storagePath);

      // Tambah cache-buster agar browser tidak cache gambar lama
      qrImageUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    }

    // ── Upsert ke qrisSettings ──────────────────────────────
    const now = new Date();

    await db
      .insert(qrisSettings)
      .values({
        id: QRIS_SINGLETON_ID,
        bankName: bankName || null,
        accountName: accountName || null,
        isActive,
        qrImageUrl: qrImageUrl ?? undefined, // jika tidak upload, tidak ubah URL lama
        uploadedByAdminId: session.sub,
        uploadedAt: qrImageUrl ? now : undefined,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: qrisSettings.id,
        set: {
          bankName: bankName || null,
          accountName: accountName || null,
          isActive,
          // Hanya update qrImageUrl jika ada file baru
          ...(qrImageUrl !== null && {
            qrImageUrl,
            uploadedByAdminId: session.sub,
            uploadedAt: now,
          }),
          updatedAt: now,
        },
      });

    // Fetch ulang untuk return data final
    const updated = await db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, QRIS_SINGLETON_ID),
      columns: { qrImageUrl: true, bankName: true, accountName: true, isActive: true },
    });

    return apiOk({
      qrImageUrl: updated?.qrImageUrl ?? null,
      bankName: updated?.bankName ?? '',
      accountName: updated?.accountName ?? '',
      isActive: updated?.isActive ?? false,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server', 'INTERNAL_ERROR', 500);
  }
}
