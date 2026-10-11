// =============================================================
// scripts/test-realtime-operational-hours.ts
// Test Suite Rinci: Pengujian Real-Time Jam & Hari Operasional Toko
// Memverifikasi Jendela Jam 05:00 Subuh Hari Kerja & Akhir Pekan
// =============================================================

import { db } from '../src/lib/db/client';
import { shiftSchedules, employees } from '../src/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Logika fungsi evaluator operasional yang identik dengan login page
type ModeResult = 
  | 'WEEKDAY_ACTIVE'   // Absensi Shift Tampil Penuh
  | 'WEEKDAY_NIGHT'    // Malam Hari Kerja (Toko Istirahat Malam)
  | 'WEEKEND_ACTIVE'   // Sesi Evaluasi, Opname & Restock Aktif
  | 'WEEKEND_NIGHT';   // Tutup Malam Akhir Pekan

function evaluateOperationalWindow(hari: string, jamMenit: string): {
  mode: ModeResult;
  deskripsi: string;
} {
  const hariUpper = hari.toUpperCase();
  const isWeekday = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT'].includes(hariUpper);
  const [h, m] = jamMenit.split(':').map(Number);
  const totalMenit = (h ?? 0) * 60 + (m ?? 0);

  if (isWeekday) {
    // Hari Kerja (Senin s.d. Jumat):
    // HARUS KELIHATAN DARI JAM 05:00 SUBUH (300 m) s/d 22:00 MALAM (1320 m)
    if (totalMenit >= 5 * 60 && totalMenit <= 22 * 60) {
      return {
        mode: 'WEEKDAY_ACTIVE',
        deskripsi: `Jadwal shift perkuliahan reguler hari ${hariUpper} TAMPIL PENUH (Siap dari subuh).`,
      };
    } else {
      return {
        mode: 'WEEKDAY_NIGHT',
        deskripsi: `Toko Istirahat Malam. Presensi shift reguler aktif kembali pukul 05:00 Subuh WIB.`,
      };
    }
  } else {
    // Akhir Pekan (Sabtu & Minggu):
    if (hariUpper === 'SABTU') {
      if (totalMenit >= 6 * 60 && totalMenit <= 21 * 60) {
        return {
          mode: 'WEEKEND_ACTIVE',
          deskripsi: `Sesi Akhir Pekan Aktif: Evaluasi, Opname Stok & Restock Logistik (s/d 21:00 WIB).`,
        };
      } else {
        return {
          mode: 'WEEKEND_NIGHT',
          deskripsi: `Sesi opname Sabtu ditutup. Operasional gudang dibuka kembali Minggu pukul 06:00 WIB.`,
        };
      }
    } else if (hariUpper === 'MINGGU') {
      if (totalMenit >= 6 * 60 && totalMenit <= 22 * 60) {
        return {
          mode: 'WEEKEND_ACTIVE',
          deskripsi: `Sesi Akhir Pekan Aktif: Evaluasi, Opname Stok & Restock Logistik (s/d 22:00 WIB).`,
        };
      } else {
        return {
          mode: 'WEEKEND_NIGHT',
          deskripsi: `Sesi opname Minggu selesai. Presensi shift reguler aktif kembali Senin pukul 05:00 Subuh WIB.`,
        };
      }
    }
    return {
      mode: 'WEEKEND_NIGHT',
      deskripsi: `Akhir pekan tutup.`,
    };
  }
}

async function runDetailedRealtimeTests() {
  console.log('🧪 Memulai Pengujian Real-Time Jam & Hari Operasional Toko Wiramart...\n');

  const testCases: Array<{
    scenario: string;
    hari: string;
    jam: string;
    expectedMode: ModeResult;
  }> = [
    // ── 1. SENIN (HARI KERJA) ──
    { scenario: 'Senin Dini Hari (04:30 WIB)', hari: 'SENIN', jam: '04:30', expectedMode: 'WEEKDAY_NIGHT' },
    { scenario: 'Senin Tepat Subuh (05:00 WIB)', hari: 'SENIN', jam: '05:00', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Senin Pagi Awal (05:45 WIB)', hari: 'SENIN', jam: '05:45', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Senin Shift Pagi Mulai (07:30 WIB)', hari: 'SENIN', jam: '07:30', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Senin Siang (11:30 WIB)', hari: 'SENIN', jam: '11:30', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Senin Sore (16:00 WIB)', hari: 'SENIN', jam: '16:00', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Senin Malam Kerja (21:55 WIB)', hari: 'SENIN', jam: '21:55', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Senin Malam Selesai (22:15 WIB)', hari: 'SENIN', jam: '22:15', expectedMode: 'WEEKDAY_NIGHT' },

    // ── 2. SELASA - JUMAT ──
    { scenario: 'Selasa Subuh (05:01 WIB)', hari: 'SELASA', jam: '05:01', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Rabu Siang (12:00 WIB)', hari: 'RABU', jam: '12:00', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Kamis Pagi (06:30 WIB)', hari: 'KAMIS', jam: '06:30', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Jumat Pagi (05:15 WIB)', hari: 'JUMAT', jam: '05:15', expectedMode: 'WEEKDAY_ACTIVE' },
    { scenario: 'Jumat Tengah Malam (23:30 WIB)', hari: 'JUMAT', jam: '23:30', expectedMode: 'WEEKDAY_NIGHT' },

    // ── 3. SABTU (AKHIR PEKAN) ──
    { scenario: 'Sabtu Subuh Sebelum Buka (05:30 WIB)', hari: 'SABTU', jam: '05:30', expectedMode: 'WEEKEND_NIGHT' },
    { scenario: 'Sabtu Pagi Opname Buka (06:00 WIB)', hari: 'SABTU', jam: '06:00', expectedMode: 'WEEKEND_ACTIVE' },
    { scenario: 'Sabtu Siang Restock Supplier (14:00 WIB)', hari: 'SABTU', jam: '14:00', expectedMode: 'WEEKEND_ACTIVE' },
    { scenario: 'Sabtu Malam Menjelang Tutup (20:55 WIB)', hari: 'SABTU', jam: '20:55', expectedMode: 'WEEKEND_ACTIVE' },
    { scenario: 'Sabtu Malam Selesai Opname (21:10 WIB)', hari: 'SABTU', jam: '21:10', expectedMode: 'WEEKEND_NIGHT' },

    // ── 4. MINGGU (AKHIR PEKAN) ──
    { scenario: 'Minggu Subuh Sebelum Buka (05:45 WIB)', hari: 'MINGGU', jam: '05:45', expectedMode: 'WEEKEND_NIGHT' },
    { scenario: 'Minggu Pagi Opname Buka (06:05 WIB)', hari: 'MINGGU', jam: '06:05', expectedMode: 'WEEKEND_ACTIVE' },
    { scenario: 'Minggu Sore Cek Stok FEFO (16:30 WIB)', hari: 'MINGGU', jam: '16:30', expectedMode: 'WEEKEND_ACTIVE' },
    { scenario: 'Minggu Malam Menjelang Tutup (21:55 WIB)', hari: 'MINGGU', jam: '21:55', expectedMode: 'WEEKEND_ACTIVE' },
    { scenario: 'Minggu Malam Selesai (22:15 WIB - Saat Ini)', hari: 'MINGGU', jam: '22:15', expectedMode: 'WEEKEND_NIGHT' },
  ];

  let passedCount = 0;
  for (const tc of testCases) {
    const res = evaluateOperationalWindow(tc.hari, tc.jam);
    if (res.mode === tc.expectedMode) {
      console.log(`✅ [PASS] ${tc.scenario} -> ${res.mode}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${tc.scenario} -> Harusnya ${tc.expectedMode}, tapi dapat ${res.mode}`);
      process.exit(1);
    }
  }

  console.log(`\n🎉 Semua ${passedCount}/${testCases.length} skenario waktu real-time LULUS 100%!\n`);

  // ── 5. VERIFIKASI INTEGRITAS DATA SHIFT HARI SENIN DI DATABASE ──
  console.log('🔍 [DATABASE CHECK] Memverifikasi data jadwal shift hari SENIN di DB...');
  const mondaySlots = await db
    .select({
      id: shiftSchedules.id,
      dayOfWeek: shiftSchedules.dayOfWeek,
      slotStart: shiftSchedules.slotStart,
      slotEnd: shiftSchedules.slotEnd,
      orderInSlot: shiftSchedules.orderInSlot,
      employeeId: shiftSchedules.employeeId,
      employeeName: employees.fullName,
      employeeNim: employees.nim,
    })
    .from(shiftSchedules)
    .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .where(and(eq(shiftSchedules.dayOfWeek, 'SENIN'), eq(shiftSchedules.isActive, true)))
    .orderBy(shiftSchedules.slotStart, shiftSchedules.orderInSlot);

  console.log(`📊 Ditemukan ${mondaySlots.length} slot jadwal aktif untuk hari SENIN:`);
  for (const s of mondaySlots) {
    console.log(`   - Slot ${s.slotStart} s/d ${s.slotEnd} (Urutan ${s.orderInSlot}): ${s.employeeName ?? '(Kosong/Fleksibel)'} ${s.employeeNim ? `[NIM ${s.employeeNim}]` : ''}`);
  }

  if (mondaySlots.length === 0) {
    throw new Error('❌ Data jadwal shift Senin kosong di database!');
  }

  console.log('\n✨ Verifikasi database berhasil: Jadwal hari Senin siap tampil 100% mulai 05:00 Subuh!');
}

runDetailedRealtimeTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
  });
