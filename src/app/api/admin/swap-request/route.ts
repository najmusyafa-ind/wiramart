// =============================================================
// GET  /api/admin/swap-request       — Daftar semua request (filter status)
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
import { eq, and, desc, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  shiftSwapRequests,
  shiftSchedules,
  attendances,
  auditLogs,
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
      fromSchedule:  { columns: { id: true, dayOfWeek: true, slotStart: true, slotEnd: true, coordinatorName: true } },
      toSchedule:    { columns: { id: true, dayOfWeek: true, slotStart: true, slotEnd: true, coordinatorName: true } },
      reviewedByAdmin: { columns: { id: true, fullName: true } },
    },
    orderBy: [desc(shiftSwapRequests.createdAt)],
    limit: 100,
  });

  return apiOk(requests);
}
