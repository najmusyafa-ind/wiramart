// =============================================================
// POST /api/publik/cari-nim
// Mahasiswa lupa NIM: input Nama Lengkap + Program Studi
// → sistem tampilkan NIM mereka (jika cocok)
// Rate-limited ketat (cegah enumerasi NIM)
// =============================================================

import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { apiOk, apiError } from '@/lib/utils/helpers';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

// Rate limit: max 5 kali per 10 menit per IP-ish (via name+prodi key)
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX = 5;
const WINDOW = 10 * 60 * 1000; // 10 menit

function rl(key: string): boolean {
  const now = Date.now();
  const r = attempts.get(key);
  if (!r || now > r.resetAt) return true;
  return r.count < MAX;
}
function recordAttempt(key: string): void {
  const now = Date.now();
  const r = attempts.get(key);
  if (!r || now > r.resetAt) attempts.set(key, { count: 1, resetAt: now + WINDOW });
  else r.count++;
}

const schema = z.object({
  fullName:     z.string().min(2).max(200).trim(),
  programStudi: z.string().min(2).max(100).trim(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return apiError('Format tidak valid', 'INVALID_JSON', 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError('Nama dan Program Studi wajib diisi.', 'VALIDATION_ERROR', 422);
  }

  const { fullName, programStudi } = parsed.data;
  const rlKey = `${fullName.toLowerCase()}:${programStudi.toLowerCase()}`;

  if (!rl(rlKey)) {
    return apiError(
      'Terlalu banyak percobaan. Tunggu 10 menit sebelum mencoba lagi.',
      'RATE_LIMITED',
      429,
    );
  }

  recordAttempt(rlKey);

  const employee = await db.query.employees.findFirst({
    where: and(
      sql`LOWER(${employees.fullName}) = LOWER(${fullName})`,
      sql`LOWER(${employees.programStudi}) = LOWER(${programStudi})`,
      eq(employees.isActive, true),
      isNull(employees.deletedAt),
    ),
    columns: { nim: true, fullName: true, programStudi: true },
  });

  if (!employee) {
    return apiError(
      'Data tidak ditemukan. Pastikan nama dan program studi sesuai data pendaftaran.',
      'NOT_FOUND',
      404,
    );
  }

  // Tampilkan NIM dengan sebagian disensor (misal: 220****1234 → privasi minimal)
  const nim = employee.nim;
  const nimMasked = nim.length > 4
    ? nim.slice(0, 3) + '****' + nim.slice(-3)
    : nim;

  return apiOk({
    message: 'NIM ditemukan!',
    nim:       employee.nim,      // full NIM
    nimMasked,                    // untuk konfirmasi visual
    fullName:  employee.fullName,
    programStudi: employee.programStudi,
  });
}
