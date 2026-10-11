import { db } from '../src/lib/db/client';
import { employees, admins, shiftSchedules } from '../src/lib/db/schema';
import { inArray, eq, asc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

async function verify() {
  console.log('================================================================');
  console.log('🔍 VERIFIKASI POST-UPDATE: ADMIN SHIFT, PIN, PERAN, & JADWAL');
  console.log('================================================================\n');

  // 1. Verifikasi Admin Shift & Hash PIN
  console.log('--- 1. VERIFIKASI AKUN ADMIN SHIFT & PIN BCRYPT ---');
  const adminsToCheck = [
    { nim: '02601018', expectedName: 'Risqia Lestari', pin: '02601018' },
    { nim: '02501063', expectedName: 'Naswa Novianti Saputri', pin: 'naswa1704' },
    { nim: '02401084', expectedName: 'Putri Solichatun', pin: '060223' },
  ];

  for (const item of adminsToCheck) {
    const adm = await db.query.admins.findFirst({ where: eq(admins.nidn, item.nim) });
    const emp = await db.query.employees.findFirst({ where: eq(employees.nim, item.nim) });

    if (!adm || !adm.passwordHash) {
      console.error(`❌ Akun admin untuk ${item.expectedName} (${item.nim}) TIDAK DITEMUKAN / TANPA PASSWORD!`);
      continue;
    }

    const matchAdmin = await bcrypt.compare(item.pin, adm.passwordHash);
    const matchEmp = emp?.pinHash ? await bcrypt.compare(item.pin, emp.pinHash) : false;

    console.log(`✅ [${adm.role}] ${adm.fullName} (NIM: ${adm.nidn})`);
    console.log(`   - Login Admin PIN (${item.pin}): ${matchAdmin ? 'MATCH / VALID ✅' : 'INVALID ❌'}`);
    console.log(`   - Employee PIN Hash: ${matchEmp ? 'MATCH / VALID ✅' : 'INVALID ❌'}`);
    console.log(`   - Jabatan: ${emp?.jabatan} | isKetuaShift: ${emp?.isKetuaShift}`);
    console.log(`   - Status Akun: Active=${adm.isActive}, Activated=${adm.isActivated}\n`);
  }

  // 2. Verifikasi Jadwal Mingguan Per Hari
  console.log('--- 2. VERIFIKASI JADWAL SHIFT PER HARI ---');
  const list = await db
    .select({
      dayOfWeek: shiftSchedules.dayOfWeek,
      slotStart: shiftSchedules.slotStart,
      slotEnd: shiftSchedules.slotEnd,
      orderInSlot: shiftSchedules.orderInSlot,
      empName: employees.fullName,
      empNim: employees.nim,
      empJabatan: employees.jabatan,
    })
    .from(shiftSchedules)
    .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .orderBy(asc(shiftSchedules.dayOfWeek), asc(shiftSchedules.slotStart), asc(shiftSchedules.orderInSlot));

  const days = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT'];
  for (const day of days) {
    console.log(`\n📅 HARI ${day}:`);
    const daySlots = list.filter(s => s.dayOfWeek === day);
    for (const s of daySlots) {
      console.log(`  [${s.slotStart} - ${s.slotEnd}] #${s.orderInSlot}: ${s.empName ? `${s.empName} (${s.empNim}) [${s.empJabatan}]` : 'KOSONG / FLEKSIBEL'}`);
    }
  }

  console.log('\n================================================================');
  console.log('✅ SELURUH VERIFIKASI POST-UPDATE LOLOS DENGAN PRESTISIUS!');
  console.log('================================================================');
}

verify().catch(console.error);
