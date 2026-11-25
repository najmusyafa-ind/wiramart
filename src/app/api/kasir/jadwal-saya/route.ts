// =============================================================
// GET /api/kasir/jadwal-saya — Jadwal shift kasir yang login
// Returns: jadwal milik sendiri + semua slot tersedia untuk swap
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees } from '@/lib/db/schema';
import { eq, and, ne, or, isNull } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Akses ditolak. Login sebagai kasir terlebih dahulu.', 401);
  }

  const employeeId = payload.sub as string;

  // Jadwal milik kasir ini
  const jadwalSaya = await db
    .select({
      id:        shiftSchedules.id,
      dayOfWeek: shiftSchedules.dayOfWeek,
      slotStart: shiftSchedules.slotStart,
      slotEnd:   shiftSchedules.slotEnd,
    })
    .from(shiftSchedules)
    .where(and(
      eq(shiftSchedules.employeeId, employeeId),
      eq(shiftSchedules.isActive, true),
      ne(shiftSchedules.orderInSlot, 99),
    ));

  // Semua slot aktif dari karyawan LAIN maupun slot KOSONG (terkecuali slot Koordinator orderInSlot=99)
  const slotTersedia = await db
    .select({
      id:          shiftSchedules.id,
      dayOfWeek:   shiftSchedules.dayOfWeek,
      slotStart:   shiftSchedules.slotStart,
      slotEnd:     shiftSchedules.slotEnd,
      employeeId:  shiftSchedules.employeeId,
      employeeName: employees.fullName,
      employeeNim:  employees.nim,
    })
    .from(shiftSchedules)
    .leftJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .where(and(
      eq(shiftSchedules.isActive, true),
      ne(shiftSchedules.orderInSlot, 99),
      or(
        isNull(shiftSchedules.employeeId),
        and(
          ne(shiftSchedules.employeeId, employeeId),
          eq(employees.isActive, true),
          isNull(employees.deletedAt),
        ),
      ),
    ))
    .orderBy(shiftSchedules.dayOfWeek, shiftSchedules.slotStart);

  return apiOk({ jadwalSaya, slotTersedia });
}
