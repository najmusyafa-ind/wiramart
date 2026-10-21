import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load PRODUCTION environment
const prodEnv = dotenv.parse(fs.readFileSync('.env.production.local'));
const sql = postgres(prodEnv.DATABASE_URL);

async function auditProduction() {
  console.log('=======================================================');
  console.log('AUDIT PRODUKSI - WIRAMART');
  console.log('Tanggal Audit: ' + new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));
  console.log('=======================================================\n');

  // 1. Overview data transaksi
  const [txOverview] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE is_test = false AND status = 'COMPLETED')::int AS total_tx_riil,
      ROUND(SUM(gross_amount) FILTER (WHERE is_test = false AND status = 'COMPLETED')) AS total_omzet,
      ROUND(SUM(gross_profit) FILTER (WHERE is_test = false AND status = 'COMPLETED')) AS total_laba_kotor,
      MIN(created_at AT TIME ZONE 'Asia/Jakarta') FILTER (WHERE is_test = false AND status = 'COMPLETED') AS tx_mulai_dari,
      MAX(created_at AT TIME ZONE 'Asia/Jakarta') FILTER (WHERE is_test = false AND status = 'COMPLETED') AS tx_terakhir
    FROM transactions;
  `;
  console.log('--- [1] OVERVIEW TRANSAKSI PRODUKSI ---');
  console.log(`Total Transaksi Riil    : ${txOverview.total_tx_riil}`);
  console.log(`Total Omzet             : Rp ${Number(txOverview.total_omzet).toLocaleString('id-ID')}`);
  console.log(`Total Laba Kotor        : Rp ${Number(txOverview.total_laba_kotor).toLocaleString('id-ID')}`);
  console.log(`Transaksi Mulai Dari    : ${txOverview.tx_mulai_dari}`);
  console.log(`Transaksi Terakhir      : ${txOverview.tx_terakhir}`);

  // 2. Semua shift Senin-Jumat beserta kasir dan jumlah transaksi
  const allShifts = await sql`
    SELECT
      s.id AS shift_id,
      s.clock_in AT TIME ZONE 'Asia/Jakarta' AS jam_buka,
      s.clock_out AT TIME ZONE 'Asia/Jakarta' AS jam_tutup,
      s.modal_awal,
      s.status AS status_shift,
      TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'Day') AS hari,
      e.full_name AS kasir,
      e.nim,
      e.program_studi AS prodi,
      COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED' AND t.is_test = false)::int AS jumlah_tx,
      ROUND(COALESCE(SUM(t.gross_amount) FILTER (WHERE t.status = 'COMPLETED' AND t.is_test = false), 0)) AS omzet_shift,
      ROUND(COALESCE(SUM(t.gross_profit) FILTER (WHERE t.status = 'COMPLETED' AND t.is_test = false), 0)) AS laba_shift
    FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN transactions t ON t.shift_id = s.id
    WHERE EXTRACT(DOW FROM s.clock_in AT TIME ZONE 'Asia/Jakarta') BETWEEN 1 AND 5
    GROUP BY s.id, s.clock_in, s.clock_out, s.modal_awal, s.status, e.full_name, e.nim, e.program_studi
    ORDER BY s.clock_in DESC
    LIMIT 60;
  `;
  console.log('\n--- [2] SEMUA SHIFT SENIN-JUMAT (PRODUKSI, 60 terakhir) ---');
  console.table(allShifts.map(s => ({
    hari: s.hari?.trim(),
    jam_buka: s.jam_buka ? new Date(s.jam_buka).toLocaleString('id-ID') : '-',
    jam_tutup: s.jam_tutup ? new Date(s.jam_tutup).toLocaleString('id-ID') : '-',
    kasir: s.kasir,
    nim: s.nim,
    status_shift: s.status_shift,
    jumlah_tx: s.jumlah_tx,
    omzet_shift: `Rp ${Number(s.omzet_shift).toLocaleString('id-ID')}`,
    laba_shift: `Rp ${Number(s.laba_shift).toLocaleString('id-ID')}`,
  })));

  // 3. Absensi kehadiran semua mahasiswa Senin-Jumat
  const absensiStats = await sql`
    SELECT
      e.full_name AS nama,
      e.nim,
      e.program_studi AS prodi,
      e.jabatan,
      COUNT(*) FILTER (WHERE a.status IN ('HADIR', 'TELAT', 'PENGGANTI'))::int AS hadir,
      COUNT(*) FILTER (WHERE a.status = 'TELAT')::int AS telat,
      COUNT(*) FILTER (WHERE a.status = 'PENGGANTI')::int AS pengganti,
      COUNT(*) FILTER (WHERE a.status IN ('TIDAK_HADIR', 'IJIN'))::int AS alpha_ijin,
      COUNT(*)::int AS total_jadwal_tercatat
    FROM attendances a
    JOIN employees e ON a.employee_id = e.id
    WHERE EXTRACT(DOW FROM (a.attendance_date::date)) BETWEEN 1 AND 5
    GROUP BY e.id, e.full_name, e.nim, e.program_studi, e.jabatan
    ORDER BY hadir DESC, alpha_ijin ASC;
  `;
  console.log('\n--- [3] REKAP ABSENSI SEMUA MAHASISWA SENIN-JUMAT (PRODUKSI) ---');
  console.table(absensiStats);

  // 4. Transaksi per bulan
  const txPerBulan = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS bulan,
      COUNT(*)::int AS total_tx,
      ROUND(SUM(gross_amount)) AS omzet,
      ROUND(SUM(gross_profit)) AS laba_kotor,
      ROUND(SUM(gross_profit) * 0.5) AS pool_gaji_50pct
    FROM transactions
    WHERE is_test = false AND status = 'COMPLETED'
    GROUP BY TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')
    ORDER BY bulan;
  `;
  console.log('\n--- [4] OMZET & POOL GAJI 50% PER BULAN (PRODUKSI) ---');
  console.table(txPerBulan.map(r => ({
    bulan: r.bulan,
    total_tx: r.total_tx,
    omzet: `Rp ${Number(r.omzet).toLocaleString('id-ID')}`,
    laba_kotor: `Rp ${Number(r.laba_kotor).toLocaleString('id-ID')}`,
    pool_gaji_50pct: `Rp ${Number(r.pool_gaji_50pct).toLocaleString('id-ID')}`,
  })));

  // 5. Transaksi yang shift_id NULL (berpotensi tidak terhitung di bagi hasil)
  const [nullShiftTx] = await sql`
    SELECT
      COUNT(*)::int AS total_tx_null_shift,
      ROUND(SUM(gross_profit)) AS laba_null_shift
    FROM transactions
    WHERE is_test = false AND status = 'COMPLETED' AND shift_id IS NULL;
  `;
  console.log('\n--- [5] TRANSAKSI TANPA shift_id (POTENSI GAP BAGI HASIL) ---');
  console.log(nullShiftTx);

  // 6. Hitungan absensi: shifts yang tidak terhubung ke attendance
  const [attendShiftStats] = await sql`
    SELECT
      COUNT(*)::int AS total_absensi,
      COUNT(shift_id)::int AS absensi_ada_shift_id,
      COUNT(*) FILTER (WHERE shift_id IS NULL)::int AS absensi_null_shift_id
    FROM attendances;
  `;
  console.log('\n--- [6] RELASI attendance.shift_id (KUALITAS DATA) ---');
  console.log(attendShiftStats);

  await sql.end();
}

auditProduction().catch(console.error);
