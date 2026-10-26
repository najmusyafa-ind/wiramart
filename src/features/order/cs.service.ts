// =============================================================
// Wiramart v2.0 — CS / Runner Delivery Service
// Alur pengantaran runner kampus:
// 1. List pesanan yang di-assign ke runner (Zero-Trust: PIN disembunyikan)
// 2. Berangkat (PREPARING → OUT_FOR_DELIVERY)
// 3. Verifikasi PIN serah terima (OUT_FOR_DELIVERY → COMPLETED)
// 4. Catat No-Show jika pembeli tidak ada di ruang kelas
// =============================================================

import { db } from '@/lib/db/client';
import {
  onlineOrders,
  onlineOrderItems,
  buyers,
  type OnlineOrder,
} from '@/lib/db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '@/lib/utils/helpers';

export type CsDeliveryRow = {
  id: string;
  orderNumber: string;
  status: OnlineOrder['status'];
  deliveryType: 'PICKUP' | 'DELIVERY';
  deliveryFloor: number | null;
  roomDetail: string | null;
  deliveryNote: string | null;
  paymentMethod: 'QRIS' | 'TRANSFER';
  totalAmount: number;
  noShowCount: number;
  handoverConfirmedAt: Date | null;
  createdAt: Date;
  buyerName: string;
  buyerNim: string;
  buyerWhatsapp: string;
  items: Array<{ id: string; productName: string; quantity: number; subtotal: number }>;
};

/**
 * Mengambil antrean pengantaran yang ditugaskan ke CS runner ini.
 * Keamanan Zero-Trust: handoverPin SENGAJA TIDAK DISERTAKAN agar runner
 * tidak bisa melihat PIN di network inspect / response API.
 */
export async function listDeliveriesForCs(
  csEmployeeId: string,
  limit = 30,
): Promise<CsDeliveryRow[]> {
  const cap = Math.min(Math.max(limit, 1), 50);

  const rows = await db
    .select({
      id: onlineOrders.id,
      orderNumber: onlineOrders.orderNumber,
      status: onlineOrders.status,
      deliveryType: onlineOrders.deliveryType,
      deliveryFloor: onlineOrders.deliveryFloor,
      roomDetail: onlineOrders.roomDetail,
      deliveryNote: onlineOrders.deliveryNote,
      paymentMethod: onlineOrders.paymentMethod,
      totalAmount: onlineOrders.totalAmount,
      noShowCount: onlineOrders.noShowCount,
      handoverConfirmedAt: onlineOrders.handoverConfirmedAt,
      createdAt: onlineOrders.createdAt,
      buyerName: buyers.fullName,
      buyerNim: buyers.nim,
      buyerWhatsapp: buyers.whatsapp,
    })
    .from(onlineOrders)
    .innerJoin(buyers, eq(buyers.id, onlineOrders.buyerId))
    .where(
      and(
        eq(onlineOrders.assignedCsId, csEmployeeId),
        isNull(onlineOrders.deletedAt),
        inArray(onlineOrders.status, ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'COMPLETED']),
      ),
    )
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
    .where(inArray(onlineOrderItems.orderId, rows.map((r) => r.id)));

  const grouped = new Map<string, CsDeliveryRow['items']>();
  for (const it of itemRows) {
    const list = grouped.get(it.orderId) ?? [];
    list.push({ id: it.id, productName: it.productName, quantity: it.quantity, subtotal: it.subtotal });
    grouped.set(it.orderId, list);
  }

  return rows.map((r) => ({
    ...r,
    items: grouped.get(r.id) ?? [],
  }));
}

/**
 * Runner berangkat menuju lokasi pemesan (PREPARING → OUT_FOR_DELIVERY).
 */
export async function berangkatDelivery(
  orderId: string,
  csEmployeeId: string,
  isAdmin = false,
): Promise<OnlineOrder> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(onlineOrders)
      .where(and(eq(onlineOrders.id, orderId), isNull(onlineOrders.deletedAt)))
      .limit(1)
      .for('update');

    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan.', 404);

    if (!isAdmin && order.assignedCsId !== csEmployeeId) {
      throw new AppError('FORBIDDEN', 'Pesanan ini tidak ditugaskan kepada Anda.', 403);
    }

    if (order.status !== 'PREPARING') {
      throw new AppError(
        'INVALID_STATE',
        `Pesanan belum siap diantar (status saat ini: ${order.status}). Tunggu admin memproses ke status Disiapkan.`,
        409,
      );
    }

    const [updated] = await tx
      .update(onlineOrders)
      .set({ status: 'OUT_FOR_DELIVERY', updatedAt: now })
      .where(eq(onlineOrders.id, orderId))
      .returning();

    return updated!;
  });
}

/**
 * Verifikasi PIN serah terima saat runner tiba di lokasi pembeli.
 * Status berubah dari OUT_FOR_DELIVERY (atau PREPARING) → COMPLETED.
 */
export async function verifyHandoverPin(
  orderId: string,
  csEmployeeId: string,
  pin: string,
  isAdmin = false,
): Promise<OnlineOrder> {
  const cleanPin = pin.trim();
  if (!cleanPin || cleanPin.length !== 6) {
    throw new AppError('VALIDATION_ERROR', 'PIN serah terima harus terdiri dari 6 digit.', 422);
  }

  const now = new Date();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(onlineOrders)
      .where(and(eq(onlineOrders.id, orderId), isNull(onlineOrders.deletedAt)))
      .limit(1)
      .for('update');

    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan.', 404);

    if (!isAdmin && order.assignedCsId !== csEmployeeId) {
      throw new AppError('FORBIDDEN', 'Pesanan ini tidak ditugaskan kepada Anda.', 403);
    }

    if (order.status !== 'OUT_FOR_DELIVERY' && order.status !== 'PREPARING') {
      throw new AppError(
        'INVALID_STATE',
        `Pesanan tidak dapat diselesaikan pada status: ${order.status}.`,
        409,
      );
    }

    // Bandingkan PIN
    if (order.handoverPin !== cleanPin) {
      throw new AppError(
        'INVALID_PIN',
        'PIN serah terima salah. Minta pembeli menunjukkan PIN 6-digit di halaman status pesanan.',
        422,
      );
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
 * Catat pembeli tidak ada di ruang kelas / lokasi pengantaran (no-show).
 * Sesuai PRD §5.4: jika no_show_count >= 2, admin dapat membatalkan pesanan.
 */
export async function recordNoShow(
  orderId: string,
  csEmployeeId: string,
  isAdmin = false,
): Promise<{ order: OnlineOrder; noShowCount: number; isMaxReached: boolean }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(onlineOrders)
      .where(and(eq(onlineOrders.id, orderId), isNull(onlineOrders.deletedAt)))
      .limit(1)
      .for('update');

    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan.', 404);

    if (!isAdmin && order.assignedCsId !== csEmployeeId) {
      throw new AppError('FORBIDDEN', 'Pesanan ini tidak ditugaskan kepada Anda.', 403);
    }

    if (order.status !== 'OUT_FOR_DELIVERY') {
      throw new AppError(
        'INVALID_STATE',
        'Pencatatan no-show hanya dapat dilakukan saat pesanan sedang diantar (OUT_FOR_DELIVERY).',
        409,
      );
    }

    const nextCount = (order.noShowCount ?? 0) + 1;
    const [updated] = await tx
      .update(onlineOrders)
      .set({
        noShowCount: nextCount,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, orderId))
      .returning();

    return {
      order: updated!,
      noShowCount: nextCount,
      isMaxReached: nextCount >= 2,
    };
  });
}
