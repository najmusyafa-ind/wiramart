// =============================================================
// GET /api/order/katalog
// Daftar produk aktif untuk PWA buyer — cache 30 detik
// PUBLIC: tidak perlu auth. SECURITY: cost_price tidak pernah expose.
// =============================================================

import { NextResponse } from 'next/server';
import { getKatalog } from '@/features/order/katalog.service';

// Next.js revalidate — katalog di-cache 30 detik di CDN/server
export const revalidate = 30;

export async function GET() {
  try {
    const data = await getKatalog();
    const response = NextResponse.json({ success: true, data });
    // Cache header tambahan untuk browser PWA
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return response;
  } catch (err) {
    console.error('[katalog] Error:', err);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil katalog produk' },
      { status: 500 },
    );
  }
}
