// =============================================================
// PATCH /api/kasir/shift/buka — Set modal awal untuk shift aktif
// Auth: Employee JWT required
// Body: { modalAwal: number, breakdown?: Record<string, number>, pinKetuaShift?: string }
//
// Business Rules (K1, K3, K10):
//   1. modalAwal WAJIB diisi sebelum POS bisa dipakai.
//   2. Idempotent: jika sudah di-set, tolak update.
//   3. K3 Serah-Terima Laci: Sistem mencari shift toko terakhir yang CLOSED.
//      Jika ada actual_cash dari shift sebelumnya, hitung selisih:
//        serahTerimaDiff = modalAwal - prevActualCash
//      Jika |serahTerimaDiff| > Rp 2.000, flag otomatis: 'SERAH_TERIMA_SELISIH'
//      untuk diaudit Dosen/Manajer di Dashboard.
// =============================================================

import { z } from 'zod';
import { NextRequest } from 'next/server';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts, employees, SHIFT_SESSION_TYPES } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { isCrossSessionPersistedShift, suggestOpeningSessionType } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bukaShiftSchema = z.object({
  modalAwal: z.number().min(0, 'Modal awal tidak boleh negatif').max(10_000_000, 'Nilai terlalu besar'),
  sessionType: z.enum(SHIFT_SESSION_TYPES).optional(),
  breakdown: z.record(z.string(), z.number()).optional(),
  pinKetuaShift: z.string().min(1, 'PIN tidak boleh kosong').max(20).optional(),
  pin: z.string().min(1, 'PIN tidak boleh kosong').max(20).optional(),
});

/** Ambil kode error Postgres, baik langsung maupun terbungkus lewat rantai `cause`. */
function readPgCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && typeof cur === 'object' && cur !== null; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function buildActiveShiftResponse(
  message: string,
  shift: {
    id: string;
    modalAwal: string | null;
    serahTerimaDiff: string | null;
    auditFlags: string | null;
  },
): Response {
  return apiOk({
    message,
    shiftId: shift.id,
    modalAwal: shift.modalAwal !== null ? Number(shift.modalAwal) : null,
    serahTerimaDiff: shift.serahTerimaDiff !== null ? Number(shift.serahTerimaDiff) : null,
    auditFlags: shift.auditFlags ?? 'NORMAL',
  });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  // 1. Auth
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  // 2. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = bukaShiftSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { modalAwal, sessionType: requestedSessionType, breakdown } = parsed.data;

  const host = req.headers.get('host') || '';
  const isLocalhost =
    process.env.NODE_ENV !== 'production' ||
    host.includes('localhost') ||
    host.includes('127.0.0.1');
  const isTestingMode: boolean =
    isLocalhost || Boolean(payload.name && payload.name.toLowerCase().includes('testing'));

  // 3. Hitung konteks serah terima & session_type (read-only) sebelum mengunci transaksi buka shift
  const FOUR_AND_HALF_HOURS = 4.5 * 60 * 60 * 1000;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const now = new Date();

  const [lastClosedShift] = await db
    .select({
      id: shifts.id,
      actualCash: shifts.actualCash,
      clockOut: shifts.clockOut,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(
      and(
        eq(shifts.status, 'CLOSED'),
        sql`LOWER(${employees.fullName}) NOT LIKE '%testing%'`,
        sql`LOWER(${employees.fullName}) NOT LIKE '%dede%'`,
        sql`${employees.nim} NOT IN ('02405013')`
      )
    )
    .orderBy(desc(shifts.clockOut))
    .limit(1);

  let serahTerimaDiff: number | null = null;
  let auditFlags = 'NORMAL';

  const MODAL_STANDAR_TOKO = 100_000;
  // Simpan nominal persis sesuai hitungan fisik kasir (0 .. 10.000.000) tanpa pemotongan paksa
  const finalModalAwal = Math.round(modalAwal);
  const isModalStandarReset = Math.abs(finalModalAwal - MODAL_STANDAR_TOKO) <= 2000;

  if (isTestingMode || isModalStandarReset) {
    serahTerimaDiff = null;
    auditFlags = 'NORMAL';
  } else if (lastClosedShift && lastClosedShift.actualCash !== null) {
    const prevActual = Number(lastClosedShift.actualCash);
    serahTerimaDiff = finalModalAwal - prevActual;
    const TOLERANSI_SERAH_TERIMA = 2000;
    if (Math.abs(serahTerimaDiff) > TOLERANSI_SERAH_TERIMA) {
      auditFlags = 'SERAH_TERIMA_SELISIH';
    }
  }

  const resolvedSessionType =
    requestedSessionType ?? (await suggestOpeningSessionType({ employeeId, now })).suggestedSession;

  // 4. Transaksi atomik dengan advisory lock toko (Single Cash Drawer anti-duplikat saat 2 kasir klik serentak)
  type OpenShiftOutcome =
    | {
        kind: 'EXISTING';
        message: string;
        shift: {
          id: string;
          modalAwal: string | null;
          serahTerimaDiff: string | null;
          auditFlags: string | null;
        };
      }
    | { kind: 'CREATED'; shiftId: string }
    | { kind: 'ERROR'; status: number; code: string; message: string };

  let outcome: OpenShiftOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<OpenShiftOutcome> => {
      const lockKey = isTestingMode
        ? `wiramart:test_shift_open:${employeeId}`
        : 'wiramart:store_shift_open';
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      let shiftToFill: { id: string } | null = null;

      if (!isTestingMode) {
        const existingStoreShift = await tx.query.shifts.findFirst({
          where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
          orderBy: [desc(shifts.clockIn)],
        });

        if (existingStoreShift) {
          const shiftAge = now.getTime() - new Date(existingStoreShift.clockIn).getTime();
          const isCrossSession =
            existingStoreShift.employeeId !== employeeId &&
            (await isCrossSessionPersistedShift(
              {
                employeeId: existingStoreShift.employeeId,
                clockIn: new Date(existingStoreShift.clockIn),
                sessionType: existingStoreShift.sessionType,
              },
              now,
              requestedSessionType,
            ));

          if (shiftAge > TWELVE_HOURS) {
            await tx
              .update(shifts)
              .set({ clockOut: now, status: 'CLOSED' })
              .where(and(eq(shifts.id, existingStoreShift.id), eq(shifts.status, 'ACTIVE')));
          } else if (
            existingStoreShift.employeeId !== employeeId &&
            (shiftAge > FOUR_AND_HALF_HOURS || isCrossSession)
          ) {
            await tx
              .update(shifts)
              .set({ clockOut: now, status: 'CLOSED' })
              .where(and(eq(shifts.id, existingStoreShift.id), eq(shifts.status, 'ACTIVE')));
          } else if (existingStoreShift.modalAwal !== null) {
            return {
              kind: 'EXISTING',
              message: 'Shift laci toko sudah aktif dengan modal awal.',
              shift: existingStoreShift,
            };
          } else {
            shiftToFill = { id: existingStoreShift.id };
          }
        }
      }

      if (!shiftToFill) {
        const ownActiveShift = await tx.query.shifts.findFirst({
          where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
          orderBy: [desc(shifts.clockIn)],
        });

        if (ownActiveShift) {
          const ownAge = now.getTime() - new Date(ownActiveShift.clockIn).getTime();
          const maxAge = isTestingMode ? TWELVE_HOURS : FOUR_AND_HALF_HOURS;
          if (ownAge > maxAge || ownActiveShift.clockOut !== null) {
            await tx
              .update(shifts)
              .set({ clockOut: ownActiveShift.clockOut ?? now, status: 'CLOSED' })
              .where(and(eq(shifts.id, ownActiveShift.id), eq(shifts.status, 'ACTIVE')));
          } else if (ownActiveShift.modalAwal !== null) {
            return {
              kind: 'EXISTING',
              message: isTestingMode
                ? 'Shift testing aktif.'
                : 'Shift laci toko sudah aktif dengan modal awal.',
              shift: ownActiveShift,
            };
          } else {
            shiftToFill = { id: ownActiveShift.id };
          }
        }
      }

      if (shiftToFill) {
        const [updatedShift] = await tx
          .update(shifts)
          .set({
            modalAwal: finalModalAwal.toString(),
            sessionType: resolvedSessionType,
            cashBreakdownOpen: breakdown ?? null,
            serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
            auditFlags,
          })
          .where(and(eq(shifts.id, shiftToFill.id), eq(shifts.status, 'ACTIVE'), isNull(shifts.modalAwal)))
          .returning({ id: shifts.id });

        if (!updatedShift) {
          const latestShift = await tx.query.shifts.findFirst({
            where: eq(shifts.id, shiftToFill.id),
          });
          if (latestShift?.status === 'ACTIVE' && latestShift.modalAwal !== null) {
            return {
              kind: 'EXISTING',
              message: isTestingMode
                ? 'Shift testing aktif.'
                : 'Shift laci toko sudah aktif dengan modal awal.',
              shift: latestShift,
            };
          }
          return {
            kind: 'ERROR',
            status: 409,
            code: 'SHIFT_ALREADY_CLOSED',
            message: 'Shift sudah ditutup sebelum modal awal disimpan.',
          };
        }
        return { kind: 'CREATED', shiftId: updatedShift.id };
      }

      const [newShift] = await tx
        .insert(shifts)
        .values({
          employeeId,
          status: 'ACTIVE',
          sessionType: resolvedSessionType,
          modalAwal: finalModalAwal.toString(),
          cashBreakdownOpen: breakdown ?? null,
          serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
          auditFlags,
        })
        .returning({ id: shifts.id });

      if (!newShift) {
        return {
          kind: 'ERROR',
          status: 500,
          code: 'SHIFT_CREATE_FAILED',
          message: 'Gagal membuka shift laci kas.',
        };
      }
      return { kind: 'CREATED', shiftId: newShift.id };
    });
  } catch (err) {
    if (readPgCode(err) !== '23505') throw err;
    const concurrentShift = await db.query.shifts.findFirst({
      where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
      orderBy: [desc(shifts.clockIn)],
    });
    if (!concurrentShift) {
      return apiError('Shift kasir sedang diproses bersamaan. Muat ulang halaman.', 'SHIFT_CONFLICT', 409);
    }
    return buildActiveShiftResponse(
      isTestingMode ? 'Shift testing aktif.' : 'Shift laci toko sudah aktif dengan modal awal.',
      concurrentShift,
    );
  }

  if (outcome.kind === 'EXISTING') {
    return buildActiveShiftResponse(outcome.message, outcome.shift);
  }
  if (outcome.kind === 'ERROR') {
    return apiError(outcome.message, outcome.code, outcome.status);
  }

  const activeShiftId = outcome.shiftId;

  return apiOk({
    message: `Shift ${resolvedSessionType === 'SIANG' ? 'Siang' : 'Pagi'} dibuka. Modal awal Rp ${finalModalAwal.toLocaleString('id-ID')} tercatat.`,
    shiftId: activeShiftId,
    sessionType: resolvedSessionType,
    modalAwal: finalModalAwal,
    serahTerimaDiff,
    auditFlags,
  });
}
