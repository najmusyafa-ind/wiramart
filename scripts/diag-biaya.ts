/**
 * Verifikasi laporan keuangan setelah fix biaya paten & pool bagi hasil.
 * 1. Soft-delete baris biaya "Biaya Operasional Tetap Bulanan" yang dobel
 *    (biaya paten 50rb sudah dihitung otomatis oleh report.ts).
 * 2. Cetak biaya/pool/laba untuk beberapa rentang + cek invarian.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { db } = await import('../src/lib/db/client');
  const { operatingExpenses, admins } = await import('../src/lib/db/schema');
  const { and, eq, isNull } = await import('drizzle-orm');
  const { resolveReportRange, getFinancialReport } = await import('../src/lib/finance/report');

  const manager = await db.query.admins.findFirst({
    where: eq(admins.role, 'MANAGER'),
    columns: { id: true },
  });
  const removed = await db.update(operatingExpenses)
    .set({
      deletedAt: new Date(),
      deletedByAdminId: manager?.id ?? null,
      deleteReason: 'Duplikat: biaya paten 50rb/bulan sudah dihitung otomatis oleh sistem laporan',
    })
    .where(and(
      eq(operatingExpenses.description, 'Biaya Operasional Tetap Bulanan (Sewa/Overhead)'),
      isNull(operatingExpenses.deletedAt),
    ))
    .returning({ id: operatingExpenses.id });
  console.log(`Soft-delete baris biaya dobel: ${removed.length}\n`);

  const cases: Array<[string, Parameters<typeof resolveReportRange>[0]]> = [
    ['Per Bulan Okt (monthly)', { period: 'monthly' }],
    ['Bulan Sep (dateFrom/To)', { dateFrom: '2026-09-01', dateTo: '2026-09-30' }],
    ['Bulan Agu (dateFrom/To)', { dateFrom: '2026-08-01', dateTo: '2026-08-31' }],
    ['Semester 2 (Jul-Des)', { period: 'semi_annual' }],
    ['6 bulan Mei-Okt', { dateFrom: '2026-05-01', dateTo: '2026-10-31' }],
    ['Sep+Okt', { dateFrom: '2026-09-01', dateTo: '2026-10-31' }],
    ['7-31 Okt', { dateFrom: '2026-10-07', dateTo: '2026-10-31' }],
    ['1 hari 20 Okt', { dateFrom: '2026-10-20', dateTo: '2026-10-20' }],
  ];
  const rows = [];
  for (const [name, input] of cases) {
    const r = await getFinancialReport(resolveReportRange(input));
    const s = r.summary;
    const sumPoolHarian = r.daily.reduce((a, d) => a + d.alokasiGajiKaryawan, 0);
    rows.push({
      rentang: name,
      labaKotor: Math.round(s.labaKotor),
      biaya: s.biayaOperasional,
      pool50: s.alokasiGajiKaryawan,
      sumPoolHarian,
      labaToko: Math.round(s.labaBersih),
      cekInvarian: r.checks.dailyMatchesSummary && r.checks.methodSplitMatches,
    });
  }
  console.table(rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
