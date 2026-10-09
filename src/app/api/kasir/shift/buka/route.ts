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
import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { shifts } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';

const bukaShiftSchema = z.object({
  modalAwal: z.number().min(0, 'Modal awal tidak boleh negatif').max(10_000_000, 'Nilai terlalu besar'),
  breakdown: z.record(z.string(), z.number()).optional(),
  pinKetuaShift: z.string().min(1, 'PIN tidak boleh kosong').max(20).optional(),
  pin: z.string().min(1, 'PIN tidak boleh kosong').max(20).optional(),
});

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

  const { modalAwal, breakdown } = parsed.data;

  // 3. Periksa shift aktif toko (Single Cash Drawer per Shift — Cacat 1 Opsi A)
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const existingStoreShift = await db.query.shifts.findFirst({
    where: and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut)),
    orderBy: [desc(shifts.clockIn)],
  });

  if (existingStoreShift) {
    const shiftAge = Date.now() - new Date(existingStoreShift.clockIn).getTime();
    if (shiftAge > TWELVE_HOURS) {
      // Auto-close shift lama yang sudah basi (>12 jam)
      await db
        .update(shifts)
        .set({ clockOut: new Date(), status: 'CLOSED' })
        .where(eq(shifts.id, existingStoreShift.id));
    } else if (existingStoreShift.modalAwal !== null) {
      // Modal awal laci toko sudah dibuka (oleh kasir ini atau rekan shift)
      return apiOk({
        message: 'Shift laci toko sudah aktif dengan modal awal.',
        shiftId: existingStoreShift.id,
        modalAwal: Number(existingStoreShift.modalAwal),
        serahTerimaDiff: existingStoreShift.serahTerimaDiff ? Number(existingStoreShift.serahTerimaDiff) : null,
        auditFlags: existingStoreShift.auditFlags ?? 'NORMAL',
      });
    }
  }

  // 4. Kontrol K3: Cek fisik tutup shift sebelumnya untuk mendeteksi selisih serah-terima
  const lastClosedShift = await db.query.shifts.findFirst({
    where: eq(shifts.status, 'CLOSED'),
    orderBy: [desc(shifts.clockOut)],
    columns: { id: true, actualCash: true, clockOut: true },
  });

  let serahTerimaDiff: number | null = null;
  let auditFlags = 'NORMAL';

  if (lastClosedShift && lastClosedShift.actualCash !== null) {
    const prevActual = Number(lastClosedShift.actualCash);
    serahTerimaDiff = modalAwal - prevActual;
    const TOLERANSI_SERAH_TERIMA = 2000; // Ambang toleransi Rp 2.000
    if (Math.abs(serahTerimaDiff) > TOLERANSI_SERAH_TERIMA) {
      auditFlags = 'SERAH_TERIMA_SELISIH';
    }
  }

  // 5. Buat shift aktif baru secara atomik dengan modal awal yang valid (Cacat 2 Opsi A)
  let activeShiftId: string;
  if (existingStoreShift && existingStoreShift.modalAwal === null) {
    // Sesi aktif tanpa modal awal -> update modal awal
    await db
      .update(shifts)
      .set({
        modalAwal: modalAwal.toString(),
        cashBreakdownOpen: breakdown ?? null,
        serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
        auditFlags,
      })
      .where(eq(shifts.id, existingStoreShift.id));
    activeShiftId = existingStoreShift.id;
  } else {
    // Buat baris shift baru secara resmi
    const [newShift] = await db
      .insert(shifts)
      .values({
        employeeId,
        status: 'ACTIVE',
        modalAwal: modalAwal.toString(),
        cashBreakdownOpen: breakdown ?? null,
        serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
        auditFlags,
      })
      .returning({ id: shifts.id });

    if (!newShift) {
      return apiError('Gagal membuka shift laci kas.', 'SHIFT_CREATE_FAILED', 500);
    }
    activeShiftId = newShift.id;
  }

  return apiOk({
    message: `Shift dibuka. Modal awal Rp ${modalAwal.toLocaleString('id-ID')} tercatat.`,
    shiftId: activeShiftId,
    modalAwal,
    serahTerimaDiff,
    auditFlags,
  });
}
