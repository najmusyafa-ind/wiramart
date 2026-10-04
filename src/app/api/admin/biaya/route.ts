// =============================================================
// /api/admin/biaya — Biaya operasional (pengurang Laba Bersih)
//   GET  ?period=daily|weekly|monthly|semi_annual | ?dateFrom=&dateTo=   → daftar biaya
//   POST { expenseDate, category, description, amount }                  → catat biaya
// Auth: Admin only. Semua mutasi tercatat di audit_logs (atomik dengan insert).
// =============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { operatingExpenses, admins, auditLogs, EXPENSE_CATEGORIES } from '@/lib/db/schema';
import { verifyJwt, apiOk, apiError } from '@/lib/utils/auth';
import {
  addDays,
  wibToday,
  resolveReportRange,
  InvalidRangeError,
  type PeriodKey,
} from '@/lib/finance/report';

export const runtime = 'nodejs';

const LIST_LIMIT = 200;
const MAX_BACKDATE_DAYS = 120;
const DUPLICATE_WINDOW_SECONDS = 60;
const PERIODS: readonly PeriodKey[] = ['daily', 'weekly', 'monthly', 'semi_annual'];

const CreateSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(3, 'Keterangan minimal 3 karakter').max(200),
  amount: z.number().int('Nominal harus bilangan bulat').min(1).max(100_000_000),
});

// ─────────────────────────────────────────────────────────────
// GET — daftar biaya pada rentang
// ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  const period = PERIODS.find((p) => p === rawPeriod) ?? null;

  let range;
  try {
    range = resolveReportRange({
      period,
      dateFrom: sp.get('dateFrom'),
      dateTo: sp.get('dateTo'),
    });
  } catch (err) {
    if (err instanceof InvalidRangeError) return apiError(err.message, 400);
    throw err;
  }

  const rows = await db
    .select({
      id:            operatingExpenses.id,
      expenseDate:   operatingExpenses.expenseDate,
      category:      operatingExpenses.category,
      description:   operatingExpenses.description,
      amount:        operatingExpenses.amount,
      createdAt:     operatingExpenses.createdAt,
      createdByName: admins.fullName,
    })
    .from(operatingExpenses)
    .innerJoin(admins, eq(operatingExpenses.createdByAdminId, admins.id))
    .where(
      and(
        isNull(operatingExpenses.deletedAt),
        gte(operatingExpenses.expenseDate, range.startDate),
        lte(operatingExpenses.expenseDate, range.endDate),
      ),
    )
    .orderBy(desc(operatingExpenses.expenseDate), desc(operatingExpenses.createdAt))
    .limit(LIST_LIMIT + 1);

  return apiOk({
    label: range.label,
    rows: rows.slice(0, LIST_LIMIT),
    truncated: rows.length > LIST_LIMIT,
  });
}

// ─────────────────────────────────────────────────────────────
// POST — catat biaya
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'admin') return apiError('Unauthorized', 401);
  const adminId = payload.sub as string;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError('Format request tidak valid', 400);
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? 'Data tidak valid', 422);
  }
  const input = parsed.data;

  // Tanggal harus nyata, tidak di masa depan, dan tidak terlalu lampau (WIB)
  const today = wibToday();
  const realDate = new Date(`${input.expenseDate}T00:00:00Z`);
  if (Number.isNaN(realDate.getTime()) || realDate.toISOString().slice(0, 10) !== input.expenseDate) {
    return apiError('Tanggal tidak valid', 422);
  }
  if (input.expenseDate > today) {
    return apiError('Tanggal biaya tidak boleh di masa depan', 422);
  }
  if (input.expenseDate < addDays(today, -MAX_BACKDATE_DAYS)) {
    return apiError(`Tanggal biaya maksimal ${MAX_BACKDATE_DAYS} hari ke belakang`, 422);
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Perlindungan klik ganda: entri identik oleh admin yang sama dalam 60 detik = entri yang sama
      const [dup] = await tx
        .select({ id: operatingExpenses.id })
        .from(operatingExpenses)
        .where(
          and(
            eq(operatingExpenses.createdByAdminId, adminId),
            eq(operatingExpenses.expenseDate, input.expenseDate),
            eq(operatingExpenses.category, input.category),
            eq(operatingExpenses.description, input.description),
            eq(operatingExpenses.amount, input.amount),
            isNull(operatingExpenses.deletedAt),
            gte(operatingExpenses.createdAt, sql`now() - make_interval(secs => ${DUPLICATE_WINDOW_SECONDS})`),
          ),
        )
        .limit(1);
      if (dup) return { id: dup.id, duplicate: true };

      const [created] = await tx
        .insert(operatingExpenses)
        .values({ ...input, createdByAdminId: adminId })
        .returning({ id: operatingExpenses.id });

      await tx.insert(auditLogs).values({
        tableName: 'operating_expenses',
        recordId:  created.id,
        action:    'INSERT',
        oldValues: null,
        newValues: JSON.stringify(input),
        actorType: 'ADMIN',
        actorId:   adminId,
      });

      return { id: created.id, duplicate: false };
    });

    return apiOk(result, result.duplicate ? 200 : 201);
  } catch {
    return apiError('Gagal menyimpan biaya. Silakan coba lagi.', 500);
  }
}
