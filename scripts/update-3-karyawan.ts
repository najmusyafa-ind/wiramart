import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  // ── 1. Devi Yuliana Sari (alias "Lia") NIM 02301030 → Manajemen ──
  await db.update(employees)
    .set({ programStudi: "Manajemen", updatedAt: new Date() })
    .where(eq(employees.nim, "02301030"));
  const r1 = await db.select().from(employees).where(eq(employees.nim, "02301030"));
  console.log("[1] Devi Yuliana Sari (Lia):", r1[0] ? `OK | ${r1[0].fullName} | programStudi: ${r1[0].programStudi}` : "TIDAK DITEMUKAN");

  // ── 2. Najua Nur Salsabila NIM 02301062 → Manajemen ──
  await db.update(employees)
    .set({ programStudi: "Manajemen", updatedAt: new Date() })
    .where(eq(employees.nim, "02301062"));
  const r2 = await db.select().from(employees).where(eq(employees.nim, "02301062"));
  console.log("[2] Najua Nur Salsabila:", r2[0] ? `OK | ${r2[0].fullName} | programStudi: ${r2[0].programStudi}` : "TIDAK DITEMUKAN");

  // ── 3. Insert Bagaskara Putra N.H (NIM 02505035, Informatika) ──
  const existing = await db.select().from(employees).where(eq(employees.nim, "02505035"));
  if (existing.length > 0) {
    console.log("[3] Bagaskara: sudah ada →", existing[0].fullName, "| programStudi:", existing[0].programStudi);
  } else {
    await db.insert(employees).values({
      fullName: "Bagaskara Putra N.H",
      nim: "02505035",
      programStudi: "Informatika",
      isActive: true,
    });
    const r3 = await db.select().from(employees).where(eq(employees.nim, "02505035"));
    console.log("[3] Bagaskara:", r3[0] ? `OK | ${r3[0].fullName} | NIM: ${r3[0].nim} | programStudi: ${r3[0].programStudi}` : "GAGAL INSERT");
  }
  console.log("\n✅ Selesai.");
}

main().then(() => process.exit(0)).catch(e => { console.error("[ERROR]", e.message); process.exit(1); });
