// =============================================================
// Supabase Server-Side Client — Smartkasir Perwira
//
// ⚠️  SECURITY: Klien ini menggunakan SERVICE_ROLE_KEY.
//    → WAJIB hanya dipakai di server-side (route handlers, server actions).
//    → JANGAN import file ini di komponen 'use client'.
//    → Service role key bypass semua RLS — jangan expose ke browser.
// =============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('[Supabase] NEXT_PUBLIC_SUPABASE_URL tidak ditemukan di environment.');
}

// Buat admin client (service role) — singleton pattern
const globalForSupabase = globalThis as unknown as {
  _supabaseAdmin: ReturnType<typeof createClient> | undefined;
};

/**
 * Supabase Admin Client (service_role).
 * Gunakan hanya di server-side untuk operasi Storage dan operasi yang perlu bypass RLS.
 *
 * Jika SUPABASE_SERVICE_ROLE_KEY tidak diset:
 * - Storage upload tidak akan bisa berjalan
 * - Fungsi getSupabaseAdmin() akan throw error
 */
export function getSupabaseAdmin(): ReturnType<typeof createClient> {
  if (!supabaseServiceKey) {
    throw new Error(
      '[Supabase] SUPABASE_SERVICE_ROLE_KEY tidak ditemukan. ' +
      'Tambahkan ke .env.local dari Supabase Dashboard → Project Settings → API → service_role key.',
    );
  }

  if (!globalForSupabase._supabaseAdmin) {
    globalForSupabase._supabaseAdmin = createClient(supabaseUrl!, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return globalForSupabase._supabaseAdmin;
}

// Singleton reset saat hot reload (development only)
if (process.env.NODE_ENV !== 'production') {
  // Tidak perlu reset — createClient memang idempotent
}
