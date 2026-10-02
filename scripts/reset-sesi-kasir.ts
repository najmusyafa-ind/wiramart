import { db } from "../src/lib/db/client";
import { employees, shifts } from "../src/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";

// Reset sesi aktif kasir yang lupa logout
// Usage: npx tsx --env-file=.env.local scripts/reset-sesi-kasir.ts

async function main() {
  const nimTarget = "02405013"; // NIM akun "testing"
  
  // Cari employee
  const [emp] = await db.select({ id: employees.id, fullName: employees.fullName, nim: employees.nim })
    .from(employees)
    .where(eq(employees.nim, nimTarget))
    .limit(1);
  
  if (!emp) {
    console.log("[ERROR] Employee tidak ditemukan NIM:", nimTarget);
    process.exit(1);
  }
  
  console.log("[OK] Employee:", emp.fullName, "(NIM:", emp.nim + ")");
  
  // Cari shift aktif
  const activeShifts = await db.select({ id: shifts.id, clockIn: shifts.clockIn, status: shifts.status })
    .from(shifts)
    .where(and(eq(shifts.employeeId, emp.id), eq(shifts.status, 'ACTIVE')));
  
  if (activeShifts.length === 0) {
    console.log("[INFO] Tidak ada sesi aktif untuk akun ini. Mungkin sudah ter-reset.");
    process.exit(0);
  }

  console.log("[FOUND]", activeShifts.length, "sesi aktif:");
  activeShifts.forEach(s => console.log("  Shift ID:", s.id, "| Clock In:", s.clockIn));
  
  // Close semua sesi aktif
  const result = await db
    .update(shifts)
    .set({ clockOut: new Date(), status: 'CLOSED' })
    .where(and(eq(shifts.employeeId, emp.id), eq(shifts.status, 'ACTIVE')));
  
  console.log("[OK] Semua sesi aktif berhasil direset! Silakan login ulang.");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("[ERROR]", e.message); process.exit(1); });
