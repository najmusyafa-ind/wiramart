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
import { shifts, employees } from '@/lib/db/schema';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { isCrossSessionPersistedShift } from '@/lib/services/activeShiftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bukaShiftSchema = z.object({
  modalAwal: z.number().min(0, 'Modal awal tidak boleh negatif').max(10_000_000, 'Nilai terlalu besar'),
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

async function closeStaleShift(shiftId: string, clockOut: Date): Promise<void> {
  await db
    .update(shifts)
    .set({ clockOut, status: 'CLOSED' })
    .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'ACTIVE')));
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

  const { modalAwal, breakdown } = parsed.data;

  const host = req.headers.get('host') || '';
  const isLocalhost =
    process.env.NODE_ENV !== 'production' ||
    host.includes('localhost') ||
    host.includes('127.0.0.1');
  const isTestingMode: boolean =
    isLocalhost || Boolean(payload.name && payload.name.toLowerCase().includes('testing'));

  // 3. Periksa shift aktif toko (Single Cash Drawer per Shift Roster)
  // Durasi shift UNPERBA adalah 4 jam. Batas overlap wajar adalah 4.5 jam.
  const FOUR_AND_HALF_HOURS = 4.5 * 60 * 60 * 1000;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const now = new Date();
  let shiftToFill: { id: string } | null = null;

  if (!isTestingMode) {
    const existingStoreShift = await db.query.shifts.findFirst({
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
          },
          now,
        ));

      if (shiftAge > TWELVE_HOURS) {
        // Auto-close shift lama yang sudah basi (>12 jam)
        await closeStaleShift(existingStoreShift.id, now);
      } else if (
        existingStoreShift.employeeId !== employeeId &&
        (shiftAge > FOUR_AND_HALF_HOURS || isCrossSession)
      ) {
        // Shift aktif milik kasir sesi sebelumnya (Pagi -> Siang atau > 4.5 jam):
        // Tutup otomatis shift lama agar kasir sesi baru membuka baris shift miliknya sendiri.
        await closeStaleShift(existingStoreShift.id, now);
      } else if (existingStoreShift.modalAwal !== null) {
        // Modal awal laci toko sudah dibuka (oleh kasir ini atau rekan dalam sesi shift yang sama)
        return buildActiveShiftResponse('Shift laci toko sudah aktif dengan modal awal.', existingStoreShift);
      } else {
        shiftToFill = { id: existingStoreShift.id };
      }
    }
  }

  // 3b. D8 Guard: pastikan karyawan ini sendiri tidak punya shift ACTIVE tersisa sebelum insert baru
  // Query tanpa filter isNull(clockOut) agar setiap baris status='ACTIVE' terdeteksi sebelum menyentuh index parsial D8.
  if (!shiftToFill) {
    const ownActiveShift = await db.query.shifts.findFirst({
      where: and(eq(shifts.employeeId, employeeId), eq(shifts.status, 'ACTIVE')),
      orderBy: [desc(shifts.clockIn)],
    });

    if (ownActiveShift) {
      const ownAge = now.getTime() - new Date(ownActiveShift.clockIn).getTime();
      const maxAge = isTestingMode ? TWELVE_HOURS : FOUR_AND_HALF_HOURS;
      if (ownAge > maxAge || ownActiveShift.clockOut !== null) {
        await closeStaleShift(ownActiveShift.id, ownActiveShift.clockOut ?? now);
      } else if (ownActiveShift.modalAwal !== null) {
        return buildActiveShiftResponse(
          isTestingMode ? 'Shift testing aktif.' : 'Shift laci toko sudah aktif dengan modal awal.',
          ownActiveShift,
        );
      } else {
        shiftToFill = { id: ownActiveShift.id };
      }
    }
  }

  // 4. Kontrol K3: Cek fisik tutup shift sebelumnya (Modal Awal Fleksibel — Opsi A)
  // Kasir mencatat nominal uang fisik yang benar-benar ada di kotak saat membuka shift
  // (bisa Rp 100.000 standar kembalian jika sudah disetor, atau saldo estafet shift sebelumnya).
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
    // Mode testing ATAU uang kotak sudah disetorkan kembali ke modal standar Rp 100.000
    serahTerimaDiff = null;
    auditFlags = 'NORMAL';
  } else if (lastClosedShift && lastClosedShift.actualCash !== null) {
    const prevActual = Number(lastClosedShift.actualCash);
    serahTerimaDiff = finalModalAwal - prevActual;
    const TOLERANSI_SERAH_TERIMA = 2000; // Ambang toleransi Rp 2.000
    if (Math.abs(serahTerimaDiff) > TOLERANSI_SERAH_TERIMA) {
      auditFlags = 'SERAH_TERIMA_SELISIH';
    }
  }

  // 5. Buat shift aktif baru secara atomik dengan modal awal yang valid (Cacat 2 Opsi A)
  let activeShiftId: string;
  if (shiftToFill) {
    // Sesi aktif tanpa modal awal -> isi modal awal hanya jika masih ACTIVE & modalAwal IS NULL
    const [updatedShift] = await db
      .update(shifts)
      .set({
        modalAwal: finalModalAwal.toString(),
        cashBreakdownOpen: breakdown ?? null,
        serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
        auditFlags,
      })
      .where(and(eq(shifts.id, shiftToFill.id), eq(shifts.status, 'ACTIVE'), isNull(shifts.modalAwal)))
      .returning({ id: shifts.id });

    if (!updatedShift) {
      const latestShift = await db.query.shifts.findFirst({
        where: eq(shifts.id, shiftToFill.id),
      });
      if (latestShift?.status === 'ACTIVE' && latestShift.modalAwal !== null) {
        return buildActiveShiftResponse(
          isTestingMode ? 'Shift testing aktif.' : 'Shift laci toko sudah aktif dengan modal awal.',
          latestShift,
        );
      }
      return apiError('Shift sudah ditutup sebelum modal awal disimpan.', 'SHIFT_ALREADY_CLOSED', 409);
    }
    activeShiftId = updatedShift.id;
  } else {
    // Buat baris shift baru secara resmi (dilindungi D8 partial unique index idx_shifts_one_active_per_employee)
    try {
      const [newShift] = await db
        .insert(shifts)
        .values({
          employeeId,
          status: 'ACTIVE',
          modalAwal: finalModalAwal.toString(),
          cashBreakdownOpen: breakdown ?? null,
          serahTerimaDiff: serahTerimaDiff !== null ? serahTerimaDiff.toString() : null,
          auditFlags,
        })
        .returning({ id: shifts.id });

      if (!newShift) {
        return apiError('Gagal membuka shift laci kas.', 'SHIFT_CREATE_FAILED', 500);
      }
      activeShiftId = newShift.id;
    } catch (err) {
      if (readPgCode(err) !== '23505') throw err;

      // D8 concurrency guard: request paralel untuk employeeId yang sama lebih dulu membuka shift ACTIVE
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
  }

  return apiOk({
    message: `Shift dibuka. Modal awal Rp ${finalModalAwal.toLocaleString('id-ID')} tercatat.`,
    shiftId: activeShiftId,
    modalAwal: finalModalAwal,
    serahTerimaDiff,
    auditFlags,
  });
}
