// =============================================================
// Wiramart v2.0 — Buyer Repository
// Isolasi total akses database untuk tabel buyers.
// Service layer TIDAK boleh menulis SQL langsung.
// =============================================================

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { buyers, type Buyer, type NewBuyer } from '@/lib/db/schema';
import { AppError } from '@/lib/utils/helpers';

// ── Read ──────────────────────────────────────────────────────

/**
 * Cari buyer aktif berdasarkan NIM.
 * Dipakai untuk login (cek NIM + nama) dan untuk cek duplikasi saat daftar.
 */
export async function findBuyerByNim(nim: string): Promise<Buyer | null> {
  const [buyer] = await db
    .select()
    .from(buyers)
    .where(and(eq(buyers.nim, nim), isNull(buyers.deletedAt)))
    .limit(1);
  return buyer ?? null;
}

/**
 * Ambil buyer berdasarkan ID (untuk session refresh & info tampilan).
 * IDOR-safe: caller harus pastikan ID berasal dari JWT, bukan dari user input.
 */
export async function findBuyerById(id: string): Promise<Buyer | null> {
  const [buyer] = await db
    .select()
    .from(buyers)
    .where(and(eq(buyers.id, id), isNull(buyers.deletedAt)))
    .limit(1);
  return buyer ?? null;
}

// ── Write ─────────────────────────────────────────────────────

/**
 * Insert buyer baru ke database.
 * Unique constraint idx_buyers_nim_active akan catch duplikasi NIM.
 */
export async function createBuyer(input: NewBuyer): Promise<Buyer> {
  const [created] = await db
    .insert(buyers)
    .values(input)
    .returning();
  if (!created) throw new AppError('DB_ERROR', 'Gagal membuat akun buyer', 500);
  return created;
}

/**
 * Update status is_active buyer (dipakai saat unblock setelah 7 hari).
 * Diakses hanya oleh admin route atau system cron.
 */
export async function updateBuyerActiveStatus(
  id: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(buyers)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(buyers.id, id), isNull(buyers.deletedAt)));
}

/**
 * Flag buyer setelah 2x no-show.
 * Sekaligus set isActive = false (blokir sementara 7 hari).
 */
export async function flagBuyer(
  id: string,
  reason: string,
  flaggedByAdminId: string,
): Promise<void> {
  await db
    .update(buyers)
    .set({
      isFlagged: true,
      isActive: false,
      flaggedReason: reason,
      flaggedBy: flaggedByAdminId,
      flaggedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(buyers.id, id), isNull(buyers.deletedAt)));
}
