// =============================================================
// GET /api/kasir/sesi — Info session karyawan yang sedang login
// Returns: nama, jabatan, shift info, QRIS URL (jika aktif)
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, shifts, qrisSettings } from '@/lib/db/schema';
import { eq, and, ne, isNull, desc } from 'drizzle-orm';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  // Cacat 1 Opsi A: Single Cash Drawer per Shift Roster
  // Ambil data karyawan + shift aktif toko saat ini (<12 jam) + QRIS settings
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const EIGHT_HOURS  = 8 * 60 * 60 * 1000;

  const [employee, storeActiveShift, qris] = await Promise.all([
    db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: { id: true, fullName: true, jabatan: true, nim: true, programStudi: true },
    }),
    db.query.shifts.findFirst({
      where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
      orderBy: [desc(shifts.clockIn)],
      columns: { id: true, clockIn: true, modalAwal: true, employeeId: true },
    }),
    db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
      columns: { qrImageUrl: true, bankName: true, accountName: true, isActive: true, storeName: true, storeAddress: true, storePhone: true },
    }),
  ]);

  let currentShift: { id: string; clockIn: Date; modalAwal: string | null } | null = null;
  const otherActiveShifts: Array<{ kasirName: string; kasirNim: string; clockIn: Date; shiftId: string }> = [];

  if (storeActiveShift) {
    const shiftAge = Date.now() - new Date(storeActiveShift.clockIn).getTime();
    if (shiftAge > TWELVE_HOURS) {
      // Auto-close shift lama yang sudah basi (>12 jam)
      await db
        .update(shifts)
        .set({ clockOut: new Date(), status: 'CLOSED' })
        .where(eq(shifts.id, storeActiveShift.id));
    } else if (storeActiveShift.employeeId === employeeId || shiftAge <= EIGHT_HOURS) {
      // Shift aktif toko milik sendiri ATAU dibuka oleh rekan dalam 1 shift kerja (<8 jam)
      // Seluruh kasir dalam shift yang sama menggunakan sesi laci kas yang sama
      currentShift = {
        id: storeActiveShift.id,
        clockIn: storeActiveShift.clockIn,
        modalAwal: storeActiveShift.modalAwal,
      };
    } else {
      // Shift aktif dari kasir shift sebelumnya yang lupa ditutup (>8 jam dan beda kasir)
      const prevKasir = await db.query.employees.findFirst({
        where: eq(employees.id, storeActiveShift.employeeId),
        columns: { fullName: true, nim: true },
      });
      if (prevKasir) {
        otherActiveShifts.push({
          kasirName: prevKasir.fullName,
          kasirNim:  prevKasir.nim,
          clockIn:   storeActiveShift.clockIn,
          shiftId:   storeActiveShift.id,
        });
      }
    }
  }

  if (!employee) {
    return apiError('Karyawan tidak ditemukan', 'NOT_FOUND', 404);
  }

  return apiOk({
    employee: {
      id: employee.id,
      fullName: employee.fullName,
      jabatan: employee.jabatan,
      nim: employee.nim,
      programStudi: employee.programStudi,
    },
    shift: currentShift
      ? { id: currentShift.id, clockIn: currentShift.clockIn, modalAwal: currentShift.modalAwal }
      : null,
    // Shift aktif dari kasir lain (handover signal jika shift lama belum ditutup)
    otherActiveShifts: otherActiveShifts.map(s => ({
      kasirName: s.kasirName,
      kasirNim:  s.kasirNim,
      clockIn:   s.clockIn,
      shiftId:   s.shiftId,
    })),
    qris: qris
      ? { qrImageUrl: qris.qrImageUrl, bankName: qris.bankName, accountName: qris.accountName }
      : null,
    store: {
      name:    qris?.storeName    ?? 'WIRAMART UNPERBA',
      address: qris?.storeAddress ?? '',
      phone:   qris?.storePhone   ?? '',
    },
  });
}
