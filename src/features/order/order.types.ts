// =============================================================
// Wiramart v2.0 — Order Feature: Types & Zod Schemas
// Semua validasi input API buyer, admin, dan CS
// =============================================================

import { z } from 'zod';

// ── Helper regex ──────────────────────────────────────────────

const VALID_FLOORS = [1, 2, 3, 4, 99] as const;

/** Normalisasi nomor WA ke format internasional 628xxx */
export function normalizeWhatsapp(wa: string): string {
  const clean = wa.replace(/[\s\-().+]/g, '');
  if (clean.startsWith('08')) return '62' + clean.slice(1);
  if (clean.startsWith('628')) return clean;
  return clean; // fallback — server akan tolak jika format tidak valid
}

// ── Buyer Auth Schemas ────────────────────────────────────────

export const BuyerRegisterSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Nama minimal 2 karakter')
    .max(200, 'Nama maksimal 200 karakter'),
  nim: z
    .string()
    .trim()
    .regex(/^\d{8,15}$/, 'NIM harus 8-15 digit angka'),
  whatsapp: z
    .string()
    .trim()
    .regex(/^(08|628)\d{8,12}$/, 'Format WA tidak valid (contoh: 08123456789 atau 628123456789)'),
});

export const BuyerLoginSchema = z.object({
  nim: z
    .string()
    .trim()
    .regex(/^\d{8,15}$/, 'NIM harus 8-15 digit angka'),
  fullName: z
    .string()
    .trim()
    .min(2, 'Nama minimal 2 karakter')
    .max(200, 'Nama maksimal 200 karakter'),
});

export type BuyerRegisterInput = z.infer<typeof BuyerRegisterSchema>;
export type BuyerLoginInput = z.infer<typeof BuyerLoginSchema>;

// ── Order Creation Schema ─────────────────────────────────────

export const CreateOrderItemSchema = z.object({
  productId: z.string().uuid('productId harus berupa UUID'),
  quantity: z
    .number()
    .int('Quantity harus bilangan bulat')
    .min(1, 'Minimal 1 item')
    .max(50, 'Maksimal 50 per jenis produk'),
});

export const CreateOrderSchema = z
  .object({
    items: z
      .array(CreateOrderItemSchema)
      .min(1, 'Minimal 1 produk dalam pesanan')
      .max(10, 'Maksimal 10 jenis produk per pesanan'),
    deliveryType: z.enum(['PICKUP', 'DELIVERY']),
    deliveryFloor: z
      .number()
      .int()
      .refine((v) => VALID_FLOORS.includes(v as typeof VALID_FLOORS[number]), {
        message: 'Lantai tidak valid. Pilih 1, 2, 3, 4, atau 99 (Auditorium)',
      })
      .optional(),
    roomDetail: z
      .string()
      .trim()
      .min(1, 'Detail ruang tidak boleh kosong')
      .max(100, 'Detail ruang maksimal 100 karakter')
      .optional(),
    deliveryNote: z
      .string()
      .trim()
      .max(200, 'Catatan maksimal 200 karakter')
      .optional(),
    paymentMethod: z.enum(['QRIS', 'TRANSFER']),
  })
  .refine(
    (d) => d.deliveryType === 'PICKUP' || d.deliveryFloor !== undefined,
    { message: 'Lantai tujuan wajib diisi untuk pengiriman', path: ['deliveryFloor'] },
  )
  .refine(
    (d) =>
      d.deliveryType === 'PICKUP' ||
      (d.roomDetail !== undefined && d.roomDetail.length > 0),
    { message: 'Detail ruang/kelas wajib diisi untuk pengiriman', path: ['roomDetail'] },
  );

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

// ── Admin Action Schemas ──────────────────────────────────────

export const OrderActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Alasan minimal 10 karakter')
    .max(500, 'Alasan maksimal 500 karakter'),
});

export const AssignCsSchema = z.object({
  csEmployeeId: z.string().uuid('csEmployeeId harus berupa UUID'),
});

// ── CS PIN Verify Schema ──────────────────────────────────────

export const PinVerifySchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN harus tepat 6 digit angka'),
});

export type PinVerifyInput = z.infer<typeof PinVerifySchema>;

// ── Delivery Fee Calculator (SERVER-SIDE ONLY) ────────────────

/**
 * Hitung ongkir berdasarkan lantai tujuan.
 * TIDAK PERNAH dipercaya dari nilai yang dikirim client.
 * Client hanya mengirim deliveryFloor → server hitung ulang.
 *
 * Kebijakan ongkir (= insentif runner):
 * - PICKUP / Lantai 1 : Rp 0
 * - Lantai 2          : Rp 1.000
 * - Lantai 3, 4, Aud  : Rp 2.000
 */
const DELIVERY_FEE_MAP: Record<number, number> = {
  1: 0,
  2: 1_000,
  3: 2_000,
  4: 2_000,
  99: 2_000, // 99 = Auditorium
};

export function calculateDeliveryFee(
  type: 'PICKUP' | 'DELIVERY',
  floor?: number,
): number {
  if (type === 'PICKUP') return 0;
  if (floor === undefined) throw new Error('Lantai tujuan wajib untuk delivery');
  const fee = DELIVERY_FEE_MAP[floor];
  if (fee === undefined) throw new Error(`Lantai ${floor} tidak valid`);
  return fee;
}

// ── Order Number Generator ────────────────────────────────────

/**
 * Generate nomor pesanan format WM-YYYYMMDD-XXXX
 * XXXX = 4 digit random (bukan sequential — untuk menghindari race condition)
 * Jika collision: DB UNIQUE constraint akan catch dan caller harus retry.
 */
export function generateOrderNumber(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const random = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit
  return `WM-${date}-${random}`;
}

// ── PIN Generator ─────────────────────────────────────────────

/**
 * Generate PIN 6 digit untuk serah terima.
 * Reject PIN trivial (000000, 111111, dst) karena mudah ditebak.
 */
export function generateHandoverPin(): string {
  let pin: string;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (/^(.)\1{5}$/.test(pin)); // reject semua digit sama
  return pin;
}

// ── Fonnte WA Templates ───────────────────────────────────────

export const WA = {
  ORDER_CREATED: (name: string, no: string, total: number): string =>
    `Halo ${name}! 🎉\n\nPesanan *#${no}* diterima!\n` +
    `Total: *Rp ${total.toLocaleString('id-ID')}*\n\n` +
    `Selesaikan pembayaran dalam 2 jam ya.\n\n_Wiramart UNPERBA_`,

  ORDER_CONFIRMED: (no: string, pin: string): string =>
    `Pesanan *#${no}* dikonfirmasi! ✅\n\n` +
    `Sedang kami siapkan.\n\n` +
    `🔐 *PIN Serah Terima: ${pin}*\n` +
    `Tunjukkan PIN ini ke runner saat barang tiba.\n\n_Wiramart UNPERBA_`,

  PREPARING: (no: string): string =>
    `Pesanan *#${no}* sedang disiapkan oleh tim kami. 📦\n\n_Wiramart UNPERBA_`,

  OUT_FOR_DELIVERY: (no: string, csName: string, floor: number | string, room: string): string =>
    `Pesanan *#${no}* sedang diantar! 🏃\n\n` +
    `*${csName}* sedang naik ke *Lantai ${floor} — ${room}*.\n` +
    `Siapkan PIN kamu!\n\n_Wiramart UNPERBA_`,

  ORDER_COMPLETED: (no: string): string =>
    `Pesanan *#${no}* selesai! 😊\n\n` +
    `Terima kasih sudah pesan di Wiramart UNPERBA!\n\n_Wiramart UNPERBA_`,

  ORDER_CANCELLED: (no: string, reason: string): string =>
    `Pesanan *#${no}* dibatalkan.\n\n` +
    `Alasan: ${reason}\n\n` +
    `Hubungi admin Wiramart untuk info lebih lanjut.\n\n_Wiramart UNPERBA_`,

  ORDER_REJECTED: (no: string, reason: string): string =>
    `Pesanan *#${no}* tidak dapat kami proses.\n\n` +
    `Alasan: ${reason}\n\n` +
    `Silakan pesan kembali dengan bukti pembayaran yang valid.\n\n_Wiramart UNPERBA_`,

  NO_SHOW_WARNING: (no: string, floor: number | string, room: string, count: number): string =>
    `⚠️ Runner Wiramart menunggu di *Lantai ${floor} — ${room}*.\n\n` +
    `Order: *#${no}* (peringatan ${count}/2)\n` +
    `Segera ke lokasi dalam 5 menit ya!\n\n_Wiramart UNPERBA_`,

  BUYER_FLAGGED: (no: string): string =>
    `Pesanan *#${no}* dibatalkan karena 2x tidak ada saat pengiriman.\n\n` +
    `Akun Anda dinonaktifkan sementara selama 7 hari.\n` +
    `Hubungi admin untuk informasi lebih lanjut.\n\n_Wiramart UNPERBA_`,

  // Notif untuk admin shift
  NEW_ORDER_ADMIN: (no: string, buyer: string, total: number, method: string): string =>
    `🛒 *[Pesanan Baru]* #${no}\n` +
    `Dari: ${buyer}\n` +
    `Total: Rp ${total.toLocaleString('id-ID')} | ${method}\n` +
    `Segera konfirmasi di dashboard.`,

  // Notif untuk CS yang di-assign
  CS_ASSIGNED: (no: string, buyer: string, floor: number | string, room: string, note?: string): string =>
    `📦 *Pesanan baru untuk kamu antar!*\n\n` +
    `Order: *#${no}*\n` +
    `Ke: *Lantai ${floor} — ${room}*\n` +
    `Pembeli: ${buyer}` +
    (note ? `\nCatatan: ${note}` : '') +
    `\n\nSiapkan barang di Wiramart.\n\n_Wiramart UNPERBA_`,

  // Notif admin jika no-show 2x
    NO_SHOW_ADMIN_ALERT: (no: string, buyer: string, floor: number | string, room: string): string =>
    `🚨 *[No-Show 2x]* Order #${no}\n` +
    `Pembeli: ${buyer}\n` +
    `Lokasi: Lantai ${floor} — ${room}\n` +
    `Runner sudah 2x naik tapi buyer tidak ada. Perlu tindakan cancel.`,
};

