// =============================================================
// Durable Payment Proof URL Resolver (Sign-On-Read)
// Menyimpan path permanen "storage:payment-proofs/<filename>" di DB
// lalu men-generate fresh signed URL 2 jam saat dibaca oleh Buyer/Admin.
// Backward-compatible dengan URL https:// lama.
// =============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server';

const STORAGE_PREFIX = 'storage:payment-proofs/';
const SIGNED_URL_TTL_SECONDS = 7200; // 2 jam

export function toDurableProofRef(storagePath: string): string {
  return `${STORAGE_PREFIX}${storagePath.replace(/^\/+/, '')}`;
}

export async function resolvePaymentProofUrl(rawUrl: string | null): Promise<string | null> {
  if (!rawUrl) return null;
  if (!rawUrl.startsWith(STORAGE_PREFIX)) {
    return rawUrl;
  }
  const objectPath = rawUrl.slice(STORAGE_PREFIX.length);
  if (!objectPath) return null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
