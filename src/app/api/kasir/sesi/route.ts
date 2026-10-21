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
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  const host = req.headers.get('host') || '';
  const isLocalhost =
    process.env.NODE_ENV !== 'production' ||
    host.includes('localhost') ||
    host.includes('127.0.0.1');
  const isTestingMode: boolean =
    isLocalhost || Boolean(payload.name && payload.name.toLowerCase().includes('testing'));

  // Single Cash Drawer per Shift Roster
  // Shift reguler di UNPERBA berdurasi 4 jam (07:30-11:30, 11:00-15:00, 14:30-18:30).
  // Ambang batas toleransi rekan 1 shift adalah 4.5 jam (4 jam 30 menit).
  // Lewat 4.5 jam, shift dipastikan milik shift sebelumnya dan kasir baru wajib handover / Buka Shift Baru.
  const FOUR_AND_HALF_HOURS = 4.5 * 60 * 60 * 1000;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  try {
    const [employee, storeActiveShift, qris] = await Promise.all([
      db.query.employees.findFirst({
        where: eq(employees.id, employeeId),
        columns: { id: true, fullName: true, jabatan: true, nim: true, programStudi: true },
      }),
      isTestingMode
        ? db.query.shifts.findFirst({
            where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
            orderBy: [desc(shifts.clockIn)],
            columns: { id: true, clockIn: true, modalAwal: true, employeeId: true },
          })
        : db.query.shifts.findFirst({
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
      } else if (storeActiveShift.employeeId === employeeId || (!isTestingMode && shiftAge <= FOUR_AND_HALF_HOURS)) {
        // Shift aktif toko milik sendiri ATAU dibuka oleh rekan dalam 1 slot shift kerja (≤ 4.5 jam)
        // Seluruh kasir dalam shift yang sama menggunakan sesi laci kas yang sama
        currentShift = {
          id: storeActiveShift.id,
          clockIn: storeActiveShift.clockIn,
          modalAwal: storeActiveShift.modalAwal,
        };
      } else {
        // Shift aktif dari kasir shift sebelumnya yang lupa ditutup (> 4.5 jam dan beda kasir)
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

    const response = apiOk({
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

    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn('[API /kasir/sesi] Offline / Network error terdeteksi:', errorMsg);
    return apiError('Koneksi database offline saat membaca sesi', 'NETWORK_OFFLINE', 503);
  }
}
