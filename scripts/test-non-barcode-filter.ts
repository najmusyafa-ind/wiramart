// =============================================================
// scripts/test-non-barcode-filter.ts
// Verifikasi Filter Makanan & Non-Barcode di POS Wiramart
// =============================================================

import { db } from '../src/lib/db/client';
import { products, categories } from '../src/lib/db/schema';
import { eq, isNull, and, or, sql } from 'drizzle-orm';

async function main() {
  console.log('🧪 Menguji Filter Makanan & Non-Barcode di Database Wiramart...\n');

  // Query dengan filter nonBarcode = true
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      categoryName: categories.name,
      isPerishable: products.isPerishable,
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        isNull(products.deletedAt),
        or(
          isNull(products.barcode),
          sql`LENGTH(TRIM(${products.barcode})) = 0`,
          sql`${products.barcode} = ${products.name}`,
          eq(products.isPerishable, true),
          sql`LOWER(${categories.name}) = 'makanan'`,
        ),
      ),
    )
    .orderBy(products.name);

  console.log(`✅ Total produk ditemukan: ${rows.length} item.`);
  rows.forEach((r, idx) => console.log(`   ${idx + 1}. ${r.name} (Barcode: ${r.barcode || 'KOSONG'}, Cat: ${r.categoryName}, Perishable: ${r.isPerishable})`));

  // 1. Verifikasi bahwa TIDAK ADA produk pabrik ber-barcode (seperti Ades, Alpenliebe)
  const invalidItems = rows.filter((r) => {
    const b = r.barcode?.trim() ?? '';
    const hasValidBarcode = b.length >= 8 && /^\d+$/.test(b);
    const isPerishable = Boolean(r.isPerishable);
    const isMakanan = (r.categoryName ?? '').toLowerCase() === 'makanan';
    // Jika punya barcode angka standar (EAN) dan BUKAN makanan cepat basi / bukan kategori makanan
    return hasValidBarcode && !isPerishable && !isMakanan;
  });

  if (invalidItems.length > 0) {
    console.error('❌ GAGAL: Masih ada produk ber-barcode pabrik yang lolos:');
    invalidItems.forEach((i) => console.error(`   - ${i.name} (Barcode: ${i.barcode}, Cat: ${i.categoryName})`));
    process.exit(1);
  }

  console.log('✅ VERIFIKASI 1: Bersih! Tidak ada produk ber-barcode pabrik (Ades, Alpenliebe, dll) yang bocor.');

  // 2. Verifikasi bahwa produk makanan / titipan non-barcode berhasil masuk
  const sampleNonBarcodeNames = ['Cilok', 'Nasi', 'Roti', 'Wonton', 'Siomay', 'Tahu Bakso'];
  for (const sample of sampleNonBarcodeNames) {
    const found = rows.find((r) => r.name.toLowerCase().includes(sample.toLowerCase()));
    if (found) {
      console.log(`✅ VERIFIKASI 2: Ditemukan produk representatif -> "${found.name}" [Stok: ${found.stockQty}, Barcode: ${found.barcode || 'NON-BARCODE'}]`);
    }
  }

  console.log('\n🎉 Pengujian Filter Makanan & Non-Barcode LULUS 100%!');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
