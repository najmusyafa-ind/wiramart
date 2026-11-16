-- =============================================================
-- Smartkasir Perwira (Wiramart UNPERBA)
-- Migration v4.2: Bersihkan Foreign Key Constraint Duplikat di Schema `public`
--
-- TUJUAN:
--   Menghapus constraint FOREIGN KEY duplikat yang menumpuk pada pasangan
--   (tabel, kolom -> tabel_induk, kolom_induk) yang sama akibat riwayat
--   migrasi bertahap (`*_fkey` / Drizzle `*_fk` vs constraint kanonik `fk_*`).
--
-- DAMPAK OPERASIONAL:
--   - NOL dampak fungsional pada operasional kasir/POS/gudang: seluruh relasi
--     FK unik tetap aktif 100% (73 pasang di Production, 62 pasang di Staging).
--   - Mengutamakan constraint kanonik (`fk_*`) serta aturan `ON DELETE`
--     yang aman (`RESTRICT`/`SET NULL`/`CASCADE` dibanding `NO ACTION`).
--   - Merapikan definisi constraint & garis Schema Visualizer Supabase.
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  unique_before INTEGER;
  unique_after  INTEGER;
  total_after   INTEGER;
  rec RECORD;
BEGIN
  SELECT count(DISTINCT (conrelid, conkey, confrelid, confkey))::int
  INTO unique_before
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
    AND contype = 'f';

  FOR rec IN
    WITH ranked AS (
      SELECT
        cl.relname AS table_name,
        c.conname,
        ROW_NUMBER() OVER (
          PARTITION BY c.conrelid, c.conkey, c.confrelid, c.confkey
          ORDER BY
            CASE WHEN c.conname = 'fk_transaction_items_discount_policy' THEN 0
                 WHEN c.conname LIKE 'fk\_%' ESCAPE '\' THEN 1
                 ELSE 2
            END,
            CASE c.confdeltype
              WHEN 'r' THEN 0  -- RESTRICT paling protektif
              WHEN 'n' THEN 1  -- SET NULL eksplisit
              WHEN 'c' THEN 2  -- CASCADE eksplisit
              ELSE 3           -- NO ACTION default
            END,
            c.conname ASC
        ) AS rn
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      WHERE c.connamespace = 'public'::regnamespace
        AND c.contype = 'f'
    )
    SELECT table_name, conname
    FROM ranked
    WHERE rn > 1
    ORDER BY table_name, conname
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', rec.table_name, rec.conname);
  END LOOP;

  SELECT
    count(*)::int,
    count(DISTINCT (conrelid, conkey, confrelid, confkey))::int
  INTO total_after, unique_after
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
    AND contype = 'f';

  IF unique_after <> unique_before THEN
    RAISE EXCEPTION 'Migrasi v4.2 dibatalkan: pasangan FK unik berubah dari % menjadi %',
      unique_before, unique_after;
  END IF;

  IF total_after <> unique_after THEN
    RAISE EXCEPTION 'Migrasi v4.2 dibatalkan: masih tersisa duplikat FK (total=% vs unik=%)',
      total_after, unique_after;
  END IF;
END;
$$;

COMMIT;
