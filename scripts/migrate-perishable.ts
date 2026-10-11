import * as path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import postgres from 'postgres';

const DB_URL = process.env.DATABASE_URL!;
if (!DB_URL) {
  console.error('DATABASE_URL tidak ditemukan');
  process.exit(1);
}

async function main() {
  const sql = postgres(DB_URL, { prepare: false });

  console.log('=== MEMULAI MIGRASI PERISHABLE FOOD (MAKANAN BASAH) ===\n');

  // 1. Tambah kolom is_perishable dan perishable_type jika belum ada
  console.log('[1/3] Menambahkan kolom is_perishable dan perishable_type...');
  await sql`
    ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS is_perishable boolean NOT NULL DEFAULT false;
  `;
  await sql`
    ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS perishable_type varchar(20) DEFAULT 'KONSINYASI';
  `;
  console.log('✅ Kolom berhasil ditambahkan/diverifikasi.');

  // 2. Daftar kata kunci makanan basah/harian
  const foodKeywords = [
    'nasi', 'ayam geprek', 'pentol pedas', 'wonton', 'cilok ayam', 'siomay', 'tahu bakso',
    'salad buah', 'fruit sando', 'burger', 'putu ayu', 'klepon', 'pisang nugget',
    'orak arik', 'sosis solo', 'roti kopi ok', 'rotib', 'roti coy',
    'dessert qq', 'pangsit kencur', 'rossa'
  ];

  console.log('\n[2/3] Memberikan flag is_perishable = true pada produk makanan basah...');
  
  // Ambil semua produk aktif
  const allProducts = await sql`SELECT id, name, is_perishable, perishable_type FROM products WHERE deleted_at IS NULL`;
  
  let markedCount = 0;
  for (const p of allProducts) {
    const low = p.name.toLowerCase();
    // Khusus: Croissant & Klanting tidak perishable karena kemasan awet ber-barcode
    if (low.includes('croissant') || low.includes('klanting')) continue;

    if (foodKeywords.some(k => low.includes(k))) {
      await sql`
        UPDATE products 
        SET is_perishable = true, perishable_type = 'KONSINYASI', updated_at = NOW()
        WHERE id = ${p.id}
      `;
      console.log(`  -> [FLAGGED] "${p.name}" (is_perishable = true, perishable_type = 'KONSINYASI')`);
      markedCount++;
    }
  }

  // 3. Verifikasi
  console.log('\n[3/3] Memverifikasi data produk yang telah di-flag...');
  const flagged = await sql`
    SELECT id, name, is_perishable, perishable_type, stock_qty 
    FROM products 
    WHERE is_perishable = true AND deleted_at IS NULL
    ORDER BY name ASC
  `;

  console.log(`\n=== HASIL VERIFIKASI: ${flagged.length} PRODUK MAKANAN BASAH ===`);
  for (const f of flagged) {
    console.log(`• "${f.name}" | is_perishable: ${f.is_perishable} | tipe: ${f.perishable_type} | stok: ${f.stock_qty}`);
  }

  await sql.end();
  console.log('\n🎉 MIGRASI SUKSES 100% TANPA KESALAHAN.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error saat migrasi:', err);
  process.exit(1);
});
