// =============================================================
// Smartkasir Perwira — Active Drawer Shift Resolver (SSOT)
// Domain: Resolusi shift aktif laci kas tunggal (Single Cash Drawer per Shift)
// Memastikan sesi POS, Kas Gerak (petty cash), dan validasi shift
// menggunakan aturan kepemilikan & masa adopsi rekan (<= 4.5 jam) yang identik.
// =============================================================

import { eq, and, isNull, isNotNull, desc, gte, lt, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts, employees, shiftSchedules, type ShiftSessionType } from '@/lib/db/schema';

export const SHARED_SHIFT_MAX_AGE_MS = 4.5 * 60 * 60 * 1000; // 4 jam 30 menit
export const STALE_SHIFT_AUTO_CLOSE_MS = 12 * 60 * 60 * 1000; // 12 jam

const HARI_WIB_ENUM: Record<number, 'MINGGU' | 'SENIN' | 'SELASA' | 'RABU' | 'KAMIS' | 'JUMAT' | 'SABTU'> = {
  0: 'MINGGU',
  1: 'SENIN',
  2: 'SELASA',
  3: 'RABU',
  4: 'KAMIS',
  5: 'JUMAT',
  6: 'SABTU',
};

/** Tanggal bisnis WIB 'YYYY-MM-DD' */
export function getWibDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

/** Menit sejak 00:00 WIB */
export function getWibMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

/** Sesi WIB: Pagi (< 11:15) vs Siang (>= 11:15) — mencegah laci Pagi terbawa ke Shift Siang */
export function getWibSessionLabel(d: Date): 'Pagi' | 'Siang' {
  return getWibMinutes(d) >= 11 * 60 + 15 ? 'Siang' : 'Pagi';
}

/** Normalisasi nilai kolom DB `shifts.session_type` ke label tampilan 'Pagi' | 'Siang'. */
export function normalizeSessionType(raw: string | null | undefined): 'Pagi' | 'Siang' | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'PAGI') return 'Pagi';
  if (upper === 'SIANG') return 'Siang';
  return null;
}

/** Konversi label tampilan 'Pagi' | 'Siang' ke nilai DB 'PAGI' | 'SIANG'. */
export function toDbSessionType(label: 'Pagi' | 'Siang'): ShiftSessionType {
  return label === 'Siang' ? 'SIANG' : 'PAGI';
}

/**
 * Resolusi sesi deterministik (pure) yang menangani Shift Siang buka awal (< 11:15 WIB)
 * akibat Shift Pagi tutup awal kuliah/izin dosen:
 * - Jika `sessionType` eksplisit ('PAGI' | 'SIANG') tersimpan di DB -> WAJIB diikuti (SSOT utama).
 * - >= 11:15 WIB -> 'Siang'
 * - < 09:45 WIB -> 'Pagi'
 * - 10:30..11:14 WIB dengan shift pagi lebih awal & tutup >= 14:00 WIB -> 'Siang'
 * - 09:45..11:14 WIB:
 *     1. Ikuti jadwal resmi pemilik shift hari tersebut jika ada (slotStart >= 11:00 -> 'Siang', else 'Pagi')
 *     2. Jika pemilik shift tidak punya jadwal hari tsb (mis. pengganti/badal), cek apakah sudah ada
 *        Shift Pagi yang ditutup dengan hitung fisik lebih awal hari ini -> 'Siang'
 */
export function resolveShiftSessionWithContext(params: {
  clockIn: Date;
  clockOut?: Date | null;
  sessionType?: string | null;
  ownerScheduledSlotStart?: string | null;
  hasClosedMorningShiftEarlier?: boolean;
}): 'Pagi' | 'Siang' {
  const explicit = normalizeSessionType(params.sessionType);
  if (explicit) return explicit;

  const mins = getWibMinutes(params.clockIn);
  if (mins >= 11 * 60 + 15) return 'Siang';
  if (mins < 9 * 60 + 45) return 'Pagi';

  if (
    mins >= 10 * 60 + 30 &&
    params.hasClosedMorningShiftEarlier &&
    params.clockOut &&
    getWibMinutes(params.clockOut) >= 14 * 60
  ) {
    return 'Siang';
  }

  if (params.ownerScheduledSlotStart) {
    const schedHour = parseInt(params.ownerScheduledSlotStart.split(':')[0] ?? '8', 10);
    if (Number.isFinite(schedHour)) {
      return schedHour >= 11 ? 'Siang' : 'Pagi';
    }
  }

  return params.hasClosedMorningShiftEarlier ? 'Siang' : 'Pagi';
}

/**
 * Resolusi sesi shift tersimpan dari database.
 * Zero query tambahan jika `sessionType` sudah tersimpan ATAU di luar jam transisi 09:45–11:14 WIB.
 */
export async function resolvePersistedShiftSession(shift: {
  employeeId: string;
  clockIn: Date;
  clockOut?: Date | null;
  sessionType?: string | null;
}): Promise<'Pagi' | 'Siang'> {
  const explicit = normalizeSessionType(shift.sessionType);
  if (explicit) return explicit;

  const clockIn = new Date(shift.clockIn);
  const mins = getWibMinutes(clockIn);
  if (mins >= 11 * 60 + 15) return 'Siang';
  if (mins < 9 * 60 + 45) return 'Pagi';

  const dateWib = getWibDateStr(clockIn);
  const dow = new Date(`${dateWib}T12:00:00+07:00`).getDay();
  const dayEnum = HARI_WIB_ENUM[dow] ?? 'SENIN';
  const dayStartUtc = new Date(`${dateWib}T00:00:00+07:00`);

  const [schedRows, earlierClosed] = await Promise.all([
    db
      .select({ slotStart: shiftSchedules.slotStart })
      .from(shiftSchedules)
      .where(
        and(
          eq(shiftSchedules.employeeId, shift.employeeId),
          eq(shiftSchedules.dayOfWeek, dayEnum),
        ),
      )
      .limit(2),
    db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.status, 'CLOSED'),
          isNotNull(shifts.actualCash),
          gte(shifts.clockIn, dayStartUtc),
          lt(shifts.clockIn, clockIn),
        ),
      )
      .limit(1),
  ]);

  const ownerSlotStart =
    schedRows.find((s) => parseInt(s.slotStart.split(':')[0] ?? '8', 10) >= 11)?.slotStart ??
    schedRows[0]?.slotStart ??
    null;

  return resolveShiftSessionWithContext({
    clockIn,
    clockOut: shift.clockOut ? new Date(shift.clockOut) : null,
    sessionType: shift.sessionType,
    ownerScheduledSlotStart: ownerSlotStart,
    hasClosedMorningShiftEarlier: earlierClosed.length > 0,
  });
}

/**
 * Menyarankan sesi default ('PAGI' | 'SIANG') saat kasir membuka shift baru di POS
 * berdasarkan jadwal kasir hari itu, keberadaan Shift Pagi yang sudah tutup hari ini, & jam WIB.
 */
export async function suggestOpeningSessionType(params: {
  employeeId: string;
  now?: Date;
}): Promise<{
  suggestedSession: ShiftSessionType;
  hasClosedMorningToday: boolean;
  ownerSlotStart: string | null;
}> {
  const now = params.now ?? new Date();
  const dateWib = getWibDateStr(now);
  const dow = new Date(`${dateWib}T12:00:00+07:00`).getDay();
  const dayEnum = HARI_WIB_ENUM[dow] ?? 'SENIN';
  const dayStartUtc = new Date(`${dateWib}T00:00:00+07:00`);

  const [schedRows, closedMorningRows] = await Promise.all([
    db
      .select({ slotStart: shiftSchedules.slotStart })
      .from(shiftSchedules)
      .where(
        and(
          eq(shiftSchedules.employeeId, params.employeeId),
          eq(shiftSchedules.dayOfWeek, dayEnum),
          eq(shiftSchedules.isActive, true),
        ),
      )
      .limit(2),
    db
      .select({ id: shifts.id, clockIn: shifts.clockIn, sessionType: shifts.sessionType })
      .from(shifts)
      .where(
        and(
          eq(shifts.status, 'CLOSED'),
          isNotNull(shifts.actualCash),
          gte(shifts.clockIn, dayStartUtc),
          lt(shifts.clockIn, now),
        ),
      )
      .limit(10),
  ]);

  const ownerSlotStart =
    schedRows.find((s) => parseInt(s.slotStart.split(':')[0] ?? '8', 10) >= 11)?.slotStart ??
    schedRows[0]?.slotStart ??
    null;

  const hasClosedMorningToday = closedMorningRows.some((row) => {
    const exp = normalizeSessionType(row.sessionType);
    if (exp) return exp === 'Pagi';
    return getWibMinutes(new Date(row.clockIn)) < 11 * 60 + 15;
  });

  const mins = getWibMinutes(now);
  let label: 'Pagi' | 'Siang';
  if (mins >= 11 * 60 + 15) {
    label = 'Siang';
  } else if (hasClosedMorningToday && mins >= 9 * 60 + 30) {
    label = 'Siang';
  } else if (mins >= 9 * 60 + 45) {
    label = resolveShiftSessionWithContext({
      clockIn: now,
      ownerScheduledSlotStart: ownerSlotStart,
      hasClosedMorningShiftEarlier: hasClosedMorningToday,
    });
  } else {
    label = 'Pagi';
  }

  return {
    suggestedSession: toDbSessionType(label),
    hasClosedMorningToday,
    ownerSlotStart,
  };
}

/**
 * Batch SSOT resolver untuk laporan & pantauan multi-shift (maks 1 query `shift_schedules`, 0 N+1).
 * Seluruh 5 endpoint (bagi-hasil, tutup-buku, export/harian, per-shift, shift-monitor) wajib memakai fungsi ini.
 */
export async function resolveShiftSessionsBatch(
  rows: ReadonlyArray<{
    id: string;
    employeeId: string;
    clockIn: Date;
    clockOut?: Date | null;
    sessionType?: string | null;
    status?: string | null;
    actualCash?: string | null;
  }>,
): Promise<Map<string, 'Pagi' | 'Siang'>> {
  const result = new Map<string, 'Pagi' | 'Siang'>();
  if (rows.length === 0) return result;

  // Cek baris mana saja yang belum punya sessionType eksplisit dan berada di jam transisi (09:45–11:14)
  const ambiguousEmpIds = new Set<string>();
  for (const r of rows) {
    if (normalizeSessionType(r.sessionType)) continue;
    const mins = getWibMinutes(new Date(r.clockIn));
    if (mins >= 9 * 60 + 45 && mins < 11 * 60 + 15) {
      ambiguousEmpIds.add(r.employeeId);
    }
  }

  const empSchedByDay = new Map<string, string>();
  if (ambiguousEmpIds.size > 0) {
    const schedRows = await db
      .select({
        employeeId: shiftSchedules.employeeId,
        dayOfWeek: shiftSchedules.dayOfWeek,
        slotStart: shiftSchedules.slotStart,
      })
      .from(shiftSchedules)
      .where(inArray(shiftSchedules.employeeId, Array.from(ambiguousEmpIds)));

    for (const sr of schedRows) {
      if (!sr.employeeId) continue;
      const key = `${sr.employeeId}__${sr.dayOfWeek}`;
      const existing = empSchedByDay.get(key);
      // Prioritaskan slot siang (>= 11:00) jika karyawan punya 2 entri
      if (!existing || parseInt(sr.slotStart.split(':')[0] ?? '8', 10) >= 11) {
        empSchedByDay.set(key, sr.slotStart);
      }
    }
  }

  // Urutkan kronologis agar hasClosedMorningShiftEarlier akurat untuk tiap hari WIB
  const sorted = [...rows].sort(
    (a, b) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime(),
  );
  const closedMorningByDate = new Map<string, boolean>();
  const anyEarlierShiftByDate = new Map<string, boolean>();

  for (const r of sorted) {
    const clockIn = new Date(r.clockIn);
    const clockOut = r.clockOut ? new Date(r.clockOut) : null;
    const dateWib = getWibDateStr(clockIn);
    const dow = new Date(`${dateWib}T12:00:00+07:00`).getDay();
    const dayEnum = HARI_WIB_ENUM[dow] ?? 'SENIN';

    const ownerSlot = empSchedByDay.get(`${r.employeeId}__${dayEnum}`) ?? null;
    const hasClosedMorning =
      (closedMorningByDate.get(dateWib) ?? false) ||
      ((anyEarlierShiftByDate.get(dateWib) ?? false) &&
        clockOut !== null &&
        getWibMinutes(clockOut) >= 14 * 60);

    const resolved = resolveShiftSessionWithContext({
      clockIn,
      clockOut,
      sessionType: r.sessionType,
      ownerScheduledSlotStart: ownerSlot,
      hasClosedMorningShiftEarlier: hasClosedMorning,
    });

    result.set(r.id, resolved);
    anyEarlierShiftByDate.set(dateWib, true);
    if (resolved === 'Pagi' && (r.status === 'CLOSED' || r.actualCash !== null)) {
      closedMorningByDate.set(dateWib, true);
    }
  }

  return result;
}

/** True jika shift toko dibuka pada hari/sesi berbeda dari waktu sekarang (versi pure timestamp) */
export function isCrossSessionStoreShift(shiftClockIn: Date, now: Date): boolean {
  if (getWibDateStr(shiftClockIn) !== getWibDateStr(now)) return true;
  return getWibSessionLabel(shiftClockIn) !== getWibSessionLabel(now);
}

/**
 * True jika shift toko tersimpan berasal dari hari atau sesi berbeda dengan waktu sekarang,
 * dengan menyadari Shift Siang yang dibuka lebih awal (09:45–11:14 WIB) agar tidak tertutup paksa
 * saat rekan siang lain login baik sebelum maupun sesudah 11:15 WIB.
 */
export async function isCrossSessionPersistedShift(
  storeShift: { employeeId: string; clockIn: Date; sessionType?: string | null },
  now: Date,
  requestedSessionType?: ShiftSessionType | null,
): Promise<boolean> {
  const shiftClockIn = new Date(storeShift.clockIn);
  if (getWibDateStr(shiftClockIn) !== getWibDateStr(now)) return true;
  const shiftSession = await resolvePersistedShiftSession({
    employeeId: storeShift.employeeId,
    clockIn: shiftClockIn,
    sessionType: storeShift.sessionType,
  });
  // Jika toko sudah resmi berada di Shift Siang hari ini (termasuk buka awal 10:30–11:14),
  // sesi tidak pernah mundur kembali ke Shift Pagi pada tanggal kalender yang sama.
  if (shiftSession === 'Siang') return false;
  if (normalizeSessionType(requestedSessionType) === 'Siang') return true;
  return getWibSessionLabel(now) === 'Siang';
}

export interface ResolvedActiveShift {
  id: string;
  employeeId: string;
  clockIn: Date;
  modalAwal: string | null;
  auditFlags: string | null;
  sessionType: ShiftSessionType | null;
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
      sessionType: true,
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
          sessionType: ownShift.sessionType ?? null,
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
      sessionType: true,
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

  const crossSession =
    storeShift.employeeId !== employeeId &&
    (await isCrossSessionPersistedShift(
      {
        employeeId: storeShift.employeeId,
        clockIn: new Date(storeShift.clockIn),
        sessionType: storeShift.sessionType,
      },
      now,
    ));

  if (storeAgeMs <= SHARED_SHIFT_MAX_AGE_MS && !crossSession) {
    return {
      activeShift: {
        id: storeShift.id,
        employeeId: storeShift.employeeId,
        clockIn: storeShift.clockIn,
        modalAwal: storeShift.modalAwal,
        auditFlags: storeShift.auditFlags,
        sessionType: storeShift.sessionType ?? null,
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

