// =============================================================
// Wiramart v2.0 — Buyer Service
// Domain logic: registrasi, login, session, validasi akun.
// Dipanggil oleh API route handler (Controller ≤ 30 baris).
// =============================================================

import {
  signBuyerToken,
  setBuyerCookie,
  type BuyerTokenPayload,
} from '@/lib/utils/auth';
import { AppError } from '@/lib/utils/helpers';
import {
  findBuyerByNim,
  findBuyerById,
  createBuyer,
} from './buyer.repository';
import {
  normalizeWhatsapp,
  type BuyerRegisterInput,
  type BuyerLoginInput,
} from './order.types';

// ── Register ──────────────────────────────────────────────────

/**
 * Daftarkan buyer baru dan langsung set cookie session.
 *
 * Flow:
 * 1. Cek apakah NIM sudah terdaftar (duplicate check)
 * 2. Normalisasi WA ke format internasional
 * 3. INSERT ke DB
 * 4. Sign JWT + set cookie sk_buyer
 * 5. Return payload untuk response
 */
export async function registerBuyer(
  input: BuyerRegisterInput,
): Promise<{ buyerId: string; name: string; nim: string }> {
  // 1. Cek duplikasi NIM
  const existing = await findBuyerByNim(input.nim);
  if (existing) {
    throw new AppError(
      'NIM_ALREADY_REGISTERED',
      `NIM ${input.nim} sudah terdaftar. Silakan login dengan NIM dan nama kamu.`,
      409,
    );
  }

  // 2. Normalisasi WA
  const whatsapp = normalizeWhatsapp(input.whatsapp);

  // 3. INSERT
  const buyer = await createBuyer({
    fullName: input.fullName.trim(),
    nim: input.nim.trim(),
    whatsapp,
  });

  // 4. Sign JWT + set cookie
  const payload: BuyerTokenPayload = {
    sub: buyer.id,
    role: 'buyer',
    nim: buyer.nim,
    name: buyer.fullName,
  };
  const token = await signBuyerToken(payload);
  await setBuyerCookie(token);

  return { buyerId: buyer.id, name: buyer.fullName, nim: buyer.nim };
}

// ── Login ─────────────────────────────────────────────────────

/**
 * Login buyer via NIM + Nama Lengkap (tanpa password).
 *
 * Security rationale:
 * - NIM adalah identitas unik kampus yang sulit ditebak (8-15 digit)
 * - Nama sebagai second factor mencegah orang lain memakai NIM orang lain
 * - Untuk kampus kecil (< 1000 mahasiswa), ini sufficient
 * - Rate limit 10x/15min di level API menambah proteksi
 *
 * Flow:
 * 1. Cari buyer berdasarkan NIM
 * 2. Cek nama cocok (case-insensitive)
 * 3. Cek is_active (jika false: blokir sementara)
 * 4. Sign JWT + set cookie
 */
export async function loginBuyer(
  input: BuyerLoginInput,
): Promise<{ buyerId: string; name: string; nim: string }> {
  // 1. Cari berdasarkan NIM
  const buyer = await findBuyerByNim(input.nim);
  if (!buyer) {
    // SECURITY: pesan generik — tidak reveal apakah NIM ada atau tidak
    throw new AppError(
      'INVALID_CREDENTIALS',
      'NIM atau nama tidak cocok. Periksa kembali atau daftar akun baru.',
      401,
    );
  }

  // 2. Cek nama (normalized: lowercase + trim)
  const nameMatch =
    buyer.fullName.toLowerCase().trim() === input.fullName.toLowerCase().trim();
  if (!nameMatch) {
    throw new AppError(
      'INVALID_CREDENTIALS',
      'NIM atau nama tidak cocok. Periksa kembali atau daftar akun baru.',
      401,
    );
  }

  // 3. Cek akun aktif
  if (!buyer.isActive) {
    const reason = buyer.isFlagged
      ? `Akun dinonaktifkan karena: ${buyer.flaggedReason ?? 'pelanggaran aturan'}. Hubungi admin Wiramart.`
      : 'Akun sedang dinonaktifkan oleh admin. Hubungi admin Wiramart.';
    throw new AppError('ACCOUNT_INACTIVE', reason, 403);
  }

  // 4. Sign JWT + set cookie
  const payload: BuyerTokenPayload = {
    sub: buyer.id,
    role: 'buyer',
    nim: buyer.nim,
    name: buyer.fullName,
  };
  const token = await signBuyerToken(payload);
  await setBuyerCookie(token);

  return { buyerId: buyer.id, name: buyer.fullName, nim: buyer.nim };
}

// ── Session Validation ────────────────────────────────────────

/**
 * Validasi session buyer yang sedang aktif.
 * Dipakai saat Server Component perlu tahu siapa yang sedang login.
 * Gunakan requireBuyer() dari auth.ts untuk guard di API route.
 */
export async function getActiveBuyerProfile(buyerId: string) {
  const buyer = await findBuyerById(buyerId);
  if (!buyer || !buyer.isActive) return null;
  return {
    id: buyer.id,
    name: buyer.fullName,
    nim: buyer.nim,
    whatsapp: buyer.whatsapp,
    isFlagged: buyer.isFlagged,
  };
}
