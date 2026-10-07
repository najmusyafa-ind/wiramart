// =============================================================
// /api/kasir/shift/kas-gerak — Pencatatan Petty Cash (Kas Keluar & Masuk Laci)
// Auth: Employee JWT required
// Business Rules:
//   - Hanya bisa dicatat saat shift berstatus ACTIVE
//   - movementType: 'CASH_OUT' (Kas Keluar) | 'CASH_IN' (Kas Masuk / Tambah Modal)
//   - Digunakan untuk pengeluaran riil laci: Beli Galon, Bensin, ATK, Kebersihan, Tukar Receh
// =============================================================

import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { shifts, shiftCashMovements } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const kasGerakSchema = z.object({
  movementType: z.enum(['CASH_OUT', 'CASH_IN'], {
    message: 'Tipe gerakan kas harus CASH_OUT atau CASH_IN',
  }),
  category: z.string().min(2, 'Kategori wajib diisi').max(50),
  amount: z
    .number()
    .min(100, 'Nominal minimal Rp 100')
    .max(5_000_000, 'Nominal kas kecil maksimal Rp 5.000.000'),
  notes: z
    .string()
    .min(3, 'Keterangan pengeluaran/pemasukan wajib diisi (minimal 3 karakter)')
    .max(500, 'Keterangan maksimal 500 karakter'),
});

// GET: Ambil riwayat kas keluar/masuk untuk shift aktif saat ini
export async function GET(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

  const activeShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
    columns: { id: true },
  });

  if (!activeShift) {
    return apiError('Tidak ada shift aktif', 'NO_ACTIVE_SHIFT', 404);
  }

  const movements = await db
    .select({
      id: shiftCashMovements.id,
      movementType: shiftCashMovements.movementType,
      category: shiftCashMovements.category,
      amount: shiftCashMovements.amount,
      notes: shiftCashMovements.notes,
      createdAt: shiftCashMovements.createdAt,
    })
    .from(shiftCashMovements)
    .where(eq(shiftCashMovements.shiftId, activeShift.id))
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
    shiftId: activeShift.id,
    movements,
    totalCashOut,
    totalCashIn,
    count: movements.length,
  });
}

// POST: Tambah kas keluar / kas masuk laci
export async function POST(req: NextRequest): Promise<Response> {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }

  const employeeId = payload.sub as string;

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

  // Pastikan ada shift aktif
  const activeShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
    columns: { id: true },
  });

  if (!activeShift) {
    return apiError('Tidak ada shift aktif yang berjalan', 'NO_ACTIVE_SHIFT', 404);
  }

  const [inserted] = await db
    .insert(shiftCashMovements)
    .values({
      shiftId: activeShift.id,
      employeeId,
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
    });

  const label = movementType === 'CASH_OUT' ? 'Kas keluar' : 'Kas masuk';

  return apiOk({
    message: `${label} Rp ${amount.toLocaleString('id-ID')} berhasil dicatat.`,
    movement: inserted,
  }, 201);
}
