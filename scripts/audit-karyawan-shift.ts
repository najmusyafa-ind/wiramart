import { db } from '../src/lib/db/client';
import {
  employees,
  admins,
  shifts,
  shiftSchedules,
  attendances,
} from '../src/lib/db/schema';
import { eq, and, isNull, desc, asc, sql } from 'drizzle-orm';

async function runAuditKaryawanShift() {
  console.log('====================================================================');
  console.log('🔍 AUDIT REAL-TIME: DATABASE KARYAWAN, JADWAL & SHIFT WIRAMART');
  console.log('====================================================================\n');

  const nowWib = new Date();
  const hariIndo = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(nowWib);

  const hariNameOnly = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
  }).format(nowWib).toUpperCase();

  const tanggalYmd = nowWib.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  console.log(`⏰ Waktu Server / WIB: ${hariIndo} (${tanggalYmd})`);
  console.log(`📅 Hari Kerja Saat Ini: ${hariNameOnly}\n`);

  // --------------------------------------------------------------------------
  // 1. AUDIT AKUN ADMIN / MANAGER (BU DYAH)
  // --------------------------------------------------------------------------
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('👤 1. DATA ADMIN & MANAGER (Termasuk Akun Bu Dyah)');
  console.log('────────────────────────────────────────────────────────────────────');

  const adminList = await db
    .select({
      id: admins.id,
      fullName: admins.fullName,
      nidn: admins.nidn,
      role: admins.role,
      isActive: admins.isActive,
      isActivated: admins.isActivated,
      hasPassword: sql<boolean>`${admins.passwordHash} IS NOT NULL`,
    })
    .from(admins)
    .where(isNull(admins.deletedAt))
    .orderBy(asc(admins.fullName));

  console.log(`Total Admin Terdaftar: ${adminList.length}`);
  for (const a of adminList) {
    const status = a.isActive ? 'AKTIF' : 'NON-AKTIF';
    const pwd = a.hasPassword ? 'Ada Password' : 'Belum Set Password';
    console.log(`  • [${a.role}] ${a.fullName} (NIDN/User: ${a.nidn}) - ${status} (${pwd})`);
  }
  console.log('');

  // --------------------------------------------------------------------------
  // 2. AUDIT DATA KARYAWAN / KASIR
  // --------------------------------------------------------------------------
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('👥 2. DATA KARYAWAN KASIR (Tabel employees)');
  console.log('────────────────────────────────────────────────────────────────────');

  const empList = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      nim: employees.nim,
      programStudi: employees.programStudi,
      jabatan: employees.jabatan,
      isKetuaShift: employees.isKetuaShift,
      isActive: employees.isActive,
      hasPin: sql<boolean>`${employees.pinHash} IS NOT NULL`,
    })
    .from(employees)
    .where(isNull(employees.deletedAt))
    .orderBy(asc(employees.fullName));

  console.log(`Total Karyawan Aktif: ${empList.filter((e) => e.isActive).length} dari ${empList.length}`);
  for (const e of empList) {
    const statusKetua = e.isKetuaShift ? '⭐ KETUA SHIFT' : 'Kasir';
    const pinStatus = e.hasPin ? 'PIN OK' : 'Belum PIN';
    console.log(
      `  • ${e.fullName.padEnd(25)} | NIM: ${e.nim.padEnd(12)} | Prodi: ${e.programStudi.padEnd(22)} | ${statusKetua.padEnd(14)} | ${pinStatus}`
    );
  }
  console.log('');

  // --------------------------------------------------------------------------
  // 3. AUDIT JADWAL SHIFT MINGGUAN (shift_schedules)
  // --------------------------------------------------------------------------
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('🗓️  3. STRUKTUR JADWAL SHIFT MINGGUAN (Senin s/d Minggu)');
  console.log('────────────────────────────────────────────────────────────────────');

  const allSchedules = await db
    .select({
      id: shiftSchedules.id,
      dayOfWeek: shiftSchedules.dayOfWeek,
      slotStart: shiftSchedules.slotStart,
      slotEnd: shiftSchedules.slotEnd,
      orderInSlot: shiftSchedules.orderInSlot,
      employeeId: shiftSchedules.employeeId,
      employeeName: employees.fullName,
      coordinatorName: shiftSchedules.coordinatorName,
      isActive: shiftSchedules.isActive,
    })
    .from(shiftSchedules)
    .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .where(eq(shiftSchedules.isActive, true))
    .orderBy(
      asc(shiftSchedules.dayOfWeek),
      asc(shiftSchedules.slotStart),
      asc(shiftSchedules.orderInSlot)
    );

  const DAYS_ORDER = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'MINGGU'] as const;

  for (const day of DAYS_ORDER) {
    const daySlots = allSchedules.filter((s) => s.dayOfWeek === day);
    console.log(`▶ HARI ${day} (${daySlots.length} personil terdaftar):`);
    if (daySlots.length === 0) {
      console.log(`    (Tidak ada jadwal rutin / Toko Libur / Tidak ada sesi)`);
    } else {
      // Group by slot
      const slotMap = new Map<string, typeof daySlots>();
      for (const s of daySlots) {
        const slotKey = `${s.slotStart} - ${s.slotEnd}`;
        if (!slotMap.has(slotKey)) slotMap.set(slotKey, []);
        slotMap.get(slotKey)!.push(s);
      }

      for (const [slotTime, persons] of slotMap.entries()) {
        const koord = persons[0]?.coordinatorName ? ` (Dosen Koordinator: ${persons[0].coordinatorName})` : '';
        console.log(`    ⏰ Slot ${slotTime}${koord}:`);
        for (const p of persons) {
          const name = p.employeeName || '(Slot Belum Terisi / Kosong)';
          console.log(`       - [Urutan ${p.orderInSlot}] ${name}`);
        }
      }
    }
  }
  console.log('');

  // --------------------------------------------------------------------------
  // 4. JADWAL HARI INI & HARI BESOK
  // --------------------------------------------------------------------------
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(`🎯 4. JADWAL HARI INI (${hariNameOnly}) & BESOK`);
  console.log('────────────────────────────────────────────────────────────────────');

  const todaySlots = allSchedules.filter((s) => s.dayOfWeek === hariNameOnly);
  console.log(`Hari Ini (${hariNameOnly}, ${tanggalYmd}): ${todaySlots.length} slot.`);
  if (todaySlots.length === 0) {
    console.log(`  ℹ️ Hari ${hariNameOnly} adalah hari libur rutin kasir atau tidak ada slot shift.`);
  } else {
    for (const s of todaySlots) {
      console.log(`  • ${s.slotStart}-${s.slotEnd}: ${s.employeeName || 'Kosong'}`);
    }
  }

  // Besok
  const tomorrowIdx = (DAYS_ORDER.indexOf(hariNameOnly as any) + 1) % DAYS_ORDER.length;
  const tomorrowDay = DAYS_ORDER[tomorrowIdx];
  const tomorrowSlots = allSchedules.filter((s) => s.dayOfWeek === tomorrowDay);
  console.log(`\nBesok (${tomorrowDay}): ${tomorrowSlots.length} slot.`);
  for (const s of tomorrowSlots) {
    console.log(`  • ${s.slotStart}-${s.slotEnd} [Urutan ${s.orderInSlot}]: ${s.employeeName || 'Kosong'}`);
  }
  console.log('');

  // --------------------------------------------------------------------------
  // 5. STATUS SHIFT AKTIF SAAT INI (REAL-TIME LACI / SESI KASIR)
  // --------------------------------------------------------------------------
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('⚡ 5. CEK REAL-TIME SESI SHIFT AKTIF (Tabel shifts)');
  console.log('────────────────────────────────────────────────────────────────────');

  const activeShifts = await db
    .select({
      id: shifts.id,
      employeeId: shifts.employeeId,
      employeeName: employees.fullName,
      clockIn: shifts.clockIn,
      clockOut: shifts.clockOut,
      status: shifts.status,
      modalAwal: shifts.modalAwal,
      actualCash: shifts.actualCash,
      auditFlags: shifts.auditFlags,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(eq(shifts.status, 'ACTIVE'))
    .orderBy(desc(shifts.clockIn));

  if (activeShifts.length === 0) {
    console.log('  ✅ AMAN: Tidak ada shift kasir yang sedang ACTIVE (laci kasir tertutup rapi).');
  } else {
    console.log(`  ⚠️ PERHATIAN: Terdapat ${activeShifts.length} shift dengan status ACTIVE:`);
    for (const sh of activeShifts) {
      const clockInTime = new Date(sh.clockIn).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
      });
      console.log(`     • Kasir: ${sh.employeeName}`);
      console.log(`       ID Shift: ${sh.id}`);
      console.log(`       Waktu Buka: ${clockInTime} WIB`);
      console.log(`       Modal Awal: Rp ${Number(sh.modalAwal || 0).toLocaleString('id-ID')}`);
      console.log(`       Audit Flag: ${sh.auditFlags || 'NORMAL'}`);
    }
  }
  console.log('');

  // --------------------------------------------------------------------------
  // 6. RIWAYAT PRESENSI HARI INI & KEMARIN
  // --------------------------------------------------------------------------
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('📋 6. RIWAYAT PRESENSI (Tabel attendances)');
  console.log('────────────────────────────────────────────────────────────────────');

  const recentAttendances = await db
    .select({
      id: attendances.id,
      date: attendances.attendanceDate,
      employeeName: employees.fullName,
      status: attendances.status,
      lateMinutes: attendances.lateMinutes,
      clockInActual: attendances.clockInActual,
      notes: attendances.notes,
    })
    .from(attendances)
    .innerJoin(employees, eq(attendances.employeeId, employees.id))
    .orderBy(desc(attendances.attendanceDate), desc(attendances.createdAt))
    .limit(10);

  if (recentAttendances.length === 0) {
    console.log('  (Belum ada riwayat absensi)');
  } else {
    for (const at of recentAttendances) {
      console.log(
        `  • [${at.date}] ${at.employeeName.padEnd(22)} | Status: ${at.status.padEnd(12)} | Telat: ${at.lateMinutes} mnt ${at.notes ? `(${at.notes})` : ''}`
      );
    }
  }
  console.log('');

  console.log('====================================================================');
  console.log('✅ AUDIT SELESAI: SEMUA DATA TERVERIFIKASI REAL-TIME!');
  console.log('====================================================================');
}

runAuditKaryawanShift().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
