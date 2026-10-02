/**
 * scripts/seed-karyawan-batch.ts
 * Batch insert karyawan yang belum ada di DB + assign slot + pindah Zahara.
 * Jalankan: npx tsx scripts/seed-karyawan-batch.ts
 */

import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees, shiftSchedules } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

const NEW_ENTRIES = [
  { fullName: "Zaiffah Nur Fathimah", nim: "02402009", programStudi: "Akuntansi", jabatan: "Kasir", slotId: "20a4a6a4-420d-4937-94dd-4f024eaec762", slotLabel: "SENIN 11:30-15:00 #2" },
  { fullName: "Dwi Lia Rahmania",     nim: "02401083", programStudi: "Manajemen",  jabatan: "Kasir", slotId: "0d688881-12b9-4f51-8e41-9a19a05b0e4f", slotLabel: "SELASA 08:00-11:30 #1" },
  { fullName: "Meizin Shinta Resmi",  nim: "02401070", programStudi: "Manajemen",  jabatan: "Kasir", slotId: "41fabf4b-b735-4f9c-84b1-dd5cb1a197ed", slotLabel: "SELASA 08:00-11:30 #2" },
  { fullName: "Nur Asshifah",         nim: "02401052", programStudi: "Manajemen",  jabatan: "Kasir", slotId: "61327d00-26b3-451b-ab57-e6d32644f4f9", slotLabel: "SELASA 08:00-11:30 #3" },
  { fullName: "Nisa Ulfia Febriani",  nim: "02601009", programStudi: "Manajemen",  jabatan: "Kasir", slotId: "ece7d7d7-2d60-493d-bbbb-1dcb8a7d6fa7", slotLabel: "SELASA 11:30-15:00 #4" },
  { fullName: "Julian Anggun Nurita", nim: "02301048", programStudi: "Manajemen",  jabatan: "Kasir", slotId: "96e344e0-6620-4589-a281-2208331af264", slotLabel: "KAMIS 08:00-11:30 #4" },
  { fullName: "Aulia Putra Ramadhan", nim: "02401002", programStudi: "Manajemen",  jabatan: "Kasir", slotId: "c8cbeef2-3d64-4534-8df7-0f1049b5ad4a", slotLabel: "KAMIS 11:30-15:00 #3" },
  { fullName: "Winda",                nim: "02402035", programStudi: "Akuntansi",  jabatan: "Kasir", slotId: "cf12af35-82c4-485b-b25b-c9811fc04550", slotLabel: "JUMAT 11:30-15:00 #1" },
  { fullName: "Maulida",              nim: "02402010", programStudi: "Akuntansi",  jabatan: "Kasir", slotId: "d4b70de9-9050-4f87-b516-da30265099ed", slotLabel: "JUMAT 11:30-15:00 #2" },
];

const ZAHARA_EMPLOYEE_ID = "ab676650-e971-4780-acbd-d01b7e40523d";
const ZAHARA_OLD_SLOT_ID = "0d688881-12b9-4f51-8e41-9a19a05b0e4f";
const ZAHARA_NEW_SLOT_ID = "0ae5a727-2731-4f6a-b33a-61bc7fce760b";

function ok(msg)   { console.log("  [OK] " + msg); }
function warn(msg) { console.log("  [WARN] " + msg); }
function info(msg) { console.log("  [INFO] " + msg); }
function fail(msg) { console.log("  [FAIL] " + msg); }

async function main() {
  console.log("\n=== SEED KARYAWAN BATCH ===\n");

  // STEP 1: Pindah Zahara
  console.log("-- STEP 1: Pindah Zahara ke JUMAT 08:00-11:30 #4 --");
  const [zahara] = await db.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(eq(employees.id, ZAHARA_EMPLOYEE_ID));
  if (!zahara) { fail("Zahara tidak ada di DB!"); process.exit(1); }
  info("Zahara ditemukan: " + zahara.fullName);

  const [oldSlot] = await db.select({ empId: shiftSchedules.employeeId }).from(shiftSchedules).where(eq(shiftSchedules.id, ZAHARA_OLD_SLOT_ID));
  if (oldSlot && oldSlot.empId === ZAHARA_EMPLOYEE_ID) {
    await db.update(shiftSchedules).set({ employeeId: null, updatedAt: new Date() }).where(eq(shiftSchedules.id, ZAHARA_OLD_SLOT_ID));
    ok("Slot SELASA dibebaskan dari Zahara");
  } else {
    warn("Slot SELASA tidak berisi Zahara, skip free. empId=" + (oldSlot?.empId ?? "null"));
  }

  const [newSlot] = await db.select({ empId: shiftSchedules.employeeId }).from(shiftSchedules).where(eq(shiftSchedules.id, ZAHARA_NEW_SLOT_ID));
  if (!newSlot) { fail("Slot JUMAT #4 tidak ditemukan!"); process.exit(1); }
  if (newSlot.empId !== null) { fail("Slot JUMAT #4 sudah terisi: " + newSlot.empId); process.exit(1); }

  await db.update(shiftSchedules).set({ employeeId: ZAHARA_EMPLOYEE_ID, updatedAt: new Date() }).where(eq(shiftSchedules.id, ZAHARA_NEW_SLOT_ID));
  ok("Zahara -> JUMAT 08:00-11:30 #4");

  // STEP 2: Insert karyawan baru
  console.log("\n-- STEP 2: Insert " + NEW_ENTRIES.length + " karyawan baru --");
  for (const entry of NEW_ENTRIES) {
    console.log("\n  -> " + entry.fullName + " (" + entry.nim + " | " + entry.programStudi + ") -> " + entry.slotLabel);

    if (!entry.fullName.trim() || entry.fullName.trim().toLowerCase() === "nama") {
      fail("Nama tidak valid, lewati."); continue;
    }

    const [existing] = await db.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(and(eq(employees.nim, entry.nim), eq(employees.programStudi, entry.programStudi)));

    let empId;
    if (existing) {
      warn("NIM " + entry.nim + " sudah ada: " + existing.fullName + " (id=" + existing.id + "). Skip insert.");
      empId = existing.id;
    } else {
      const [created] = await db.insert(employees).values({ fullName: entry.fullName.trim(), nim: entry.nim.trim(), programStudi: entry.programStudi.trim(), jabatan: entry.jabatan, isActive: true, isSelfRegistered: false }).returning({ id: employees.id });
      empId = created.id;
      ok("Karyawan dibuat: " + entry.fullName + " id=" + empId);
    }

    const [slot] = await db.select({ empId: shiftSchedules.employeeId }).from(shiftSchedules).where(eq(shiftSchedules.id, entry.slotId));
    if (!slot) { fail("Slot " + entry.slotLabel + " tidak ditemukan!"); continue; }
    if (slot.empId !== null && slot.empId !== empId) { fail("Slot " + entry.slotLabel + " sudah terisi orang lain."); continue; }
    if (slot.empId === empId) { info("Sudah assigned, skip."); continue; }

    await db.update(shiftSchedules).set({ employeeId: empId, updatedAt: new Date() }).where(eq(shiftSchedules.id, entry.slotId));
    ok("Slot " + entry.slotLabel + " -> assigned");
  }

  // STEP 3: Audit final
  console.log("\n-- STEP 3: Audit Final --");
  const all = await db.select({ day: shiftSchedules.dayOfWeek, start: shiftSchedules.slotStart, end: shiftSchedules.slotEnd, order: shiftSchedules.orderInSlot, empName: employees.fullName, nim: employees.nim }).from(shiftSchedules).leftJoin(employees, eq(shiftSchedules.employeeId, employees.id)).where(eq(shiftSchedules.isActive, true)).orderBy(shiftSchedules.dayOfWeek, shiftSchedules.slotStart, shiftSchedules.orderInSlot);

  let g = "";
  for (const r of all) {
    const key = r.day + " " + r.start + "-" + r.end;
    if (key !== g) { console.log("\n  " + key); g = key; }
    console.log("    #" + r.order + " " + (r.empName ? r.empName + " (" + r.nim + ")" : "(kosong)"));
  }

  console.log("\n=== SEED SELESAI ===\n");
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
