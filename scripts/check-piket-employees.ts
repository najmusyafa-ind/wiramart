import { db } from '../src/lib/db/client';
import { employees } from '../src/lib/db/schema';

async function check() {
  const list = await db.query.employees.findMany();
  console.log(`Total employees di DB: ${list.length}`);
  console.log('--- DAFTAR SEMUA KARYAWAN ---');
  for (const e of list) {
    console.log(`[${e.id}] ${e.fullName} (${e.nim}) - ${e.jabatan}`);
  }
}

check().catch(console.error).finally(() => process.exit(0));
