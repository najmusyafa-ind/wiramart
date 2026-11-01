// ─────────────────────────────────────────────────────────────
// GET /api/admin/laporan/jejak-transaksi
// Menampilkan jejak siklus hidup transaksi: STARTED → COMMITTED/ROLLED_BACK/REJECTED
// Auth: sk_admin + adminRole = MANAGER
//
// Query params:
//   dateFrom   YYYY-MM-DD (default: 7 hari lalu)
//   dateTo     YYYY-MM-DD (default: hari ini)
//   outcome    COMMITTED | ROLLED_BACK | STARTED | REJECTED | (kosong = semua)
//   employeeId UUID (opsional)
//   page       number (default: 1)
//   limit      number (default: 50, maks: 200)
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { transactionLogs, employees } from '@/lib/db/schema';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import { z } from 'zod';

const QuerySchema = z.object({
  dateFrom:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outcome:    z.enum(['COMMITTED', 'ROLLED_BACK', 'STARTED', 'REJECTED']).optional(),
  employeeId: z.string().uuid().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  // Auth: hanya Manager (Dosen)
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  if (payload.adminRole !== 'MANAGER') {
    return apiError('Akses ditolak. Jejak transaksi hanya untuk Manager (Dosen).', 403);
  }

  // Parse & validasi query params
  const sp = req.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({
    dateFrom:   sp.get('dateFrom') ?? undefined,
    dateTo:     sp.get('dateTo') ?? undefined,
    outcome:    sp.get('outcome') ?? undefined,
    employeeId: sp.get('employeeId') ?? undefined,
    page:       sp.get('page') ?? 1,
    limit:      sp.get('limit') ?? 50,
  });
  if (!parsed.success) return apiError(parsed.error.flatten().fieldErrors, 422);

  const { dateFrom, dateTo, outcome, employeeId, page, limit } = parsed.data;

  // Default range: 30 hari terakhir (WIB)
  const now = new Date();
  const defaultTo   = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  const fromTs = new Date(`${dateFrom ?? defaultFrom}T00:00:00+07:00`);
  const toTs   = new Date(`${dateTo   ?? defaultTo  }T23:59:59+07:00`);

  // Build WHERE clauses
  const rangeWheres = [
    gte(transactionLogs.createdAt, fromTs),
    lte(transactionLogs.createdAt, toTs),
  ];
  if (employeeId) rangeWheres.push(eq(transactionLogs.employeeId, employeeId));

  const wheres = [...rangeWheres];
  if (outcome) wheres.push(eq(transactionLogs.outcome, outcome));

  const offset = (page - 1) * limit;

  // Query dengan JOIN ke employees untuk nama kasir
  const rows = await db
    .select({
      id:             transactionLogs.id,
      employeeId:     transactionLogs.employeeId,
      employeeName:   employees.fullName,
      employeeNim:    employees.nim,
      shiftId:        transactionLogs.shiftId,
      invoiceAttempt: transactionLogs.invoiceAttempt,
      attemptNumber:  transactionLogs.attemptNumber,
      itemCount:      transactionLogs.itemCount,
      grossAmount:    transactionLogs.grossAmount,
      paymentMethod:  transactionLogs.paymentMethod,
      outcome:        transactionLogs.outcome,
      transactionId:  transactionLogs.transactionId,
      rollbackReason: transactionLogs.rollbackReason,
      failedStep:     transactionLogs.failedStep,
      createdAt:      transactionLogs.createdAt,
      finishedAt:     transactionLogs.finishedAt,
    })
    .from(transactionLogs)
    .leftJoin(employees, eq(transactionLogs.employeeId, employees.id))
    .where(and(...wheres))
    .orderBy(desc(transactionLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Hitung total untuk pagination
  const countResult = await db.$count(transactionLogs, and(...wheres));
  const total = Number(countResult ?? 0);

  // Hitung ringkasan outcome pada range tanggal & kasir (SQL GROUP BY — FinOps safe)
  const summaryRows = await db
    .select({
      outcome: transactionLogs.outcome,
      cnt: sql<number>`count(*)::int`,
    })
    .from(transactionLogs)
    .where(and(...rangeWheres))
    .groupBy(transactionLogs.outcome);

  const summary = { COMMITTED: 0, ROLLED_BACK: 0, STARTED: 0, REJECTED: 0 };
  for (const r of summaryRows) {
    if (r.outcome in summary) summary[r.outcome as keyof typeof summary] = Number(r.cnt);
  }

  // Daftar kasir aktif untuk dropdown filter
  const cashiers = await db
    .select({ id: employees.id, name: employees.fullName, nim: employees.nim })
    .from(employees)
    .where(eq(employees.isActive, true))
    .orderBy(asc(employees.fullName))
    .limit(100);

  return apiOk({
    rows: rows.map((r) => ({
      ...r,
      grossAmount: r.grossAmount !== null ? Number(r.grossAmount) : null,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    summary,
    cashiers,
    range: {
      dateFrom: dateFrom ?? defaultFrom,
      dateTo:   dateTo   ?? defaultTo,
    },
  });
}

