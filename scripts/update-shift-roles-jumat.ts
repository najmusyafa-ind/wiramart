import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/db/client";
import { employees, shiftSchedules, admins } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
  const PIN_PUTRI = "123456";
  const pinHashPutri = await bcrypt.hash(PIN_PUTRI, 12);
  const now = new Date();

  console.log("=== MEMULAI UPDATE ROLE & JADWAL SHIFT JUMAT ===");

  // 1. Putri Solichatun -> KETUA SHIFT (Admin Shift) + PIN
  console.log("1. Mengupdate Putri Solichatun menjadi Ketua Shift...");
  await db
    .update(employees)
    .set({
      jabatan: "Admin Shift",
      isKetuaShift: true,
      pinHash: pinHashPutri,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(eq(employees.id, "d2ae0860-54be-46d3-a3a6-7c80636856ca"));

  // Upsert Putri ke tabel admins
  await db
    .insert(admins)
    .values({
      nidn: "02401084",
      fullName: "Putri Solichatun",
      passwordHash: pinHashPutri,
      role: "ADMIN_SHIFT",
      isActivated: true,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: admins.nidn,
      set: {
        fullName: "Putri Solichatun",
        passwordHash: pinHashPutri,
        role: "ADMIN_SHIFT",
        isActivated: true,
        isActive: true,
        updatedAt: now,
      },
    });
  console.log("   -> Putri Solichatun berhasil diupdate (Ketua Shift, PIN: 123456)");

  // 2. Siska Febriani -> KASIR (isKetuaShift: false)
  console.log("2. Mengupdate Siska Febriani menjadi Kasir biasa...");
  await db
    .update(employees)
    .set({
      jabatan: "Kasir",
      isKetuaShift: false,
      pinHash: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    })
    .where(eq(employees.id, "e03e7d9d-0f3c-435c-8a55-0c982250561e"));
  console.log("   -> Siska Febriani berhasil diupdate (Kasir biasa, bebas otorisasi PIN)");

  // 3. Zahara Nurrohmah -> GUDANG
  console.log("3. Mengupdate Zahara Nurrohmah menjadi Gudang...");
  await db
    .update(employees)
    .set({
      jabatan: "Gudang",
      isKetuaShift: false,
      updatedAt: now,
    })
    .where(eq(employees.id, "ab676650-e971-4780-acbd-d01b7e40523d"));
  console.log("   -> Zahara Nurrohmah berhasil diupdate (Gudang)");

  // 4. Yuni Mutiara Dewi Nur Alifa -> CUSTOMER SERVICE
  console.log("4. Mengupdate Yuni Mutiara Dewi Nur Alifa menjadi Customer Service...");
  await db
    .update(employees)
    .set({
      jabatan: "Customer Service",
      isKetuaShift: false,
      updatedAt: now,
    })
    .where(eq(employees.id, "215d5e28-31ab-4d53-9953-51c6ad8c62ba"));
  console.log("   -> Yuni Mutiara Dewi Nur Alifa berhasil diupdate (Customer Service)");

  // 5. Update shift_schedules untuk JUMAT 08:00 - 11:30
  console.log("5. Menyelaraskan urutan slot jadwal piket Jumat 08:00 - 11:30...");
  // Slot 1 (Ketua / Admin Shift) -> Putri Solichatun
  await db
    .update(shiftSchedules)
    .set({
      employeeId: "d2ae0860-54be-46d3-a3a6-7c80636856ca",
      updatedAt: now,
    })
    .where(eq(shiftSchedules.id, "e2c14a97-690d-4e13-a36f-e48fca43e776"));

  // Slot 2 (Kasir) -> Siska Febriani
  await db
    .update(shiftSchedules)
    .set({
      employeeId: "e03e7d9d-0f3c-435c-8a55-0c982250561e",
      updatedAt: now,
    })
    .where(eq(shiftSchedules.id, "1c973642-36ca-4c4b-ab0e-116afb3052f5"));

  // Slot 3 (Gudang) -> Zahara Nurrohmah
  await db
    .update(shiftSchedules)
    .set({
      employeeId: "ab676650-e971-4780-acbd-d01b7e40523d",
      updatedAt: now,
    })
    .where(eq(shiftSchedules.id, "43784364-789e-4aca-9f7b-9f6645a20f27"));

  // Slot 4 (Customer Service) -> Yuni Mutiara Dewi Nur Alifa
  await db
    .update(shiftSchedules)
    .set({
      employeeId: "215d5e28-31ab-4d53-9953-51c6ad8c62ba",
      updatedAt: now,
    })
    .where(eq(shiftSchedules.id, "0ae5a727-2731-4f6a-b33a-61bc7fce760b"));
  console.log("   -> Slot 1 (Putri), Slot 2 (Siska), Slot 3 (Zahara), Slot 4 (Yuni) selesai disinkronkan.");

  console.log("=== SEMUA PROSES BERHASIL DISELESAIKAN ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Gagal menjalankan update:", err);
  process.exit(1);
});
