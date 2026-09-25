// =============================================================
// GET /api/kasir/produk/barcode?code={barcode}
// Lookup produk berdasarkan barcode di DB lokal
// Flow:
//   1. Cari di products.barcode (DB lokal) → return jika ada
//   2. Jika tidak ada → return { found: false } (client akan coba OFF)
// Auth: Employee JWT
// =============================================================

import { NextRequest } from 'next/server';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { products, categories } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload) return apiError('Unauthorized', 'UNAUTHORIZED', 401);

  const code = new URL(req.url).searchParams.get('code')?.trim();
  if (!code) return apiError('Parameter code wajib diisi.', 'MISSING_CODE', 400);

  const [product] = await db
    .select({
      id:           products.id,
      name:         products.name,
      sellingPrice: products.sellingPrice,
      stockQty:     products.stockQty,
      unit:         products.unit,
      photoUrl:     products.photoUrl,
      barcode:      products.barcode,
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

  return apiOk({ found: true, product });
}
