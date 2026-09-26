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
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
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


