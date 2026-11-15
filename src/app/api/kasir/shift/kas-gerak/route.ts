// =============================================================
// /api/kasir/shift/kas-gerak — Pencatatan Petty Cash (Kas Keluar & Masuk Laci)
// Auth: Employee JWT required
// Business Rules:
//   - Hanya bisa dicatat saat shift berstatus ACTIVE
//   - movementType: 'CASH_OUT' (Kas Keluar) | 'CASH_IN' (Kas Masuk / Tambah Modal)
//   - Digunakan untuk pengeluaran riil laci: Beli Galon, Bensin, ATK, Kebersihan, Tukar Receh
// =============================================================

import { z } from 'zod';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftCashMovements } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { resolveActiveDrawerShift } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const kasGerakSchema = z.object({
  movementType: z.enum(['CASH_OUT', 'CASH_IN'], {
    message: 'Tipe gerakan kas harus CASH_OUT atau CASH_IN',
  }),
  category: z.string().min(2, 'Kategori wajib diisi').max(50),
  amount: z
    .number()
    .finite('Nominal tidak valid')
    .min(100, 'Nominal minimal Rp 100')
    .max(5_000_000, 'Nominal kas kecil maksimal Rp 5.000.000'),
  notes: z
    .string()
    .min(3, 'Keterangan pengeluaran/pemasukan wajib diisi (minimal 3 karakter)')
    .max(500, 'Keterangan maksimal 500 karakter'),
});

type KasGerakContextResult =
  | {
      ok: true;
      employee: { id: string; fullName: string };
      shiftId: string;
      isPeerShared: boolean;
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

  if (!resolution.activeShift) {
    const msg =
      resolution.otherActiveShifts.length > 0
        ? 'Shift sebelumnya menunggu serah terima. Buka shift baru terlebih dahulu sebelum mencatat kas gerak.'
        : 'Tidak ada shift aktif yang berjalan';
    return { ok: false, response: apiError(msg, 'NO_ACTIVE_SHIFT', 404) };
  }

  return {
    ok: true,
    employee,
    shiftId: resolution.activeShift.id,
    isPeerShared: resolution.activeShift.isPeerShared,
  };
}

// GET: Ambil riwayat kas keluar/masuk untuk shift laci aktif saat ini
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
    if (m.movementType === 'CASH_OUT') {
      totalCashOut += val;
    } else if (m.movementType === 'CASH_IN') {
      totalCashIn += val;
    }
  }

  return apiOk({
    shiftId: ctx.shiftId,
    isPeerShared: ctx.isPeerShared,
    movements,
    totalCashOut,
    totalCashIn,
    count: movements.length,
  });
}

// POST: Tambah kas keluar / kas masuk laci
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
      parsed.error.issues[0]?.message ?? 'Data kas gerak tidak valid',
      'VALIDATION_ERROR',
      422,
    );
  }

  const { movementType, category, amount, notes } = parsed.data;

  // Kunci baris shift di transaksi ACID untuk mencegah insert ke shift yang baru ditutup
  const inserted = await db.transaction(async (tx) => {
    const [lockedShift] = await tx
      .select({ id: shifts.id, status: shifts.status })
      .from(shifts)
      .where(and(eq(shifts.id, ctx.shiftId), eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)))
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
        notes: notes.trim(),
      })
      .returning({
        id: shiftCashMovements.id,
        movementType: shiftCashMovements.movementType,
        category: shiftCashMovements.category,
        amount: shiftCashMovements.amount,
        notes: shiftCashMovements.notes,
        createdAt: shiftCashMovements.createdAt,
        employeeId: shiftCashMovements.employeeId,
      });

    return created;
  });

  if (!inserted) {
    return apiError(
      'Shift aktif sudah ditutup sebelum kas gerak dicatat.',
      'SHIFT_ALREADY_CLOSED',
      409,
    );
  }

  const label = movementType === 'CASH_OUT' ? 'Kas keluar' : 'Kas masuk';

  return apiOk(
    {
      message: `${label} Rp ${amount.toLocaleString('id-ID')} berhasil dicatat.`,
      movement: {
        ...inserted,
        employeeName: ctx.employee.fullName,
      },
    },
    undefined,
    201,
  );
}
