import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load PRODUCTION environment
const prodEnv = dotenv.parse(fs.readFileSync('.env.production.local'));
const sql = postgres(prodEnv.DATABASE_URL);

async function hitungGajiBagiHasil() {
  console.log('================================================================');
  console.log('HITUNG GAJI BAGI HASIL PER MAHASISWA - DATA PRODUKSI WIRAMART');
  console.log('================================================================\n');

  // ============================================================
  // A. Ambil SEMUA data laba kotor per shift dari SEMUA transaksi historis
  //    (Catatan: di produksi shift_id IS NOT NULL = 0 tx gap, jadi kita bisa
  //     langsung join shift -> transaction)
  // ============================================================

  // Laba per shift (basis pembagian)
  const labaPerShift = await sql`
    SELECT
      s.id AS shift_id,
      s.clock_in AT TIME ZONE 'Asia/Jakarta' AS jam_buka,
      TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS tanggal,
      TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'Day') AS hari,
      s.employee_id AS kasir_id,
      e.full_name AS kasir,
      COUNT(t.id)::int AS jumlah_tx,
      COALESCE(SUM(t.gross_profit), 0)::numeric AS laba_kotor_shift,
      FLOOR(COALESCE(SUM(t.gross_profit), 0) * 0.5) AS pool_50pct
    FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN transactions t ON t.shift_id = s.id AND t.is_test = false AND t.status = 'COMPLETED'
    GROUP BY s.id, s.clock_in, e.full_name, e.full_name, s.employee_id
    ORDER BY s.clock_in;
  `;

  // ============================================================
  // B. Absensi per shift-date (hanya HADIR, TELAT, PENGGANTI saja)
  //    Alpha / TIDAK_HADIR / IJIN = 0 rupiah
  // ============================================================
  const absensiDetail = await sql`
    SELECT
      a.id AS absensi_id,
      a.employee_id,
      a.shift_id AS att_shift_id,
      a.attendance_date::text,
      a.status,
      a.clock_in_actual,
      a.clock_out_actual,
      ss.slot_start,
      ss.slot_end,
      e.full_name AS nama,
      e.nim,
      e.program_studi AS prodi,
      e.jabatan
    FROM attendances a
    JOIN employees e ON a.employee_id = e.id
    JOIN shift_schedules ss ON a.schedule_id = ss.id
    ORDER BY a.attendance_date, ss.slot_start;
  `;

  console.log(`Data Shift Total: ${labaPerShift.length}`);
  console.log(`Data Absensi Total: ${absensiDetail.length}`);

  // ============================================================
  // C. Kelompokkan absensi per tanggal
  // ============================================================
  type AttRecord = typeof absensiDetail[0];
  const attByDate = new Map<string, AttRecord[]>();
  for (const a of absensiDetail) {
    if (!attByDate.has(a.attendance_date)) attByDate.set(a.attendance_date, []);
    attByDate.get(a.attendance_date)!.push(a);
  }

  // Kelompokkan shift per tanggal
  type ShiftRecord = typeof labaPerShift[0];
  const shiftByDate = new Map<string, ShiftRecord[]>();
  for (const s of labaPerShift) {
    if (!shiftByDate.has(s.tanggal)) shiftByDate.set(s.tanggal, []);
    shiftByDate.get(s.tanggal)!.push(s);
  }

  // ============================================================
  // D. Hitung akumulasi gaji per karyawan
  // ============================================================
  const empGaji = new Map<string, {
    nama: string;
    nim: string;
    prodi: string;
    jabatan: string;
    totalHadir: number;
    totalAlpha: number;
    totalTelat: number;
    totalNominal: number;
    detail: { tanggal: string; shift: string; nominal: number; status: string }[];
  }>();

  for (const [tanggal, shiftsOnDay] of shiftByDate.entries()) {
    const attsOnDay = attByDate.get(tanggal) ?? [];
    const hadirOnDay = attsOnDay.filter(a => ['HADIR', 'TELAT', 'PENGGANTI'].includes(a.status));

    // Per shift pada hari itu:
    for (const shift of shiftsOnDay) {
      const pool = Number(shift.pool_50pct);

      // Cocokkan attendee ke shift ini via multi-tier:
      // Tier 1: att.shift_id === shift.id
      // Tier 2: att.employee_id === shift.kasir_id (kasir pemegang sesi laci)
      // Tier 3: clockInActual overlap jam shift (±30 menit)
      // Tier 4: slot_start heuristik (pagi < 11, siang >= 11)
      const shiftHourWib = new Date(new Date(shift.jam_buka).getTime()).getHours();
      const shiftIsAfternoon = shiftHourWib >= 11;

      const matchedAtts: AttRecord[] = [];
      for (const att of hadirOnDay) {
        if (att.att_shift_id === shift.shift_id) {
          matchedAtts.push(att);
        }
      }
      if (matchedAtts.length === 0) {
        for (const att of hadirOnDay) {
          if (att.employee_id === shift.kasir_id) {
            matchedAtts.push(att);
          }
        }
      }
      if (matchedAtts.length === 0 && shiftsOnDay.length > 1) {
        for (const att of hadirOnDay) {
          if (att.clock_in_actual) {
            const attTime = new Date(att.clock_in_actual).getTime();
            const sIn = new Date(shift.jam_buka).getTime();
            if (Math.abs(attTime - sIn) <= 4 * 3600 * 1000) {
              matchedAtts.push(att);
            }
          }
        }
      }
      if (matchedAtts.length === 0) {
        for (const att of hadirOnDay) {
          const slotHour = att.slot_start ? parseInt(att.slot_start.split(':')[0] ?? '8') : 8;
          const attIsAfternoon = slotHour >= 11;
          if (attIsAfternoon === shiftIsAfternoon) {
            matchedAtts.push(att);
          }
        }
      }
      // Jika masih kosong dan hanya 1 shift hari itu, semua hadiran hari ini masuk
      if (matchedAtts.length === 0 && shiftsOnDay.length === 1) {
        matchedAtts.push(...hadirOnDay);
      }

      const count = matchedAtts.length;
      const nominalPerOrang = count > 0 ? Math.floor(pool / count) : 0;

      for (const att of matchedAtts) {
        const empId = att.employee_id;
        if (!empGaji.has(empId)) {
          empGaji.set(empId, {
            nama: att.nama,
            nim: att.nim,
            prodi: att.prodi,
            jabatan: att.jabatan,
            totalHadir: 0,
            totalAlpha: 0,
            totalTelat: 0,
            totalNominal: 0,
            detail: [],
          });
        }
        const rec = empGaji.get(empId)!;
        rec.totalHadir += 1;
        if (att.status === 'TELAT') rec.totalTelat += 1;
        rec.totalNominal += nominalPerOrang;
        rec.detail.push({
          tanggal,
          shift: shiftIsAfternoon ? 'Siang' : 'Pagi',
          nominal: nominalPerOrang,
          status: att.status,
        });
      }
    }

    // Catat alpha (mahasiswa dijadwal tapi tidak hadir)
    for (const att of attsOnDay) {
      if (['TIDAK_HADIR', 'IJIN'].includes(att.status)) {
        const empId = att.employee_id;
        if (!empGaji.has(empId)) {
          empGaji.set(empId, {
            nama: att.nama,
            nim: att.nim,
            prodi: att.prodi,
            jabatan: att.jabatan,
            totalHadir: 0,
            totalAlpha: 0,
            totalTelat: 0,
            totalNominal: 0,
            detail: [],
          });
        }
        empGaji.get(empId)!.totalAlpha += 1;
      }
    }
  }

  // ============================================================
  // E. Output tabel bagi hasil per karyawan
  // ============================================================
  const sorted = Array.from(empGaji.values()).sort((a, b) => b.totalNominal - a.totalNominal);

  console.log('\n================================================================');
  console.log('TABEL BAGI HASIL SEMUA MAHASISWA (ALPHA = Rp 0)');
  console.log('================================================================');
  console.table(sorted.map(e => ({
    nama: e.nama,
    nim: e.nim,
    prodi: e.prodi,
    jabatan: e.jabatan,
    hadir: e.totalHadir,
    telat: e.totalTelat,
    alpha: e.totalAlpha,
    gaji_bagi_hasil: `Rp ${e.totalNominal.toLocaleString('id-ID')}`,
  })));

  // ============================================================
  // F. Ringkasan finansial per bulan
  // ============================================================
  const totalPool = labaPerShift.reduce((acc, s) => acc + Number(s.pool_50pct), 0);
  const totalDidistribusi = sorted.reduce((acc, e) => acc + e.totalNominal, 0);

  console.log('\n--- RINGKASAN FINANSIAL ---');
  console.log(`Total Pool Bagi Hasil 50% (semua bulan): Rp ${totalPool.toLocaleString('id-ID')}`);
  console.log(`Total Sudah Didistribusi ke Mahasiswa  : Rp ${totalDidistribusi.toLocaleString('id-ID')}`);
  console.log(`Selisih (kembalian ke toko)            : Rp ${(totalPool - totalDidistribusi).toLocaleString('id-ID')}`);

  // ============================================================
  // G. Per bulan ringkasan
  // ============================================================
  const perBulan = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS bulan,
      COUNT(*)::int AS total_tx,
      ROUND(SUM(gross_amount)) AS omzet,
      ROUND(SUM(gross_profit)) AS laba_kotor,
      ROUND(SUM(gross_profit) * 0.5) AS pool_50pct
    FROM transactions
    WHERE is_test = false AND status = 'COMPLETED'
    GROUP BY TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')
    ORDER BY bulan;
  `;
  console.log('\n--- POOL BAGI HASIL PER BULAN ---');
  console.table(perBulan.map(r => ({
    bulan: r.bulan,
    total_tx: r.total_tx,
    omzet: `Rp ${Number(r.omzet).toLocaleString('id-ID')}`,
    laba_kotor: `Rp ${Number(r.laba_kotor).toLocaleString('id-ID')}`,
    pool_50pct: `Rp ${Number(r.pool_50pct).toLocaleString('id-ID')}`,
  })));

  await sql.end();
}

hitungGajiBagiHasil().catch(console.error);
