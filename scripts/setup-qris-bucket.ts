// Setup idempoten bucket Supabase Storage 'qris' (public, 2MB, PNG/JPG) + uji upload.
// Usage: npx tsx --env-file=.env.local scripts/setup-qris-bucket.ts
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'qris';
const OPTIONS = {
  public: true,
  fileSizeLimit: 2 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Env Supabase tidak lengkap.');

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: buckets, error: listErr } = await sb.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets: ${listErr.message}`);

  if (buckets.some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.updateBucket(BUCKET, OPTIONS);
    if (error) throw new Error(`updateBucket: ${error.message}`);
    console.log(`[OK] Bucket "${BUCKET}" sudah ada — konfigurasi disamakan.`);
  } else {
    const { error } = await sb.storage.createBucket(BUCKET, OPTIONS);
    if (error) throw new Error(`createBucket: ${error.message}`);
    console.log(`[OK] Bucket "${BUCKET}" berhasil dibuat.`);
  }

  // Uji end-to-end: upload -> public URL -> fetch -> hapus
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const { error: upErr } = await sb.storage.from(BUCKET).upload('__diag__.png', png, { contentType: 'image/png', upsert: true });
  if (upErr) throw new Error(`Uji upload GAGAL: ${upErr.message}`);

  const { data } = sb.storage.from(BUCKET).getPublicUrl('__diag__.png');
  const res = await fetch(data.publicUrl);
  console.log(`[TEST] Upload OK | Public URL HTTP ${res.status} (${res.headers.get('content-type')})`);

  await sb.storage.from(BUCKET).remove(['__diag__.png']);
  console.log('[TEST] Cleanup OK');
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => { console.error('[ERROR]', e instanceof Error ? e.message : String(e)); process.exit(1); });
