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
import { employees, transactions, transactionItems, transactionPayments, shifts, shiftCashMovements } from '@/lib/db/schema';
import { eq, and, desc, gte, lte, inArray, isNull } from 'drizzle-orm';
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

  // 2. Parse & validasi params
  const { searchParams } = new URL(req.url);
  const tanggalTarget = searchParams.get('tanggal') ?? toWIBDateString(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalTarget)) {
    return apiError('Format tanggal tidak valid (gunakan YYYY-MM-DD).', 'INVALID_DATE', 400);
  }
  const parsedLimit = parseInt(searchParams.get('limit') ?? '50', 10);
  const limitParam = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 100);

  const startUtc = new Date(`${tanggalTarget}T00:00:00+07:00`);
  const endUtc   = new Date(`${tanggalTarget}T23:59:59.999+07:00`);

  try {
    // 3. Info kasir aktif
    const kasir = await db.query.employees.findFirst({
      where: and(eq(employees.id, employeeId), eq(employees.isActive, true), isNull(employees.deletedAt)),
      columns: { id: true, fullName: true, jabatan: true, nim: true },
    });
    if (!kasir) return apiError('Kasir tidak ditemukan atau tidak aktif', 'NOT_FOUND', 404);

    // 4. Transaksi kasir hari ini + shift sendiri (paralel)
    const [ownShiftHariIni, trxList] = await Promise.all([
      db.query.shifts.findFirst({
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
      }),
      db.query.transactions.findMany({
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
      }),
    ]);

    // Dukung co-cashier pada shared shift jika tidak punya baris shift sendiri hari ini
    let shiftHariIni = ownShiftHariIni;
    if (!shiftHariIni && trxList[0]?.shiftId) {
      shiftHariIni = await db.query.shifts.findFirst({
        where: eq(shifts.id, trxList[0].shiftId),
        columns: {
          id: true, clockIn: true, clockOut: true,
          status: true, modalAwal: true, actualCash: true,
        },
      });
    }

    // 5. Batch fetch items + payments (2 query total, 0 N+1)
    const txIds = trxList.map((t) => t.id);
    const [allItems, allPayments] = txIds.length > 0
      ? await Promise.all([
          db
            .select({
              id: transactionItems.id,
              transactionId: transactionItems.transactionId,
              productNameSnapshot: transactionItems.productNameSnapshot,
              qty: transactionItems.qty,
              sellingPriceSnapshot: transactionItems.sellingPriceSnapshot,
              subtotalSell: transactionItems.subtotalSell,
              discountPolicyId: transactionItems.discountPolicyId,
            })
            .from(transactionItems)
            .where(inArray(transactionItems.transactionId, txIds)),
          db
            .select({
              transactionId: transactionPayments.transactionId,
              paymentMethod: transactionPayments.paymentMethod,
              amount: transactionPayments.amount,
              cashReceived: transactionPayments.cashReceived,
              changeAmount: transactionPayments.changeAmount,
            })
            .from(transactionPayments)
            .where(inArray(transactionPayments.transactionId, txIds)),
        ])
      : [[], []];

    const itemsByTx = new Map<string, Array<{
      id: string;
      productNameSnapshot: string;
      qty: number;
      sellingPriceSnapshot: string;
      subtotalSell: string;
      discountPolicyId: string | null;
    }>>();
    for (const it of allItems) {
      const list = itemsByTx.get(it.transactionId) ?? [];
      list.push({
        id: it.id,
        productNameSnapshot: it.productNameSnapshot,
        qty: it.qty,
        sellingPriceSnapshot: it.sellingPriceSnapshot,
        subtotalSell: it.subtotalSell,
        discountPolicyId: it.discountPolicyId,
      });
      itemsByTx.set(it.transactionId, list);
    }

    const paymentsByTx = new Map<string, Array<{
      paymentMethod: 'CASH' | 'QRIS';
      amount: string;
      cashReceived: string | null;
      changeAmount: string | null;
    }>>();
    for (const p of allPayments) {
      const list = paymentsByTx.get(p.transactionId) ?? [];
      list.push({
        paymentMethod: p.paymentMethod === 'QRIS' ? 'QRIS' : 'CASH',
        amount: p.amount,
        cashReceived: p.cashReceived,
        changeAmount: p.changeAmount,
      });
      paymentsByTx.set(p.transactionId, list);
    }

    const enriched = trxList.map((t) => ({
      ...t,
      items: itemsByTx.get(t.id) ?? [],
      payments: paymentsByTx.get(t.id) ?? [],
    }));

    // 6. Summary harian (termasuk fallback transaksi legacy tanpa baris transaction_payments)
    const totalOmzet = trxList.reduce((s, t) => s + parseFloat(t.grossAmount ?? '0'), 0);
    let totalCash = 0;
    let totalQris = 0;
    for (const t of enriched) {
      if (t.payments.length > 0) {
        for (const p of t.payments) {
          const amt = parseFloat(p.amount ?? '0');
          if (p.paymentMethod === 'CASH') totalCash += amt;
          else if (p.paymentMethod === 'QRIS') totalQris += amt;
        }
      } else {
        const amt = parseFloat(t.grossAmount ?? '0');
        if (t.paymentMethod === 'CASH') totalCash += amt;
        else if (t.paymentMethod === 'QRIS') totalQris += amt;
      }
    }

    // 7b. Potongan Bayar Supplier / Kas Gerak pada shift hari ini
    const cashMovements = shiftHariIni
      ? await db
          .select({
            id: shiftCashMovements.id,
            movementType: shiftCashMovements.movementType,
            category: shiftCashMovements.category,
            amount: shiftCashMovements.amount,
            notes: shiftCashMovements.notes,
            createdAt: shiftCashMovements.createdAt,
          })
          .from(shiftCashMovements)
          .where(eq(shiftCashMovements.shiftId, shiftHariIni.id))
          .orderBy(desc(shiftCashMovements.createdAt))
      : [];

    const totalCashOut = cashMovements
      .filter((m) => m.movementType === 'CASH_OUT')
      .reduce((acc, m) => acc + parseFloat(m.amount ?? '0'), 0);
    const totalCashIn = cashMovements
      .filter((m) => m.movementType === 'CASH_IN')
      .reduce((acc, m) => acc + parseFloat(m.amount ?? '0'), 0);

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
        totalCashOut,
        totalCashIn,
        modalAwal:    shiftHariIni?.modalAwal  ? parseFloat(shiftHariIni.modalAwal)  : null,
        aktualKas:    shiftHariIni?.actualCash ? parseFloat(shiftHariIni.actualCash) : null,
        statusShift:  shiftHariIni?.status  ?? null,
        clockIn:      shiftHariIni?.clockIn  ?? null,
        clockOut:     shiftHariIni?.clockOut ?? null,
      },
      cashMovements,
      transaksi: enriched,
    });
  } catch (err) {
    console.error('[GET /api/kasir/riwayat]', err);
    return apiError('Terjadi kesalahan server', 'INTERNAL_ERROR', 500);
  }
}
