// =============================================================
// Migration v3.5: Tabel Suppliers (Wiramart v3.0 - Fase 5)
// STANDAR: Zero-Trust, Idempotent, Additive-Only, RLS Enabled
// =============================================================

import { db } from '../src/lib/db/client';
import { sql } from 'drizzle-orm';

async function migrate() {
  console.log('🚀 Menjalankan migrasi tabel suppliers...');

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public.suppliers (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                VARCHAR(200) NOT NULL,
      contact_person      VARCHAR(200),
      phone               VARCHAR(30),
      address             TEXT,
      notes               TEXT,
      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_admin_id UUID REFERENCES public.admins(id),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_suppliers_name
      ON public.suppliers(name)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_suppliers_active
      ON public.suppliers(is_active)
      WHERE deleted_at IS NULL;

    -- RLS Security
    ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "sk_suppliers_deny_anon" ON public.suppliers;
    CREATE POLICY "sk_suppliers_deny_anon" ON public.suppliers FOR ALL TO anon USING (false);

    REVOKE ALL ON TABLE public.suppliers FROM anon;
  `);

  // Masukkan supplier default/seed jika masih kosong
  const checkSeed: any = await db.execute(sql`SELECT count(*)::int as count FROM public.suppliers`);
  if (checkSeed[0]?.count === 0) {
    console.log('🌱 Melakukan seeding data supplier awal...');
    await db.execute(sql`
      INSERT INTO public.suppliers (name, contact_person, phone, address, notes)
      VALUES
        ('Koperasi Mahasiswa UNPERBA', 'Divisi Pengadaan', '081234567890', 'Gedung Rektorat UNPERBA', 'Supplier internal kampus'),
        ('Agen Sembako Berkah Jaya', 'Pak Haji Joko', '082198765432', 'Pasar Segamas Purbalingga', 'Gula, minyak, beras, mie instan'),
        ('Distributor Snack & Minuman Perwira', 'Mbak Rina', '085712345678', 'Jl. Letjen S. Parman Purbalingga', 'Aneka snack basah, keripik, minuman kemasan')
      ON CONFLICT DO NOTHING;
    `);
  }

  const result = await db.execute(sql`SELECT id, name, is_active FROM public.suppliers LIMIT 5`);
  console.log('✅ Migrasi tabel suppliers sukses! Data:', result);
  process.exit(0);
}

migrate().catch((err) => {
  console.error('❌ Gagal migrasi tabel suppliers:', err);
  process.exit(1);
});
