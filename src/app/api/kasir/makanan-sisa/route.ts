// =============================================================
// /api/kasir/makanan-sisa — Cut-off Sisa Makanan Harian (Jam 15:00)
// Mendukung Kelas H / E1: Makanan Cepat Basi & Non-Barcode (Cilok, Siomai, Ricebowl, Gorengan)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull, or, ilike } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { products, categories, stockAdjustments, admins } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

const cutOffItemSchema = z.object({
  productId: z.string().uuid(),
  qtySisaFisik: z.number().min(0).max(10_000),
  disposition: z.enum(['RETUR', 'BUANG_BASI', 'HABIS', 'SIMPAN']),
  notes: z.string().max(200).optional(),
});

const cutOffBatchSchema = z.object({
  items: z.array(cutOffItemSchema).min(1, 'Minimal satu item makanan harus dilaporkan'),
});

// GET: Ambil daftar makanan harian / non-barcode untuk formulir cut-off
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
      unit: products.unit,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        isNull(products.deletedAt),
        or(
          isNull(products.barcode),
          ilike(categories.name, '%makanan%'),
          ilike(categories.name, '%kue%'),
          ilike(categories.name, '%snack%'),
          ilike(categories.name, '%basah%'),
          ilike(categories.name, '%konsinyasi%'),
          ilike(products.name, '%cilok%'),
          ilike(products.name, '%siomai%'),
          ilike(products.name, '%ricebowl%'),
          ilike(products.name, '%gorengan%'),
        ),
      ),
    )
    .orderBy(products.name);

  return apiOk({ items: rows });
}

// POST: Catat cut-off sisa makanan jam 15:00
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 400);
  }

  const parsed = cutOffBatchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 422);
  }

  const { items } = parsed.data;

  // Cari admin id untuk audit record stock_adjustments
  const adminRow = await db.query.admins.findFirst({
    where: eq(admins.isActive, true),
    columns: { id: true },
  });

  const adminId = adminRow?.id;
  if (!adminId) {
    return apiError('Tidak ada sistem admin yang aktif untuk otorisasi stok', 500);
  }

  const nowWib = new Date();
  const timeStr = nowWib.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  // Eksekusi penyesuaian stok per item
  for (const item of items) {
    const existing = await db.query.products.findFirst({
      where: eq(products.id, item.productId),
      columns: { id: true, stockQty: true, name: true },
    });

    if (!existing) continue;

    const qtyBefore = existing.stockQty;
    let qtyAfter = qtyBefore;

    if (item.disposition === 'RETUR') {
      // Sisa diretur ke penitip -> stok toko dikurangi sisa fisik tsb (atau diset 0 jika seluruh sisa diretur)
      qtyAfter = Math.max(0, qtyBefore - item.qtySisaFisik);
    } else if (item.disposition === 'BUANG_BASI') {
      // Sisa basi dibuang -> stok toko disesuaikan (dikeluarkan dari inventaris)
      qtyAfter = Math.max(0, qtyBefore - item.qtySisaFisik);
    } else if (item.disposition === 'HABIS') {
      // Barang sudah habis terjual
      qtyAfter = 0;
    } else if (item.disposition === 'SIMPAN') {
      // Masih layak dan disimpan di etalase
      qtyAfter = item.qtySisaFisik;
    }

    const qtyDiff = qtyAfter - qtyBefore;

    // Update stok produk jika ada perubahan
    if (qtyDiff !== 0) {
      await db
        .update(products)
        .set({ stockQty: qtyAfter, updatedAt: nowWib })
        .where(eq(products.id, item.productId));

      const dispLabel =
        item.disposition === 'RETUR'
          ? 'Retur ke Pemasok'
          : item.disposition === 'BUANG_BASI'
          ? 'Dibuang (Basi)'
          : item.disposition === 'HABIS'
          ? 'Habis Terjual'
          : 'Disimpan';

      const reasonNote = `[CUTOFF-15:00 ${timeStr}] ${dispLabel} (Sisa fisik: ${item.qtySisaFisik} pcs). ${item.notes ? `Catatan: ${item.notes}` : ''}`.trim();

      await db.insert(stockAdjustments).values({
        productId: item.productId,
        qtyBefore,
        qtyAfter,
        qtyDiff,
        reason: reasonNote,
        adjustedByAdminId: adminId,
      });
    }
  }

  return apiOk({
    message: `Cut-off sisa ${items.length} produk makanan berhasil disimpan.`,
    processedCount: items.length,
  });
}
