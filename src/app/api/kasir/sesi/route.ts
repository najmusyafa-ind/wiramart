// =============================================================
// GET /api/kasir/sesi — Info session karyawan yang sedang login
// Returns: nama, jabatan, shift info, QRIS URL (jika aktif)
// Auth: employee JWT required
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, qrisSettings, shifts } from '@/lib/db/schema';
import { eq, and, isNull, isNotNull, desc, sql } from 'drizzle-orm';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { resolveActiveDrawerShift, suggestOpeningSessionType } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  try {
    const [employee, qris] = await Promise.all([
      db.query.employees.findFirst({
        where: and(
          eq(employees.id, employeeId),
          eq(employees.isActive, true),
          isNull(employees.deletedAt),
        ),
        columns: {
          id: true,
          fullName: true,
          jabatan: true,
          nim: true,
          programStudi: true,
          pinHash: true,
        },
      }),
      db.query.qrisSettings.findFirst({
        where: eq(qrisSettings.id, '00000000-0000-0000-0000-000000000002'),
        columns: {
          qrImageUrl: true,
          bankName: true,
          accountName: true,
          isActive: true,
          storeName: true,
          storeAddress: true,
          storePhone: true,
        },
      }),
    ]);

    if (!employee) {
      const errRes = apiError('Akun kasir tidak aktif atau tidak ditemukan', 'UNAUTHORIZED', 401);
      errRes.cookies.delete('sk_kasir');
      errRes.cookies.delete('sk_kasir_r');
      return errRes;
    }

    const [resolution, [lastClosedRow], openingSuggestion] = await Promise.all([
      resolveActiveDrawerShift({
        employeeId: employee.id,
        employeeName: employee.fullName,
        host: req.headers.get('host'),
        autoCloseStale: true,
      }),
      db
        .select({
          actualCash: shifts.actualCash,
          clockOut: shifts.clockOut,
          kasirName: employees.fullName,
        })
        .from(shifts)
        .innerJoin(employees, eq(shifts.employeeId, employees.id))
        .where(
          and(
            eq(shifts.status, 'CLOSED'),
            isNotNull(shifts.actualCash),
            sql`LOWER(${employees.fullName}) NOT LIKE '%testing%'`,
            sql`LOWER(${employees.fullName}) NOT LIKE '%dede%'`,
            sql`${employees.nim} NOT IN ('02405013')`,
          ),
        )
        .orderBy(desc(shifts.clockOut))
        .limit(1),
      suggestOpeningSessionType({ employeeId: employee.id }),
    ]);

    const lastClosedShift =
      lastClosedRow && lastClosedRow.actualCash !== null
        ? {
            actualCash: Math.round(Number(lastClosedRow.actualCash)),
            clockOut: lastClosedRow.clockOut ? lastClosedRow.clockOut.toISOString() : null,
            kasirName: lastClosedRow.kasirName,
          }
        : null;

    const response = apiOk({
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        jabatan: employee.jabatan,
        nim: employee.nim,
        programStudi: employee.programStudi,
        hasPin: Boolean(employee.pinHash),
      },
      shift: resolution.activeShift
        ? {
            id: resolution.activeShift.id,
            clockIn: resolution.activeShift.clockIn,
            modalAwal: resolution.activeShift.modalAwal,
            sessionType: resolution.activeShift.sessionType,
            isPeerShared: resolution.activeShift.isPeerShared,
          }
        : null,
      suggestedSessionType: openingSuggestion.suggestedSession,
      lastClosedShift,
      // Shift aktif dari kasir lain (handover signal jika shift lama belum ditutup)
      otherActiveShifts: resolution.otherActiveShifts.map((s) => ({
        kasirName: s.kasirName,
        kasirNim: s.kasirNim,
        clockIn: s.clockIn,
        shiftId: s.shiftId,
      })),
      qris: qris
        ? {
            qrImageUrl: qris.qrImageUrl,
            bankName: qris.bankName,
            accountName: qris.accountName,
            isActive: qris.isActive,
          }
        : null,
      store: {
        name: qris?.storeName ?? 'WIRAMART UNPERBA',
        address: qris?.storeAddress ?? '',
        phone: qris?.storePhone ?? '',
      },
    });

    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[API /kasir/sesi] Offline / Network error terdeteksi:', errorMsg);
    return apiError('Koneksi database offline saat membaca sesi', 'NETWORK_OFFLINE', 503);
  }
}
