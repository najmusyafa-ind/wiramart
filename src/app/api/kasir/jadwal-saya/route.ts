// =============================================================
// GET /api/kasir/jadwal-saya — Jadwal shift kasir yang login
// Returns: jadwal milik sendiri + semua slot tersedia untuk swap
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shiftSchedules, employees } from '@/lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
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
    ));

  // Semua slot aktif dari karyawan LAIN (untuk pilihan swap tujuan)
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
    .innerJoin(employees, eq(shiftSchedules.employeeId, employees.id))
    .where(and(
      ne(shiftSchedules.employeeId, employeeId),
      eq(shiftSchedules.isActive, true),
    ))
    .orderBy(shiftSchedules.dayOfWeek, shiftSchedules.slotStart);

  return apiOk({ jadwalSaya, slotTersedia });
}
