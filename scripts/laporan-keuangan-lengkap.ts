import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

const prodEnv = dotenv.parse(fs.readFileSync('.env.production.local'));
const sql = postgres(prodEnv.DATABASE_URL);

async function laporanKeuanganLengkap() {
  console.log('================================================================');
  console.log('LAPORAN KEUANGAN LENGKAP — PRODUKSI WIRAMART');
  console.log('================================================================\n');

  // Produk bermasalah: HPP > selling_price (stock_qty bukan stock)
  const hppBermasalah = await sql`
    SELECT id, name, selling_price, cost_price,
           (cost_price - selling_price) AS rugi_per_unit, stock_qty, is_active
    FROM products
    WHERE cost_price > selling_price AND cost_price > 0
    ORDER BY (cost_price - selling_price) DESC;
  `;
  console.log(`--- [A] PRODUK HPP > HARGA JUAL (ROOT CAUSE MINUS): ${hppBermasalah.length} produk ---`);
  if (hppBermasalah.length > 0) {
    console.table(hppBermasalah.map(p => ({
      nama: p.name,
      hpp: `Rp ${Number(p.cost_price).toLocaleString('id-ID')}`,
      jual: `Rp ${Number(p.selling_price).toLocaleString('id-ID')}`,
      rugi_unit: `Rp ${Number(p.rugi_per_unit).toLocaleString('id-ID')}`,
      stok: p.stock_qty,
      aktif: p.is_active,
    })));
  } else console.log('Tidak ada');

  // Produk HPP = 0 tapi terjual
  const hppNol = await sql`
    SELECT p.id, p.name, p.selling_price, p.cost_price,
           COUNT(ti.id)::int AS kali_terjual, SUM(ti.qty)::int AS total_qty
    FROM products p
    JOIN transaction_items ti ON ti.product_id = p.id
    JOIN transactions t ON ti.transaction_id = t.id
    WHERE (p.cost_price IS NULL OR p.cost_price = 0)
      AND t.is_test = false AND t.status = 'COMPLETED'
    GROUP BY p.id ORDER BY kali_terjual DESC LIMIT 15;
  `;
  console.log(`\n--- [B] PRODUK HPP NOL TAPI TERJUAL (LABA SEMU): ${hppNol.length} produk ---`);
  if (hppNol.length > 0) {
    console.table(hppNol.map(p => ({
      nama: p.name,
      harga_jual: `Rp ${Number(p.selling_price).toLocaleString('id-ID')}`,
      hpp: Number(p.cost_price ?? 0),
      transaksi: p.kali_terjual,
      qty_terjual: p.total_qty,
    })));
  } else console.log('✅ Semua produk yang terjual memiliki HPP > 0');

  // Snapshot dari transaction_items — apakah pakai harga lama atau harga sekarang?
  const snapshotCheck = await sql`
    SELECT 
      ti.product_id,
      p.name,
      ti.cost_price_snapshot,
      ti.selling_price_snapshot,
      p.cost_price AS hpp_sekarang,
      p.selling_price AS jual_sekarang,
      ti.qty,
      ti.subtotal_cost,
      ti.subtotal_sell,
      (ti.subtotal_sell - ti.subtotal_cost) AS margin_item
    FROM transaction_items ti
    JOIN products p ON ti.product_id = p.id
    JOIN transactions t ON ti.transaction_id = t.id
    WHERE t.gross_profit < 0 AND t.is_test = false
    LIMIT 10;
  `;
  console.log('\n--- [C] SNAPSHOT HARGA SAAT TRANSAKSI vs HARGA SEKARANG ---');
  console.table(snapshotCheck.map(r => ({
    produk: r.name,
    hpp_snapshot: `Rp ${Number(r.cost_price_snapshot).toLocaleString('id-ID')}`,
    jual_snapshot: `Rp ${Number(r.selling_price_snapshot).toLocaleString('id-ID')}`,
    hpp_skrg: `Rp ${Number(r.hpp_sekarang).toLocaleString('id-ID')}`,
    jual_skrg: `Rp ${Number(r.jual_sekarang).toLocaleString('id-ID')}`,
    qty: r.qty,
    margin_item: `Rp ${Number(r.margin_item).toLocaleString('id-ID')}`,
  })));

  // Rekapitulasi gross_profit berdasarkan snapshot (formula koreksi)
  const [formulaCheck] = await sql`
    SELECT
      COUNT(DISTINCT t.id)::int AS total_tx,
      ROUND(SUM(t.gross_profit)) AS gross_profit_tersimpan,
      ROUND(SUM(ti.subtotal_sell - ti.subtotal_cost)) AS gross_profit_dari_snapshot,
      ROUND(SUM(t.gross_profit) - SUM(ti.subtotal_sell - ti.subtotal_cost)) AS selisih
    FROM transactions t
    JOIN transaction_items ti ON ti.transaction_id = t.id
    WHERE t.is_test = false AND t.status = 'COMPLETED';
  `;
  console.log('\n--- [D] VERIFIKASI FORMULA gross_profit vs SNAPSHOT ITEM ---');
  console.log(`gross_profit tersimpan di DB  : Rp ${Number(formulaCheck.gross_profit_tersimpan).toLocaleString('id-ID')}`);
  console.log(`gross_profit dari snapshot    : Rp ${Number(formulaCheck.gross_profit_dari_snapshot).toLocaleString('id-ID')}`);
  console.log(`Selisih (harusnya 0)          : Rp ${Number(formulaCheck.selisih).toLocaleString('id-ID')}`);

  // Laporan harian lengkap
  const perHari = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS tanggal,
      TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'Day') AS hari,
      COUNT(*)::int AS tx,
      COUNT(*) FILTER (WHERE gross_profit < 0)::int AS tx_rugi,
      ROUND(SUM(gross_amount)) AS omzet,
      ROUND(SUM(gross_profit)) AS laba_kotor,
      ROUND(SUM(gross_profit) * 0.5) AS pool_gaji
    FROM transactions
    WHERE is_test = false AND status = 'COMPLETED'
    GROUP BY TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD'),
             TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'Day')
    ORDER BY tanggal;
  `;
  console.log('\n--- [E] LAPORAN HARIAN SEMUA DATA ---');
  console.table(perHari.map(r => ({
    tgl: r.tanggal,
    hari: r.hari?.trim(),
    tx: r.tx,
    tx_rugi: r.tx_rugi > 0 ? `⚠️${r.tx_rugi}` : 0,
    omzet: `Rp ${Number(r.omzet).toLocaleString('id-ID')}`,
    laba_kotor: `Rp ${Number(r.laba_kotor).toLocaleString('id-ID')}`,
    pool50: `Rp ${Number(r.pool_gaji).toLocaleString('id-ID')}`,
  })));

  // Laporan per minggu
  const perMinggu = await sql`
    SELECT
      TO_CHAR(DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS minggu,
      COUNT(*)::int AS tx,
      ROUND(SUM(gross_amount)) AS omzet,
      ROUND(SUM(gross_profit)) AS laba,
      ROUND(SUM(gross_profit)*0.5) AS pool
    FROM transactions WHERE is_test = false AND status = 'COMPLETED'
    GROUP BY DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Jakarta')
    ORDER BY minggu;
  `;
  console.log('\n--- [F] LAPORAN PER MINGGU ---');
  console.table(perMinggu.map(r => ({
    minggu: r.minggu, tx: r.tx,
    omzet: `Rp ${Number(r.omzet).toLocaleString('id-ID')}`,
    laba_kotor: `Rp ${Number(r.laba).toLocaleString('id-ID')}`,
    pool_gaji_50: `Rp ${Number(r.pool).toLocaleString('id-ID')}`,
  })));

  // Laporan per bulan
  const perBulan = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS bulan,
      COUNT(*)::int AS tx,
      ROUND(SUM(gross_amount)) AS omzet,
      ROUND(SUM(gross_profit)) AS laba,
      ROUND(SUM(gross_profit)*0.5) AS pool
    FROM transactions WHERE is_test = false AND status = 'COMPLETED'
    GROUP BY TO_CHAR(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')
    ORDER BY bulan;
  `;
  console.log('\n--- [G] LAPORAN PER BULAN ---');
  console.table(perBulan.map(r => ({
    bulan: r.bulan, tx: r.tx,
    omzet: `Rp ${Number(r.omzet).toLocaleString('id-ID')}`,
    laba_kotor: `Rp ${Number(r.laba).toLocaleString('id-ID')}`,
    pool_gaji_50: `Rp ${Number(r.pool).toLocaleString('id-ID')}`,
  })));

  // Total kumulatif
  const [total] = await sql`
    SELECT COUNT(*)::int AS tx,
      ROUND(SUM(gross_amount)) AS omzet,
      ROUND(SUM(gross_profit)) AS laba,
      ROUND(SUM(gross_profit)*0.5) AS pool,
      ROUND(AVG(gross_profit)/NULLIF(AVG(gross_amount),0)*100,1) AS margin_pct
    FROM transactions WHERE is_test = false AND status = 'COMPLETED';
  `;
  console.log('\n--- [H] TOTAL KUMULATIF SELURUH OPERASIONAL ---');
  console.log(`Total Transaksi     : ${total.tx}`);
  console.log(`Total Omzet         : Rp ${Number(total.omzet).toLocaleString('id-ID')}`);
  console.log(`Total Laba Kotor    : Rp ${Number(total.laba).toLocaleString('id-ID')}`);
  console.log(`Pool Gaji 50%       : Rp ${Number(total.pool).toLocaleString('id-ID')}`);
  console.log(`Laba Bersih Toko 50%: Rp ${Number(total.pool).toLocaleString('id-ID')}`);
  console.log(`Margin Rata-rata     : ${total.margin_pct}%`);

  // Laporan per shift (per hari + slot)
  const perShift = await sql`
    SELECT
      TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS tanggal,
      TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'Day') AS hari,
      TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS jam_buka,
      CASE 
        WHEN EXTRACT(HOUR FROM s.clock_in AT TIME ZONE 'Asia/Jakarta') < 11 THEN 'Pagi (07:00-11:30)'
        ELSE 'Siang (11:30-15:00)'
      END AS sesi,
      e.full_name AS kasir,
      COUNT(t.id) FILTER (WHERE t.status='COMPLETED' AND t.is_test=false)::int AS tx,
      ROUND(COALESCE(SUM(t.gross_amount) FILTER (WHERE t.status='COMPLETED' AND t.is_test=false), 0)) AS omzet,
      ROUND(COALESCE(SUM(t.gross_profit) FILTER (WHERE t.status='COMPLETED' AND t.is_test=false), 0)) AS laba,
      ROUND(COALESCE(SUM(t.gross_profit) FILTER (WHERE t.status='COMPLETED' AND t.is_test=false), 0) * 0.5) AS pool
    FROM shifts s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN transactions t ON t.shift_id = s.id
    WHERE EXTRACT(DOW FROM s.clock_in AT TIME ZONE 'Asia/Jakarta') BETWEEN 1 AND 5
    GROUP BY s.id, s.clock_in, e.full_name
    ORDER BY tanggal, s.clock_in;
  `;
  console.log('\n--- [I] LAPORAN PER SHIFT (SENIN-JUMAT, PAGI & SIANG) ---');
  console.table(perShift.map(r => ({
    tgl: r.tanggal,
    hari: r.hari?.trim(),
    sesi: r.sesi,
    kasir: r.kasir,
    tx: r.tx,
    omzet: `Rp ${Number(r.omzet).toLocaleString('id-ID')}`,
    laba: `Rp ${Number(r.laba).toLocaleString('id-ID')}`,
    pool50: `Rp ${Number(r.pool).toLocaleString('id-ID')}`,
  })));

  await sql.end();
}

laporanKeuanganLengkap().catch(console.error);
