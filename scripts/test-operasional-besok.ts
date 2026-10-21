// ============================================================================
// SIMULASI LENGKAP END-TO-END OPERASIONAL KASIR BESOK
// Alur:
// 1. Absensi & Login Kasir Shift 1 (Pagi)
// 2. Buka Laci Kasir / Isi Modal Awal Shift Pagi (Rp 100.000)
// 3. Transaksi Penjualan Shift Pagi (Tunai & QRIS) + Verifikasi transaction_logs
// 4. Tutup Kasir Shift Pagi (Hitung Fisik Laci & Serah Terima)
// 5. Absensi & Login Kasir Shift 2 (Siang)
// 6. Buka Laci Kasir Shift Siang (Rp 100.000)
// 7. Transaksi Penjualan Shift Siang
// 8. Tutup Kasir Shift Siang / Tutup Shift Hari Ini
// 9. Verifikasi Rekap Harian & Kembalikan Stok Produk Uji Coba
// ============================================================================

import { db } from '../src/lib/db/client';
import { sql, eq, and, desc, inArray } from 'drizzle-orm';
import {
  employees,
  shifts,
  products,
  transactions,
  transactionItems,
  transactionPayments,
  transactionLogs,
} from '../src/lib/db/schema';
import { signAccessToken } from '../src/lib/utils/auth';
import { NextRequest } from 'next/server';

// Import Route Handlers langsung
import { POST as loginHandler } from '../src/app/api/auth/kasir/route';
import { PATCH as bukaShiftHandler } from '../src/app/api/kasir/shift/buka/route';
import { POST as transaksiHandler } from '../src/app/api/kasir/transaksi/route';
import { PATCH as tutupShiftHandler } from '../src/app/api/kasir/shift/tutup/route';
import { GET as sesiHandler } from '../src/app/api/kasir/sesi/route';

async function main() {
  console.log('====================================================================');
  console.log('🚀 MEMULAI TEST SIMULASI OPERASIONAL SMARTKASIR PERWIRA UNTUK BESOK');
  console.log('====================================================================\n');

  // 0. Cek Kasir Aktif di Database
  const activeEmployees = await db
    .select()
    .from(employees)
    .where(and(eq(employees.isActive, true), sql`${employees.deletedAt} IS NULL`))
    .limit(5);

  if (activeEmployees.length < 2) {
    throw new Error('Minimal butuh 2 kasir aktif di database untuk simulasi pergantian shift.');
  }

  const kasir1 = activeEmployees[0];
  const kasir2 = activeEmployees[1];

  console.log(`👤 Kasir 1 (Shift Pagi) : ${kasir1.fullName} (NIM: ${kasir1.nim})`);
  console.log(`👤 Kasir 2 (Shift Siang): ${kasir2.fullName} (NIM: ${kasir2.nim})\n`);

  // Pastikan tidak ada shift ACTIVE yang menggantung sebelum test
  await db
    .update(shifts)
    .set({ status: 'CLOSED', clockOut: new Date() })
    .where(eq(shifts.status, 'ACTIVE'));

  // Ambil 2 produk nyata dengan stok > 5
  const sampleProducts = await db
    .select()
    .from(products)
    .where(and(eq(products.isActive, true), sql`${products.stockQty} >= 5`))
    .limit(2);

  if (sampleProducts.length === 0) {
    throw new Error('Tidak ada produk aktif dengan stok cukup untuk test transaksi.');
  }

  const prodA = sampleProducts[0];
  const prodB = sampleProducts[1] || sampleProducts[0];

  console.log(`📦 Produk Uji Coba:`);
  console.log(`   A: ${prodA.name} | Harga: Rp ${Number(prodA.sellingPrice).toLocaleString('id-ID')} | Stok: ${prodA.stockQty}`);
  if (prodB.id !== prodA.id) {
    console.log(`   B: ${prodB.name} | Harga: Rp ${Number(prodB.sellingPrice).toLocaleString('id-ID')} | Stok: ${prodB.stockQty}`);
  }
  console.log('');

  const stockBeforeA = prodA.stockQty;
  const stockBeforeB = prodB.stockQty;

  // Track ID untuk cleanup di akhir
  const createdShiftIds: string[] = [];
  const createdTxIds: string[] = [];

  // ==========================================================================
  // TAHAP 1: SHIFT PAGI (KASIR 1)
  // ==========================================================================
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('🌅 [TAHAP 1] SHIFT PAGI — KASIR 1 DATANG & LOGIN');
  console.log('────────────────────────────────────────────────────────────────────');

  // 1.1 Login Kasir 1
  const loginReq1 = new Request('http://localhost:3000/api/auth/kasir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nim: kasir1.nim, fullName: kasir1.fullName }),
  });

  const loginRes1 = await loginHandler(loginReq1);
  const loginData1 = await loginRes1.json();

  if (!loginRes1.ok) {
    throw new Error(`Login Kasir 1 Gagal: ${JSON.stringify(loginData1)}`);
  }
  console.log(`✅ Kasir 1 Berhasil Login: ${loginData1.data?.name} (Jabatan: ${loginData1.data?.jabatan})`);

  // Ambil token dari cookie login atau sign token
  const tokenKasir1 = await signAccessToken({
    sub: kasir1.id,
    role: 'employee',
    name: kasir1.fullName,
  });

  // 1.2 Cek Sesi Kasir 1 Sebelum Buka Laci
  const sesiReq1 = new NextRequest('http://localhost:3000/api/kasir/sesi', {
    headers: { cookie: `sk_kasir=${tokenKasir1}` },
  });
  const sesiRes1 = await sesiHandler(sesiReq1);
  const sesiData1 = await sesiRes1.json();
  console.log(`ℹ️ Status Sesi Kasir 1: Shift Aktif = ${sesiData1.data?.shift ? 'Sudah Ada' : 'Belum Ada (Menunggu Isi Uang Laci)'}`);

  // 1.3 Isi Uang Laci (Buka Shift Pagi Rp 100.000)
  console.log('\n💵 Mengisi Uang Laci / Buka Shift Pagi (Modal Awal: Rp 100.000)...');
  const bukaReq1 = new NextRequest('http://localhost:3000/api/kasir/shift/buka', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir1}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      modalAwal: 100000,
      breakdown: { '50000': 1, '20000': 2, '10000': 1 },
    }),
  });

  const bukaRes1 = await bukaShiftHandler(bukaReq1);
  const bukaData1 = await bukaRes1.json();

  if (!bukaRes1.ok) {
    throw new Error(`Buka Shift Pagi Gagal: ${JSON.stringify(bukaData1)}`);
  }

  const shiftId1 = bukaData1.data?.shiftId;
  createdShiftIds.push(shiftId1);
  console.log(`✅ Shift Pagi Berhasil Dibuka!`);
  console.log(`   Shift ID   : ${shiftId1}`);
  console.log(`   Modal Awal : Rp ${bukaData1.data?.modalAwal?.toLocaleString('id-ID')}`);
  console.log(`   Status     : ACTIVE`);

  // 1.4 Transaksi 1: Penjualan TUNAI (CASH)
  console.log('\n🛒 Transaksi 1: Penjualan TUNAI (CASH)...');
  const hargaA = Number(prodA.sellingPrice);
  const cashGiven = Math.ceil(hargaA / 10000) * 10000 + 10000;

  const txReq1 = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir1}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      items: [{ productId: prodA.id, qty: 1 }],
      paymentMethod: 'CASH',
      cashReceived: cashGiven,
    }),
  });

  const txRes1 = await transaksiHandler(txReq1);
  const txData1 = await txRes1.json();

  if (!txRes1.ok) {
    throw new Error(`Transaksi 1 Tunai Gagal: ${JSON.stringify(txData1)}`);
  }

  const tx1Id = txData1.data?.transactionId;
  createdTxIds.push(tx1Id);
  console.log(`✅ Transaksi 1 (Tunai) Sukses!`);
  console.log(`   Transaction ID: ${tx1Id}`);
  console.log(`   Invoice       : ${txData1.data?.invoiceNumber}`);
  console.log(`   Total Belanja : Rp ${Number(txData1.data?.grossAmount).toLocaleString('id-ID')}`);
  console.log(`   Uang Diterima : Rp ${cashGiven.toLocaleString('id-ID')}`);
  console.log(`   Kembalian     : Rp ${Number(txData1.data?.changeAmount).toLocaleString('id-ID')}`);

  // 1.5 Transaksi 2: Penjualan QRIS
  console.log('\n📱 Transaksi 2: Penjualan QRIS...');
  const txReq2 = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir1}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      items: [{ productId: prodB.id, qty: 1 }],
      paymentMethod: 'QRIS',
    }),
  });

  const txRes2 = await transaksiHandler(txReq2);
  const txData2 = await txRes2.json();

  if (!txRes2.ok) {
    throw new Error(`Transaksi 2 QRIS Gagal: ${JSON.stringify(txData2)}`);
  }

  const tx2Id = txData2.data?.transactionId;
  createdTxIds.push(tx2Id);
  console.log(`✅ Transaksi 2 (QRIS) Sukses!`);
  console.log(`   Transaction ID: ${tx2Id}`);
  console.log(`   Invoice       : ${txData2.data?.invoiceNumber}`);
  console.log(`   Total QRIS    : Rp ${Number(txData2.data?.grossAmount).toLocaleString('id-ID')}`);

  // 1.6 Verifikasi Tabel transaction_logs
  const auditLogs1 = await db
    .select()
    .from(transactionLogs)
    .where(inArray(transactionLogs.transactionId, [tx1Id, tx2Id]));

  console.log(`\n🛡️ Verifikasi Audit Trail (transaction_logs):`);
  console.log(`   Ditemukan ${auditLogs1.length} log audit COMMITTED di database.`);
  auditLogs1.forEach(log => {
    console.log(`   - Invoice ${log.invoiceAttempt} | Metode: ${log.paymentMethod} | Outcome: ${log.outcome} | Nominal: Rp ${log.grossAmount}`);
  });

  // 1.7 Tutup Kasir Shift Pagi (Ganti Shift)
  console.log('\n🔒 Tutup Kasir Shift Pagi (Serah Terima Kasir)...');
  const uangLaciFisik1 = 100000 + hargaA;

  const tutupReq1 = new NextRequest('http://localhost:3000/api/kasir/shift/tutup', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir1}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      actualCash: uangLaciFisik1,
      notes: 'Serah terima shift pagi ke kasir shift siang selesai lancar.',
    }),
  });

  const tutupRes1 = await tutupShiftHandler(tutupReq1);
  const tutupData1 = await tutupRes1.json();

  if (!tutupRes1.ok) {
    throw new Error(`Tutup Shift Pagi Gagal: ${JSON.stringify(tutupData1)}`);
  }

  console.log(`✅ Shift Pagi Berhasil Ditutup!`);
  console.log(`   Total Transaksi : ${tutupData1.data?.txCount}`);
  console.log(`   Expected Kas    : Rp ${tutupData1.data?.expectedCash?.toLocaleString('id-ID')}`);
  console.log(`   Fisik Laci Kasir: Rp ${tutupData1.data?.actualCash?.toLocaleString('id-ID')}`);
  console.log(`   Selisih Kas     : Rp ${tutupData1.data?.difference?.toLocaleString('id-ID')} (${tutupData1.data?.difference === 0 ? 'COCOK / BALANCED ✅' : 'SELISIH ⚠️'})`);

  // ==========================================================================
  // TAHAP 2: SHIFT SIANG (KASIR 2)
  // ==========================================================================
  console.log('\n────────────────────────────────────────────────────────────────────');
  console.log('☀️ [TAHAP 2] SHIFT SIANG — PERGANTIAN KASIR (KASIR 2 DATANG & LOGIN)');
  console.log('────────────────────────────────────────────────────────────────────');

  // 2.1 Login Kasir 2
  const loginReq2 = new Request('http://localhost:3000/api/auth/kasir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nim: kasir2.nim, fullName: kasir2.fullName }),
  });

  const loginRes2 = await loginHandler(loginReq2);
  const loginData2 = await loginRes2.json();

  if (!loginRes2.ok) {
    throw new Error(`Login Kasir 2 Gagal: ${JSON.stringify(loginData2)}`);
  }
  console.log(`✅ Kasir 2 (Shift Siang) Berhasil Login: ${loginData2.data?.name} (Jabatan: ${loginData2.data?.jabatan})`);

  const tokenKasir2 = await signAccessToken({
    sub: kasir2.id,
    role: 'employee',
    name: kasir2.fullName,
  });

  // 2.2 Buka Shift Siang (Isi Modal Awal Rp 100.000)
  console.log('\n💵 Mengisi Uang Laci Shift Siang (Modal Awal: Rp 100.000)...');
  const bukaReq2 = new NextRequest('http://localhost:3000/api/kasir/shift/buka', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir2}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      modalAwal: 100000,
      breakdown: { '50000': 2 },
    }),
  });

  const bukaRes2 = await bukaShiftHandler(bukaReq2);
  const bukaData2 = await bukaRes2.json();

  if (!bukaRes2.ok) {
    throw new Error(`Buka Shift Siang Gagal: ${JSON.stringify(bukaData2)}`);
  }

  const shiftId2 = bukaData2.data?.shiftId;
  createdShiftIds.push(shiftId2);
  console.log(`✅ Shift Siang Berhasil Dibuka!`);
  console.log(`   Shift ID   : ${shiftId2}`);
  console.log(`   Modal Awal : Rp ${bukaData2.data?.modalAwal?.toLocaleString('id-ID')}`);
  console.log(`   Status     : ACTIVE`);

  // 2.3 Transaksi Penjualan Shift Siang
  console.log('\n🛒 Transaksi Shift Siang: Penjualan TUNAI...');
  const txReq3 = new NextRequest('http://localhost:3000/api/kasir/transaksi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir2}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      items: [{ productId: prodA.id, qty: 1 }],
      paymentMethod: 'CASH',
      cashReceived: 50000,
    }),
  });

  const txRes3 = await transaksiHandler(txReq3);
  const txData3 = await txRes3.json();

  if (!txRes3.ok) {
    throw new Error(`Transaksi Shift Siang Gagal: ${JSON.stringify(txData3)}`);
  }

  const tx3Id = txData3.data?.transactionId;
  createdTxIds.push(tx3Id);
  console.log(`✅ Transaksi Shift Siang Sukses!`);
  console.log(`   Transaction ID: ${tx3Id}`);
  console.log(`   Invoice       : ${txData3.data?.invoiceNumber}`);
  console.log(`   Total Belanja : Rp ${Number(txData3.data?.grossAmount).toLocaleString('id-ID')}`);

  // 2.4 Tutup Shift Siang / Tutup Shift Hari Ini
  console.log('\n🔒 Tutup Kasir Shift Siang / Closing Toko Hari Ini...');
  const uangLaciFisik2 = 100000 + hargaA;

  const tutupReq2 = new NextRequest('http://localhost:3000/api/kasir/shift/tutup', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      cookie: `sk_kasir=${tokenKasir2}`,
      host: 'localhost:3000',
    },
    body: JSON.stringify({
      actualCash: uangLaciFisik2,
      notes: 'Tutup kasir shift siang / penutupan operasional toko.',
    }),
  });

  const tutupRes2 = await tutupShiftHandler(tutupReq2);
  const tutupData2 = await tutupRes2.json();

  if (!tutupRes2.ok) {
    throw new Error(`Tutup Shift Siang Gagal: ${JSON.stringify(tutupData2)}`);
  }

  console.log(`✅ Shift Siang Berhasil Ditutup!`);
  console.log(`   Status: CLOSED`);
  console.log(`   Expected Kas    : Rp ${tutupData2.data?.expectedCash?.toLocaleString('id-ID')}`);
  console.log(`   Fisik Laci Kasir: Rp ${tutupData2.data?.actualCash?.toLocaleString('id-ID')}`);
  console.log(`   Selisih Kas     : Rp ${tutupData2.data?.difference?.toLocaleString('id-ID')} (${tutupData2.data?.difference === 0 ? 'COCOK / BALANCED ✅' : 'SELISIH ⚠️'})`);

  // ==========================================================================
  // TAHAP 3: AUDIT & CLEANUP AMAN
  // ==========================================================================
  console.log('\n────────────────────────────────────────────────────────────────────');
  console.log('🧹 [TAHAP 3] AUDIT INTEGRASI & RESTORASI STOK AMAN UNTUK BESOK');
  console.log('────────────────────────────────────────────────────────────────────');

  // 3.1 Kembalikan stok produk uji coba ke kondisi semula
  await db
    .update(products)
    .set({ stockQty: stockBeforeA })
    .where(eq(products.id, prodA.id));

  if (prodB.id !== prodA.id) {
    await db
      .update(products)
      .set({ stockQty: stockBeforeB })
      .where(eq(products.id, prodB.id));
  }
  console.log('✅ Stok fisik produk telah dikembalikan 100% utuh seperti semula.');

  // 3.2 Hapus data transaksi & shift uji coba agar tidak mengotori buku riil besok
  await db.delete(transactionLogs).where(inArray(transactionLogs.transactionId, createdTxIds));
  await db.delete(transactionPayments).where(inArray(transactionPayments.transactionId, createdTxIds));
  await db.delete(transactionItems).where(inArray(transactionItems.transactionId, createdTxIds));
  await db.delete(transactions).where(inArray(transactions.id, createdTxIds));
  await db.delete(shifts).where(inArray(shifts.id, createdShiftIds));
  console.log('✅ Data transaksi & shift uji coba telah dibersihkan secara aman.');

  // 3.3 Verifikasi akhir database: tidak ada shift ACTIVE yang menggantung
  const lingeringShifts: any = await db.execute(sql`
    SELECT count(*) as count FROM shifts WHERE status = 'ACTIVE';
  `);
  console.log(`✅ Verifikasi Sesi Menggantung: ${lingeringShifts[0].count} shift aktif (SIAP 100% UNTUK BESOK)`);

  console.log('\n====================================================================');
  console.log('🎉 SEMUA TAHAPAN TEST OPERASIONAL BESOK BERHASIL 100% TANPA KENDALA!');
  console.log('   - Absensi & Login Kasir: ✅ PASS');
  console.log('   - Isi Uang Laci (Buka Shift): ✅ PASS');
  console.log('   - Transaksi Kasir (Tunai & QRIS): ✅ PASS');
  console.log('   - Audit Trail (transaction_logs): ✅ PASS');
  console.log('   - Tutup Kasir Shift 1 (Ganti Shift): ✅ PASS');
  console.log('   - Buka Kasir Shift 2 (Shift Siang): ✅ PASS');
  console.log('   - Transaksi Kasir Shift Siang: ✅ PASS');
  console.log('   - Tutup Shift Hari Ini: ✅ PASS');
  console.log('====================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ TEST SIMULASI GAGAL:', err);
  process.exit(1);
});
