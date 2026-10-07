// =============================================================
// GET /api/cron/auto-close-shift
// Dipanggil oleh Vercel Cron Job setiap menit (*/1 * * * *).
// Jadwal produksi: "0 17 * * *" = pukul 00:00 WIB setiap hari.
//
// Auth: CRON_SECRET header (Vercel Cron standard)
//
// Business Rules:
//   1. Tutup otomatis shift ACTIVE yang sudah melewati slotEnd jadwal
//      kasir + 15 menit TOLERANSI — dihitung dari slotEnd hari kasir
//      tersebut buka shift (bukan hari cron berjalan).
//   2. Jika shift tidak punya slot jadwal (kasir tanpa jadwal hari ini),
//      fallback: tutup shift yang > 10 jam (stale session).
//   3. Semua auto-close dicatat dengan notes = 'AUTO_CLOSED_BY_CRON'
//   4. Tidak blocking — error satu shift tidak menghentikan yang lain.
//
// ⚠️  FIX v2 — Bug yang diperbaiki:
//      Versi lama membandingkan nowMinutes (0 saat cron 00:00 WIB)
//      terhadap slotEndMinutes (~915 untuk 15:15 WIB). Selalu false.
//      Kini menggunakan perbandingan epoch absolut:
//        slotEndWib = date(clockIn WIB) + slotEnd "HH:MM" → ms
//        shouldClose = nowEpoch >= slotEndWib + 15 menit buffer
//
// FinOps: query ACTIVE shifts difilter isNull(clockOut) + limit 50
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, shiftSchedules, attendances } from '@/lib/db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';

// Tipe literal enum hari dari skema DB
type DayOfWeek = 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU' | 'MINGGU';

export const runtime = 'nodejs';

// ── Mapping nama hari Indonesia ke format database ─────────────────────────
const HARI_MAP: Record<string, string> = {
  Minggu: 'MINGGU',
  Senin:  'SENIN',
  Selasa: 'SELASA',
  Rabu:   'RABU',
  Kamis:  'KAMIS',
  Jumat:  'JUMAT',
  Sabtu:  'SABTU',
};

// Pastikan hanya Vercel Cron yang bisa memanggil endpoint ini
function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // env tidak di-set → tolak semua
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

/**
 * Mengonversi string tanggal WIB (YYYY-MM-DD) + slotEnd "HH:MM[:SS]"
 * menjadi epoch milliseconds yang merepresentasikan waktu WIB absolut.
 *
 * Contoh: tanggal="2026-10-07" + slotEnd="15:00"
 *   → new Date("2026-10-07T15:00:00+07:00").getTime()
 *   → ms epoch untuk 15:00 WIB tgl 7 Oktober 2026
 */
function slotEndToEpoch(tanggalWib: string, slotEnd: string): number {
  const [hh, mm] = slotEnd.split(':');
  // Buat timestamp WIB eksplisit dengan offset +07:00
  const isoWib = `${tanggalWib}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`;
  return new Date(isoWib).getTime();
}

/**
 * Mengambil nama hari dari timestamp UTC dalam zona WIB.
 * Return: 'SENIN' | 'SELASA' | ... | 'MINGGU'
 */
function getDayOfWeekWib(date: Date): string {
  const hariRaw = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
  }).format(date);
  return HARI_MAP[hariRaw] ?? hariRaw.toUpperCase();
}

/**
 * Mengambil string tanggal WIB (YYYY-MM-DD) dari Date UTC.
 */
function getTanggalWib(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth guard — hanya Vercel Cron yang boleh
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const nowWib = new Date();
  const nowEpoch = nowWib.getTime();

  // Toleransi menit setelah slotEnd sebelum shift ditutup paksa
  const TOLERANSI_MS   = 15 * 60 * 1_000; // 15 menit
  const TEN_HOURS_MS   = 10 * 60 * 60 * 1_000;

  let closedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  try {
    // ── PASS 1: Tutup shift ACTIVE yang sudah overdue ─────────────────────
    // Ambil semua shift ACTIVE yang belum di-clockOut
    const activeShifts = await db
      .select({
        shiftId:    shifts.id,
        employeeId: shifts.employeeId,
        clockIn:    shifts.clockIn,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.status, 'ACTIVE'),
          isNull(shifts.clockOut),
        ),
      )
      .limit(50);

    if (activeShifts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Tidak ada shift aktif.',
        closedCount: 0,
        skippedCount: 0,
        timestamp: nowWib.toISOString(),
      });
    }

    // Proses setiap shift aktif secara serial (menghindari race condition)
    for (const shift of activeShifts) {
      try {
        // Tentukan hari WIB saat kasir buka shift (bukan hari cron berjalan)
        const clockInDate  = new Date(shift.clockIn);
        const hariShift    = getDayOfWeekWib(clockInDate);
        const tanggalShift = getTanggalWib(clockInDate);

        // Cari jadwal kasir yang sesuai hari saat shift dibuka
        const jadwal = await db.query.shiftSchedules.findFirst({
          where: and(
            eq(shiftSchedules.employeeId, shift.employeeId),
            eq(shiftSchedules.dayOfWeek, hariShift as DayOfWeek),
            eq(shiftSchedules.isActive, true),
          ),
          columns: { slotEnd: true },
        });

        let shouldClose = false;
        let closeReason = '';

        if (jadwal) {
          // ── KUNCI FIX: bandingkan epoch absolut, bukan nowMinutes ────────
          // slotEndEpoch = kapan seharusnya shift berakhir (dalam ms epoch UTC)
          const slotEndEpoch = slotEndToEpoch(tanggalShift, jadwal.slotEnd);

          if (nowEpoch >= slotEndEpoch + TOLERANSI_MS) {
            shouldClose = true;
            closeReason = `AUTO_CLOSED_OVERDUE — ditutup otomatis oleh sistem. Batas akhir slot: ${jadwal.slotEnd} WIB (${tanggalShift}) + 15m toleransi. Fisik laci kas belum diverifikasi kasir.`;
          }
        } else {
          // Tidak ada jadwal untuk hari itu — fallback: tutup shift > 10 jam
          const shiftAgeMs = nowEpoch - clockInDate.getTime();
          if (shiftAgeMs > TEN_HOURS_MS) {
            shouldClose = true;
            closeReason = 'AUTO_CLOSED_STALE — durasi shift aktif melebihi 10 jam tanpa jadwal aktif. Fisik laci kas belum diverifikasi kasir.';
          }
        }

        if (!shouldClose) {
          skippedCount++;
          continue;
        }

        // Tutup shift — dengan race condition guard (ACTIVE check ulang)
        const result = await db
          .update(shifts)
          .set({
            status:   'CLOSED',
            clockOut: nowWib,
            notes:    closeReason,
          })
          .where(
            and(
              eq(shifts.id, shift.shiftId),
              eq(shifts.status, 'ACTIVE'), // guard: jangan tutup yang sudah CLOSED
            ),
          )
          .returning({ id: shifts.id });

        if (result.length > 0) {
          closedCount++;
        } else {
          skippedCount++; // sudah ditutup lebih dahulu (race condition)
        }
      } catch (shiftErr) {
        errors.push(`shiftId=${shift.shiftId}: ${shiftErr instanceof Error ? shiftErr.message : 'unknown'}`);
      }
    }

    // ── PASS 2: Auto-mark TIDAK_HADIR ─────────────────────────────────────
    // Karyawan yang punya jadwal kemarin (atau hari ini jika cron bukan tengah malam),
    // slotEnd sudah lewat + 30 menit, tapi tidak ada attendance record.
    let absenCount = 0;
    try {
      // Cron berjalan pukul 00:00 WIB → "hariIni" di WIB = hari baru.
      // Jadwal yang perlu dicek absennya adalah KEMARIN (hari saat toko masih buka).
      // Kita cek keduanya agar tidak missed jika cron berjalan di jam lain.
      const waktuCek = [
        // Kemarin WIB (kasus utama: cron 00:00)
        new Date(nowEpoch - 24 * 60 * 60 * 1_000),
        // Hari ini WIB (kasus cron berjalan siang/sore)
        nowWib,
      ];

      const BUFFER_ABSEN_MS = 30 * 60 * 1_000; // 30 menit

      for (const refDate of waktuCek) {
        const hariRef    = getDayOfWeekWib(refDate);
        const tanggalRef = getTanggalWib(refDate);

        // Ambil semua jadwal aktif hari referensi
        const jadwalHariRef = await db
          .select({
            scheduleId: shiftSchedules.id,
            employeeId: shiftSchedules.employeeId,
            slotEnd:    shiftSchedules.slotEnd,
          })
          .from(shiftSchedules)
          .where(and(
            eq(shiftSchedules.dayOfWeek, hariRef as DayOfWeek),
            eq(shiftSchedules.isActive, true),
          ))
          .limit(100);

        for (const jadwal of jadwalHariRef) {
          try {
            if (!jadwal.employeeId) continue;
            const empId = jadwal.employeeId;

            // Hanya proses jika slotEnd + buffer sudah benar-benar lewat
            const slotEndEpoch = slotEndToEpoch(tanggalRef, jadwal.slotEnd);
            if (nowEpoch < slotEndEpoch + BUFFER_ABSEN_MS) continue;

            // Cek apakah sudah ada attendance record untuk tanggal referensi ini
            const existingAttendance = await db.query.attendances.findFirst({
              where: and(
                eq(attendances.employeeId, empId),
                eq(attendances.attendanceDate, tanggalRef),
              ),
              columns: { id: true },
            });

            if (existingAttendance) continue; // Sudah hadir/telat/ijin → skip

            // Cek apakah ada shift pada tanggal referensi
            const existingShiftOnDate = await db.query.shifts.findFirst({
              where: eq(shifts.employeeId, empId),
              orderBy: [desc(shifts.clockIn)],
              columns: { id: true, clockIn: true },
            });

            if (existingShiftOnDate) {
              const shiftClockInDate = getTanggalWib(new Date(existingShiftOnDate.clockIn));
              if (shiftClockInDate === tanggalRef) continue; // Ada shift hari itu → skip
            }

            // Tidak ada attendance & tidak ada shift → TIDAK_HADIR
            await db
              .insert(attendances)
              .values({
                employeeId:     empId,
                scheduleId:     jadwal.scheduleId,
                attendanceDate: tanggalRef,
                status:         'TIDAK_HADIR',
                lateMinutes:    0,
              })
              .onConflictDoNothing();

            absenCount++;
          } catch {
            // Gagal satu jadwal tidak menghentikan proses
          }
        }
      }
    } catch {
      // PASS 2 gagal total — tetap return hasil PASS 1
    }

    return NextResponse.json({
      success: true,
      message: `Cron selesai. Ditutup: ${closedCount}, Dilewati: ${skippedCount}, Auto-Absen: ${absenCount}.`,
      closedCount,
      skippedCount,
      absenCount,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: nowWib.toISOString(),
    });


  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: 'Cron gagal: ' + (err instanceof Error ? err.message : 'unknown'),
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
