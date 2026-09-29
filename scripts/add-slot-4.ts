/**
 * add-slot-4.ts — Tambah slot ke-4 untuk semua time slot yang masih punya < 4 slot
 *
 * Jalankan: npx tsx scripts/add-slot-4.ts
 *
 * Aman dijalankan berkali-kali (idempotent via COUNT check).
 * Tidak menyentuh slot yang sudah punya 4+ entries.
 * Tidak menyentuh slot koordinator (orderInSlot = 99).
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { sql } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL tidak ditemukan di .env.local');
}

const conn = postgres(process.env.DATABASE_URL, { prepare: false });
const db = drizzle(conn, { schema });


async function main() {
  console.log('\n📋 AUDIT SLOT SAAT INI\n');

  // 1. Lihat semua kombinasi (dayOfWeek, slotStart, slotEnd) dan jumlah slot normal-nya
  const auditRows = await db.execute(sql`
    SELECT
      day_of_week            AS "day",
      slot_start             AS "start",
      slot_end               AS "end",
      COUNT(*)               AS total_slots,
      COUNT(*) FILTER (WHERE order_in_slot != 99) AS normal_slots,
      COUNT(*) FILTER (WHERE order_in_slot = 99)  AS coordinator_slots,
      COUNT(*) FILTER (WHERE employee_id IS NOT NULL AND order_in_slot != 99) AS filled_slots
    FROM shift_schedules
    WHERE is_active = true
    GROUP BY day_of_week, slot_start, slot_end
    ORDER BY day_of_week, slot_start
  `);

  console.table(auditRows);

  // 2. Cari kombinasi yang normal_slots < 4 (perlu ditambah)
  const needSlot4 = auditRows.filter((r: any) => Number(r.normal_slots) < 4);

  if (needSlot4.length === 0) {
    console.log('\n✅ Semua time slot sudah memiliki 4 slot normal. Tidak ada yang perlu ditambah.\n');
    await conn.end();
    return;
  }

  console.log(`\n🔧 Ditemukan ${needSlot4.length} time slot yang perlu ditambah ke slot ke-4:\n`);
  needSlot4.forEach((r: any) => {
    console.log(`  → ${r.day} ${r.start}–${r.end}  (saat ini: ${r.normal_slots} slot normal)`);
  });

  console.log('\n⚡ Menambah slot ke-4 untuk semua time slot di atas...\n');

  let insertedCount = 0;

  await db.transaction(async (tx) => {
    for (const row of needSlot4) {
      const currentNormal = Number((row as any).normal_slots);
      for (let order = currentNormal + 1; order <= 4; order++) {
        await tx.insert(schema.shiftSchedules).values({
          dayOfWeek:   (row as any).day   as schema.ShiftSchedule['dayOfWeek'],
          slotStart:   (row as any).start as string,
          slotEnd:     (row as any).end   as string,
          employeeId:  null,
          orderInSlot: order,
          isActive:    true,
        });
        console.log(`  ✅ INSERT: ${(row as any).day} ${(row as any).start}–${(row as any).end} → orderInSlot=${order}`);
        insertedCount++;
      }
    }
  });

  console.log(`\n🎉 Selesai! Total ${insertedCount} slot baru berhasil ditambahkan.\n`);

  // 4. Tampilkan audit akhir
  console.log('📋 KONDISI SLOT SETELAH UPDATE:\n');
  const finalAudit = await db.execute(sql`
    SELECT
      day_of_week  AS "day",
      slot_start   AS "start",
      slot_end     AS "end",
      COUNT(*) FILTER (WHERE order_in_slot != 99) AS normal_slots,
      COUNT(*) FILTER (WHERE order_in_slot = 99)  AS coordinator_slots,
      COUNT(*) FILTER (WHERE employee_id IS NOT NULL AND order_in_slot != 99) AS filled_slots
    FROM shift_schedules
    WHERE is_active = true
    GROUP BY day_of_week, slot_start, slot_end
    ORDER BY day_of_week, slot_start
  `);
  console.table(finalAudit);

  await conn.end();
}

main().catch((err) => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
