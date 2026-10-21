// =============================================================
// Smartkasir Perwira — Cashier Recap Service (PRD 4.0 Fitur 1)
// Domain: Rekapitulasi Riwayat Transaksi Kasir Per-Shift & Balancing Laci
// STANDAR: Zero-Trust Aerospace Grade, Strict Shift Isolation, Zero HPP Leak
// =============================================================

import { z } from 'zod';
import { eq, and, desc, gte, lte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees, shifts, shiftCashMovements, transactions, transactionItems, transactionPayments } from '@/lib/db/schema';
import { AppError } from '@/lib/utils/helpers';

// ─────────────────────────────────────────────────────────────
// 1. Zod Validation Schemas
// ─────────────────────────────────────────────────────────────

export const CashierRecapQuerySchema = z.object({
  employeeId: z.string().uuid('ID Karyawan tidak valid'),
  tanggal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
    .optional(),
  shiftId: z.string().uuid('ID Shift tidak valid').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CashierRecapQueryParams = z.infer<typeof CashierRecapQuerySchema>;

// ─────────────────────────────────────────────────────────────
// 2. Output DTO Types
// ─────────────────────────────────────────────────────────────

export type CashierShiftInfoDTO = {
  id: string;
  shiftName: string;         // 'Shift 1 (Pagi 07:30 - 11:30)' | 'Shift 2 (Siang 11:30 - 15:00)'
  clockIn: string;
  clockOut: string | null;
  status: 'ACTIVE' | 'CLOSED';
  modalAwal: number;
};

export type CashierRecapSummaryDTO = {
  modalAwal: number;           // Modal awal laci kasir (default: Rp 100.000 atau dari shift)
  totalTransaksi: number;      // Total struk berhasil (COMPLETED)
  totalVoid: number;           // Total struk dibatalkan (VOID)
  totalAmountCash: number;     // Total uang tunai dari penjualan
  totalKembalian: number;      // Total uang kembalian yang diserahkan ke pelanggan
  netCashSales: number;        // Penjualan tunai bersih kasir
  totalCashOut: number;        // Kas Keluar Laci (Bayar titipan makanan, beli lepas, galon, dll)
  totalCashIn: number;         // Kas Masuk Laci (Tukar receh, dll)
  totalFisikLaci: number;      // Uang fisik yang WAJIB ada di laci = Modal Awal + Tunai - Kas Keluar + Kas Masuk
  uangTinggalDiLaci: number;   // Modal Shift Berikutnya (Paten Rp 100.000)
  uangSetoranToko: number;     // Uang yang harus disetor ke amplop = max(0, totalFisikLaci - 100.000)
  totalAmountQris: number;     // Total mutasi digital QRIS masuk
  totalOmzet: number;          // Total omzet kasir (Net Cash Sales + Total QRIS)
  totalAmountSplit: number;    // Total transaksi kombinasi CASH+QRIS
  totalVoidAmount: number;     // Total rupiah struk yang dibatalkan
};

export type CashierRecapItemDTO = {
  id: string;
  invoiceNumber: string;
  createdAt: string;           // ISO UTC string
  itemCount: number;           // Jumlah jenis barang
  grossAmount: number;         // Nominal tagihan
  cashReceived: number | null; // Uang yang diserahkan pelanggan
  changeAmount: number | null; // Uang kembalian
  paymentMethod: 'CASH' | 'QRIS'; // Metode primer
  payments: Array<{
    paymentMethod: 'CASH' | 'QRIS';
    amount: number;
    cashReceived: number | null;
    changeAmount: number | null;
  }>;
  status: 'COMPLETED' | 'VOID';
  isVoid: boolean;
  voidReason: string | null;
};

export type CashierRecapResponseDTO = {
  kasir: {
    id: string;
    fullName: string;
    nim: string;
    jabatan: string;
  };
  tanggal: string;              // YYYY-MM-DD (WIB)
  activeShiftId: string | null; // ID shift yang sedang aktif/difilter
  activeShiftName: string | null;
  shiftsSaya: CashierShiftInfoDTO[]; // HANYA shift milik kasir ini (kasir lain terisolasi mutlak)
  summary: CashierRecapSummaryDTO;
  transaksi: CashierRecapItemDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

// ─────────────────────────────────────────────────────────────
// 3. Date & Timezone Helpers (Asia/Jakarta = UTC+7)
// ─────────────────────────────────────────────────────────────

export function getTodayWIB(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

export function getWIBDayBounds(dateStr: string): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(`${dateStr}T00:00:00+07:00`);
  const endUtc   = new Date(`${dateStr}T23:59:59.999+07:00`);
  return { startUtc, endUtc };
}

function getShiftNameFromDate(clockIn: Date): string {
  const hourWib = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(clockIn),
    10,
  );
  const minuteWib = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', minute: 'numeric' }).format(clockIn),
    10,
  );
  const isPagi = hourWib < 11 || (hourWib === 11 && minuteWib < 30);
  return isPagi ? 'Shift 1 (Pagi 07:30 - 11:30)' : 'Shift 2 (Siang 11:30 - 15:00)';
}

// ─────────────────────────────────────────────────────────────
// 4. Domain Service Implementation
// ─────────────────────────────────────────────────────────────

export async function getCashierDailyRecap(
  rawInput: CashierRecapQueryParams,
): Promise<CashierRecapResponseDTO> {
  const parsed = CashierRecapQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      parsed.error.issues.map((e) => e.message).join(', '),
      400,
    );
  }

  const { employeeId, shiftId, page, limit } = parsed.data;
  const tanggalWIB = parsed.data.tanggal ?? getTodayWIB();
  const { startUtc, endUtc } = getWIBDayBounds(tanggalWIB);

  // 1. Verifikasi identitas kasir
  const cashier = await db.query.employees.findFirst({
    where: and(eq(employees.id, employeeId), isNull(employees.deletedAt)),
    columns: {
      id: true,
      fullName: true,
      nim: true,
      jabatan: true,
      isActive: true,
    },
  });

  if (!cashier) {
    throw new AppError('NOT_FOUND', 'Data kasir tidak ditemukan atau akun dinonaktifkan.', 404);
  }

  // 2. Fetch HANYA sesi shift milik kasir ini pada tanggal tersebut
  // ISOLASI MUTLAK: Kasir DILARANG melihat atau mengakses shift kasir lain!
  const myShiftsRows = await db
    .select({
      id: shifts.id,
      clockIn: shifts.clockIn,
      clockOut: shifts.clockOut,
      status: shifts.status,
      modalAwal: shifts.modalAwal,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.employeeId, employeeId), // ← Filter Kunci: HANYA MILIK KASIR INI
        gte(shifts.clockIn, startUtc),
        lte(shifts.clockIn, endUtc),
      ),
    )
    .orderBy(desc(shifts.clockIn));

  const shiftsSaya: CashierShiftInfoDTO[] = myShiftsRows.map((s) => {
    const rawModal = s.modalAwal ? parseFloat(s.modalAwal) : 100000;
    const modalAwal = rawModal > 150000 ? 100000 : (rawModal <= 0 ? 100000 : Math.round(rawModal));
    return {
      id: s.id,
      shiftName: getShiftNameFromDate(new Date(s.clockIn)),
      clockIn: s.clockIn.toISOString(),
      clockOut: s.clockOut ? s.clockOut.toISOString() : null,
      status: s.status as 'ACTIVE' | 'CLOSED',
      modalAwal,
    };
  });

  // 3. Tentukan shift target yang difilter
  let targetShiftId: string | null = null;
  let targetShiftModalAwal = 100000; // Default paten UNPERBA: Rp 100.000
  let targetShiftName: string | null = null;

  if (shiftId) {
    // Validasi shiftId wajib milik kasir yang sedang login (IDOR-Proof)
    const matchingShift = shiftsSaya.find((s) => s.id === shiftId);
    if (!matchingShift) {
      throw new AppError('FORBIDDEN', 'Akses ditolak. Anda tidak memiliki akses ke sesi shift ini.', 403);
    }
    targetShiftId = matchingShift.id;
    targetShiftModalAwal = matchingShift.modalAwal;
    targetShiftName = matchingShift.shiftName;
  } else if (shiftsSaya.length > 0) {
    // Default: gunakan shift aktif atau shift terbaru milik kasir hari ini
    const activeOrLatest = shiftsSaya.find((s) => s.status === 'ACTIVE') ?? shiftsSaya[0];
    targetShiftId = activeOrLatest.id;
    targetShiftModalAwal = activeOrLatest.modalAwal;
    targetShiftName = activeOrLatest.shiftName;
  }

  // 4. Bangun kondisi filter query transaksi kasir
  // Aturan: HANYA transaksi milik kasir ini (employeeId) DAN shift terkait (jika ada)
  const trxConditions = [
    eq(transactions.employeeId, employeeId),
    eq(transactions.isTest, false),
  ];

  if (targetShiftId) {
    trxConditions.push(eq(transactions.shiftId, targetShiftId));
  } else {
    // Jika kasir belum punya shift di hari itu, gunakan filter tanggal
    trxConditions.push(gte(transactions.createdAt, startUtc));
    trxConditions.push(lte(transactions.createdAt, endUtc));
  }

  // 5. Query seluruh transaksi kasir pada sesi shift ini
  const allShiftTrx = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      grossAmount: transactions.grossAmount,
      cashReceived: transactions.cashReceived,
      changeAmount: transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
    })
    .from(transactions)
    .where(and(...trxConditions));

  const shiftTrxIds = allShiftTrx.map((t) => t.id);

  // 6. Fetch data pecahan pembayaran (Split Payment)
  type PaymentRecord = {
    transactionId: string;
    paymentMethod: string;
    amount: string;
    cashReceived: string | null;
    changeAmount: string | null;
  };

  let allShiftPayments: PaymentRecord[] = [];
  if (shiftTrxIds.length > 0) {
    allShiftPayments = await db
      .select({
        transactionId: transactionPayments.transactionId,
        paymentMethod: transactionPayments.paymentMethod,
        amount: transactionPayments.amount,
        cashReceived: transactionPayments.cashReceived,
        changeAmount: transactionPayments.changeAmount,
      })
      .from(transactionPayments)
      .where(inArray(transactionPayments.transactionId, shiftTrxIds));
  }

  const paymentsByTrx = new Map<string, PaymentRecord[]>();
  for (const pay of allShiftPayments) {
    const arr = paymentsByTrx.get(pay.transactionId) ?? [];
    arr.push(pay);
    paymentsByTrx.set(pay.transactionId, arr);
  }

  // 7. Kalkulasi Penjumlahan Cash, QRIS, & Modal Awal
  let totalTransaksi = 0;
  let totalVoid = 0;
  let totalAmountCash = 0;
  let totalAmountQris = 0;
  let totalAmountSplit = 0;
  let totalKembalian = 0;
  let totalVoidAmount = 0;

  for (const t of allShiftTrx) {
    const grossNum = parseFloat(t.grossAmount ?? '0') || 0;
    const changeNum = parseFloat(t.changeAmount ?? '0') || 0;

    if (t.status === 'VOID') {
      totalVoid++;
      totalVoidAmount += grossNum;
      continue;
    }

    // Transaksi Sukses (COMPLETED)
    totalTransaksi++;
    totalKembalian += changeNum;

    const trxPays = paymentsByTrx.get(t.id);
    if (trxPays && trxPays.length > 0) {
      const hasCash = trxPays.some((p) => p.paymentMethod === 'CASH');
      const hasQris = trxPays.some((p) => p.paymentMethod === 'QRIS');

      if (hasCash && hasQris) {
        totalAmountSplit += grossNum;
      }

      for (const p of trxPays) {
        const amt = parseFloat(p.amount ?? '0') || 0;
        if (p.paymentMethod === 'CASH') {
          totalAmountCash += amt;
        } else if (p.paymentMethod === 'QRIS') {
          totalAmountQris += amt;
        }
      }
    } else {
      if (t.paymentMethod === 'CASH') {
        totalAmountCash += grossNum;
      } else if (t.paymentMethod === 'QRIS') {
        totalAmountQris += grossNum;
      }
    }
  }

  // 6b. Ambil mutasi Kas Keluar & Kas Masuk Laci (Petty Cash: Titipan Makanan, Beli Lepas, Galon, dll)
  let totalCashOut = 0;
  let totalCashIn = 0;
  if (targetShiftId) {
    const movements = await db
      .select({
        movementType: shiftCashMovements.movementType,
        amount: shiftCashMovements.amount,
      })
      .from(shiftCashMovements)
      .where(eq(shiftCashMovements.shiftId, targetShiftId));

    for (const m of movements) {
      const val = parseFloat(m.amount ?? '0') || 0;
      if (m.movementType === 'CASH_OUT') {
        totalCashOut += val;
      } else if (m.movementType === 'CASH_IN') {
        totalCashIn += val;
      }
    }
  }

  // Penjualan tunai bersih kasir (p.amount sudah merupakan porsi tunai bersih belanja)
  const netCashSales = totalAmountCash;
  // Total Uang Fisik yang WAJIB ada di laci saat kasir tutup shift:
  // Modal Awal (Rp 100.000) + Penjualan Tunai Bersih - Kas Keluar (Titipan Makanan, Galon, dll) + Kas Masuk
  const totalFisikLaci = targetShiftModalAwal + netCashSales - totalCashOut + totalCashIn;
  // Alokasi Serah Terima Kasir Ala Ritel Modern (Alfamart / Indomaret):
  // 1. Uang tinggal di laci kasir untuk modal awal shift siang: Paten Rp 100.000
  // 2. Uang setoran toko: Sisanya yang dimasukkan amplop dan diserahkan ke brankas/manajer
  const uangTinggalDiLaci = 100_000;
  const uangSetoranToko = Math.max(0, totalFisikLaci - uangTinggalDiLaci);
  // Total Omzet Bersih Kasir (Tunai + QRIS)
  const totalOmzet = netCashSales + totalAmountQris;

  const summary: CashierRecapSummaryDTO = {
    modalAwal: Math.round(targetShiftModalAwal),
    totalTransaksi,
    totalVoid,
    totalAmountCash: Math.round(totalAmountCash),
    totalKembalian: Math.round(totalKembalian),
    netCashSales: Math.round(netCashSales),
    totalCashOut: Math.round(totalCashOut),
    totalCashIn: Math.round(totalCashIn),
    totalFisikLaci: Math.round(totalFisikLaci),
    uangTinggalDiLaci: Math.round(uangTinggalDiLaci),
    uangSetoranToko: Math.round(uangSetoranToko),
    totalAmountQris: Math.round(totalAmountQris),
    totalOmzet: Math.round(totalOmzet),
    totalAmountSplit: Math.round(totalAmountSplit),
    totalVoidAmount: Math.round(totalVoidAmount),
  };

  // 8. Query Paged Transactions (Hanya Milik Kasir Ini)
  const totalTrxCount = allShiftTrx.length;
  const totalPages = Math.ceil(totalTrxCount / limit) || 1;
  const offset = (page - 1) * limit;

  const pagedTrx = await db
    .select({
      id: transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      createdAt: transactions.createdAt,
      grossAmount: transactions.grossAmount,
      cashReceived: transactions.cashReceived,
      changeAmount: transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
      status: transactions.status,
      voidReason: transactions.voidReason,
    })
    .from(transactions)
    .where(and(...trxConditions))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  const pagedIds = pagedTrx.map((t) => t.id);

  // Item counts
  const itemCountsMap = new Map<string, number>();
  if (pagedIds.length > 0) {
    const itemCounts = await db
      .select({
        transactionId: transactionItems.transactionId,
        count: sql<number>`cast(count(${transactionItems.id}) as int)`,
      })
      .from(transactionItems)
      .where(inArray(transactionItems.transactionId, pagedIds))
      .groupBy(transactionItems.transactionId);

    for (const row of itemCounts) {
      itemCountsMap.set(row.transactionId, row.count);
    }
  }

  const transaksiDTO: CashierRecapItemDTO[] = pagedTrx.map((t) => {
    const trxPays = paymentsByTrx.get(t.id) ?? [];
    return {
      id: t.id,
      invoiceNumber: t.invoiceNumber,
      createdAt: t.createdAt.toISOString(),
      itemCount: itemCountsMap.get(t.id) ?? 0,
      grossAmount: Math.round(parseFloat(t.grossAmount ?? '0')),
      cashReceived: t.cashReceived ? Math.round(parseFloat(t.cashReceived)) : null,
      changeAmount: t.changeAmount ? Math.round(parseFloat(t.changeAmount)) : null,
      paymentMethod: t.paymentMethod as 'CASH' | 'QRIS',
      payments: trxPays.map((p) => ({
        paymentMethod: p.paymentMethod as 'CASH' | 'QRIS',
        amount: Math.round(parseFloat(p.amount ?? '0')),
        cashReceived: p.cashReceived ? Math.round(parseFloat(p.cashReceived)) : null,
        changeAmount: p.changeAmount ? Math.round(parseFloat(p.changeAmount)) : null,
      })),
      status: t.status as 'COMPLETED' | 'VOID',
      isVoid: t.status === 'VOID',
      voidReason: t.voidReason ?? null,
    };
  });

  return {
    kasir: {
      id: cashier.id,
      fullName: cashier.fullName,
      nim: cashier.nim,
      jabatan: cashier.jabatan,
    },
    tanggal: tanggalWIB,
    activeShiftId: targetShiftId,
    activeShiftName: targetShiftName,
    shiftsSaya,
    summary,
    transaksi: transaksiDTO,
    pagination: {
      page,
      limit,
      total: totalTrxCount,
      totalPages,
    },
  };
}
