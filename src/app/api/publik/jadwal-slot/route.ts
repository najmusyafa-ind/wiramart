// =============================================================
// GET /api/publik/jadwal-slot
// Endpoint PUBLIK (tanpa auth) — untuk halaman daftar karyawan
// Return: semua slot jadwal mingguan, beserta siapa yang sudah
//         mengisi (nama) dan mana yang masih kosong
// =============================================================

import { eq, asc, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees } from '@/lib/db/schema';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const DAY_ORDER: Record<string, number> = {
  SENIN: 1, SELASA: 2, RABU: 3, KAMIS: 4, JUMAT: 5, SABTU: 6, MINGGU: 7,
};

export async function GET(): Promise<Response> {
  try {
    // Fetch semua slot aktif + nama karyawan jika sudah diisi dan belum dihapus
    const slots = await db
      .select({
        id:              shiftSchedules.id,
        dayOfWeek:       shiftSchedules.dayOfWeek,
        slotStart:       shiftSchedules.slotStart,
        slotEnd:         shiftSchedules.slotEnd,
        orderInSlot:     shiftSchedules.orderInSlot,
        coordinatorName: shiftSchedules.coordinatorName,
        employeeId:      shiftSchedules.employeeId,
        // Nama karyawan yang sudah mengisi (null jika kosong atau karyawan sudah dihapus)
        employeeName:    employees.fullName,
        employeeNim:     employees.nim,
      })
      .from(shiftSchedules)
      .leftJoin(
        employees,
        and(
          eq(shiftSchedules.employeeId, employees.id),
          isNull(employees.deletedAt),
          eq(employees.isActive, true),
        ),
      )
      .where(eq(shiftSchedules.isActive, true))
      .orderBy(
        asc(shiftSchedules.dayOfWeek),
        asc(shiftSchedules.slotStart),
        asc(shiftSchedules.orderInSlot),
      );

    // Group by hari → slot → entries
    type SlotEntry = {
      id: string;
      orderInSlot: number;
      employeeId: string | null;
      employeeName: string | null;
      employeeNim: string | null;
      isFilled: boolean;
    };

    type SlotGroup = {
      slotStart: string;
      slotEnd: string;
      coordinatorName: string | null;
      entries: SlotEntry[];
      filledCount: number;
      totalCount: number;
    };

    type DayGroup = {
      dayOfWeek: string;
      dayOrder: number;
      slots: SlotGroup[];
    };

    const grouped: Record<string, DayGroup> = {};

    for (const row of slots) {
      const day = row.dayOfWeek;
      const slotKey = `${row.slotStart}-${row.slotEnd}`;

      if (!grouped[day]) {
        grouped[day] = { dayOfWeek: day, dayOrder: DAY_ORDER[day] ?? 9, slots: [] };
      }

      const dayGroup = grouped[day]!;
      let slotGroup = dayGroup.slots.find(
        (s) => s.slotStart === row.slotStart && s.slotEnd === row.slotEnd,
      );

      if (!slotGroup) {
        slotGroup = {
          slotStart:       row.slotStart,
          slotEnd:         row.slotEnd,
          coordinatorName: row.coordinatorName ?? null,
          entries:         [],
          filledCount:     0,
          totalCount:      0,
        };
        dayGroup.slots.push(slotGroup);
      }

      const isFilled = Boolean(row.employeeId && row.employeeName);
      slotGroup.entries.push({
        id:           row.id,
        orderInSlot:  row.orderInSlot,
        employeeId:   isFilled ? row.employeeId : null,
        employeeName: isFilled ? row.employeeName : null,
        employeeNim:  isFilled ? row.employeeNim : null,
        isFilled,
      });

      slotGroup.totalCount++;
      if (isFilled) slotGroup.filledCount++;
    }

    // Sort by day order
    const result = Object.values(grouped).sort((a, b) => a.dayOrder - b.dayOrder);

    return apiOk({ schedule: result, totalSlots: slots.length });
  } catch {
    return apiError('Gagal memuat jadwal', 'INTERNAL_ERROR', 500);
  }
}
