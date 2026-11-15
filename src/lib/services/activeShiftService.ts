// =============================================================
// Smartkasir Perwira — Active Drawer Shift Resolver (SSOT)
// Domain: Resolusi shift aktif laci kas tunggal (Single Cash Drawer per Shift)
// Memastikan sesi POS, Kas Gerak (petty cash), dan validasi shift
// menggunakan aturan kepemilikan & masa adopsi rekan (<= 4.5 jam) yang identik.
// =============================================================

import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts, employees } from '@/lib/db/schema';

export const SHARED_SHIFT_MAX_AGE_MS = 4.5 * 60 * 60 * 1000; // 4 jam 30 menit
export const STALE_SHIFT_AUTO_CLOSE_MS = 12 * 60 * 60 * 1000; // 12 jam

export interface ResolvedActiveShift {
  id: string;
  employeeId: string;
  clockIn: Date;
  modalAwal: string | null;
  auditFlags: string | null;
  isPeerShared: boolean;
}

export interface StalePeerShiftInfo {
  shiftId: string;
  kasirName: string;
  kasirNim: string;
  clockIn: Date;
}

export interface ActiveDrawerResolution {
  activeShift: ResolvedActiveShift | null;
  otherActiveShifts: StalePeerShiftInfo[];
  isTestingMode: boolean;
}

export interface ResolveActiveDrawerParams {
  employeeId: string;
  employeeName?: string | null;
  host?: string | null;
  autoCloseStale?: boolean;
}

/**
 * Menentukan apakah request berjalan pada mode testing/localhost terisolasi.
 */
export function detectTestingMode(params: {
  host?: string | null;
  employeeName?: string | null;
}): boolean {
  const host = params.host ?? '';
  const isLocalhost =
    process.env.NODE_ENV !== 'production' ||
    host.includes('localhost') ||
    host.includes('127.0.0.1');
  return (
    isLocalhost ||
    Boolean(params.employeeName && params.employeeName.toLowerCase().includes('testing'))
  );
}

/**
 * Meresolusi shift laci kas aktif untuk seorang kasir:
 * 1. Jika kasir memiliki shift ACTIVE milik sendiri (<= 12 jam), gunakan shift tersebut.
 * 2. Di luar mode testing, kasir ke-2 dalam slot roster yang sama dapat mengadopsi
 *    shift aktif rekan yang berumur <= 4,5 jam (Single Cash Drawer per Shift).
 * 3. Shift rekan > 4,5 jam (<= 12 jam) dikembalikan sebagai sinyal handover (`otherActiveShifts`).
 */
export async function resolveActiveDrawerShift(
  params: ResolveActiveDrawerParams,
): Promise<ActiveDrawerResolution> {
  const { employeeId, employeeName, host, autoCloseStale = false } = params;
  const isTestingMode = detectTestingMode({ host, employeeName });
  const now = new Date();
  const nowMs = now.getTime();

  // 1. Cek shift aktif milik kasir ini sendiri terlebih dahulu
  const ownShift = await db.query.shifts.findFirst({
    where: and(
      eq(shifts.employeeId, employeeId),
      eq(shifts.status, 'ACTIVE'),
      isNull(shifts.clockOut),
    ),
    orderBy: [desc(shifts.clockIn)],
    columns: {
      id: true,
      employeeId: true,
      clockIn: true,
      modalAwal: true,
      auditFlags: true,
    },
  });

  if (ownShift) {
    const ownAgeMs = nowMs - new Date(ownShift.clockIn).getTime();
    if (ownAgeMs > STALE_SHIFT_AUTO_CLOSE_MS) {
      if (autoCloseStale) {
        await db
          .update(shifts)
          .set({ clockOut: now, status: 'CLOSED' })
          .where(and(eq(shifts.id, ownShift.id), eq(shifts.status, 'ACTIVE')));
      }
    } else {
      return {
        activeShift: {
          id: ownShift.id,
          employeeId: ownShift.employeeId,
          clockIn: ownShift.clockIn,
          modalAwal: ownShift.modalAwal,
          auditFlags: ownShift.auditFlags,
          isPeerShared: false,
        },
        otherActiveShifts: [],
        isTestingMode,
      };
    }
  }

  // 2. Di mode testing/localhost, jangan mengadopsi shift toko milik akun lain
  if (isTestingMode) {
    return {
      activeShift: null,
      otherActiveShifts: [],
      isTestingMode,
    };
  }

  // 3. Cek shift laci aktif toko (untuk Kasir ke-2 dalam 1 slot shift roster)
  const storeShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
    orderBy: [desc(shifts.clockIn)],
    columns: {
      id: true,
      employeeId: true,
      clockIn: true,
      modalAwal: true,
      auditFlags: true,
    },
  });

  if (!storeShift) {
    return {
      activeShift: null,
      otherActiveShifts: [],
      isTestingMode,
    };
  }

  const storeAgeMs = nowMs - new Date(storeShift.clockIn).getTime();

  if (storeAgeMs > STALE_SHIFT_AUTO_CLOSE_MS) {
    if (autoCloseStale) {
      await db
        .update(shifts)
        .set({ clockOut: now, status: 'CLOSED' })
        .where(and(eq(shifts.id, storeShift.id), eq(shifts.status, 'ACTIVE')));
    }
    return {
      activeShift: null,
      otherActiveShifts: [],
      isTestingMode,
    };
  }

  if (storeAgeMs <= SHARED_SHIFT_MAX_AGE_MS) {
    return {
      activeShift: {
        id: storeShift.id,
        employeeId: storeShift.employeeId,
        clockIn: storeShift.clockIn,
        modalAwal: storeShift.modalAwal,
        auditFlags: storeShift.auditFlags,
        isPeerShared: storeShift.employeeId !== employeeId,
      },
      otherActiveShifts: [],
      isTestingMode,
    };
  }

  // 4. Shift aktif rekan > 4,5 jam (<= 12 jam) → sinyal handover serah terima
  const otherActiveShifts: StalePeerShiftInfo[] = [];
  if (storeShift.employeeId !== employeeId) {
    const prevKasir = await db.query.employees.findFirst({
      where: eq(employees.id, storeShift.employeeId),
      columns: { fullName: true, nim: true },
    });
    if (prevKasir) {
      otherActiveShifts.push({
        shiftId: storeShift.id,
        kasirName: prevKasir.fullName,
        kasirNim: prevKasir.nim,
        clockIn: storeShift.clockIn,
      });
    }
  }

  return {
    activeShift: null,
    otherActiveShifts,
    isTestingMode,
  };
}

