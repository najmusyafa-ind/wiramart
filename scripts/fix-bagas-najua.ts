import { db } from "../src/lib/db/client";
import { employees, shiftSchedules } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  // ─── 1. Assign Bagaskara ke slot RABU 08:00-11:30 ─────────────────────────
  const [bagas] = await db.select({ id: employees.id, fullName: employees.fullName })
    .from(employees).where(eq(employees.nim, "02505035")).limit(1);
  if (!bagas) { console.log("[ERROR] Bagaskara tidak ditemukan!"); return; }
  console.log("[OK] Bagaskara: " + bagas.fullName);

  const rabuSlots = await db.select({ id: shiftSchedules.id, orderInSlot: shiftSchedules.orderInSlot, empId: shiftSchedules.employeeId })
    .from(shiftSchedules)
    .where(and(eq(shiftSchedules.dayOfWeek, "RABU"), eq(shiftSchedules.slotStart, "08:00"), eq(shiftSchedules.slotEnd, "11:30")))
    .orderBy(shiftSchedules.orderInSlot);

  console.log("Slot RABU 08:00-11:30: " + rabuSlots.length + " slot");
  rabuSlots.forEach(s => console.log("  Order " + s.orderInSlot + ": " + (s.empId ?? "KOSONG")));

  const bagasTarget = rabuSlots.find(s => s.empId === null);
  if (!bagasTarget) { console.log("[SKIP] Tidak ada slot kosong RABU 08:00-11:30!"); }
  else {
    await db.update(shiftSchedules).set({ employeeId: bagas.id, updatedAt: new Date() }).where(eq(shiftSchedules.id, bagasTarget.id));
    console.log("[OK] Bagaskara -> RABU 08:00-11:30 slot " + bagasTarget.orderInSlot);
  }

  // ─── 2. Pindah Najua: KAMIS -> JUMAT 11:30-15:00 ──────────────────────────
  const [najua] = await db.select({ id: employees.id, fullName: employees.fullName })
    .from(employees).where(eq(employees.nim, "02301062")).limit(1);
  if (!najua) { console.log("[ERROR] Najua tidak ditemukan!"); return; }
  console.log("\n[OK] Najua: " + najua.fullName);

  const [oldSlot] = await db.select({ id: shiftSchedules.id, orderInSlot: shiftSchedules.orderInSlot })
    .from(shiftSchedules)
    .where(and(eq(shiftSchedules.employeeId, najua.id), eq(shiftSchedules.dayOfWeek, "KAMIS")))
    .limit(1);

  if (!oldSlot) { console.log("[INFO] Najua tidak ada di KAMIS, skip lepas slot."); }
  else {
    await db.update(shiftSchedules).set({ employeeId: null, updatedAt: new Date() }).where(eq(shiftSchedules.id, oldSlot.id));
    console.log("[OK] Najua dilepas dari KAMIS slot " + oldSlot.orderInSlot);
  }

  const jumatSlots = await db.select({ id: shiftSchedules.id, orderInSlot: shiftSchedules.orderInSlot, empId: shiftSchedules.employeeId })
    .from(shiftSchedules)
    .where(and(eq(shiftSchedules.dayOfWeek, "JUMAT"), eq(shiftSchedules.slotStart, "11:30"), eq(shiftSchedules.slotEnd, "15:00")))
    .orderBy(shiftSchedules.orderInSlot);

  console.log("Slot JUMAT 11:30-15:00: " + jumatSlots.length + " slot");
  jumatSlots.forEach(s => console.log("  Order " + s.orderInSlot + ": " + (s.empId ?? "KOSONG")));

  const jumatTarget = jumatSlots.find(s => s.empId === null);
  if (!jumatTarget) { console.log("[SKIP] Tidak ada slot kosong JUMAT 11:30-15:00!"); }
  else {
    await db.update(shiftSchedules).set({ employeeId: najua.id, updatedAt: new Date() }).where(eq(shiftSchedules.id, jumatTarget.id));
    console.log("[OK] Najua -> JUMAT 11:30-15:00 slot " + jumatTarget.orderInSlot);
  }

  console.log("\n[DONE]");
}
main().then(() => process.exit(0)).catch(e => { console.error("[ERROR]", e.message); process.exit(1); });
