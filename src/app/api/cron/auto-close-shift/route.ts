// =============================================================
// GET /api/cron/auto-close-shift
// Dipanggil oleh Vercel Cron Job setiap menit (*/1 * * * *)
// Auth: CRON_SECRET header (Vercel Cron standard)
//
// Business Rules:
//   1. Tutup otomatis shift ACTIVE yang sudah > 15 menit
//      melewati jam akhir slot jadwal kasir tsb.
//   2. Jika shift tidak punya slot jadwal (kasir tanpa jadwal hari ini),
//      fallback: tutup shift yang > 10 jam (stale session).
//   3. Semua auto-close dicatat dengan notes = 'AUTO_CLOSED_BY_CRON'
//   4. Tidak blocking — error satu shift tidak menghentikan yang lain.
//
// FinOps: query ACTIVE shifts difilter isNull(clockOut) + limit 50
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, shiftSchedules } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

export const runtime = 'nodejs';

// Pastikan hanya Vercel Cron yang bisa memanggil endpoint ini
function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // env tidak di-set → tolak semua
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth guard — hanya Vercel Cron yang boleh
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const nowWib = new Date();
  // Nama hari Indonesia — gunakan locale WIB
  const hariMap: Record<number, string> = {
    0: 'MINGGU', 1: 'SENIN', 2: 'SELASA', 3: 'RABU',
    4: 'KAMIS',  5: 'JUMAT', 6: 'SABTU',
  };
  const wibDateStr = nowWib.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  const hariIni = hariMap[new Date(wibDateStr).getDay()] as
    'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU' | 'MINGGU';

  // Jam sekarang dalam WIB (HH:MM)
  const jamWib = nowWib.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
  }); // "HH:MM"
  const [jamH, jamM] = jamWib.split(':').map(Number);
  const nowMinutes = (jamH ?? 0) * 60 + (jamM ?? 0);

  let closedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  try {
    // Ambil semua shift ACTIVE yang belum di-clockOut
    // Limit 50 — max kasir Wiramart ~10 orang
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
        // Cek apakah kasir ini punya jadwal hari ini
        const jadwal = await db.query.shiftSchedules.findFirst({
          where: and(
            eq(shiftSchedules.employeeId, shift.employeeId),
            eq(shiftSchedules.dayOfWeek, hariIni),
            eq(shiftSchedules.isActive, true),
          ),
          columns: { slotEnd: true },
        });

        let shouldClose = false;
        let closeReason = '';

        if (jadwal) {
          // Kasir punya jadwal — tutup 15 menit setelah slotEnd
          // slotEnd format: "HH:MM" atau "HH:MM:SS"
          const [slotH, slotM] = jadwal.slotEnd.split(':').map(Number);
          const slotEndMinutes = (slotH ?? 0) * 60 + (slotM ?? 0);
          const TOLERANSI = 15; // menit buffer setelah slotEnd

          if (nowMinutes >= slotEndMinutes + TOLERANSI) {
            shouldClose = true;
            closeReason = `AUTO_CLOSED_BY_CRON — jadwal selesai ${jadwal.slotEnd} WIB, toleransi ${TOLERANSI} menit`;
          }
        } else {
          // Tidak ada jadwal hari ini — fallback tutup shift > 10 jam
          const shiftAgeMs = nowWib.getTime() - new Date(shift.clockIn).getTime();
          const TEN_HOURS_MS = 10 * 60 * 60 * 1000;
          if (shiftAgeMs > TEN_HOURS_MS) {
            shouldClose = true;
            closeReason = 'AUTO_CLOSED_BY_CRON — durasi shift melebihi 10 jam (tidak ada jadwal hari ini)';
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

    return NextResponse.json({
      success: true,
      message: `Cron selesai. Ditutup: ${closedCount}, Dilewati: ${skippedCount}.`,
      closedCount,
      skippedCount,
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
