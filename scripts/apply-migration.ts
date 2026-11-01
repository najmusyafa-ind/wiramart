// Menjalankan satu file migrasi SQL ke staging atau produksi.
//
//   tsx scripts/apply-migration.ts <file.sql> staging
//   tsx scripts/apply-migration.ts <file.sql> prod --yes
//
// File dipecah pada baris "-- @@"; tiap bagian dijalankan sendiri (autocommit antar bagian).
// Produksi hanya dijalankan bila ada flag --yes. Semua koneksi dibaca eksplisit dari file env,
// bukan dari .env.local yang bisa berubah.
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

const [file, target, flag] = process.argv.slice(2);
if (!file || (target !== 'staging' && target !== 'prod')) {
  console.error('Pemakaian: tsx scripts/apply-migration.ts <file.sql> staging|prod [--yes]');
  process.exit(1);
}
if (target === 'prod' && flag !== '--yes') {
  console.error('DIBATALKAN: produksi butuh flag --yes. Tidak ada yang diubah.');
  process.exit(1);
}

const envFile = target === 'prod' ? '.env.production.local' : '.env.staging';
const url = dotenv.parse(fs.readFileSync(envFile)).DATABASE_URL;
if (!url) {
  console.error(`DATABASE_URL tidak ditemukan di ${envFile}.`);
  process.exit(1);
}
const u = new URL(url);
console.log(`Target: ${target} -> ${u.username}@${u.host}${u.pathname}`);

async function main() {
  const parts = fs.readFileSync(file, 'utf8').split(/^-- @@\s*$/m).map((p) => p.trim()).filter(Boolean);
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  try {
    for (let i = 0; i < parts.length; i++) {
      await sql.unsafe(parts[i]!);
      console.log(`Bagian ${i + 1}/${parts.length}: OK`);
    }
    console.log('Migrasi selesai.');
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error('GAGAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

