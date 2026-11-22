// =============================================================
// /api/kasir/shift/kas-gerak — Pencatatan Kas Laci (Uang Keluar & Masuk)
// Auth: Employee JWT required
// Mendukung pencatatan pada:
//   1. Shift ACTIVE berjalan
//   2. Shift CLOSED yang masih dalam Jeda 5 Menit (PENDING_GRACE) -> ditandai isGraceCorrection = true
// =============================================================

import { z } from 'zod';
import { eq, and, desc, isNull, gt } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftCashMovements } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { resolveActiveDrawerShift } from '@/lib/services/activeShiftService';
import {
  findActiveGraceShift,
  recalculateGraceShiftShortage,
  writeGraceAuditLog,
} from '@/lib/services/shiftShortageService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const kasGerakSchema = z.object({
  movementType: z.enum(['CASH_OUT', 'CASH_IN'], {
    message: 'Tipe arus kas harus CASH_OUT atau CASH_IN',
  }),
  category: z.string().min(2, 'Kategori wajib diisi').max(50),
  amount: z
    .number()
    .finite('Nominal tidak valid')
    .min(100, 'Nominal minimal Rp 100')
    .max(5_000_000, 'Nominal maksimal Rp 5.000.000'),
  notes: z
    .string()
    .min(3, 'Catatan minimal 3 karakter')
    .max(500, 'Catatan maksimal 500 karakter'),
});

type KasGerakContextResult =
  | {
      ok: true;
      employee: { id: string; fullName: string };
      shiftId: string;
      isPeerShared: boolean;
      isGraceMode: boolean;
      graceUntil: string | null;
    }
  | {
      ok: false;
      response: Response;
    };

async function resolveKasGerakContext(req: NextRequest): Promise<KasGerakContextResult> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return { ok: false, response: apiError('Unauthorized', 'UNAUTHORIZED', 401) };
  }

  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.id, payload.sub as string),
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: { id: true, fullName: true },
  });

  if (!employee) {
    return {
      ok: false,
      response: apiError('Akun kasir tidak aktif atau tidak ditemukan', 'FORBIDDEN', 403),
    };
  }

  const resolution = await resolveActiveDrawerShift({
    employeeId: employee.id,
    employeeName: employee.fullName,
    host: req.headers.get('host'),
  });

  if (resolution.activeShift) {
    return {
      ok: true,
      employee,
      shiftId: resolution.activeShift.id,
      isPeerShared: resolution.activeShift.isPeerShared,
      isGraceMode: false,
      graceUntil: null,
    };
  }

  // Cek apakah ada shift yang baru ditutup dan masih dalam Jeda 5 Menit (PENDING_GRACE)
  const graceShift = await findActiveGraceShift();
  if (graceShift) {
    return {
      ok: true,
      employee,
      shiftId: graceShift.id,
      isPeerShared: graceShift.employeeId !== employee.id,
      isGraceMode: true,
      graceUntil: graceShift.shortageGraceUntil.toISOString(),
    };
  }

  const msg =
    resolution.otherActiveShifts.length > 0
      ? 'Shift sebelumnya menunggu serah terima. Buka shift baru terlebih dahulu.'
      : 'Tidak ada shift aktif yang berjalan';
  return { ok: false, response: apiError(msg, 'NO_ACTIVE_SHIFT', 404) };
}

// GET: Ambil riwayat Kas Laci untuk shift aktif atau jeda 5 menit
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await resolveKasGerakContext(req);
  if (!ctx.ok) return ctx.response;

  const movements = await db
    .select({
      id: shiftCashMovements.id,
      movementType: shiftCashMovements.movementType,
      category: shiftCashMovements.category,
      amount: shiftCashMovements.amount,
      notes: shiftCashMovements.notes,
      isGraceCorrection: shiftCashMovements.isGraceCorrection,
      consignmentEntryId: shiftCashMovements.consignmentEntryId,
      createdAt: shiftCashMovements.createdAt,
      employeeId: shiftCashMovements.employeeId,
      employeeName: employees.fullName,
    })
    .from(shiftCashMovements)
    .leftJoin(employees, eq(shiftCashMovements.employeeId, employees.id))
    .where(eq(shiftCashMovements.shiftId, ctx.shiftId))
    .orderBy(desc(shiftCashMovements.createdAt));

  let totalCashOut = 0;
  let totalCashIn = 0;

  for (const m of movements) {
    const val = Number(m.amount);
    if (m.movementType === 'CASH_OUT') totalCashOut += val;
    else if (m.movementType === 'CASH_IN') totalCashIn += val;
  }

  return apiOk({
    shiftId: ctx.shiftId,
    isPeerShared: ctx.isPeerShared,
    isGraceMode: ctx.isGraceMode,
    graceUntil: ctx.graceUntil,
    movements,
    totalCashOut,
    totalCashIn,
    count: movements.length,
  });
}

// POST: Tambah Uang Keluar / Uang Masuk Kas Laci
export async function POST(req: NextRequest): Promise<Response> {
  const ctx = await resolveKasGerakContext(req);
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format JSON tidak valid', 'INVALID_JSON', 400);
  }

  const parsed = kasGerakSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      parsed.error.issues[0]?.message ?? 'Data kas laci tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { movementType, category, amount, notes } = parsed.data;
  const now = new Date();
  const cleanNotes = ctx.isGraceMode ? `[Koreksi Jeda 5m] ${notes.trim()}` : notes.trim();

  const inserted = await db.transaction(async (tx) => {
    const [lockedShift] = await tx
      .select({
        id: shifts.id,
        status: shifts.status,
        shortageStatus: shifts.shortageStatus,
        shortageGraceUntil: shifts.shortageGraceUntil,
      })
      .from(shifts)
      .where(
        ctx.isGraceMode
          ? and(
              eq(shifts.id, ctx.shiftId),
              eq(shifts.status, 'CLOSED'),
              eq(shifts.shortageStatus, 'PENDING_GRACE'),
              gt(shifts.shortageGraceUntil, now),
            )
          : and(eq(shifts.id, ctx.shiftId), eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
      )
      .limit(1)
      .for('update');

    if (!lockedShift) return null;

    const [created] = await tx
      .insert(shiftCashMovements)
      .values({
        shiftId: lockedShift.id,
        employeeId: ctx.employee.id,
        movementType,
        category: category.trim().toUpperCase(),
        amount: amount.toString(),
        notes: cleanNotes,
        isGraceCorrection: ctx.isGraceMode,
      })
      .returning({
        id: shiftCashMovements.id,
        movementType: shiftCashMovements.movementType,
        category: shiftCashMovements.category,
        amount: shiftCashMovements.amount,
        notes: shiftCashMovements.notes,
        isGraceCorrection: shiftCashMovements.isGraceCorrection,
        createdAt: shiftCashMovements.createdAt,
        employeeId: shiftCashMovements.employeeId,
      });

    return created;
  });

  if (!inserted) {
    return apiError(
      ctx.isGraceMode
        ? 'Waktu koreksi jeda 5 menit sudah habis.'
        : 'Shift aktif sudah ditutup sebelum kas laci dicatat.',
      'SHIFT_ALREADY_CLOSED',
      409,
    );
  }

  let graceUpdate = null;
  if (ctx.isGraceMode) {
    await writeGraceAuditLog({
      tableName: 'shift_cash_movements',
      recordId: inserted.id,
      actorType: 'EMPLOYEE',
      actorId: ctx.employee.id,
      newValues: {
        tag: 'KOREKSI_JEDA_5M',
        shiftId: ctx.shiftId,
        movementType,
        category: category.trim().toUpperCase(),
        amount,
        notes: cleanNotes,
      },
    });
    graceUpdate = await recalculateGraceShiftShortage(ctx.shiftId);
  }

  const label = movementType === 'CASH_OUT' ? 'Uang keluar' : 'Uang masuk';

  return apiOk(
    {
      message: `${label} Rp ${amount.toLocaleString('id-ID')} berhasil dicatat.`,
      movement: {
        ...inserted,
        employeeName: ctx.employee.fullName,
      },
      graceUpdate,
    },
    undefined,
    201,
  );
}
