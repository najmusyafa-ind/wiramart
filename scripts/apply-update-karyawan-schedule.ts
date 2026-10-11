import { db } from '../src/lib/db/client';
import { employees, admins, shiftSchedules } from '../src/lib/db/schema';
import { eq, and, asc, isNull } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

async function applyUpdates() {
  console.log('================================================================');
  console.log('🚀 EKSEKUSI PEMBAHARUAN DB: ADMIN SHIFT, PIN, PERAN, & JADWAL');
  console.log('================================================================\n');

  const now = new Date();

  // ------------------------------------------------------------------
  // 1. UPDATE ADMIN SHIFT & PIN YANG SUDAH JAPRI
  // ------------------------------------------------------------------
  console.log('--- 1. UPDATE ADMIN SHIFT & PIN ---');

  // A. Risqia Lestari (02601018) -> PIN: 02601018
  const hashRisqia = await bcrypt.hash('02601018', 12);
  const empRisqia = await db.query.employees.findFirst({ where: eq(employees.nim, '02601018') });
  if (empRisqia) {
    await db.update(employees).set({
      isKetuaShift: true,
      jabatan: 'Kepala Admin',
      pinHash: hashRisqia,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    }).where(eq(employees.id, empRisqia.id));

    await db.insert(admins).values({
      nidn: '02601018',
      fullName: empRisqia.fullName,
      passwordHash: hashRisqia,
      role: 'ADMIN_SHIFT',
      isActive: true,
      isActivated: true,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: admins.nidn,
      set: {
        fullName: empRisqia.fullName,
        passwordHash: hashRisqia,
        role: 'ADMIN_SHIFT',
        isActive: true,
        isActivated: true,
        updatedAt: now,
      }
    });
    console.log(`✅ Admin Shift 1: ${empRisqia.fullName} (NIM: 02601018) -> PIN: 02601018 tersimpan aman.`);
  }

  // B. Naswa Novianti Saputri (02501063) -> PIN: naswa1704
  const hashNaswa = await bcrypt.hash('naswa1704', 12);
  const empNaswa = await db.query.employees.findFirst({ where: eq(employees.nim, '02501063') });
  if (empNaswa) {
    await db.update(employees).set({
      isKetuaShift: true,
      jabatan: 'Kepala Admin',
      pinHash: hashNaswa,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    }).where(eq(employees.id, empNaswa.id));

    await db.insert(admins).values({
      nidn: '02501063',
      fullName: empNaswa.fullName,
      passwordHash: hashNaswa,
      role: 'ADMIN_SHIFT',
      isActive: true,
      isActivated: true,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: admins.nidn,
      set: {
        fullName: empNaswa.fullName,
        passwordHash: hashNaswa,
        role: 'ADMIN_SHIFT',
        isActive: true,
        isActivated: true,
        updatedAt: now,
      }
    });
    console.log(`✅ Admin Shift 2: ${empNaswa.fullName} (NIM: 02501063) -> PIN: naswa1704 tersimpan aman.`);
  }

  // C. Putri Solichatun (02401084) -> PIN: 060223
  const hashPutri = await bcrypt.hash('060223', 12);
  const empPutri = await db.query.employees.findFirst({ where: eq(employees.nim, '02401084') });
  if (empPutri) {
    await db.update(employees).set({
      isKetuaShift: true,
      jabatan: 'Kepala Admin',
      pinHash: hashPutri,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      updatedAt: now,
    }).where(eq(employees.id, empPutri.id));

    await db.insert(admins).values({
      nidn: '02401084',
      fullName: empPutri.fullName,
      passwordHash: hashPutri,
      role: 'ADMIN_SHIFT',
      isActive: true,
      isActivated: true,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: admins.nidn,
      set: {
        fullName: empPutri.fullName,
        passwordHash: hashPutri,
        role: 'ADMIN_SHIFT',
        isActive: true,
        isActivated: true,
        updatedAt: now,
      }
    });
    console.log(`✅ Admin Shift 3: ${empPutri.fullName} (NIM: 02401084) -> PIN: 060223 tersimpan aman.`);
  }

  // D. Azzahro Setyowati S (02301028) -> Role Ketua Shift / Admin Shift di Rabu Siang
  const empAzzahro = await db.query.employees.findFirst({ where: eq(employees.nim, '02301028') });
  if (empAzzahro) {
    await db.update(employees).set({
      isKetuaShift: true,
      jabatan: 'Kepala Admin',
      updatedAt: now,
    }).where(eq(employees.id, empAzzahro.id));
    console.log(`✅ Admin Shift 4: ${empAzzahro.fullName} (NIM: 02301028) -> Jabatan diset Kepala Admin.`);
  }

  // ------------------------------------------------------------------
  // 2. UPDATE PERAN / JABATAN KARYAWAN LAIN SESUAI DAFTAR RESMI
  // ------------------------------------------------------------------
  console.log('\n--- 2. UPDATE PERAN & JABATAN KARYAWAN ---');

  const roleUpdates: Record<string, string> = {
    // Gudang
    '02601011': 'Kepala Gudang', // Khalila Sevina Nurani
    '02505035': 'Kepala Gudang', // Bagaskara Putra N.H
    '02301054': 'Kepala Gudang', // Faizah Bisa'adatil Ukhrowiyah
    '02401002': 'Kepala Gudang', // Aulia Putra Ramadhan
    '02401042': 'Kepala Gudang', // Zahara Nurrohmah

    // Pelayan / Customer Service
    '02601009': 'Pelayan', // Nisa Ulfia Febriani
    '02501016': 'Pelayan', // Endah Purwati
    '02501056': 'Pelayan', // Zaizafun Inez Arundini
    '02301076': 'Pelayan', // Ratih Sri Widyaningrum
    '02401058': 'Pelayan', // Yuni Mutiara Dewi Nur Afifa
    '02402010': 'Pelayan', // Maulida

    // Kasir
    '02601020': 'Kasir', // Tisya Nur Febriani
    '02501008': 'Kasir', // Dwi Puspitasari
    '02301022': 'Kasir', // Annisa Salsabila
    '02301048': 'Kasir', // Julian Anggun Nurita
    '02401061': 'Kasir', // Siska Febriani
    '02402035': 'Kasir', // Winda
    '02301030': 'Kasir', // Devi Yuliana Sari / Lia
    '02301062': 'Kasir', // Najua Nur Salsabila
    '02302017': 'Kasir', // Gita Aprilianingrum
    '02302011': 'Kasir', // Liliyana Dwi Kusuma Handayani
    '02402006': 'Kasir', // Nazila Awalia Solikhah
    '02402009': 'Kasir', // Zaiffah Nur Fathimah
    '02402007': 'Kasir', // Lisa Amelia
    '02401083': 'Kasir', // Dwi Lia Rahmania
    '02401070': 'Kasir', // Meizin Shinta Resmi
    '02401052': 'Kasir', // Nur Asshifah
  };

  for (const [nim, jabatan] of Object.entries(roleUpdates)) {
    await db.update(employees).set({ jabatan, updatedAt: now }).where(eq(employees.nim, nim));
  }
  console.log(`✅ Berhasil memperbarui jabatan untuk ${Object.keys(roleUpdates).length} karyawan.`);

  // ------------------------------------------------------------------
  // 3. UPDATE JAM SLOT DAN PERSONIL DI SHIFT_SCHEDULES
  // ------------------------------------------------------------------
  console.log('\n--- 3. SINKRONISASI JADWAL SHIFT MINGGUAN ---');

  // Bersihkan slot legacy 08:00-15:00 yang tidak terpakai
  const deletedLegacy = await db.delete(shiftSchedules).where(
    and(eq(shiftSchedules.slotStart, '08:00'), eq(shiftSchedules.slotEnd, '15:00'))
  ).returning({ id: shiftSchedules.id });
  console.log(`🧹 Membersihkan ${deletedLegacy.length} slot legacy 08:00-15:00.`);

  // Update jam slot utama:
  // 08:00 -> 07:30 (Slot Pagi: 07:30 - 11:30)
  // 11:30 -> 11:00 (Slot Siang: 11:00 - 15:00)
  await db.update(shiftSchedules)
    .set({ slotStart: '07:30', slotEnd: '11:30', updatedAt: now })
    .where(and(eq(shiftSchedules.slotStart, '08:00'), eq(shiftSchedules.slotEnd, '11:30')));

  await db.update(shiftSchedules)
    .set({ slotStart: '11:00', slotEnd: '15:00', updatedAt: now })
    .where(and(eq(shiftSchedules.slotStart, '11:30'), eq(shiftSchedules.slotEnd, '15:00')));

  console.log(`✅ Jam slot diperbarui: Pagi (07:30 - 11:30 WIB) & Siang (11:00 - 15:00 WIB).`);

  // Map NIM to Employee ID
  const allEmp = await db.query.employees.findMany();
  const empByNim = new Map(allEmp.map(e => [e.nim, e.id]));

  // Data jadwal resmi dari user
  type SlotAssignment = {
    dayOfWeek: 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT';
    slotStart: '07:30' | '11:00';
    slotEnd: '11:30' | '15:00';
    orderInSlot: number;
    nim: string | null;
  };

  const masterAssignments: SlotAssignment[] = [
    // SENIN Pagi
    { dayOfWeek: 'SENIN', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 1, nim: '02302017' }, // Gita
    { dayOfWeek: 'SENIN', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 2, nim: '02302011' }, // Liliyana
    { dayOfWeek: 'SENIN', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 3, nim: null },       // nama (kosong)
    { dayOfWeek: 'SENIN', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 4, nim: null },       // nama (kosong)

    // SENIN Siang
    { dayOfWeek: 'SENIN', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 1, nim: '02402006' }, // Nazila
    { dayOfWeek: 'SENIN', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 2, nim: '02402009' }, // Zaiffah
    { dayOfWeek: 'SENIN', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 3, nim: '02402007' }, // Lisa Amelia
    { dayOfWeek: 'SENIN', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 4, nim: null },       // nama (kosong)

    // SELASA Pagi
    { dayOfWeek: 'SELASA', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 1, nim: '02401083' }, // Dwi Lia
    { dayOfWeek: 'SELASA', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 2, nim: '02401070' }, // Meizin
    { dayOfWeek: 'SELASA', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 3, nim: '02401052' }, // Nur Asshifah
    { dayOfWeek: 'SELASA', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 4, nim: null },

    // SELASA Siang
    { dayOfWeek: 'SELASA', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 1, nim: '02601020' }, // Tisya (Kasir)
    { dayOfWeek: 'SELASA', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 2, nim: '02601011' }, // Khalila (Gudang)
    { dayOfWeek: 'SELASA', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 3, nim: '02601018' }, // Risqia (Admin)
    { dayOfWeek: 'SELASA', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 4, nim: '02601009' }, // Nisa Ulfia (CS)

    // RABU Pagi
    { dayOfWeek: 'RABU', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 1, nim: '02505035' }, // Bagaskara (Gudang)
    { dayOfWeek: 'RABU', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 2, nim: '02501063' }, // Naswa (Admin)
    { dayOfWeek: 'RABU', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 3, nim: '02501016' }, // Endah (CS)
    { dayOfWeek: 'RABU', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 4, nim: '02501008' }, // Dwi Puspitasari (Kasir)
    { dayOfWeek: 'RABU', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 5, nim: '02501056' }, // Zaizafun (CS)

    // RABU Siang
    { dayOfWeek: 'RABU', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 1, nim: '02301076' }, // Ratih (CS)
    { dayOfWeek: 'RABU', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 2, nim: '02301054' }, // Faizah (Gudang)
    { dayOfWeek: 'RABU', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 3, nim: '02301028' }, // Azzahro (Admin)
    { dayOfWeek: 'RABU', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 4, nim: '02301022' }, // Annisa (Kasir)
    { dayOfWeek: 'RABU', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 5, nim: '02301048' }, // Julian (Kasir)

    // KAMIS Pagi (Belum ada nama)
    { dayOfWeek: 'KAMIS', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 1, nim: null },
    { dayOfWeek: 'KAMIS', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 2, nim: null },
    { dayOfWeek: 'KAMIS', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 3, nim: null },
    { dayOfWeek: 'KAMIS', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 4, nim: null },

    // KAMIS Siang
    { dayOfWeek: 'KAMIS', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 1, nim: '02501063' }, // Naswa (Admin)
    { dayOfWeek: 'KAMIS', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 2, nim: '02501016' }, // Endah (CS)
    { dayOfWeek: 'KAMIS', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 3, nim: '02501008' }, // Dwi Puspitasari (Kasir)
    { dayOfWeek: 'KAMIS', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 4, nim: '02501056' }, // Zaizafun (CS)
    { dayOfWeek: 'KAMIS', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 5, nim: '02401002' }, // Aulia Putra (Gudang)

    // JUMAT Pagi
    { dayOfWeek: 'JUMAT', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 1, nim: '02401058' }, // Yuni Mutiara (Pelayan)
    { dayOfWeek: 'JUMAT', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 2, nim: '02401061' }, // Siska (Kasir)
    { dayOfWeek: 'JUMAT', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 3, nim: '02401084' }, // Putri Solichatun (Admin)
    { dayOfWeek: 'JUMAT', slotStart: '07:30', slotEnd: '11:30', orderInSlot: 4, nim: '02401042' }, // Zahara (Gudang)

    // JUMAT Siang
    { dayOfWeek: 'JUMAT', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 1, nim: '02402035' }, // Winda (Kasir)
    { dayOfWeek: 'JUMAT', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 2, nim: '02402010' }, // Maulida (Pelayan)
    { dayOfWeek: 'JUMAT', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 3, nim: '02301030' }, // Lia (Kasir)
    { dayOfWeek: 'JUMAT', slotStart: '11:00', slotEnd: '15:00', orderInSlot: 4, nim: '02301062' }, // Najua (Kasir)
  ];

  for (const item of masterAssignments) {
    const employeeId = item.nim ? (empByNim.get(item.nim) ?? null) : null;

    // Cari jadwal existing di slot dan order ini
    const existing = await db.query.shiftSchedules.findFirst({
      where: and(
        eq(shiftSchedules.dayOfWeek, item.dayOfWeek),
        eq(shiftSchedules.slotStart, item.slotStart),
        eq(shiftSchedules.slotEnd, item.slotEnd),
        eq(shiftSchedules.orderInSlot, item.orderInSlot),
      ),
    });

    if (existing) {
      await db.update(shiftSchedules).set({
        employeeId,
        isActive: true,
        updatedAt: now,
      }).where(eq(shiftSchedules.id, existing.id));
    } else {
      await db.insert(shiftSchedules).values({
        dayOfWeek: item.dayOfWeek,
        slotStart: item.slotStart,
        slotEnd: item.slotEnd,
        orderInSlot: item.orderInSlot,
        employeeId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  console.log(`✅ Berhasil menyelaraskan ${masterAssignments.length} slot jadwal mingguan.`);

  console.log('\n================================================================');
  console.log('🎉 SEMUA PEMBAHARUAN DATABASE SELESAI DENGAN SUKSES & AMAN!');
  console.log('================================================================');
}

applyUpdates().catch((err) => {
  console.error('Fatal error during updates:', err);
  process.exit(1);
});
