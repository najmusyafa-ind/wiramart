import { db } from '../src/lib/db/client';
import { sql } from 'drizzle-orm';
import { resolveReportRange, getFinancialReport, allocateProportional, KETUA_UMKM_CANONICAL_ID, KETUA_UMKM_DUPLICATE_ID, KETUA_UMKM_NIM, extractRoleFromNotes, computePersonnelWeight } from '../src/lib/finance/report';
import { shifts, employees, attendances, shiftSchedules, transactionItems, transactions, shiftCashMovements, transactionPayments } from '../src/lib/db/schema';
import { and, asc, eq, gte, lte, lt, inArray, isNull } from 'drizzle-orm';

function wibDateOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

function wibDayOfWeek(wibDateStr: string): number {
  return new Date(`${wibDateStr}T12:00:00Z`).getUTCDay();
}

function isExcludedAccount(name?: string | null, nim?: string | null): boolean {
  const lname = (name || '').toLowerCase();
  const lnim = (nim || '').trim();
  return (
    lname.includes('testing') ||
    lname.includes('dede') ||
    lnim === '02405013' ||
    lnim === '02405021' ||
    lnim === '02405015' ||
    lnim === '02405016' ||
    lnim === '02405050' ||
    lnim === '00000000'
  );
}

async function auditMonth(monthParam: string) {
  const [yStr, mStr] = monthParam.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const dateFrom = `${monthParam}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dateTo = `${monthParam}-${String(lastDay).padStart(2, '0')}`;

  const range = resolveReportRange({
    period: 'monthly',
    dateFrom,
    dateTo,
  });

  const financial = await getFinancialReport(range);

  const rawShiftRows = await db
    .select({
      id: shifts.id,
      clockIn: shifts.clockIn,
      clockOut: shifts.clockOut,
      status: shifts.status,
      modalAwal: shifts.modalAwal,
      actualCash: shifts.actualCash,
      serahTerimaDiff: shifts.serahTerimaDiff,
      employeeId: shifts.employeeId,
      kasirName: employees.fullName,
      kasirNim: employees.nim,
      kasirProdi: employees.programStudi,
      kasirJabatan: employees.jabatan,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(
      and(
        gte(shifts.clockIn, range.start),
        lt(shifts.clockIn, range.endExclusive),
      ),
    )
    .orderBy(shifts.clockIn);

  // Exclude weekend
  const shiftRows = rawShiftRows.filter((s) => {
    const wib = wibDateOf(s.clockIn);
    const dow = wibDayOfWeek(wib);
    return dow !== 0 && dow !== 6;
  });

  console.log(`\n=============================================================`);
  console.log(`BULAN: ${monthParam} (${range.label})`);
  console.log(`Raw Shifts di DB: ${rawShiftRows.length} (Weekend diabaikan: ${rawShiftRows.length - shiftRows.length})`);
  console.log(`Shift Hari Kerja Reguler: ${shiftRows.length}`);
  console.log(`Finansial Summary:`);
  console.log(`  Tx: ${financial.summary.txCount}`);
  console.log(`  Omzet: Rp ${financial.summary.omzet.toLocaleString('id-ID')}`);
  console.log(`  Laba Kotor: Rp ${financial.summary.labaKotor.toLocaleString('id-ID')}`);
  console.log(`  Beban Toko: Rp ${financial.summary.biayaOperasional.toLocaleString('id-ID')}`);
  console.log(`  Laba Bersih Operasional: Rp ${(financial.summary.labaKotor - financial.summary.biayaOperasional).toLocaleString('id-ID')}`);
  console.log(`  Alokasi Hak Mhs (50%): Rp ${financial.summary.alokasiGajiKaryawan.toLocaleString('id-ID')}`);
  console.log(`  Alokasi Kas Toko (50%): Rp ${financial.summary.labaBersih.toLocaleString('id-ID')}`);

  // Cek shift rows
  const shiftDates = shiftRows.map(s => `${wibDateOf(s.clockIn)} (${s.kasirName})`);
  console.log(`Daftar Shift Reguler:`, shiftDates);
}

async function main() {
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    await auditMonth(m);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
