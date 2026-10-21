// =============================================================
// GET /api/kasir/produk/barcode?code={barcode}
// Lookup produk berdasarkan barcode di DB lokal
// Flow:
//   1. Cek apakah barcode cocok dengan discount_barcodes aktif (Fase 3: Diskon Darurat FEFO)
//      → Jika ada dan valid, return produk dengan harga override diskon & data policy
//      → Jika ada tapi kuantitas habis / expired, return pesan kesalahan spesifik
//   2. Cari di products.barcode (DB lokal) → return jika ada
//   3. Jika tidak ada → return { found: false } (client akan coba OFF)
// Auth: Employee JWT
// =============================================================

import { NextRequest } from 'next/server';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, categories, discountBarcodes, discountPolicies } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

function getTodayWIB(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload) return apiError('Unauthorized', 'UNAUTHORIZED', 401);

  const code = new URL(req.url).searchParams.get('code')?.trim();
  if (!code) return apiError('Parameter code wajib diisi.', 'MISSING_CODE', 400);

  const todayWIB = getTodayWIB();

  // ─────────────────────────────────────────────────────────────
  // 1. Cek apakah ini Barcode Diskon Darurat (discount_barcodes)
  // Format biasa: DISC-XXXXXX-XXXX atau tercatat di tabel discount_barcodes
  // ─────────────────────────────────────────────────────────────
  const [discountRecord] = await db
    .select({
      id:              discountBarcodes.id,
      policyId:        discountBarcodes.policyId,
      productId:       discountBarcodes.productId,
      barcode:         discountBarcodes.barcode,
      discountedPrice: discountBarcodes.discountedPrice,
      discountPct:     discountBarcodes.discountPct,
      remainingQty:    discountBarcodes.remainingQty,
      validUntil:      discountBarcodes.validUntil,
      isActive:        discountBarcodes.isActive,
      // Data Produk
      productName:     products.name,
      originalPrice:   products.sellingPrice,
      stockQty:        products.stockQty,
      unit:            products.unit,
      photoUrl:        products.photoUrl,
      categoryId:      products.categoryId,
      categoryName:    categories.name,
      // Data Kebijakan
      policyIsActive:  discountPolicies.isActive,
    })
    .from(discountBarcodes)
    .innerJoin(discountPolicies, eq(discountBarcodes.policyId, discountPolicies.id))
    .innerJoin(products, eq(discountBarcodes.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(discountBarcodes.barcode, code),
        eq(products.isActive, true),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);

  if (discountRecord) {
    // Validasi status diskon darurat
    if (!discountRecord.isActive || !discountRecord.policyIsActive) {
      return apiError('Barcode diskon ini telah dinonaktifkan oleh Manager.', 'DISCOUNT_INACTIVE', 400);
    }

    if (discountRecord.validUntil < todayWIB) {
      return apiError(
        `Masa berlaku barcode diskon darurat ini telah berakhir pada ${discountRecord.validUntil}.`,
        'DISCOUNT_EXPIRED',
        400,
      );
    }

    if (discountRecord.remainingQty <= 0) {
      return apiError(
        'Kuantitas kuota barcode diskon darurat ini sudah habis terjual.',
        'DISCOUNT_DEPLETED',
        400,
      );
    }

    const pctNum = Math.round(Number(discountRecord.discountPct));

    return apiOk({
      found: true,
      isDiscounted: true,
      product: {
        id:                 discountRecord.productId,
        name:               `[DISKON ${pctNum}%] ${discountRecord.productName}`,
        sellingPrice:       String(discountRecord.discountedPrice),
        originalPrice:      String(discountRecord.originalPrice),
        stockQty:           Math.min(discountRecord.stockQty, discountRecord.remainingQty),
        unit:               discountRecord.unit,
        photoUrl:           discountRecord.photoUrl,
        barcode:            discountRecord.barcode,
        categoryId:         discountRecord.categoryId,
        categoryName:       discountRecord.categoryName,
        discountPolicyId:   discountRecord.policyId,
        discountBarcode:    discountRecord.barcode,
        discountPct:        pctNum,
        isDiscountOverride: true,
      },
    });
  }

  // Jika kode berawalan 'DISC-' tapi tidak ditemukan di database sama sekali
  if (code.toUpperCase().startsWith('DISC-')) {
    return apiError(
      `Barcode diskon "${code}" tidak valid atau tidak terdaftar di sistem.`,
      'DISCOUNT_NOT_FOUND',
      404,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Barcode Produk Reguler (DB lokal)
  // ─────────────────────────────────────────────────────────────
  const [product] = await db
    .select({
      id:           products.id,
      name:         products.name,
      sellingPrice: products.sellingPrice,
      stockQty:     products.stockQty,
      unit:         products.unit,
      photoUrl:     products.photoUrl,
      barcode:      products.barcode,
      categoryId:   products.categoryId,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.barcode, code),
        eq(products.isActive, true),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);

  if (!product) {
    // Tidak ada di DB lokal — client harus coba Open Food Facts
    return apiOk({ found: false, barcode: code });
  }

  return apiOk({ found: true, isDiscounted: false, product });
}
