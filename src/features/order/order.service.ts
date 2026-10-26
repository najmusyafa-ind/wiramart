// =============================================================
// Wiramart v2.0 — Order Service
// Business logic: buat pesanan, validasi stok, ACID transaction.
// =============================================================

import { db } from '@/lib/db/client';
import {
  products,
  onlineOrders,
  onlineOrderItems,
  type NewOnlineOrder,
  type NewOnlineOrderItem,
  type OnlineOrder,
} from '@/lib/db/schema';
import { eq, and, isNull, inArray, desc } from 'drizzle-orm';
import { AppError } from '@/lib/utils/helpers';
import {
  calculateDeliveryFee,
  generateOrderNumber,
  type CreateOrderInput,
} from './order.types';
import { validateStockForOrder } from './katalog.service';

// ── Types ─────────────────────────────────────────────────────

export type OrderWithItems = OnlineOrder & {
  items: Array<{
    productId: string;
    productName: string;
    sellingPrice: number;
    quantity: number;
    subtotal: number;
  }>;
};

// ── Create Order ──────────────────────────────────────────────

/**
 * Buat pesanan online baru dengan ACID transaction.
 *
 * Flow:
 * 1. Validasi input: stok cukup? produk aktif?
 * 2. Ambil harga SNAPSHOT dari DB (tidak dari client) — anti price manipulation
 * 3. Hitung ongkir server-side — anti fee bypass
 * 4. Generate order number + payment reference
 * 5. INSERT dalam satu DB transaction
 *    - Stok TIDAK dikurangi di sini — dikurangi saat admin CONFIRM (step 6)
 *    - Alasan: buyer bisa cancel sebelum dikonfirmasi → stok tidak terbuang
 *
 * Security enforcements:
 * - sellingPrice dari DB, bukan dari client
 * - deliveryFee dihitung server-side, bukan dari client
 * - orderNumber dan paymentReference di-generate server-side
 */
export async function createOnlineOrder(
  buyerId: string,
  input: CreateOrderInput,
): Promise<OrderWithItems> {
  // 1. Validasi stok awal
  const stockCheck = await validateStockForOrder(input.items);
  if (!stockCheck.valid) {
    const failedNames = stockCheck.failedItems
      .map((f) => `${f.name} (diminta: ${f.requested}, tersedia: ${f.available})`)
      .join(', ');
    throw new AppError(
      'INSUFFICIENT_STOCK',
      `Stok tidak mencukupi: ${failedNames}`,
      422,
    );
  }

  // 2. Ambil harga SNAPSHOT dari DB untuk semua productId yang diminta
  const productIds = input.items.map((i) => i.productId);
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sellingPrice: products.sellingPrice,
      isActive: products.isActive,
    })
    .from(products)
    .where(and(inArray(products.id, productIds), isNull(products.deletedAt)));

  const productMap = new Map(productRows.map((p) => [p.id, p]));

  // Validasi semua produk ditemukan dan aktif
  for (const item of input.items) {
    const p = productMap.get(item.productId);
    if (!p || !p.isActive) {
      throw new AppError('PRODUCT_NOT_FOUND', `Produk tidak ditemukan atau sudah tidak aktif`, 422);
    }
  }

  // 3. Hitung biaya server-side (TIDAK percaya nilai dari client)
  const deliveryFee = calculateDeliveryFee(input.deliveryType, input.deliveryFloor);

  // 4. Build item rows dengan harga snapshot
  const orderItemsData: Array<{
    productId: string;
    productName: string;
    sellingPrice: number;
    quantity: number;
    subtotal: number;
  }> = input.items.map((item) => {
    const p = productMap.get(item.productId)!;
    const price = Number(p.sellingPrice);
    return {
      productId: item.productId,
      productName: p.name,
      sellingPrice: price,
      quantity: item.quantity,
      subtotal: price * item.quantity,
    };
  });

  const subtotal = orderItemsData.reduce((sum, i) => sum + i.subtotal, 0);
  const totalAmount = subtotal + deliveryFee;

  // 5. Tentukan status awal berdasarkan metode bayar
  // TRANSFER → WAITING_PAYMENT_VERIFICATION (perlu upload bukti)
  // QRIS     → WAITING_CONFIRMATION (langsung ke admin verify)
  const initialStatus = input.paymentMethod === 'TRANSFER'
    ? 'WAITING_PAYMENT_VERIFICATION' as const
    : 'WAITING_CONFIRMATION' as const;

  // 6. Generate identifiers server-side
  // Retry max 3x jika collision pada orderNumber (sangat jarang)
  let orderNumber: string = '';
  let order: OnlineOrder | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    orderNumber = generateOrderNumber();
    const paymentReference = orderNumber; // sama dengan orderNumber untuk referensi transfer

    try {
      // ACID transaction
      const result = await db.transaction(async (tx) => {
        // INSERT online_orders
        const orderData: NewOnlineOrder = {
          orderNumber,
          buyerId,
          deliveryType: input.deliveryType,
          deliveryFloor: input.deliveryFloor,
          deliveryFee,
          deliveryNote: input.deliveryNote,
          roomDetail: input.roomDetail,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentMethod === 'TRANSFER' ? paymentReference : undefined,
          status: initialStatus,
          subtotal,
          totalAmount,
          // Expired dalam 2 jam jika belum diproses
          expiredAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        };

        const [insertedOrder] = await tx
          .insert(onlineOrders)
          .values(orderData)
          .returning();

        if (!insertedOrder) throw new Error('Gagal insert order');

        // INSERT online_order_items (batch)
        const itemsData: NewOnlineOrderItem[] = orderItemsData.map((item) => ({
          orderId: insertedOrder.id,
          productId: item.productId,
          productName: item.productName,
          sellingPrice: item.sellingPrice,
          quantity: item.quantity,
          subtotal: item.subtotal,
        }));

        await tx.insert(onlineOrderItems).values(itemsData);

        return insertedOrder;
      });

      order = result;
      break; // sukses, keluar loop
    } catch (err: unknown) {
      const dbErr = err as { code?: string };
      // PostgreSQL unique violation = collision pada orderNumber → retry
      if (dbErr?.code === '23505' && attempt < 2) continue;
      throw new AppError('ORDER_CREATE_FAILED', 'Gagal membuat pesanan. Coba lagi.', 500);
    }
  }

  if (!order) {
    throw new AppError('ORDER_CREATE_FAILED', 'Gagal membuat pesanan setelah 3 percobaan.', 500);
  }

  return {
    ...order,
    items: orderItemsData,
  };
}

// ── Get Orders by Buyer ───────────────────────────────────────

/**
 * Ambil daftar pesanan buyer (untuk halaman riwayat order di PWA).
 * IDOR-safe: buyerId selalu dari JWT session, bukan dari user input.
 */
export async function getOrdersByBuyerId(
  buyerId: string,
  limit = 10,
): Promise<OnlineOrder[]> {
  const rows = await db
    .select()
    .from(onlineOrders)
    .where(and(eq(onlineOrders.buyerId, buyerId), isNull(onlineOrders.deletedAt)))
    .orderBy(desc(onlineOrders.createdAt))
    .limit(limit);
  return rows; // newest first
}

/**
 * Ambil detail satu pesanan beserta items.
 * IDOR check: harus pastikan order.buyerId === session.buyerId di caller.
 */
export async function getOrderDetail(orderId: string): Promise<OnlineOrder | null> {
  const [row] = await db
    .select()
    .from(onlineOrders)
    .where(and(eq(onlineOrders.id, orderId), isNull(onlineOrders.deletedAt)))
    .limit(1);
  return row ?? null;
}
