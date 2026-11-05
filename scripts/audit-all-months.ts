import { db } from '../src/lib/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const months = ['2026-08', '2026-09', '2026-10', '2026-11'];

  for (const m of months) {
    console.log(`\n======================================================`);
    console.log(`=== AUDIT DATA SHIFT BULAN ${m} ===`);
    console.log(`======================================================`);

    const shifts = await db.execute(sql`
      SELECT 
        s.id,
        TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') as tgl,
        TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'Dy') as day_name,
        EXTRACT(DOW FROM s.clock_in AT TIME ZONE 'Asia/Jakarta') as dow,
        TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') as in_time,
        TO_CHAR(s.clock_out AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') as out_time,
        s.status,
        e.full_name,
        e.nim,
        (SELECT COUNT(*) FROM transactions t WHERE t.shift_id = s.id AND t.status = 'COMPLETED') as tx_count,
        (SELECT COALESCE(SUM(t.gross_amount), 0) FROM transactions t WHERE t.shift_id = s.id AND t.status = 'COMPLETED') as omzet,
        (SELECT COUNT(*) FROM attendances a WHERE a.shift_id = s.id) as att_count
      FROM shifts s
      JOIN employees e ON s.employee_id = e.id
      WHERE TO_CHAR(s.clock_in AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = ${m}
      ORDER BY s.clock_in ASC
    `);

    const rows = (shifts as any).rows ?? shifts;
    console.log(`Total shifts di DB: ${rows.length}`);
    rows.forEach((r: any) => {
      console.log(`  ${r.tgl} (${r.day_name}) ${r.in_time}-${r.out_time ?? '??'} | ${r.full_name.padEnd(25)} (${r.nim}) | tx:${r.tx_count} | omzet: Rp ${Number(r.omzet).toLocaleString('id-ID')} | att:${r.att_count}`);
    });
  }

  process.exit(0);
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
