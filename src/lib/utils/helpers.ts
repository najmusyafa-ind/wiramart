// =============================================================
// Smartkasir Perwira — Utility Helpers
// =============================================================

import { NextResponse } from 'next/server';

// --- Currency Formatter ---
export function formatRupiah(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

// --- Date Formatters ---
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

// --- Invoice Number Generator ---
// DEPRECATED: generateInvoiceNumber(sequence) sudah tidak dipakai.
// Implementasi baru ada di src/app/api/kasir/transaksi/route.ts
// menggunakan format INV{date}{time}{random} yang collision-resistant.
// Hapus jika ada yang masih import fungsi ini.

// --- Decimal / Number helpers ---
export function toDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? 0 : num;
}

export function calculateChange(cashReceived: number, totalAmount: number): number {
  return Math.max(0, cashReceived - totalAmount);
}

// --- Duration ---
export function durationBetween(start: Date | string, end?: Date | string | null): string {
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = end ? (typeof end === 'string' ? new Date(end) : end) : new Date();
  const ms = e.getTime() - s.getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

// --- Typed Error ---
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    arg1: string,
    arg2: string,
    statusCode: number = 400,
    isOperational: boolean = true,
  ) {
    // Deteksi fleksibel: mendukung (code, message) maupun (message, code)
    const isCode = (s: string) => /^[A-Z0-9_]{3,}$/.test(s.trim());
    let code: string;
    let message: string;

    if (isCode(arg1) && !isCode(arg2)) {
      code = arg1;
      message = arg2;
    } else if (isCode(arg2) && !isCode(arg1)) {
      code = arg2;
      message = arg1;
    } else {
      code = arg1;
      message = arg2;
    }

    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

// --- Safe JSON parse ---
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

// --- API Response Helpers ---
export function apiOk(data: unknown, meta?: unknown, status = 200): NextResponse {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status });
}

export function apiError(
  message: unknown,
  code?: string,
  status = 400,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}), ...(details ? { details } : {}) },
    { status },
  );
}

// --- Pagination ---
export function getPaginationParams(searchParams: URLSearchParams): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  return { page, limit, offset: (page - 1) * limit };
}

// --- Period date ranges ---
export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'semi_annual';

export function getPeriodRange(period: PeriodType, referenceDate = new Date()): {
  start: Date;
  end: Date;
  label: string;
} {
  const now = new Date(referenceDate);

  switch (period) {
    case 'daily': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end, label: formatDate(start) };
    }
    case 'weekly': {
      const day = now.getDay(); // 0 = Sunday
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: `${formatDate(start)} – ${formatDate(end)}` };
    }
    case 'monthly': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return {
        start,
        end,
        label: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(start),
      };
    }
    case 'semi_annual': {
      const month = now.getMonth();
      const isFH = month < 6;
      const start = new Date(now.getFullYear(), isFH ? 0 : 6, 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), isFH ? 6 : 12, 0, 23, 59, 59, 999);
      const sem = isFH ? 'Semester 1' : 'Semester 2';
      return { start, end, label: `${sem} ${now.getFullYear()}` };
    }
  }
}

// --- Truncate text ---
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

// --- Class names helper (lightweight cx) ---
export function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// --- WIB (Asia/Jakarta) Date & FEFO Helpers (Client & Server Safe) ---
/** Mengembalikan tanggal kalender saat ini di zona waktu WIB (YYYY-MM-DD). */
export function getTodayWib(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

/** Mengembalikan tanggal WIB bergeser `offsetDays` hari dari `now` (YYYY-MM-DD). */
export function getOffsetDateWib(offsetDays: number, now = new Date()): string {
  const shifted = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return getTodayWib(shifted);
}

/** Mengembalikan jam (0-23) di zona waktu WIB (Asia/Jakarta). */
export function getHourWib(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return Number.parseInt(hourStr, 10) % 24;
}

/**
 * Menghitung harga diskon darurat FEFO secara seragam di backend & UI
 * agar preview Admin/Gudang selalu identik dengan nominal di kasir.
 */
export function computeFefoDiscountedPrice(originalPrice: number, discountPct: number): number {
  const safePrice = Number.isFinite(originalPrice) ? Math.max(0, originalPrice) : 0;
  const safePct = Number.isFinite(discountPct) ? Math.min(100, Math.max(0, discountPct)) : 0;
  return Math.max(0, Math.round(safePrice * (1 - safePct / 100)));
}

/**
 * Mengembalikan objek Date yang merepresentasikan pukul 00:00:00.000 WIB pada hari ini.
 * Dipakai untuk mendeteksi stok Makanan Harian yang belum di-reset sejak hari sebelumnya.
 */
export function getStartOfTodayWib(now = new Date()): Date {
  const todayStr = getTodayWib(now);
  return new Date(`${todayStr}T00:00:00.000+07:00`);
}

/**
 * Menghitung kelipatan paket eceran minimum (bundle step) berdasarkan harga satuan.
 * Contoh warung/ritel: harga satuan Rp 250/pcs -> step 2 pcs (Rp 500 dapat 2, Rp 1.000 dapat 4).
 */
export function getProductBundleStep(sellingPrice: number | string | null | undefined): number {
  const raw = typeof sellingPrice === 'string' ? parseFloat(sellingPrice) : Number(sellingPrice ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const price = Math.round(raw);
  if (price > 0 && price < 500 && 500 % price === 0) {
    return Math.max(1, Math.round(500 / price));
  }
  return 1;
}

/**
 * Membulatkan jumlah item ke kelipatan paket (bundleStep) yang valid dan tidak melebihi stok.
 */
export function snapToBundleQty(qty: number, step: number, maxStock?: number): number {
  const safeStep = Math.max(1, Math.round(step));
  const rawQty = Math.max(safeStep, Math.round(qty / safeStep) * safeStep);
  if (maxStock !== undefined && Number.isFinite(maxStock)) {
    const maxAllowed = Math.floor(Math.max(0, maxStock) / safeStep) * safeStep;
    return Math.min(rawQty, maxAllowed);
  }
  return rawQty;
}

/**
 * Menghasilkan label harga ramah pengguna untuk produk paket eceran (mis. Rp 500 / 2 pcs).
 */
export function getBundlePriceDisplay(
  sellingPrice: number | string | null | undefined,
  unit = 'pcs',
): {
  step: number;
  unitPrice: number;
  bundlePrice: number;
  primaryLabel: string;
  secondaryLabel: string | null;
} {
  const raw = typeof sellingPrice === 'string' ? parseFloat(sellingPrice) : Number(sellingPrice ?? 0);
  const unitPrice = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  const step = getProductBundleStep(unitPrice);
  const bundlePrice = unitPrice * step;
  const cleanUnit = unit?.trim() || 'pcs';

  if (step > 1) {
    const doubleStep = step * 2;
    const doublePrice = unitPrice * doubleStep;
    return {
      step,
      unitPrice,
      bundlePrice,
      primaryLabel: `Rp ${bundlePrice.toLocaleString('id-ID')} / ${step} ${cleanUnit}`,
      secondaryLabel: `Rp ${doublePrice.toLocaleString('id-ID')} / ${doubleStep} ${cleanUnit}`,
    };
  }

  return {
    step: 1,
    unitPrice,
    bundlePrice: unitPrice,
    primaryLabel: `Rp ${unitPrice.toLocaleString('id-ID')}`,
    secondaryLabel: null,
  };
}




