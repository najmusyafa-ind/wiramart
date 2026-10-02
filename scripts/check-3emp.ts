import { db } from "../src/lib/db/client";
import { employees, shiftSchedules } from "../src/lib/db/schema";
import { or, eq, ilike } from "drizzle-orm";

async function main() {
  const targets = [
    { nim: "02505035", nameLike: "Bagaskara" },
    { nim: "02301030", nameLike: "Lia" },
    { nim: "02301062", nameLike: "Najua" },
  ];

  for (const t of targets) {
    console.log(`\n── Cari NIM ${t.nim} / nama '${t.nameLike}' ──`);
    const rows = await db
      .select({ id: employees.id, fullName: employees.fullName, nim: employees.nim, programStudi: employees.programStudi, isActive: employees.isActive, deletedAt: employees.deletedAt })
      .from(employees)
      .where(or(eq(employees.nim, t.nim), ilike(employees.fullName, `%${t.nameLike}%`)));

    if (rows.length === 0) {
      console.log("  → TIDAK DITEMUKAN di DB");
    } else {
      for (const r of rows) {
        const slots = await db
          .select({ day: shiftSchedules.dayOfWeek, slotStart: shiftSchedules.slotStart, slotEnd: shiftSchedules.slotEnd })
          .from(shiftSchedules).where(eq(shiftSchedules.employeeId, r.id));
        console.log(`  → FOUND: "${r.fullName}" | NIM: ${r.nim} | Prodi: ${r.programStudi} | isActive: ${r.isActive} | deletedAt: ${r.deletedAt ?? "null"}`);
        if (slots.length > 0) slots.forEach(s => console.log(`     Slot: ${s.day} ${s.slotStart}-${s.slotEnd}`));
        else console.log(`     Slot: (tidak ada)`);
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
