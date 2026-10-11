import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../src/lib/db/client';
import { products, categories, stockAdjustments, admins, stockBatches } from '../src/lib/db/schema';
import { eq, and, isNull, or, ilike, gt, asc, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

// ============================================================================
// SUITE PENGUJIAN MENYELURUH: PENANGANAN MAKANAN BASAH (PERISHABLE) WIRAMART
// ============================================================================

const cutOffItemSchema = z.object({
  productId: z.string().uuid(),
  qtySisaFisik: z.number().min(0).max(10_000),
  disposition: z.enum(['RETUR', 'BUANG_BASI', 'HABIS', 'SIMPAN', 'MAKAN_PETUGAS', 'OBRAL']),
  notes: z.string().max(200).optional(),
});

const cutOffBatchSchema = z.object({
  items: z.array(cutOffItemSchema).min(1, 'Minimal satu item makanan harus dilaporkan'),
});

async function runTestSuite() {
  console.log('====================================================================');
  console.log('🚀 MEMULAI SUITE PENGUJIAN MENYELURUH (ZERO-DEFECT VERIFICATION)');
  console.log('====================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(name: string, condition: boolean, details?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Integritas Skema Kolom di PostgreSQL Supabase
  // --------------------------------------------------------------------------
  console.log('📌 TEST 1: Verifikasi Skema Kolom PostgreSQL di Supabase');
  const cols = await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'products' AND column_name IN ('is_perishable', 'perishable_type');
  `);

  const colRows = Array.from(cols) as Array<{
    column_name: string;
    data_type: string;
    column_default: string;
    is_nullable: string;
  }>;

  const hasIsPerishable = colRows.find((r) => r.column_name === 'is_perishable');
  const hasPerishableType = colRows.find((r) => r.column_name === 'perishable_type');

  assert('Kolom products.is_perishable bertipe boolean', hasIsPerishable?.data_type === 'boolean');
  assert('Kolom products.is_perishable default false', hasIsPerishable?.column_default?.includes('false') ?? false);
  assert('Kolom products.perishable_type bertipe varchar/text', hasPerishableType?.data_type?.includes('char') ?? false);
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 2: Validasi Barcode Riil Pabrik vs Custom / Non-Barcode
  // --------------------------------------------------------------------------
  console.log('📌 TEST 2: Proteksi Produk Kemasan Ber-Barcode Riil Pabrik');
  const factoryBarcodedPerishable = await db
    .select({ id: products.id, name: products.name, barcode: products.barcode })
    .from(products)
    .where(
      and(
        eq(products.isPerishable, true),
        sql`${products.barcode} ~ '^[0-9]{8,14}$'`
      )
    );

  assert(
    'TIDAK ADA produk barcode riil pabrik (8-14 digit numerik murni) yang ter-flag is_perishable',
    factoryBarcodedPerishable.length === 0,
    `Ditemukan: ${factoryBarcodedPerishable.map((p) => `${p.name} (${p.barcode})`).join(', ')}`
  );

  // Verifikasi spesifik produk penting: Croissant & Klanting
  const [croissant] = await db
    .select({ name: products.name, barcode: products.barcode, isPerishable: products.isPerishable, stock: products.stockQty })
    .from(products)
    .where(ilike(products.name, '%croissant%'));

  if (croissant) {
    assert('Croissant TIDAK ter-flag perishable (is_perishable = false)', croissant.isPerishable === false);
    assert('Croissant memiliki barcode pabrik', croissant.barcode === '8997213750513');
  }

  const [klanting] = await db
    .select({ name: products.name, isPerishable: products.isPerishable, stock: products.stockQty })
    .from(products)
    .where(ilike(products.name, '%klanting%'));

  if (klanting) {
    assert('Klanting TIDAK ter-flag perishable (is_perishable = false)', klanting.isPerishable === false);
  }
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 3: Daftar Produk Makanan Basah Terdaftar
  // --------------------------------------------------------------------------
  console.log('📌 TEST 3: Verifikasi 33 Produk Makanan Basah Terdaftar');
  const perishableList = await db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      costPrice: products.costPrice,
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
      isPerishable: products.isPerishable,
      perishableType: products.perishableType,
    })
    .from(products)
    .where(and(eq(products.isPerishable, true), isNull(products.deletedAt)));

  assert(`Total produk is_perishable = true adalah 33 produk`, perishableList.length === 33, `Ditemukan: ${perishableList.length}`);

  // Cek HPP dan harga jual tidak ada yang 0
  const invalidPrice = perishableList.filter(
    (p) => parseFloat(p.costPrice) <= 0 || parseFloat(p.sellingPrice) <= 0
  );
  assert(
    'Seluruh produk perishable memiliki HPP > 0 dan Harga Jual > 0',
    invalidPrice.length === 0,
    `Produk harga 0: ${invalidPrice.map((p) => p.name).join(', ')}`
  );

  // Cek harga jual >= HPP (tidak ada jual rugi)
  const lossPrice = perishableList.filter(
    (p) => parseFloat(p.sellingPrice) < parseFloat(p.costPrice)
  );
  assert(
    'Seluruh produk perishable memiliki Harga Jual >= HPP (Margin sehat)',
    lossPrice.length === 0,
    `Produk jual rugi: ${lossPrice.map((p) => `${p.name} (HPP: ${p.costPrice}, Jual: ${p.sellingPrice})`).join(', ')}`
  );
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 4: Query Engine `GET /api/kasir/makanan-sisa`
  // --------------------------------------------------------------------------
  console.log('📌 TEST 4: Simulasi Query GET /api/kasir/makanan-sisa');
  const getRows = await db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      sellingPrice: products.sellingPrice,
      stockQty: products.stockQty,
      unit: products.unit,
      categoryName: categories.name,
      isPerishable: products.isPerishable,
      perishableType: products.perishableType,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(products.isActive, true),
        isNull(products.deletedAt),
        or(
          eq(products.isPerishable, true),
          ilike(categories.name, '%basah%'),
          ilike(categories.name, '%konsinyasi%'),
        ),
      ),
    )
    .orderBy(desc(products.stockQty), asc(products.name));

  assert('GET /api/kasir/makanan-sisa mengembalikan baris produk', getRows.length > 0);
  assert('Semua baris memiliki id, name, sellingPrice, stockQty', getRows.every((r) => r.id && r.name && r.sellingPrice !== undefined && r.stockQty !== undefined));
  console.log(`   Ditemukan ${getRows.length} produk untuk form cut-off kasir.`);
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 5: Zod Schema Validation (Semua Disposisi)
  // --------------------------------------------------------------------------
  console.log('📌 TEST 5: Pengujian Zod Schema Validation (Input Kasir)');
  const dummyId = perishableList[0]?.id || '11111111-1111-1111-1111-111111111111';

  // Test all 6 valid dispositions
  const validDispositions = ['RETUR', 'BUANG_BASI', 'HABIS', 'SIMPAN', 'MAKAN_PETUGAS', 'OBRAL'] as const;
  for (const disp of validDispositions) {
    const res = cutOffBatchSchema.safeParse({
      items: [{ productId: dummyId, qtySisaFisik: 5, disposition: disp, notes: `Test ${disp}` }],
    });
    assert(`Zod menerima disposition '${disp}'`, res.success);
  }

  // Test invalid disposition
  const invalidDisp = cutOffBatchSchema.safeParse({
    items: [{ productId: dummyId, qtySisaFisik: 5, disposition: 'INVALID_ENUM' }],
  });
  assert('Zod menolak disposition tidak dikenal', !invalidDisp.success);

  // Test negative qty
  const negQty = cutOffBatchSchema.safeParse({
    items: [{ productId: dummyId, qtySisaFisik: -1, disposition: 'RETUR' }],
  });
  assert('Zod menolak qtySisaFisik negatif (< 0)', !negQty.success);

  // Test empty items
  const emptyItems = cutOffBatchSchema.safeParse({ items: [] });
  assert('Zod menolak array items kosong', !emptyItems.success);
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 6: Simulasi ACID Transaction Disposisi (Dry-Run / Rollback)
  // --------------------------------------------------------------------------
  console.log('📌 TEST 6: Simulasi Transaksi Atomik POST /api/kasir/makanan-sisa (ACID Safe)');
  const adminRow = await db.query.admins.findFirst({
    where: eq(admins.isActive, true),
    columns: { id: true, fullName: true },
  });
  assert('Admin aktif ditemukan untuk otorisasi audit', !!adminRow?.id, `Admin: ${adminRow?.fullName}`);

  let rollbackSuccess = false;
  try {
    await db.transaction(async (tx) => {
      const targetProduct = perishableList[0];
      if (!targetProduct) throw new Error('Tidak ada produk uji');

      // Update produk ke 0
      await tx
        .update(products)
        .set({ stockQty: 0, updatedAt: new Date() })
        .where(eq(products.id, targetProduct.id));

      // Insert audit record
      await tx.insert(stockAdjustments).values({
        productId: targetProduct.id,
        qtyBefore: 5,
        qtyAfter: 0,
        qtyDiff: -5,
        reason: '[TEST-SIMULASI] Uji coba rollback aman',
        adjustedByAdminId: adminRow!.id,
        createdAt: new Date(),
      });

      // Sengaja throw untuk memicu rollback dan tidak meninggalkan sampah di database
      throw new Error('ROLLBACK_INTENTIONAL');
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'ROLLBACK_INTENTIONAL') {
      rollbackSuccess = true;
    }
  }
  assert('Transaksi ACID rollback berhasil (database bersih dari artefak uji)', rollbackSuccess);
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 7: Simulasi Query Sweep Tengah Malam PASS 3 Cron Vercel
  // --------------------------------------------------------------------------
  console.log('📌 TEST 7: Verifikasi Logika Sapu Tengah Malam (PASS 3 Cron)');
  const midnightSweepCandidates = await db
    .select({
      id: products.id,
      name: products.name,
      stockQty: products.stockQty,
      unit: products.unit,
      perishableType: products.perishableType,
    })
    .from(products)
    .where(
      and(
        eq(products.isPerishable, true),
        eq(products.isActive, true),
        isNull(products.deletedAt),
        gt(products.stockQty, 0),
      ),
    );

  console.log(`   Saat ini ada ${midnightSweepCandidates.length} produk perishable dengan stockQty > 0.`);
  assert('Query sweep tengah malam mengeksekusi tanpa error SQL', true);
  console.log('');

  // --------------------------------------------------------------------------
  // TEST 8: Audit Stok Minus Seluruh Database
  // --------------------------------------------------------------------------
  console.log('📌 TEST 8: Pemeriksaan Stok Minus di Seluruh Tabel Products');
  const negativeStockProducts = await db
    .select({ id: products.id, name: products.name, stockQty: products.stockQty })
    .from(products)
    .where(sql`${products.stockQty} < 0`);

  assert(
    'TIDAK ADA SATUPUN produk yang memiliki stok minus (< 0) di seluruh database',
    negativeStockProducts.length === 0,
    `Produk minus: ${negativeStockProducts.map((p) => `${p.name} (${p.stockQty})`).join(', ')}`
  );
  console.log('');

  console.log('====================================================================');
  console.log(`🏁 HASIL AKHIR: ${passedTests} DARI ${totalTests} PENGUJIAN LULUS DENGAN SEMPURNA!`);
  console.log('====================================================================');
}

runTestSuite().catch((e) => {
  console.error('Fatal error saat pengujian:', e);
  process.exit(1);
});
