// =============================================================
// GET /api/kasir/sesi — Info session karyawan yang sedang login
// Returns: nama, jabatan, shift info, QRIS URL (jika aktif)
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, shifts, qrisSettings } from '@/lib/db/schema';
import { eq, and, ne, isNull } from 'drizzle-orm';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  // Ambil data karyawan + shift aktif sendiri + QRIS settings
  // + cek apakah ada kasir lain yang masih punya shift ACTIVE (deteksi handover)
  const [employee, activeShift, qris, otherShiftRows] = await Promise.all([
    db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: { id: true, fullName: true, jabatan: true, nim: true, programStudi: true },
    }),
    db.query.shifts.findFirst({
      where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
      columns: { id: true, clockIn: true, modalAwal: true },
    }),
    // Ambil QRIS tanpa filter isActive — kasir tetap bisa konfirmasi QRIS manual
    // WAJIB filter singleton ID: tabel bisa berisi baris lama/kosong (legacy)
    db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
      columns: { qrImageUrl: true, bankName: true, accountName: true, isActive: true, storeName: true, storeAddress: true, storePhone: true },
    }),
    // Cek shift ACTIVE dari karyawan LAIN (untuk deteksi handover)
    db
      .select({
        kasirName: employees.fullName,
        kasirNim:  employees.nim,
        clockIn:   shifts.clockIn,
        shiftId:   shifts.id,
      })
      .from(shifts)
      .innerJoin(employees, eq(shifts.employeeId, employees.id))
      .where(
        and(
          eq(shifts.status, 'ACTIVE'),
          ne(shifts.employeeId, employeeId), // BUKAN milik kasir ini
          isNull(shifts.clockOut),
        ),
      )
      .limit(5), // max 5 — di Wiramart tidak mungkin >1, tapi aman
  ]);

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
    shift: activeShift
      ? { id: activeShift.id, clockIn: activeShift.clockIn, modalAwal: activeShift.modalAwal }
      : null,
    // Shift aktif dari kasir lain (handover signal)
    otherActiveShifts: otherShiftRows.map(s => ({
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
