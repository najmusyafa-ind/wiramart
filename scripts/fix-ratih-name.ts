import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees } from "../src/lib/db/schema";
import { eq, like } from "drizzle-orm";

async function main() {
  const found = await db.select({ id: employees.id, fullName: employees.fullName, nim: employees.nim })
    .from(employees)
    .where(like(employees.fullName, "%Widyaningrumj%"));

  console.log("Cek:", JSON.stringify(found));
  if (found.length === 0) { console.log("Tidak ditemukan typo."); return; }
  if (found.length > 1)   { console.log("MULTI MATCH, batal!"); return; }

  const fixed = found[0].fullName.replace(/j$/, "");
  console.log("Fix:", found[0].fullName, "->", fixed);

  await db.update(employees).set({ fullName: fixed, updatedAt: new Date() }).where(eq(employees.id, found[0].id));

  const after = await db.select({ fullName: employees.fullName }).from(employees).where(eq(employees.id, found[0].id));
  console.log("Setelah update:", after[0].fullName);
}

main().then(() => process.exit(0)).catch(e => { console.error("ERROR:", e); process.exit(1); });
