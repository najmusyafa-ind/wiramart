// =============================================================
// GET /api/kasir/riwayat — Riwayat transaksi milik kasir sendiri
// Auth: employee JWT (role: employee)
// Query params:
//   - tanggal: YYYY-MM-DD (default: hari ini WIB)
//   - limit: number (default: 50, max: 100)
// Returns: list transaksi + summary shift hari ini
// =============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { employees, transactions, transactionItems, transactionPayments, shifts } from '@/lib/db/schema';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { verifyJwt } from '@/lib/utils/auth';
import { apiOk, apiError } from '@/lib/utils/helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toWIBDateString(d: Date): string {
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  // 1. Auth
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 'UNAUTHORIZED', 401);
  }
  const employeeId = payload.sub as string;

  // 2. Parse params
  const { searchParams } = new URL(req.url);
  const tanggalTarget = searchParams.get('tanggal') ?? toWIBDateString(new Date());
  const limitParam    = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);

  const startUtc = new Date(`${tanggalTarget}T00:00:00+07:00`);
  const endUtc   = new Date(`${tanggalTarget}T23:59:59+07:00`);

  try {
    // 3. Info kasir
    const kasir = await db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: { id: true, fullName: true, jabatan: true, nim: true },
    });
    if (!kasir) return apiError('Kasir tidak ditemukan', 'NOT_FOUND', 404);

    // 4. Shift kasir hari ini
    const shiftHariIni = await db.query.shifts.findFirst({
      where: and(
        eq(shifts.employeeId, employeeId),
        gte(shifts.clockIn, startUtc),
        lte(shifts.clockIn, endUtc),
      ),
      columns: {
        id: true, clockIn: true, clockOut: true,
        status: true, modalAwal: true, actualCash: true,
      },
      orderBy: [desc(shifts.clockIn)],
    });

    // 5. Transaksi kasir hari ini
    const trxList = await db.query.transactions.findMany({
      where: and(
        eq(transactions.employeeId, employeeId),
        eq(transactions.status, 'COMPLETED'),
        eq(transactions.isTest, false),
        gte(transactions.createdAt, startUtc),
        lte(transactions.createdAt, endUtc),
      ),
      columns: {
        id: true, invoiceNumber: true, paymentMethod: true,
        grossAmount: true, cashReceived: true, changeAmount: true,
        shiftId: true, createdAt: true,
      },
      orderBy: [desc(transactions.createdAt)],
      limit: limitParam,
    });

    // 6. Items + payments per transaksi
    const enriched = await Promise.all(
      trxList.map(async (t) => {
        const [items, payments] = await Promise.all([
          db.query.transactionItems.findMany({
            where: eq(transactionItems.transactionId, t.id),
            columns: {
              id: true, productNameSnapshot: true,
              qty: true, sellingPriceSnapshot: true, subtotalSell: true,
            },
          }),
          db.query.transactionPayments.findMany({
            where: eq(transactionPayments.transactionId, t.id),
            columns: {
              paymentMethod: true, amount: true,
              cashReceived: true, changeAmount: true,
            },
          }),
        ]);
        return { ...t, items, payments };
      })
    );

    // 7. Summary harian
    const totalOmzet = trxList.reduce((s, t) => s + parseFloat(t.grossAmount ?? '0'), 0);
    let totalCash = 0;
    let totalQris = 0;
    for (const t of enriched) {
      for (const p of t.payments) {
        const amt = parseFloat(p.amount ?? '0');
        if (p.paymentMethod === 'CASH') totalCash += amt;
        else if (p.paymentMethod === 'QRIS') totalQris += amt;
      }
    }

    return apiOk({
      kasir: {
        namaLengkap: kasir.fullName,
        jabatan:     kasir.jabatan,
        nim:         kasir.nim,
      },
      tanggal: tanggalTarget,
      summary: {
        jumlahStruk:  trxList.length,
        totalOmzet,
        totalCash,
        totalQris,
        modalAwal:    shiftHariIni?.modalAwal  ? parseFloat(shiftHariIni.modalAwal)  : null,
        aktualKas:    shiftHariIni?.actualCash ? parseFloat(shiftHariIni.actualCash) : null,
        statusShift:  shiftHariIni?.status  ?? null,
        clockIn:      shiftHariIni?.clockIn  ?? null,
        clockOut:     shiftHariIni?.clockOut ?? null,
      },
      transaksi: enriched,
    });
  } catch (err) {
    console.error('[GET /api/kasir/riwayat]', err);
    return apiError('Terjadi kesalahan server', 'INTERNAL_ERROR', 500);
  }
}
