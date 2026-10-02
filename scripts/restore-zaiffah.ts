import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const [before] = await db.select({ id: employees.id, fullName: employees.fullName, nim: employees.nim, isActive: employees.isActive, deletedAt: employees.deletedAt })
    .from(employees).where(eq(employees.nim, "02402009"));

  if (!before) { console.log("Tidak ditemukan!"); return; }
  console.log("Sebelum:", before.fullName, "| isActive:", before.isActive, "| deletedAt:", before.deletedAt);

  await db.update(employees)
    .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
    .where(eq(employees.id, before.id));

  const [after] = await db.select({ fullName: employees.fullName, isActive: employees.isActive, deletedAt: employees.deletedAt })
    .from(employees).where(eq(employees.id, before.id));
  console.log("Sesudah:", after.fullName, "| isActive:", after.isActive, "| deletedAt:", after.deletedAt);
  console.log("[OK] Zaiffah dipulihkan.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
