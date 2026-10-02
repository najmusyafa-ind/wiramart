import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, shifts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

// ── POST /api/admin/karyawan/[id]/reset-sesi ──────────────────────────────
// Admin-only: force-close semua sesi aktif milik karyawan (kasir lupa logout)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') {
    return apiError('Unauthorized', 401);
  }

  const { id: employeeId } = await params;

  // Validasi employee exists
  const emp = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
    columns: { id: true, fullName: true },
  });

  if (!emp) {
    return apiError('Karyawan tidak ditemukan.', 404);
  }

  // Cari semua sesi aktif
  const activeShifts = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')));

  if (activeShifts.length === 0) {
    return apiOk({
      message: 'Tidak ada sesi aktif untuk karyawan ini.',
      resetCount: 0,
    });
  }

  // Force-close semua sesi aktif
  await db
    .update(shifts)
    .set({ clockOut: new Date(), status: 'CLOSED' })
    .where(and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')));

  return apiOk({
    message: `Sesi ${emp.fullName} berhasil direset. (${activeShifts.length} sesi ditutup)`,
    resetCount: activeShifts.length,
    employeeName: emp.fullName,
  });
}
