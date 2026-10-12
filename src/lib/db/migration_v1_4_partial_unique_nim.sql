-- =============================================================
-- Migration v1.4: Partial Unique Index on employees(nim)
-- Menghilangkan constraint unik unconditional yang memblokir
-- pendaftaran ulang karyawan yang sebelumnya di-soft-delete.
-- =============================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_nim_program_studi_key;
DROP INDEX IF EXISTS idx_employees_nim_unique;
CREATE UNIQUE INDEX idx_employees_nim_unique ON employees (nim) WHERE (deleted_at IS NULL);
