-- =============================================================
-- Smartkasir Perwira — Migration v1.1
-- Tambah: shift_swap_requests, attendances
-- Tambah: enum swap_status, attendance_status
--
-- CARA PAKAI: Supabase Dashboard → SQL Editor → Run
-- ROLLBACK:   Jalankan rollback_v1_1.sql jika ada masalah
-- =============================================================

-- ── ENUM: Status pengajuan pindah shift ───────────────────────
CREATE TYPE swap_status AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

-- ── ENUM: Status kehadiran ─────────────────────────────────────
CREATE TYPE attendance_status AS ENUM (
  'HADIR',
  'TELAT',
  'IJIN',
  'TIDAK_HADIR',
  'PENGGANTI'
);

-- ── TABEL: shift_swap_requests ─────────────────────────────────
-- Pengajuan pindah shift oleh mahasiswa, disetujui dosen
CREATE TABLE public.shift_swap_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id         UUID NOT NULL REFERENCES public.employees(id),
  from_schedule_id     UUID NOT NULL REFERENCES public.shift_schedules(id),
  to_schedule_id       UUID NOT NULL REFERENCES public.shift_schedules(id),
  reason               TEXT NOT NULL,
  status               swap_status NOT NULL DEFAULT 'PENDING',
  reviewed_by_admin_id UUID REFERENCES public.admins(id),
  reviewed_at          TIMESTAMPTZ,
  admin_note           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index untuk dashboard admin: tampilkan pending request terbaru
CREATE INDEX idx_swap_status_created  ON public.shift_swap_requests (status, created_at DESC);
-- Index untuk history swap per mahasiswa
CREATE INDEX idx_swap_requester       ON public.shift_swap_requests (requester_id, created_at DESC);

-- ── TABEL: attendances ─────────────────────────────────────────
-- Rekap kehadiran: 1 row = 1 mahasiswa × 1 jadwal × 1 tanggal
CREATE TABLE public.attendances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID        NOT NULL REFERENCES public.employees(id),
  schedule_id           UUID        NOT NULL REFERENCES public.shift_schedules(id),
  -- Tanggal spesifik, bukan hanya hari (krusial untuk laporan bulanan)
  attendance_date       DATE        NOT NULL,
  status                attendance_status NOT NULL,
  -- Linked ke sesi login aktual (NULL untuk TIDAK_HADIR / IJIN)
  shift_id              UUID        REFERENCES public.shifts(id),
  clock_in_actual       TIMESTAMPTZ,
  clock_out_actual      TIMESTAMPTZ,
  -- Menit keterlambatan (0 jika tepat waktu)
  late_minutes          INTEGER     NOT NULL DEFAULT 0,
  notes                 TEXT,
  -- NULL jika auto-generated saat login, diisi jika dosen input manual
  recorded_by_admin_id  UUID        REFERENCES public.admins(id),
  -- Jika status = PENGGANTI, ref ke swap yang menyebabkannya
  from_swap_request_id  UUID        REFERENCES public.shift_swap_requests(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE: 1 mahasiswa hanya 1 record per jadwal per tanggal
CREATE UNIQUE INDEX idx_attendance_unique
  ON public.attendances (employee_id, schedule_id, attendance_date);

-- Index untuk laporan harian dosen
CREATE INDEX idx_attendance_date
  ON public.attendances (attendance_date, status);

-- Index untuk riwayat kehadiran per mahasiswa
CREATE INDEX idx_attendance_employee
  ON public.attendances (employee_id, attendance_date DESC);

-- ── RLS: Aktifkan proteksi di tabel baru ──────────────────────
ALTER TABLE public.shift_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sk_swap_deny_anon"           ON public.shift_swap_requests FOR ALL TO anon          USING (false);
CREATE POLICY "sk_swap_deny_authenticated"  ON public.shift_swap_requests FOR ALL TO authenticated USING (false);
CREATE POLICY "sk_attend_deny_anon"         ON public.attendances          FOR ALL TO anon          USING (false);
CREATE POLICY "sk_attend_deny_authenticated"ON public.attendances          FOR ALL TO authenticated USING (false);

-- ── Verifikasi ─────────────────────────────────────────────────
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('shift_swap_requests', 'attendances')
ORDER BY tablename;
-- Hasil yang benar: kedua baris rls_enabled = true
