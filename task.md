# 🧠 Session Memory — Smartkasir Perwira (Wiramart UNPERBA)
_Last Updated: 2026-11-12 11:50 WIB_

## 🧬 Stack DNA
- **Runtime:** Next.js 16.4.3 (App Router, Node 20+, React 19.2.8) — `src/proxy.ts` menggantikan `middleware.ts`
- **Database:** Supabase PostgreSQL (33 tabel via Drizzle ORM `src/lib/db/schema.ts` + 100% RLS)
- **Auth:** Custom JWT Session (`jose` + `bcryptjs` 12 rounds) — Triple Cookie Session (`sk_admin`, `sk_kasir`, `sk_buyer`)
- **Deploy:** Vercel + Vercel Cron (`scan-fefo`, `expire-orders`, `auto-close-shift`)
- **Scale:** [indie / campus POS] 1k–10k transactions
- **Profile:** 🟦 Profile A — Indie Stack (Next.js + Supabase + Vercel / Drizzle)

## 🎯 Active Goal
Harmonisasi dokumentasi arsitektur penuh (Obsidian Vault 32 file, `AGENTS.md`, `CLAUDE.md`, `README.md`, dan sinkronisasi `docs/PRD_*` terhadap Single Source of Truth `schema.ts`), siap menuju Production Deployment Gate.

## ✅ Completed Milestones (v1.0 → v4.0)
- [x] **POS Kasir & Shift v1.x:** Transaksi atomik (`stock_qty - n WHERE stock_qty >= n`), Split Payment (`CASH`/`QRIS`), Idempotency-Key (`idx_trx_employee_idempotency`), Modal Awal Paten Rp 100.000, Blind Count Tutup Shift, Kas Gerak, Cut-Off Makanan Basah 15:00 WIB, dan Auto-Close Shift Cron.
- [x] **Database Security & Backup Engine v1.2:** RLS Hardening 100% tabel, SHA-256 Checksum Snapshot Backup & Atomic ACID Restore (`scripts/db-backup.ts`, `scripts/db-restore.ts`, `/admin/pengaturan`).
- [x] **Historical Data Ingestion (Buku Kas SiDU):** 684 Transaksi Selesai (15 Ags s/d 18 Sep 2026), Total Omzet Rp 3.755.500, Triple Integrity Check 100% PASSED ✅.
- [x] **Pesanan Online & Delivery PWA v2.0 (`/order`):** Katalog publik, registrasi/login Buyer, kalkulasi ongkir server-side (`DELIVERY_FEE_MAP`: L1=Rp0, L2=Rp1.000, L3/L4/99=Rp2.000), konfirmasi Admin Shift, penugasan CS Runner, verifikasi PIN 6 digit & proteksi No-Show 2x.
- [x] **Gudang Terintegrasi, Batch FEFO & MOD v3.0:** Separation of Duty (`employees.jabatan='gudang'` vs `admins.adminRole='MANAGER'`), Draft Penerimaan Barang (`DRAFT` → `SUBMITTED` → `APPROVED`/`REVISED`/`REJECTED`), FEFO Radar (`product_condition_reports`), Keputusan Manager (`DISCOUNT`/`DISPLAY_FRONT`/`DESTROY`/`RETURN_SUPPLIER`/`HOLD`), Barcode Override (`DISC-...`), serta Manager on Duty (MOD) Check-In & Sign-Off Closing Harian.
- [x] **Rekap Kasir v4.0 (F1) & Laporan Keuangan Baku (`src/lib/finance/report.ts`):** Rumus tunggal Omzet, HPP Terjual, Biaya Operasional + Biaya Paten, Pool Mahasiswa 50%, dan Laba Bersih Hak Toko.
- [x] **Obsidian Knowledge Graph (`../Wiramart-Vault`) & AI Governance (`AGENTS.md` + `CLAUDE.md`):**
  - 32 berkas markdown terhubung (`00 - MOC Wiramart`, `01 - Arsitektur`, `02 - Role`, `03 - Workflow`, `04 - PRD Asli`, `Catatan Inkonsistensi`).
  - Seluruh 9 inkonsistensi dokumen vs kode telah diverifikasi dan diselaraskan ke `schema.ts` & `order.types.ts`.
  - `AGENTS.md` & `CLAUDE.md` telah diisi aturan arsitektur, zero-trust security, dan domain bisnis Wiramart.
  - `README.md` telah ditulis ulang sesuai kondisi produksi Next.js 16.4.3, dan `task.md` lama di root telah diarsipkan ke `_arsip/task_lama_sept2026.md`.

## ⏭️ Next Phases (Queued)
- [ ] **Migrasi Fase 2 (D8):** Tambahkan partial unique index `(employee_id) WHERE status = 'ACTIVE'` pada tabel `shifts` (saat ini sudah dijaga di application layer).
- [ ] **Opsional — PRD v4.0 F2:** Implementasi endpoint `/api/auth/google/*` untuk login kasir via `@student.unperba.ac.id` bila dibutuhkan.
- [ ] **Production Deployment Gate:** Verifikasi final environment variables di Vercel & jadwal Vercel Cron.
