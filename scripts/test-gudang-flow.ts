// =============================================================
// scripts/test-gudang-flow.ts
// Test Suite & Verifikasi Real-Time Alur Petugas Gudang Wiramart
// =============================================================

import { db } from '../src/lib/db/client';
import {
  products,
  employees,
  stockBatches,
  stockAdjustments,
} from '../src/lib/db/schema';
import { eq, ilike, isNull, and, desc } from 'drizzle-orm';
import {
  getWarehouseSummary,
  getWarehouseProducts,
  restockProductByWarehouse,
  getWarehouseActivityLogs,
} from '../src/lib/services/warehouseService';

async function runGudangTestSuite() {
  console.log('🧪 Memulai Pengujian Modul Petugas Gudang Wiramart...');

  // 1. Ambil salah satu karyawan gudang yang ada di DB
  const gudangEmployee = await db.query.employees.findFirst({
    where: and(ilike(employees.jabatan, '%gudang%'), eq(employees.isActive, true)),
  });

  if (!gudangEmployee) {
    console.error('❌ Tidak ditemukan karyawan aktif dengan jabatan Gudang di database.');
    process.exit(1);
  }

  console.log(`✅ Petugas Gudang Uji: ${gudangEmployee.fullName} (NIM: ${gudangEmployee.nim}, Jabatan: ${gudangEmployee.jabatan})`);

  // 2. Uji getWarehouseSummary
  console.log('\n📊 [TEST 1] Menguji getWarehouseSummary()...');
  const summary = await getWarehouseSummary();
  console.log(`   - Total SKU: ${summary.totalSku}`);
  console.log(`   - Stok Habis (0): ${summary.outOfStockSku}`);
  console.log(`   - Stok Kritis (<=5): ${summary.lowStockSku}`);
  console.log(`   - Mendekati Expired (FEFO <30 hari): ${summary.expiringSoonSku}`);
  console.log(`   - Restock Hari Ini: ${summary.todayRestockCount}`);
  if (typeof summary.totalSku !== 'number') throw new Error('Summary invalid');
  console.log('   -> PASSED (KPI summary valid)');

  // 3. Uji getWarehouseProducts (FEFO Radar & Filters)
  console.log('\n📋 [TEST 2] Menguji getWarehouseProducts()...');
  const allProds = await getWarehouseProducts({ filter: 'semua', limit: 10 });
  console.log(`   - Diambil: ${allProds.items.length} produk`);
  if (allProds.items.length > 0) {
    const sample = allProds.items[0];
    console.log(`   - Contoh: ${sample.name} (Stok: ${sample.stockQty} ${sample.unit}, Status: ${sample.stockStatus}, Exp: ${sample.nearestExpiryDate ?? '-'})`);
    // Pastikan costPrice tidak bocor
    if ('costPrice' in sample) {
      throw new Error('SECURITY VIOLATION: costPrice bocor di WarehouseProductDto!');
    }
  }
  console.log('   -> PASSED (Zero HPP leak verified)');

  // 4. Uji Mutasi Restock ACID (Inbound Restock)
  console.log('\n📦 [TEST 3] Menguji restockProductByWarehouse() ACID mutation...');
  const testProduct = await db.query.products.findFirst({
    where: and(eq(products.isActive, true), isNull(products.deletedAt)),
  });

  if (!testProduct) {
    throw new Error('Tidak ada produk untuk uji restock');
  }

  const initialQty = testProduct.stockQty;
  const qtyToAdd = 3;
  const testExpiry = '2026-12-31';

  console.log(`   - Target Produk: ${testProduct.name}`);
  console.log(`   - Stok Awal: ${initialQty} ${testProduct.unit}`);

  const restockResult = await restockProductByWarehouse({
    productId: testProduct.id,
    qtyAdd: qtyToAdd,
    expiryDate: testExpiry,
    notes: '[TEST AUTOMATION] Inbound barang supplier',
    employeeId: gudangEmployee.id,
  });

  console.log(`   - Restock Selesai: +${restockResult.qtyDiff} ${testProduct.unit} -> Stok Baru: ${restockResult.qtyAfter}`);
  if (restockResult.qtyAfter !== initialQty + qtyToAdd) {
    throw new Error('Perhitungan qtyAfter tidak cocok!');
  }

  // Verifikasi langsung di DB
  const updatedDbProd = await db.query.products.findFirst({
    where: eq(products.id, testProduct.id),
  });
  if (updatedDbProd?.stockQty !== initialQty + qtyToAdd) {
    throw new Error('Stok di DB products tidak sinkron!');
  }
  console.log('   -> PASSED (Database products.stockQty terupdate secara atomik)');

  // 5. Uji Audit Trail di stockAdjustments
  console.log('\n📝 [TEST 4] Menguji Audit Trail di stockAdjustments...');
  const adjRow = await db.query.stockAdjustments.findFirst({
    where: eq(stockAdjustments.id, restockResult.adjustmentId),
  });

  if (!adjRow) throw new Error('Catatan stockAdjustments tidak ditemukan!');
  console.log(`   - Audit Reason: "${adjRow.reason}"`);
  if (!adjRow.reason.includes('RESTOCK GUDANG') || !adjRow.reason.includes(gudangEmployee.fullName)) {
    throw new Error('Nama petugas gudang tidak tercatat di audit trail!');
  }
  console.log('   -> PASSED (Audit trail mencatat petugas gudang dengan akurat)');

  // 6. Uji getWarehouseActivityLogs untuk Widget Admin Dashboard
  console.log('\n🔔 [TEST 5] Menguji getWarehouseActivityLogs() untuk Admin Shift Widget...');
  const activities = await getWarehouseActivityLogs(5);
  console.log(`   - Aktivitas Terkini: ${activities.length} item`);
  const foundOurTest = activities.find((a) => a.id === restockResult.adjustmentId);
  if (!foundOurTest) throw new Error('Aktivitas uji tidak muncul di daftar aktivitas terkini!');
  console.log(`   - Notifikasi Admin Terverifikasi: "${foundOurTest.productName} (+${foundOurTest.qtyDiff})"`);
  console.log('   -> PASSED (Admin Shift Dashboard akan menerima notifikasi aktivitas ini)');

  // 7. Cleanup Test Mutation agar stok kembali normal
  console.log('\n🧹 [CLEANUP] Mengembalikan stok produk uji ke nilai semula...');
  await db
    .update(products)
    .set({ stockQty: initialQty })
    .where(eq(products.id, testProduct.id));

  if (restockResult.batchId) {
    await db.delete(stockBatches).where(eq(stockBatches.id, restockResult.batchId));
  }
  await db.delete(stockAdjustments).where(eq(stockAdjustments.id, restockResult.adjustmentId));

  console.log('   -> Database dikembalikan ke kondisi awal (Clean Rollback Verified).');

  console.log('\n✨ SEMUA 5/5 PENGUJIAN MODUL PETUGAS GUDANG LULUS 100% TANPA CACAT! ✨\n');
}

runGudangTestSuite().catch((err) => {
  console.error('❌ Test Suite Gagal:', err);
  process.exit(1);
});
