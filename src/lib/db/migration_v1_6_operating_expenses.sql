-- =============================================================
-- Migration v1.6 — Biaya Operasional (Laporan Laba Bersih)
--
-- Laba Bersih = Laba Kotor − Biaya Operasional. Tabel ini menyimpan
-- biaya yang dicatat Admin/Dosen (listrik, plastik, honor, kerugian
-- barang expired/rusak, fee QRIS/bank, dll).
--
-- ADITIF & AMAN DIULANG:
--   • Tabel baru; tidak menyentuh tabel/baris yang ada.
--   • amount = BILANGAN BULAT rupiah (hindari desimal untuk uang).
--   • Kategori = varchar + CHECK (bukan enum PG → mudah ditambah, lihat 17.4).
--   • Soft-delete (deleted_at) — data keuangan tidak di-hard-delete.
--   • RLS aktif + policy deny anon/authenticated + hak publik dicabut
--     (aturan N10: tabel baru di schema public WAJIB begini).
--
-- ROLLBACK:  DROP TABLE IF EXISTS public.operating_expenses;
-- =============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.operating_expenses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tanggal bisnis biaya (WIB). Menentukan masuk ke laporan hari mana.
  expense_date          date         NOT NULL,
  category              varchar(30)  NOT NULL,
  description           varchar(200) NOT NULL,
  amount                integer      NOT NULL,
  created_by_admin_id   uuid         NOT NULL REFERENCES public.admins(id),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by_admin_id   uuid REFERENCES public.admins(id),
  delete_reason         varchar(200),
  CONSTRAINT operating_expenses_amount_check
    CHECK (amount > 0 AND amount <= 100000000),
  CONSTRAINT operating_expenses_category_check
    CHECK (category IN ('LISTRIK','PLASTIK_KEMASAN','HONOR','SEWA','TRANSPORT',
                        'KERUGIAN_BARANG','FEE_QRIS_BANK','LAINNYA')),
  -- soft-delete harus lengkap: kalau dihapus, ada pelaku & alasan
  CONSTRAINT operating_expenses_delete_check
    CHECK (deleted_at IS NULL OR (deleted_by_admin_id IS NOT NULL AND delete_reason IS NOT NULL))
);

-- Laporan selalu memfilter per rentang tanggal + hanya yang belum dihapus
CREATE INDEX IF NOT EXISTS idx_opex_date_active
  ON public.operating_expenses (expense_date)
  WHERE deleted_at IS NULL;

-- ── Keamanan (N10) ───────────────────────────────────────────
ALTER TABLE public.operating_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sk_opex_deny_anon"          ON public.operating_expenses;
DROP POLICY IF EXISTS "sk_opex_deny_authenticated" ON public.operating_expenses;
CREATE POLICY "sk_opex_deny_anon"          ON public.operating_expenses FOR ALL TO anon          USING (false);
CREATE POLICY "sk_opex_deny_authenticated" ON public.operating_expenses FOR ALL TO authenticated USING (false);

REVOKE ALL ON TABLE public.operating_expenses FROM anon, authenticated;

COMMIT;
