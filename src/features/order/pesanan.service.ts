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
  products,
  stockBatches,
  buyers,
  onlineOrders,
  onlineOrderItems,
  employees,
  type OnlineOrder,
  type OnlineOrderItem,
} from '@/lib/db/schema';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '@/lib/utils/helpers';
import { generateHandoverPin } from './order.types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OrderStatus = OnlineOrder['status'];

// ── State machine (PRD §5.2) — Record exhaustif: status baru wajib didaftarkan ──

const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  WAITING_PAYMENT_VERIFICATION: ['WAITING_CONFIRMATION', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  WAITING_CONFIRMATION: ['CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY'],
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

/** Kurangi batch aktif berurutan FEFO (sama dengan stok-adjustment). */
async function deductBatchesFefo(tx: Tx, productId: string, qty: number, now: Date): Promise<void> {
  let remaining = qty;
  const active = await tx
    .select({ id: stockBatches.id, currentQty: stockBatches.currentQty })
    .from(stockBatches)
    .where(and(eq(stockBatches.productId, productId), gt(stockBatches.currentQty, 0)))
    .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.createdAt));

  for (const b of active) {
    if (remaining <= 0) break;
    const take = Math.min(b.currentQty, remaining);
    await tx
      .update(stockBatches)
      .set({ currentQty: sql`${stockBatches.currentQty} - ${take}`, updatedAt: now })
      .where(eq(stockBatches.id, b.id));
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
      .select({ id: products.id, name: products.name, stockQty: products.stockQty, deletedAt: products.deletedAt })
      .from(products)
      .where(inArray(products.id, ids))
      .orderBy(asc(products.id))
      .for('update');

    const byId = new Map(stockRows.map((p) => [p.id, p]));
    const shortages: string[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      const qty = need.get(id)!;
      if (!p || p.deletedAt !== null) shortages.push('produk tidak tersedia');
      else if (p.stockQty < qty) shortages.push(`${p.name} (butuh ${qty}, sisa ${p.stockQty})`);
    }
    if (shortages.length > 0) {
      throw new AppError('INSUFFICIENT_STOCK', `Stok tidak cukup: ${shortages.join(', ')}`, 422);
    }

    for (const id of ids) {
      const qty = need.get(id)!;
      await tx
        .update(products)
        .set({ stockQty: sql`${products.stockQty} - ${qty}`, updatedAt: now })
        .where(eq(products.id, id));
      await deductBatchesFefo(tx, id, qty, now);
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
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    assertTransition(order.status, 'REJECTED');
    const [updated] = await tx
      .update(onlineOrders)
      .set({ status: 'REJECTED', rejectedReason: reason, cancelledBy: adminId, updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return updated!;
  });
}

/** Buyer membatalkan miliknya — hanya sebelum CONFIRMED (stok belum disentuh). */
export async function cancelByBuyer(orderId: string, buyerId: string): Promise<OnlineOrder> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId, buyerId);
    if (order.status !== 'WAITING_PAYMENT_VERIFICATION' && order.status !== 'WAITING_CONFIRMATION') {
      throw new AppError(
        'INVALID_TRANSITION',
        'Pesanan yang sudah dikonfirmasi tidak dapat dibatalkan sendiri. Hubungi admin Wiramart.',
        409,
      );
    }
    const [updated] = await tx
      .update(onlineOrders)
      .set({ status: 'CANCELLED', cancelledReason: 'Dibatalkan oleh pembeli', updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();
    return updated!;
  });
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

  return rows.map((r) => ({
    ...r.order,
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

