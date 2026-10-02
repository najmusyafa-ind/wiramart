import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees, shiftSchedules } from "../src/lib/db/schema";
import { eq, isNotNull, isNull } from "drizzle-orm";

async function main() {
  // Karyawan yang terlihat di halaman admin (aktif + tidak dihapus)
  const active = await db.select({ id: employees.id, fullName: employees.fullName, nim: employees.nim, isActive: employees.isActive, deletedAt: employees.deletedAt })
    .from(employees)
    .where(isNull(employees.deletedAt));
  console.log("Karyawan di halaman (deletedAt IS NULL):", active.length);

  // Slot yang terisi
  const filledSlots = await db.select({ empId: shiftSchedules.employeeId })
    .from(shiftSchedules)
    .where(isNotNull(shiftSchedules.employeeId));
  console.log("Slot terisi:", filledSlots.length);

  // Cari employee yang ada di slot tapi tidak muncul di list
  const activeIds = new Set(active.map(e => e.id));
  const filledEmpIds = [...new Set(filledSlots.map(s => s.empId).filter(Boolean))];
  const ghostIds = filledEmpIds.filter(id => !activeIds.has(id!));
  console.log("\n[GHOST] Employee di slot tapi tidak di list karyawan:", ghostIds.length);

  if (ghostIds.length > 0) {
    for (const gid of ghostIds) {
      const [emp] = await db.select().from(employees).where(eq(employees.id, gid!));
      if (emp) {
        console.log("  ->", emp.fullName, "| NIM:", emp.nim, "| isActive:", emp.isActive, "| deletedAt:", emp.deletedAt);
      } else {
        console.log("  -> ID tidak ditemukan:", gid);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error("ERROR:", e); process.exit(1); });
