// =============================================================
// GET /api/kasir/sesi — Info session karyawan yang sedang login
// Returns: nama, jabatan, shift info, QRIS URL (jika aktif)
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, shifts, qrisSettings } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  // Ambil data karyawan + shift aktif
  const [employee, activeShift, qris] = await Promise.all([
    db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: { id: true, fullName: true, jabatan: true, nim: true, programStudi: true },
    }),
    db.query.shifts.findFirst({
      where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
      columns: { id: true, clockIn: true },
    }),
    db.query.qrisSettings.findFirst({
      where: eq(qrisSettings.isActive, true),
      columns: { qrImageUrl: true, bankName: true, accountName: true },
    }),
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
      ? { id: activeShift.id, clockIn: activeShift.clockIn }
      : null,
    qris: qris
      ? { qrImageUrl: qris.qrImageUrl, bankName: qris.bankName, accountName: qris.accountName }
      : null,
  });
}
