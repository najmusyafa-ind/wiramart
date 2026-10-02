import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const FIXES = [
  { oldNim: "02301023", newNim: "02301022", nameLike: "Annisa Salsabila" },
  { oldNim: "02301083", newNim: "02301028", nameLike: "Azzahro Setyowati" },
];

async function main() {
  for (const fix of FIXES) {
    const found = await db.select({ id: employees.id, fullName: employees.fullName, nim: employees.nim })
      .from(employees).where(eq(employees.nim, fix.oldNim));

    console.log(`\nCari NIM ${fix.oldNim}:`, JSON.stringify(found));

    if (found.length === 0) { console.log("  Tidak ditemukan, skip."); continue; }
    if (found.length > 1)   { console.log("  MULTI MATCH, batal!"); continue; }

    const emp = found[0];
    if (!emp.fullName.includes(fix.nameLike.split(" ")[0])) {
      console.log(`  NAMA TIDAK COCOK (${emp.fullName} vs ${fix.nameLike}). Batal!`);
      continue;
    }

    await db.update(employees)
      .set({ nim: fix.newNim, updatedAt: new Date() })
      .where(eq(employees.id, emp.id));

    const after = await db.select({ nim: employees.nim, fullName: employees.fullName })
      .from(employees).where(eq(employees.id, emp.id));

    console.log(`  [OK] ${emp.fullName}: ${fix.oldNim} -> ${after[0].nim}`);
  }
  console.log("\nSelesai.");
}

main().then(() => process.exit(0)).catch(e => { console.error("ERROR:", e); process.exit(1); });
