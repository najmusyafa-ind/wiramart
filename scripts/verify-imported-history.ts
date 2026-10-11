import { db } from '../src/lib/db/client';
import { resolveReportRange, getFinancialReport } from '../src/lib/finance/report';
import { shifts, transactions } from '../src/lib/db/schema';
import { sql } from 'drizzle-orm';

async function verify() {
  console.log('🔍 Menjalankan Audit Laporan Finansial Wiramart...');

  const range = resolveReportRange({
    dateFrom: '2026-08-15',
    dateTo: '2026-09-14',
  });

  const report = await getFinancialReport(range);

  console.log('\n======================================================');
  console.log(`📊 LAPORAN KEUANGAN HISTORIS WIRAMART UNPERBA`);
  console.log(`Periode: ${range.label}`);
  console.log('======================================================');
  console.log(`💰 Total Omzet:             Rp ${report.summary.omzet.toLocaleString('id-ID')}`);
  console.log(`💵 Omzet Cash (Tunai):      Rp ${report.summary.omzetCash.toLocaleString('id-ID')}`);
  console.log(`💳 Omzet QRIS:              Rp ${report.summary.omzetQris.toLocaleString('id-ID')}`);
  console.log(`🧾 Total Transaksi:         ${report.summary.txCount}`);
  console.log(`📦 Total HPP Terjual:       Rp ${report.summary.hppTerjual.toLocaleString('id-ID')}`);
  console.log(`📈 Laba Kotor:              Rp ${report.summary.labaKotor.toLocaleString('id-ID')}`);
  console.log(`👥 Alokasi Gaji (50%):      Rp ${report.summary.alokasiGajiKaryawan.toLocaleString('id-ID')}`);
  console.log(`🏢 Laba Bersih Hak Toko:    Rp ${report.summary.labaBersih.toLocaleString('id-ID')}`);
  console.log('======================================================\n');

  console.log('📅 Rincian Omzet Harian:');
  for (const d of report.daily) {
    console.log(`   - ${d.date}: ${d.txCount} transaksi | Omzet: Rp ${d.omzet.toLocaleString('id-ID')} | Laba Kotor: Rp ${d.labaKotor.toLocaleString('id-ID')}`);
  }

  console.log('\n🛡️ Triple Integrity Checks:');
  console.log(`   - Method Split Matches:  ${report.checks.methodSplitMatches ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   - Items Match Omzet:     ${report.checks.itemsMatchOmzet ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   - Daily Matches Summary: ${report.checks.dailyMatchesSummary ? '✅ PASSED' : '❌ FAILED'}`);

  // Query Shift 14 September
  console.log('\n👥 Daftar Shift Tanggal 14 September 2026:');
  const shifts14 = await db
    .select({
      id: shifts.id,
      notes: shifts.notes,
      modalAwal: shifts.modalAwal,
      actualCash: shifts.actualCash,
      clockIn: shifts.clockIn,
      clockOut: shifts.clockOut,
    })
    .from(shifts)
    .where(sql`DATE(${shifts.clockIn} AT TIME ZONE 'Asia/Jakarta') = '2026-09-14'::date`);

  for (const s of shifts14) {
    console.log(`   🔹 Shift ID: ${s.id}`);
    console.log(`      Catatan: ${s.notes}`);
    console.log(`      Modal: Rp ${Number(s.modalAwal).toLocaleString('id-ID')} | Fisik Kas: Rp ${Number(s.actualCash).toLocaleString('id-ID')}`);
  }
}

verify().catch(console.error).finally(() => process.exit(0));
