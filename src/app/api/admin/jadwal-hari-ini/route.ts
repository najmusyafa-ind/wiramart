// =============================================================
// GET /api/admin/jadwal-hari-ini
// Return jadwal shift hari ini (berdasarkan hari server WIB)
// + status: on-duty atau belum/sudah
// Auth: Admin only
// =============================================================

import { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/utils/auth';
import { apiOk, apiError, AppError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

// Map JS getDay() → dayOfWeekEnum
const DAY_MAP = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'] as const;

type DayEnum = typeof DAY_MAP[number];

export async function GET(_req: NextRequest): Promise<Response> {
  try {
    await requireAdmin();

    // Waktu server dalam WIB (UTC+7)
    const nowUTC = new Date();
    const nowWIB = new Date(nowUTC.getTime() + 7 * 60 * 60 * 1000);
    const dayOfWeek = DAY_MAP[nowWIB.getUTCDay()] as DayEnum;
    const timeNow = `${String(nowWIB.getUTCHours()).padStart(2, '0')}:${String(nowWIB.getUTCMinutes()).padStart(2, '0')}`;

    // Fetch jadwal hari ini
    const scheduleRows = await db
      .select({
        id:              shiftSchedules.id,
        slotStart:       shiftSchedules.slotStart,
        slotEnd:         shiftSchedules.slotEnd,
        orderInSlot:     shiftSchedules.orderInSlot,
        coordinatorName: shiftSchedules.coordinatorName,
        employeeId:      shiftSchedules.employeeId,
        employeeName:    employees.fullName,
        employeeNim:     employees.nim,
        employeeProdi:   employees.programStudi,
      })
      .from(shiftSchedules)
      .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
      .where(
        and(
          eq(shiftSchedules.dayOfWeek, dayOfWeek),
          eq(shiftSchedules.isActive, true),
        ),
      )
      .orderBy(shiftSchedules.slotStart, shiftSchedules.orderInSlot);

    // Group by slot
    type SlotEntry = {
      slotStart: string;
      slotEnd: string;
      isCurrentSlot: boolean;
      coordinator: string | null;
      karyawan: {
        id: string | null;
        nama: string | null;
        nim: string | null;
        prodi: string | null;
        onDuty: boolean;
      }[];
    };

    const slotMap = new Map<string, SlotEntry>();

    for (const row of scheduleRows) {
      const key = `${row.slotStart}-${row.slotEnd}`;
      const isCurrentSlot = timeNow >= row.slotStart && timeNow < row.slotEnd;

      if (!slotMap.has(key)) {
        slotMap.set(key, {
          slotStart:      row.slotStart,
          slotEnd:        row.slotEnd,
          isCurrentSlot,
          coordinator:    row.coordinatorName,
          karyawan:       [],
        });
      }

      const slot = slotMap.get(key)!;

      // Update coordinator jika ada
      if (row.coordinatorName) slot.coordinator = row.coordinatorName;

      // Hanya tambah jika bukan baris koordinator (orderInSlot == 99)
      if (row.orderInSlot !== 99) {
        slot.karyawan.push({
          id:     row.employeeId,
          nama:   row.employeeName ?? null,
          nim:    row.employeeNim ?? null,
          prodi:  row.employeeProdi ?? null,
          onDuty: isCurrentSlot,
        });
      }
    }

    return apiOk({
      dayOfWeek,
      timeNow,
      tanggal: nowWIB.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Asia/Jakarta',
      }),
      slots: Array.from(slotMap.values()),
    });
  } catch (err) {
    if (err instanceof AppError) {
      return apiError(err.message, err.code, err.statusCode);
    }
    return apiError('Terjadi kesalahan server.', 'INTERNAL_ERROR', 500);
  }
}
