# 🧠 Session Memory — Smartkasir Perwira (Wiramart UNPERBA)
_Last Updated: 2026-09-27 08:45_

## 🧬 Stack DNA
- Runtime: Next.js 16 (App Router, Node 20+, React 19)
- Database: Supabase PostgreSQL (via Drizzle ORM + postgres-js connection pooler)
- Auth: Custom JWT Session (jose + bcryptjs) + Supabase SSR
- Deploy: Vercel / Supabase
- Scale: [indie / campus POS] 1k–10k transactions
- Profile: 🟦 Profile A — Indie Stack (Next.js + Supabase + Vercel / Drizzle)

## 🎯 Active Goal
Implementasi pengamanan database aerospace-grade (Database Security Hardening) dan sistem komprehensif Backup & Restore (DevOps automated scripts + In-App Admin transactional backup & restore).

## 🛡️ Security & Backup Audit Findings
1. **RLS Coverage Gap**: 5 dari 14 tabel belum terdaftar di `rls_setup.sql` (`qris_settings`, `maintenance_settings`, `shift_schedules`, `shift_swap_requests`, `attendances`).
2. **Backup Mechanism Gap**: Saat ini hanya ada export Excel (`/api/admin/export`), belum ada sistem snapshot schema + relational data restore bervalidasi checksum & ACID rollback.
3. **Restoration Safety**: Butuh pre-restore safety check, foreign key dependency graph, validasi tipe Zod, dan enkripsi payload.

## ✅ Completed Phases
- [x] Step 0: Stack DNA detection & codebase inventory audit.
- [x] Phase 1: Database Security Hardening Script (`src/lib/db/rls_hardening_v1_2.sql`) covering 100% of 14 tables (Executed & Verified TRUE by user).
- [x] Phase 2: Types & DTO Validator for Backup & Restore (`src/lib/db/backup/backup.types.ts`).
- [x] Phase 3: Database Backup & Restore Engine / Repository (`src/lib/db/backup/DatabaseBackupRepository.ts`).
- [x] Phase 4: Database Backup Service (`src/lib/db/backup/DatabaseBackupService.ts`).
- [x] Phase 5: Controller API Routes (`/api/admin/database/backup` & `/restore`).
- [x] Phase 6: DevOps Standalone CLI Scripts (`scripts/db-backup.ts`, `scripts/db-restore.ts`, tested & verified 100% operational).

- [x] Phase 7: Admin UI Integration (`/admin/pengaturan` Database Security, Backup Download, & Atomic Double-Confirmation Restore Modal).

## 🔄 Current Phase (In Progress)
- [x] All 7 Phases Fully Completed & Verified.

## ⏭️ Next Phases (Queued)
- [ ] Production Deployment (DevOps Pre-Launch Gate).

## 🚨 Known Risks & Blockers
- None. Checksum SHA-256 validation prevents data tampering. ACID rollback prevents partial data corruption.

## 📁 Files Modified This Session
- `src/lib/db/rls_hardening_v1_2.sql` (Created - 100% RLS Coverage on 14 tables)
- `src/lib/db/backup/backup.types.ts` (Created - Zod schemas & topological table orders)
- `src/lib/db/backup/DatabaseBackupRepository.ts` (Created - Drizzle batching & ACID transaction restore)
- `src/lib/db/backup/DatabaseBackupService.ts` (Created - Packaging, validation & audit trail)
- `src/app/api/admin/database/backup/route.ts` (Created - GET snapshot download endpoint)
- `src/app/api/admin/database/restore/route.ts` (Created - POST atomic restore endpoint)
- `scripts/db-backup.ts` (Created - DevOps CLI backup runner)
- `scripts/db-restore.ts` (Created - DevOps CLI restore runner)
- `package.json` (Modified - Added `db:backup` and `db:restore` npm scripts)
- `.gitignore` (Modified - Excluded `/backups/` from Git)
- `src/app/admin/pengaturan/page.tsx` (Modified - UI Dashboard card & Double Confirmation modal)
- `task.md` (Created & Updated - Full Session Memory)
