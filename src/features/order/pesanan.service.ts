// =============================================================
// Wiramart v2.0 — Pesanan Service (state machine + mutasi stok ACID)
// Transisi: verifyPayment | confirmOrder | rejectOrder | cancelByBuyer
// Controller (route) hanya validasi + delegasi ke sini.
//
// Invarian proyek: products.stock_qty = Σ stock_batches.current_qty
// → konfirmasi mengurangi KEDUANYA (FEFO), dalam satu transaksi.
// Stok di-reserve LATE: hanya berkurang saat CONFIRMED (PRD §2.1).
// =============================================================

import { db } from '@/lib/db/client';
import {
  admins,
  auditLogs,
  products,
  shifts,
  stockBatches,
  discountPolicies,
  discountBarcodes,
  buyers,
  onlineOrders,
  onlineOrderItems,
  employees,
  transactions,
  transactionItems,
  transactionPayments,
  type OnlineOrder,
  type OnlineOrderItem,
} from '@/lib/db/schema';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AppError, getTodayWib } from '@/lib/utils/helpers';
import { generateHandoverPin } from './order.types';
import { resolvePaymentProofUrl } from './payment-proof';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OrderStatus = OnlineOrder['status'];

const WAITING_STATUSES = ['WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION'] as const;

// ── State machine (PRD §5.2) — Record exhaustif: status baru wajib didaftarkan ──

const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  WAITING_PAYMENT_VERIFICATION: ['WAITING_CONFIRMATION', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  WAITING_CONFIRMATION: ['CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'COMPLETED', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
};

function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new AppError(
      'INVALID_TRANSITION',
      `Pesanan berstatus ${from} tidak dapat diubah ke ${to}.`,
      409,
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────

/** Kunci baris pesanan (FOR UPDATE). ownerBuyerId diisi → IDOR-safe (404 jika bukan milik). */
async function lockOrder(tx: Tx, orderId: string, ownerBuyerId?: string): Promise<OnlineOrder> {
  const where = ownerBuyerId
    ? and(eq(onlineOrders.id, orderId), eq(onlineOrders.buyerId, ownerBuyerId), isNull(onlineOrders.deletedAt))
    : and(eq(onlineOrders.id, orderId), isNull(onlineOrders.deletedAt));

  const [row] = await tx.select().from(onlineOrders).where(where).limit(1).for('update');
  if (!row) throw new AppError('NOT_FOUND', 'Pesanan tidak ditemukan.', 404);
  return row;
}

/**
 * Kurangi batch aktif berurutan FEFO dengan FOR UPDATE, tolak stok kedaluwarsa,
 * prioritaskan batch non-diskon untuk pesanan reguler, dan sinkronkan kuota promo.
 */
async function deductBatchesFefo(
  tx: Tx,
  productId: string,
  productName: string,
  stockQtyBefore: number,
  qty: number,
  now: Date,
): Promise<void> {
  const todayWib = getTodayWib(now);
  const allActiveBatches = await tx
    .select({
      id: stockBatches.id,
      currentQty: stockBatches.currentQty,
      expiryDate: stockBatches.expiryDate,
    })
    .from(stockBatches)
    .where(and(eq(stockBatches.productId, productId), gt(stockBatches.currentQty, 0)))
    .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt), asc(stockBatches.id))
    .for('update');

  const totalActiveBatchQty = allActiveBatches.reduce((sum, b) => sum + b.currentQty, 0);
  const unbatchedQty = Math.max(0, stockQtyBefore - totalActiveBatchQty);
  const validBatches = allActiveBatches.filter(
    (b) => !b.expiryDate || b.expiryDate >= todayWib,
  );
  const validBatchQty = validBatches.reduce((sum, b) => sum + b.currentQty, 0);
  const sellableQty = validBatchQty + unbatchedQty;

  if (qty > sellableQty) {
    throw new AppError(
      'STOCK_EXPIRED',
      `Stok layak jual (non-kedaluwarsa) untuk "${productName}" hanya ${sellableQty} unit (butuh ${qty}).`,
      422,
    );
  }

  if (validBatches.length === 0) return;

  const validBatchIds = validBatches.map((b) => b.id);
  const activeBatchPolicies = await tx
    .select({
      id: discountPolicies.id,
      batchId: discountPolicies.batchId,
      allowedQty: discountPolicies.allowedQty,
      soldQty: discountPolicies.soldQty,
    })
    .from(discountPolicies)
    .where(
      and(
        inArray(discountPolicies.batchId, validBatchIds),
        eq(discountPolicies.isActive, true),
        gte(discountPolicies.validUntil, todayWib),
      ),
    );

  const discountedBatchIds = new Set<string>();
  for (const row of activeBatchPolicies) {
    if (row.soldQty < row.allowedQty) {
      discountedBatchIds.add(row.batchId);
    }
  }

  // Pesanan online memakai harga reguler → prioritaskan batch non-diskon lebih dulu
  const sortedBatches = [...validBatches].sort((a, b) => {
    const aDisc = discountedBatchIds.has(a.id) ? 1 : 0;
    const bDisc = discountedBatchIds.has(b.id) ? 1 : 0;
    return aDisc - bDisc;
  });

  let remaining = qty;
  for (const b of sortedBatches) {
    if (remaining <= 0) break;
    const take = Math.min(b.currentQty, remaining);
    const [updatedBatch] = await tx
      .update(stockBatches)
      .set({ currentQty: sql`${stockBatches.currentQty} - ${take}`, updatedAt: now })
      .where(and(eq(stockBatches.id, b.id), gte(stockBatches.currentQty, take)))
      .returning({ id: stockBatches.id, currentQty: stockBatches.currentQty });

    if (!updatedBatch) {
      throw new AppError(
        'INSUFFICIENT_STOCK',
        `Stok batch "${productName}" berubah saat konfirmasi, silakan muat ulang.`,
        409,
      );
    }

    const linkedPolicies = activeBatchPolicies.filter((p) => p.batchId === b.id);
    if (linkedPolicies.length > 0) {
      const policyIdsForBatch = linkedPolicies.map((p) => p.id);
      await tx
        .update(discountBarcodes)
        .set({
          remainingQty: sql`LEAST(${discountBarcodes.remainingQty}, ${updatedBatch.currentQty})`,
          ...(updatedBatch.currentQty <= 0 ? { isActive: false } : {}),
        })
        .where(
          and(
            inArray(discountBarcodes.policyId, policyIdsForBatch),
            eq(discountBarcodes.isActive, true),
          ),
        );

      if (updatedBatch.currentQty <= 0) {
        await tx
          .update(discountPolicies)
          .set({ isActive: false, updatedAt: now })
          .where(
            and(
              inArray(discountPolicies.id, policyIdsForBatch),
              eq(discountPolicies.isActive, true),
            ),
          );
      } else {
        await tx
          .update(discountPolicies)
          .set({
            allowedQty: sql`LEAST(${discountPolicies.allowedQty}, ${discountPolicies.soldQty} + ${updatedBatch.currentQty})`,
            updatedAt: now,
          })
          .where(
            and(
              inArray(discountPolicies.id, policyIdsForBatch),
              eq(discountPolicies.isActive, true),
            ),
          );
      }
    }

    remaining -= take;
  }
}

/** Tandai EXPIRED bila lewat batas waktu. true = sudah kedaluwarsa (caller harus menolak). */
async function expireIfDue(tx: Tx, order: OnlineOrder, now: Date): Promise<boolean> {
  if (!order.expiredAt || order.expiredAt > now) return false;
  await tx
    .update(onlineOrders)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(eq(onlineOrders.id, order.id));
  return true;
}

/**
 * Kedaluwarsakan pesanan WAITING_* yang telah melewati `expired_at` (batch / lazy sweep).
 * Aman dipanggil oleh cron maupun sebelum query admin/buyer agar tidak bergantung pada cron 5-menitan.
 */
export async function expireDueOrders(options?: {
  buyerId?: string;
  orderId?: string;
  limit?: number;
}): Promise<number> {
  const now = new Date();
  const cap = Math.min(Math.max(options?.limit ?? 100, 1), 100);
  const conditions = [
    inArray(onlineOrders.status, [...WAITING_STATUSES]),
    lte(onlineOrders.expiredAt, now),
    isNull(onlineOrders.deletedAt),
  ];
  if (options?.buyerId) conditions.push(eq(onlineOrders.buyerId, options.buyerId));
  if (options?.orderId) conditions.push(eq(onlineOrders.id, options.orderId));

  const due = await db
    .select({ id: onlineOrders.id })
    .from(onlineOrders)
    .where(and(...conditions))
    .limit(cap);

  if (due.length === 0) return 0;

  const updated = await db
    .update(onlineOrders)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(
      and(
        inArray(onlineOrders.id, due.map((r) => r.id)),
        inArray(onlineOrders.status, [...WAITING_STATUSES]),
        lte(onlineOrders.expiredAt, now),
      ),
    )
    .returning({ id: onlineOrders.id });

  return updated.length;
}

// ── Transisi ──────────────────────────────────────────────────

/** TRANSFER: bukti valid → WAITING_PAYMENT_VERIFICATION → WAITING_CONFIRMATION. */
export async function verifyPayment(orderId: string, adminId: string): Promise<OnlineOrder> {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== 'WAITING_PAYMENT_VERIFICATION') {
      throw new AppError('INVALID_TRANSITION', 'Pesanan tidak menunggu verifikasi pembayaran.', 409);
    }
    if (await expireIfDue(tx, order, now)) return { expired: true as const };

    const [updated] = await tx
      .update(onlineOrders)
      .set({
        status: 'WAITING_CONFIRMATION',
        paymentVerifiedAt: now,
        paymentVerifiedBy: adminId,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return { expired: false as const, order: updated! };
  });

  if (result.expired) throw new AppError('ORDER_EXPIRED', 'Pesanan sudah kedaluwarsa.', 410);
  return result.order;
}

/**
 * Konfirmasi: kunci pesanan + produk (urut id → anti-deadlock), cek stok,
 * kurangi products & batches (FEFO), generate PIN, status → CONFIRMED.
 */
export async function confirmOrder(orderId: string, adminId: string): Promise<OnlineOrder> {
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    assertTransition(order.status, 'CONFIRMED');
    if (await expireIfDue(tx, order, now)) return { expired: true as const };

    const items = await tx
      .select()
      .from(onlineOrderItems)
      .where(eq(onlineOrderItems.orderId, orderId));
    if (items.length === 0) throw new AppError('EMPTY_ORDER', 'Pesanan tidak memiliki item.', 422);

    // Agregasi qty per produk (defensif jika ada baris ganda)
    const need = new Map<string, number>();
    for (const it of items) need.set(it.productId, (need.get(it.productId) ?? 0) + it.quantity);
    const ids = [...need.keys()].sort();

    const stockRows = await tx
      .select({
        id: products.id,
        name: products.name,
        costPrice: products.costPrice,
        stockQty: products.stockQty,
        isActive: products.isActive,
        deletedAt: products.deletedAt,
      })
      .from(products)
      .where(inArray(products.id, ids))
      .orderBy(asc(products.id))
      .for('update');

    const byId = new Map(stockRows.map((p) => [p.id, p]));
    const shortages: string[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      const qty = need.get(id)!;
      if (!p || !p.isActive || p.deletedAt !== null) shortages.push('produk tidak tersedia');
      else if (p.stockQty < qty) shortages.push(`${p.name} (butuh ${qty}, sisa ${p.stockQty})`);
    }
    if (shortages.length > 0) {
      throw new AppError('INSUFFICIENT_STOCK', `Stok tidak cukup: ${shortages.join(', ')}`, 422);
    }

    for (const id of ids) {
      const p = byId.get(id)!;
      const qty = need.get(id)!;
      await deductBatchesFefo(tx, id, p.name, p.stockQty, qty, now);
      const [updatedProd] = await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} - ${qty}`, updatedAt: now })
        .where(and(eq(products.id, id), gte(products.stockQty, qty)))
        .returning({ id: products.id });
      if (!updatedProd) {
        throw new AppError('INSUFFICIENT_STOCK', `Stok "${p.name}" tidak cukup.`, 422);
      }
    }

    // ── Opsi A Single Source of Truth: Catat ke buku besar `transactions` (ACID) ──
    // Memastikan omzet, HPP, laba, bagi hasil 50:50, Rekonsiliasi QRIS, & Tutup Buku 100% sinkron dengan stok terpotong.
    const existingLedgerTx = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.invoiceNumber, order.orderNumber))
      .limit(1);

    if (existingLedgerTx.length === 0) {
      // Tentukan shift aktif hari ini (jika ada) & employeeId yang valid
      const todayStartWib = new Date(`${getTodayWib()}T00:00:00+07:00`);
      const [activeShift] = await tx
        .select({ id: shifts.id, employeeId: shifts.employeeId })
        .from(shifts)
        .where(and(eq(shifts.status, 'ACTIVE'), isNull(shifts.clockOut), gte(shifts.clockIn, todayStartWib)))
        .orderBy(desc(shifts.clockIn))
        .limit(1);

      let txEmployeeId = activeShift?.employeeId ?? null;
      if (!txEmployeeId) {
        const [adm] = await tx
          .select({ nidn: admins.nidn })
          .from(admins)
          .where(eq(admins.id, adminId))
          .limit(1);
        if (adm) {
          const [matchedEmp] = await tx
            .select({ id: employees.id })
            .from(employees)
            .where(and(eq(employees.nim, adm.nidn), isNull(employees.deletedAt)))
            .limit(1);
          txEmployeeId = matchedEmp?.id ?? null;
        }
      }
      if (!txEmployeeId) {
        const [fallbackEmp] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.isActive, true), isNull(employees.deletedAt)))
          .limit(1);
        txEmployeeId = fallbackEmp?.id ?? null;
      }

      if (txEmployeeId) {
        // 3NF invariant: gross_amount header == SUM(transaction_items.subtotal_sell)
        let merchandiseGross = 0;
        let merchandiseHpp = 0;
        const ledgerItems = items.map((it) => {
          const prod = byId.get(it.productId);
          const costPerUnit = Math.max(0, Number(prod?.costPrice ?? 0));
          const subSell = it.subtotal;
          const subCost = Math.round(costPerUnit * it.quantity);
          merchandiseGross += subSell;
          merchandiseHpp += subCost;
          return {
            productId: it.productId,
            productNameSnapshot: it.productName,
            costPriceSnapshot: costPerUnit.toFixed(2),
            sellingPriceSnapshot: it.sellingPrice.toFixed(2),
            qty: it.quantity,
            subtotalCost: subCost.toFixed(2),
            subtotalSell: subSell.toFixed(2),
          };
        });

        const [createdTx] = await tx
          .insert(transactions)
          .values({
            invoiceNumber: order.orderNumber,
            shiftId: activeShift?.id ?? null,
            employeeId: txEmployeeId,
            paymentMethod: 'QRIS',
            grossAmount: merchandiseGross.toFixed(2),
            totalHpp: merchandiseHpp.toFixed(2),
            grossProfit: (merchandiseGross - merchandiseHpp).toFixed(2),
            status: 'COMPLETED',
            isTest: false,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: transactions.id });

        if (createdTx) {
          await tx.insert(transactionItems).values(
            ledgerItems.map((li) => ({
              transactionId: createdTx.id,
              ...li,
            })),
          );
          await tx.insert(transactionPayments).values({
            transactionId: createdTx.id,
            paymentMethod: 'QRIS',
            amount: merchandiseGross.toFixed(2),
            createdAt: now,
          });
        }
      }
    }

    const [updated] = await tx
      .update(onlineOrders)
      .set({
        status: 'CONFIRMED',
        handoverPin: generateHandoverPin(),
        confirmedBy: adminId,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return { expired: false as const, order: updated! };
  });

  if (result.expired) throw new AppError('ORDER_EXPIRED', 'Pesanan sudah kedaluwarsa.', 410);
  return result.order;
}

/** Admin menolak (hanya dari WAITING_*). Stok tidak berubah. */
export async function rejectOrder(orderId: string, adminId: string, reason: string): Promise<OnlineOrder> {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    assertTransition(order.status, 'REJECTED');
    if (await expireIfDue(tx, order, now)) return { expired: true as const };
    const [updated] = await tx
      .update(onlineOrders)
      .set({ status: 'REJECTED', rejectedReason: reason, cancelledBy: adminId, updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return { expired: false as const, order: updated! };
  });

  if (result.expired) throw new AppError('ORDER_EXPIRED', 'Pesanan sudah kedaluwarsa.', 410);
  return result.order;
}

/** Buyer membatalkan miliknya — hanya sebelum CONFIRMED (stok belum disentuh). */
export async function cancelByBuyer(orderId: string, buyerId: string): Promise<OnlineOrder> {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId, buyerId);
    if (!WAITING_STATUSES.includes(order.status as typeof WAITING_STATUSES[number])) {
      throw new AppError(
        'INVALID_TRANSITION',
        'Pesanan yang sudah dikonfirmasi tidak dapat dibatalkan sendiri. Hubungi admin Wiramart.',
        409,
      );
    }
    if (await expireIfDue(tx, order, now)) return { expired: true as const };
    const [updated] = await tx
      .update(onlineOrders)
      .set({ status: 'CANCELLED', cancelledReason: 'Dibatalkan oleh pembeli', updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return { expired: false as const, order: updated! };
  });

  if (result.expired) throw new AppError('ORDER_EXPIRED', 'Pesanan sudah kedaluwarsa.', 410);
  return result.order;
}

// ── Query admin ───────────────────────────────────────────────

export type AdminOrderRow = OnlineOrder & {
  buyerName: string;
  buyerNim: string;
  buyerWhatsapp: string;
  csName: string | null;
  items: Array<Pick<OnlineOrderItem, 'id' | 'productName' | 'quantity' | 'subtotal'>>;
};

/** Daftar pesanan untuk dashboard admin. Selalu dibatasi (limit ≤ 100, FinOps guard). */
export async function listOrdersForAdmin(statuses: OrderStatus[] | null, limit = 50): Promise<AdminOrderRow[]> {
  // Sinkronkan pesanan WAITING_* yang lewat 2 jam agar daftar admin akurat meski tanpa cron 5-menit
  await expireDueOrders({ limit: 100 });

  const cap = Math.min(Math.max(limit, 1), 100);
  const where = statuses && statuses.length > 0
    ? and(isNull(onlineOrders.deletedAt), inArray(onlineOrders.status, statuses))
    : isNull(onlineOrders.deletedAt);

  const rows = await db
    .select({
      order: onlineOrders,
      buyerName: buyers.fullName,
      buyerNim: buyers.nim,
      buyerWhatsapp: buyers.whatsapp,
      csName: employees.fullName,
    })
    .from(onlineOrders)
    .innerJoin(buyers, eq(buyers.id, onlineOrders.buyerId))
    .leftJoin(employees, eq(employees.id, onlineOrders.assignedCsId))
    .where(where)
    .orderBy(desc(onlineOrders.createdAt))
    .limit(cap);

  if (rows.length === 0) return [];

  const itemRows = await db
    .select({
      id: onlineOrderItems.id,
      orderId: onlineOrderItems.orderId,
      productName: onlineOrderItems.productName,
      quantity: onlineOrderItems.quantity,
      subtotal: onlineOrderItems.subtotal,
    })
    .from(onlineOrderItems)
    .where(inArray(onlineOrderItems.orderId, rows.map((r) => r.order.id)));

  const grouped = new Map<string, AdminOrderRow['items']>();
  for (const it of itemRows) {
    const list = grouped.get(it.orderId) ?? [];
    list.push({ id: it.id, productName: it.productName, quantity: it.quantity, subtotal: it.subtotal });
    grouped.set(it.orderId, list);
  }

  const resolvedProofs = await Promise.all(
    rows.map((r) => resolvePaymentProofUrl(r.order.paymentProofUrl)),
  );

  return rows.map((r, idx) => ({
    ...r.order,
    paymentProofUrl: resolvedProofs[idx] ?? null,
    buyerName: r.buyerName,
    buyerNim: r.buyerNim,
    buyerWhatsapp: r.buyerWhatsapp,
    csName: r.csName ?? null,
    items: grouped.get(r.order.id) ?? [],
  }));
}

// ── Admin: Assign CS + Proses ─────────────────────────────────

/**
 * Admin assign CS ke pesanan CONFIRMED → status tetap CONFIRMED,
 * assignedCsId dan assignedAt diset.
 * CS employee harus ada (aktif, belum dihapus).
 */
export async function assignCs(
  orderId: string,
  csEmployeeId: string,
  adminId: string,
): Promise<OnlineOrder> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== 'CONFIRMED') {
      throw new AppError('INVALID_TRANSITION', 'Hanya pesanan berstatus CONFIRMED yang bisa di-assign ke CS.', 409);
    }

    // Validasi CS employee ada & aktif
    const [cs] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, csEmployeeId), eq(employees.isActive, true), isNull(employees.deletedAt)))
      .limit(1);
    if (!cs) throw new AppError('CS_NOT_FOUND', 'CS/Pelayan tidak ditemukan atau tidak aktif.', 404);

    const [updated] = await tx
      .update(onlineOrders)
      .set({ assignedCsId: csEmployeeId, assignedAt: now, assignedBy: adminId, updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return updated!;
  });
}

/**
 * Admin proses pesanan CONFIRMED → PREPARING.
 * Untuk pesanan DELIVERY: harus sudah di-assign ke Runner / CS.
 * Untuk pesanan PICKUP: staf toko langsung memproses pesanan.
 */
export async function prosesOrder(orderId: string): Promise<OnlineOrder> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    assertTransition(order.status, 'PREPARING');
    if (order.deliveryType === 'DELIVERY' && !order.assignedCsId) {
      throw new AppError('CS_NOT_ASSIGNED', 'Assign CS/Runner terlebih dahulu sebelum memproses pesanan delivery.', 409);
    }
    const [updated] = await tx
      .update(onlineOrders)
      .set({ status: 'PREPARING', updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return updated!;
  });
}

/**
 * Admin menyelesaikan pesanan PICKUP (ambil sendiri di toko) dengan verifikasi PIN 6-digit pembeli.
 * Menutup dead-end PICKUP pada status CONFIRMED / PREPARING → COMPLETED.
 */
export async function completePickupOrder(
  orderId: string,
  pin: string,
): Promise<OnlineOrder> {
  const cleanPin = pin.trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    throw new AppError('VALIDATION_ERROR', 'PIN serah terima harus tepat 6 digit angka.', 422);
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.deliveryType !== 'PICKUP') {
      throw new AppError('INVALID_TYPE', 'Verifikasi ini khusus untuk pesanan Ambil Sendiri (PICKUP).', 400);
    }
    assertTransition(order.status, 'COMPLETED');
    if (order.handoverPin !== cleanPin) {
      throw new AppError('INVALID_PIN', 'PIN serah terima tidak cocok. Minta pembeli menunjukkan PIN 6-digit di HP.', 422);
    }
    const [updated] = await tx
      .update(onlineOrders)
      .set({
        status: 'COMPLETED',
        handoverConfirmedAt: now,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return updated!;
  });
}

/**
 * Admin membatalkan pesanan pasca-CONFIRMED (termasuk kasus 2x No-Show):
 * - Memulihkan products.stockQty + stock_batches (Reverse FEFO) secara atomik
 * - Mem-VOID transaksi buku besar terkait (invoiceNumber = order.orderNumber)
 * - Opsional mem-flag/memblokir buyer (otomatis jika noShowCount >= 2 atau shouldFlagBuyer = true)
 */
export async function cancelConfirmedOrder(
  orderId: string,
  adminId: string,
  reason: string,
  shouldFlagBuyer = false,
): Promise<OnlineOrder> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      throw new AppError(
        'INVALID_TRANSITION',
        `Pembatalan pasca-konfirmasi hanya untuk status CONFIRMED/PREPARING/OUT_FOR_DELIVERY (saat ini: ${order.status}).`,
        409,
      );
    }

    const items = await tx
      .select({ productId: onlineOrderItems.productId, quantity: onlineOrderItems.quantity })
      .from(onlineOrderItems)
      .where(eq(onlineOrderItems.orderId, orderId));

    const restoreByProd = new Map<string, number>();
    for (const it of items) {
      restoreByProd.set(it.productId, (restoreByProd.get(it.productId) ?? 0) + it.quantity);
    }
    const sortedProdIds = [...restoreByProd.keys()].sort();

    // 1. Kembalikan stok produk & stock_batches (Reverse FEFO, lock terurut ID)
    for (const prodId of sortedProdIds) {
      const qty = restoreByProd.get(prodId)!;
      await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} + ${qty}`, updatedAt: now })
        .where(eq(products.id, prodId));

      const candidateBatches = await tx
        .select({ id: stockBatches.id, initialQty: stockBatches.initialQty, currentQty: stockBatches.currentQty })
        .from(stockBatches)
        .where(eq(stockBatches.productId, prodId))
        .orderBy(desc(stockBatches.expiryDate), desc(stockBatches.createdAt))
        .for('update');

      let left = qty;
      for (const b of candidateBatches) {
        if (left <= 0) break;
        const space = Math.max(0, b.initialQty - b.currentQty);
        if (space > 0) {
          const add = Math.min(space, left);
          await tx
            .update(stockBatches)
            .set({ currentQty: sql`${stockBatches.currentQty} + ${add}`, updatedAt: now })
            .where(eq(stockBatches.id, b.id));
          left -= add;
        }
      }
      if (left > 0 && candidateBatches[0]) {
        await tx
          .update(stockBatches)
          .set({ currentQty: sql`${stockBatches.currentQty} + ${left}`, updatedAt: now })
          .where(eq(stockBatches.id, candidateBatches[0].id));
      }
    }

    // 2. VOID record transaksi buku besar terkait (jika ada) agar laporan & QRIS tetap 100% sinkron
    await tx
      .update(transactions)
      .set({
        status: 'VOID',
        voidReason: `Order Online #${order.orderNumber} dibatalkan: ${reason}`.slice(0, 300),
        voidedByAdminId: adminId,
        voidedAt: now,
        updatedAt: now,
      })
      .where(and(eq(transactions.invoiceNumber, order.orderNumber), eq(transactions.status, 'COMPLETED')));

    // 3. Flag buyer jika 2x No-Show atau diminta eksplisit
    const doFlag = shouldFlagBuyer || (order.noShowCount ?? 0) >= 2;
    if (doFlag) {
      await tx
        .update(buyers)
        .set({
          isFlagged: true,
          isActive: false,
          flaggedReason: `Dibatalkan pasca-konfirmasi (${order.noShowCount ?? 0}x no-show): ${reason}`.slice(0, 250),
          flaggedBy: adminId,
          flaggedAt: now,
          updatedAt: now,
        })
        .where(eq(buyers.id, order.buyerId));
    }

    // 4. Update status order -> CANCELLED + audit log
    const [updated] = await tx
      .update(onlineOrders)
      .set({
        status: 'CANCELLED',
        cancelledReason: reason,
        cancelledBy: adminId,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, orderId))
      .returning();

    await tx.insert(auditLogs).values({
      tableName: 'online_orders',
      recordId: orderId,
      action: 'UPDATE',
      oldValues: JSON.stringify({ status: order.status, noShowCount: order.noShowCount }),
      newValues: JSON.stringify({ status: 'CANCELLED', reason, buyerFlagged: doFlag }),
      actorType: 'ADMIN',
      actorId: adminId,
    });

    return updated!;
  });
}

