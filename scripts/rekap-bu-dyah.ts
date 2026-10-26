import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { getFinancialReport, resolveReportRange } = await import('../src/lib/finance/report');
  const { db } = await import('../src/lib/db/client');
  const { transactions, transactionItems } = await import('../src/lib/db/schema');
  const { eq, and, gte, lt, sql } = await import('drizzle-orm');

  const range = resolveReportRange({ dateFrom: '2026-10-07', dateTo: '2026-10-31' });
  const report = await getFinancialReport(range);
  const s = report.summary;

  // Top 5 produk terlaris
  const top = await db.select({
    nama: transactionItems.productNameSnapshot,
    qty: sql<string>`SUM(qty)`,
    revenue: sql<string>`SUM(subtotal_sell)`,
  }).from(transactionItems)
    .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
    .where(and(
      eq(transactions.status, 'COMPLETED'),
      eq(transactions.isTest, false),
      gte(transactions.createdAt, range.start),
      lt(transactions.createdAt, range.endExclusive),
    ))
    .groupBy(transactionItems.productNameSnapshot)
    .orderBy(sql`SUM(qty) DESC`)
    .limit(10);

  const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║      REKAP KEUANGAN KUMULATIF — WIRAMART UNPERBA     ║');
  console.log('║          7 Oktober 2026 s/d 31 Oktober 2026          ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📊 RINGKASAN PENJUALAN:');
  console.log(`   Total Transaksi    : ${s.txCount} transaksi (${s.voidCount} void)`);
  console.log(`   Omzet Total        : ${fmt(s.omzet)}`);
  console.log(`   Omzet Cash         : ${fmt(s.omzetCash)}`);
  console.log(`   Omzet QRIS         : ${fmt(s.omzetQris)}`);
  console.log('');
  console.log('💰 ANALISIS KEUNTUNGAN:');
  console.log(`   HPP Terjual        : ${fmt(s.hppTerjual)}`);
  console.log(`   Laba Kotor         : ${fmt(s.labaKotor)}`);
  console.log(`   Biaya Operasional  : ${fmt(s.biayaOperasional)}`);
  console.log(`   ─────────────────────────────────────────`);
  console.log(`   LABA BERSIH        : ${fmt(s.labaBersih)}`);
  console.log('');
  console.log('🎓 BAGI HASIL (50% Laba Kotor):');
  console.log(`   Pool Gaji Mahasiswa: ${fmt(s.alokasiGajiKaryawan)}`);
  console.log(`   Sisa Margin Toko   : ${fmt(s.labaBersih - s.alokasiGajiKaryawan)}`);
  console.log('');
  console.log('🏆 TOP 10 PRODUK TERLARIS:');
  top.forEach((p, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. ${String(p.nama).padEnd(25)} ${String(p.qty).padStart(4)} pcs  ${fmt(Number(p.revenue))}`);
  });
  console.log('');

  process.exit(0);
}

main().catch(console.error);
