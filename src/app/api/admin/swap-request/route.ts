// =============================================================
// GET  /api/admin/swap-request       — Daftar semua request (filter status)
// POST /api/admin/swap-request       — Admin input swap manual (langsung APPROVED)
// PATCH /api/admin/swap-request/[id] — Approve atau Reject
// Auth: sk_admin
// =============================================================
// APPROVE FLOW (ATOMIK dalam 1 transaksi):
//   1. Update status → APPROVED
//   2. Swap employeeId di kedua shiftSchedules
//   3. Upsert attendance PENGGANTI untuk requester di slot baru
//   4. Insert audit log
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  shiftSwapRequests,
  shiftSchedules,
  employees,
} from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';

export const runtime = 'nodejs';

// ── GET: Daftar swap request (default: PENDING terbaru) ───────

export async function GET(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin.', 403);
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') ?? 'PENDING';

  // Validate status filter
  const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] as const;
  if (!validStatuses.includes(statusFilter as typeof validStatuses[number])) {
    return apiError('Status filter tidak valid.', 422);
  }

  const requests = await db.query.shiftSwapRequests.findMany({
    where: statusFilter === 'ALL'
      ? undefined
      : eq(shiftSwapRequests.status, statusFilter as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'),
    with: {
      requester:     { columns: { id: true, fullName: true, nim: true, programStudi: true, jabatan: true } },
      peer:          { columns: { id: true, fullName: true, nim: true } },
      fromSchedule:  { columns: { id: true, dayOfWeek: true, slotStart: true, slotEnd: true, coordinatorName: true } },
      toSchedule:    { columns: { id: true, dayOfWeek: true, slotStart: true, slotEnd: true, coordinatorName: true } },
      reviewedByAdmin: { columns: { id: true, fullName: true } },
    },
    orderBy: [desc(shiftSwapRequests.createdAt)],
    limit: 100,
  });

  return apiOk(requests);
}

// ── POST: Admin input swap manual (konfirmasi WA) ─────────────
// Body: { fromScheduleId, toScheduleId, reason, adminNote? }
// Hasil: swap request dibuat + langsung di-APPROVE dalam 1 transaksi

const manualSwapSchema = z.object({
  fromScheduleId: z.string().uuid('fromScheduleId harus UUID'),
  toScheduleId:   z.string().uuid('toScheduleId harus UUID'),
  reason:         z.string().min(5, 'Alasan minimal 5 karakter').max(500),
  adminNote:      z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const session = await verifyJwt(req);
  if (!session || session.role !== 'admin') {
    return apiError('Akses ditolak. Hanya Admin.', 403);
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return apiError('Body tidak valid (JSON required).', 400); }

  const parsed = manualSwapSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 422);
  }
  const { fromScheduleId, toScheduleId, reason, adminNote } = parsed.data;

  if (fromScheduleId === toScheduleId) {
    return apiError('fromScheduleId dan toScheduleId tidak boleh sama.', 422);
  }

  // Fetch kedua slot
  const [fromSlot, toSlot] = await Promise.all([
    db.query.shiftSchedules.findFirst({
      where: and(eq(shiftSchedules.id, fromScheduleId), eq(shiftSchedules.isActive, true)),
      columns: { id: true, employeeId: true, dayOfWeek: true, slotStart: true, slotEnd: true },
    }),
    db.query.shiftSchedules.findFirst({
      where: and(eq(shiftSchedules.id, toScheduleId), eq(shiftSchedules.isActive, true)),
      columns: { id: true, employeeId: true, dayOfWeek: true, slotStart: true, slotEnd: true },
    }),
  ]);

  if (!fromSlot) return apiError('Slot asal tidak ditemukan atau tidak aktif.', 404);
  if (!toSlot)   return apiError('Slot tujuan tidak ditemukan atau tidak aktif.', 404);
  if (!fromSlot.employeeId) return apiError('Slot asal belum memiliki karyawan.', 422);

  // Requester = karyawan di slot asal
  const requesterEmployee = await db.query.employees.findFirst({
    where: eq(employees.id, fromSlot.employeeId),
    columns: { id: true, fullName: true },
  });
  if (!requesterEmployee) return apiError('Karyawan slot asal tidak ditemukan.', 404);

  // Eksekusi dalam 1 transaksi atomik
  await db.transaction(async (tx) => {
    // 1. Buat swap request
    const [newRequest] = await tx
      .insert(shiftSwapRequests)
      .values({
        requesterId:    requesterEmployee.id,
        fromScheduleId: fromScheduleId,
        toScheduleId:   toScheduleId,
        reason,
        status:         'APPROVED',
        adminNote:      adminNote ?? `Input manual oleh Admin setelah konfirmasi WhatsApp.`,
        reviewedAt:     new Date(),
      })
      .returning({ id: shiftSwapRequests.id });

    if (!newRequest) throw new Error('Gagal membuat swap request');

    // 2. Tukar employeeId di kedua slot
    await tx
      .update(shiftSchedules)
      .set({ employeeId: toSlot.employeeId })
      .where(eq(shiftSchedules.id, fromScheduleId));

    await tx
      .update(shiftSchedules)
      .set({ employeeId: fromSlot.employeeId })
      .where(eq(shiftSchedules.id, toScheduleId));
  });

  return Response.json({
    success: true,
    data: {
      message: `Swap shift berhasil dicatat dan disetujui. ${requesterEmployee.fullName} sekarang di jadwal ${toSlot.dayOfWeek} ${toSlot.slotStart}–${toSlot.slotEnd}.`,
    },
  }, { status: 201 });
}


