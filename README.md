# 🏪 Smartkasir Perwira — Ekosistem Digital Wiramart UNPERBA

![Next.js](https://img.shields.io/badge/Next.js-16.4.3-black?logo=next.js)
![React](https://img.shields.io/badge/React-19.2.8-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x_Strict-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/PostgreSQL-Supabase_RLS-3ECF8E?logo=supabase&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?logo=drizzle&logoColor=black)
![Vercel](https://img.shields.io/badge/Deploy-Vercel_Serverless-black?logo=vercel)

Sistem Point of Sale (POS), Manajemen Gudang Terintegrasi (FEFO), Pesanan Online & Delivery Kampus (PWA), serta Pelaporan Keuangan Akuntabel untuk **UKM Kewirausahaan (Wiramart) Universitas Perwira Purbalingga (UNPERBA)**.

> 📌 **Untuk AI Agent & Kontributor Baru:** Wajib membaca [`AGENTS.md`](./AGENTS.md) dan [`CLAUDE.md`](./CLAUDE.md) sebelum mengubah satu baris kode pun. Dokumentasi visual arsitektur, ERD, role, dan workflow tersedia di Obsidian Vault (`../Wiramart-Vault`).

---

## ✨ Fitur Utama (Production-Ready)

| Modul | Cakupan Fitur |
|---|---|
| **🛒 Terminal POS Kasir (`/kasir/pos`)** | Transaksi **CASH**, **QRIS**, dan **SPLIT Payment**; pemindai barcode kamera/USB; deteksi otomatis barcode diskon FEFO (`DISC-...`); idempotensi checkout (`Idempotency-Key`); pengurangan stok atomik anti-oversell (`stock_qty - n WHERE stock_qty >= n`). |
| **🔐 Multi-Role & Triple Session** | 3 cookie sesi HttpOnly independen (`sk_admin`, `sk_kasir`, `sk_buyer`) yang dapat aktif bersamaan di satu browser. Memisahkan hak akses **Manager (Dosen)**, **Admin Shift**, **Kasir**, **Petugas Gudang**, **CS/Runner**, dan **Buyer**. |
| **⏱️ Manajemen Shift & Blind Count** | Buka shift dengan Modal Awal Paten Rp 100.000, pencatatan Kas Gerak (`CASH_IN`/`CASH_OUT`), cut-off makanan basah pukul 15:00 WIB, tutup shift dengan *Blind Count* (tanpa membocorkan ekspektasi kas sistem), deteksi anomali `FRAUD_CASH_SUSPICIOUS`, dan cron `auto-close-shift`. |
| **📅 Jadwal, Absensi & Tukar Shift** | Presensi real-time (`HADIR`, `TELAT`, `IJIN`, `TIDAK_HADIR`, `PENGGANTI`) dengan pembagian peran per shift. Pengajuan tukar shift terstruktur (maks 3x/7 hari) dengan persetujuan rekan & validasi Admin. |
| **📦 Gudang & Batch FEFO (`/kasir/gudang`)** | Pemisahan tugas (*Separation of Duty*): Gudang membuat draft penerimaan barang masuk (`DRAFT` → `SUBMITTED`), stok baru bertambah secara **ACID** hanya setelah di-ACC **Manager** (`APPROVED`) dan membentuk batch di `stock_batches`. |
| **⏳ FEFO Radar & Diskon Darurat** | Pemindaian otomatis (Cron 06:00 WIB & tombol manual) untuk batch mendekati kedaluwarsa (`H1_KRITIS`, `H3_URGENT`, `H5_WARNING`, `H7_WATCH`). Laporan kondisi fisik ke `product_condition_reports`, keputusan eksklusif Manager (`DISCOUNT`, `DISPLAY_FRONT`, `DESTROY`, `RETURN_SUPPLIER`, `HOLD`), dan pencetakan barcode override `DISC-...`. |
| **🚚 Pesanan Online & Delivery PWA (`/order`)** | Katalog publik kampus, checkout Pickup (Lantai 1) atau Delivery (Lantai 2 = Rp 1.000; Lantai 3, 4, Auditorium = Rp 2.000), pembayaran QRIS/Transfer, konfirmasi Admin Shift, penugasan CS Runner, serta verifikasi serah terima berbasis **PIN 6 digit** & proteksi *no-show* 2x. |
| **👔 Manager on Duty (MOD) & Closing Harian** | Kewajiban Check-In MOD harian sebelum Manager mengeksekusi approval gudang, rekonsiliasi QRIS, serta sign-off penutupan hari operasional (`daily_closings`). |
| **📊 Laporan Keuangan & Bagi Hasil 50%** | Satu sumber kebenaran kalkulasi di `src/lib/finance/report.ts` (Harian, Mingguan, Bulanan, Semesteran/6-Bulanan). Menghitung Omzet, HPP Terjual, Biaya Operasional + Biaya Paten, **Pool Mahasiswa (50%)**, dan **Laba Bersih Hak Toko**, lengkap dengan ekspor Excel Multi-Sheet. |
| **🛡️ Backup & Restore Database** | Mesin snapshot skema & data relasional bervalidasi checksum SHA-256 dan transaksi ACID rollback — tersedia melalui antarmuka `/admin/pengaturan` maupun CLI (`npm run db:backup` / `npm run db:restore`). |

---

## 🛠️ Tech Stack & Arsitektur

| Lapisan | Teknologi |
|---|---|
| **Framework** | **Next.js 16.4.3** (App Router, React 19.2.8, Node.js 20+ Runtime) — menggunakan `src/proxy.ts` sebagai pengganti `middleware.ts` |
| **Bahasa & Validasi** | TypeScript Strict Mode + **Zod** (100% validasi DTO runtime di setiap endpoint) |
| **Database & ORM** | **Supabase PostgreSQL** (33 tabel dengan **100% Row-Level Security / RLS**) + **Drizzle ORM** (`src/lib/db/schema.ts`) |
| **Autentikasi** | Custom JWT (`jose` + `bcryptjs` 12 rounds) di dalam Cookie `HttpOnly`, `SameSite=Lax` |
| **Styling & UI** | Vanilla CSS Design System berbasis token HSL (`src/app/globals.css`) + Lucide React Icons |
| **Integrasi Eksternal** | WhatsApp Gateway **Fonnte** (*fire-and-forget* + pencatatan di `notification_logs`), Supabase Storage (`product-images`, `payment-proofs`) |
| **Deployment** | **Vercel** + **Vercel Cron** (`scan-fefo`, `expire-orders`, `auto-close-shift`) |

---

## 📂 Struktur Direktori Aktual

```text
app/
├── src/
│   ├── proxy.ts                 # Gatekeeper Next.js 16 (Maintenance gate + JWT role guard)
│   ├── app/
│   │   ├── admin/               # Dashboard Admin Shift & Manager
│   │   │   ├── absensi/         # Rekap presensi & kuota peran shift
│   │   │   ├── dashboard/       # Ringkasan metrik harian & grafik
│   │   │   ├── export/          # Ekspor laporan Excel (.xlsx)
│   │   │   ├── gudang-approval/ # Antrian ACC penerimaan barang & keputusan FEFO (Manager)
│   │   │   ├── jadwal/          # Manajemen template jadwal shift mingguan
│   │   │   ├── karyawan/        # Master data karyawan mahasiswa & PIN
│   │   │   ├── laporan/         # Laporan keuangan, biaya operasional & mutasi stok
│   │   │   ├── pengaturan/      # QRIS, Maintenance Mode, Backup & Restore DB
│   │   │   ├── pesanan-online/  # Verifikasi pesanan online & penugasan CS Runner
│   │   │   ├── produk/          # Master produk, koreksi stok opname & usulan produk
│   │   │   ├── qris/            # Rekonsiliasi mutasi QRIS harian
│   │   │   ├── restock/         # Peringatan stok menipis
│   │   │   └── swap-request/    # Persetujuan tukar shift karyawan
│   │   ├── kasir/               # Terminal Operasional Karyawan
│   │   │   ├── gudang/          # Antarmuka Petugas Gudang (Draft masuk, FEFO Radar, Scan)
│   │   │   ├── pengiriman/      # Antarmuka CS Runner (Antar pesanan & input PIN 6 digit)
│   │   │   ├── pos/             # Terminal Kasir Utama (Transaksi, Buka/Tutup Shift, Kas Gerak)
│   │   │   ├── produk/          # Pengajuan usulan produk baru oleh kasir
│   │   │   ├── rekap/           # Ringkasan transaksi shift aktif
│   │   │   ├── riwayat/         # Jejak struk transaksi shift
│   │   │   └── tukar-shift/     # Form pengajuan tukar jadwal shift
│   │   ├── order/               # PWA Pembeli Online Kampus (Katalog, Checkout, Status/PIN)
│   │   ├── api/                 # Route Handlers (Controller tipis: Zod + delegasi Service)
│   │   │   ├── admin/           # Endpoint Admin & Manager
│   │   │   ├── auth/            # Login Admin, Kasir, Gudang, Karyawan, Setup PIN, Logout
│   │   │   ├── cron/            # scan-fefo, expire-orders, auto-close-shift
│   │   │   ├── gudang/          # Endpoint draft penerimaan & laporan kondisi FEFO
│   │   │   ├── kasir/           # Endpoint transaksi POS, shift, kas gerak, sisa makanan
│   │   │   ├── order/           # Endpoint katalog, registrasi/login buyer & checkout online
│   │   │   └── publik/          # Endpoint publik jadwal & status presensi
│   │   ├── login/               # Halaman Login Admin Shift & Manager
│   │   ├── daftar/              # Registrasi mandiri karyawan baru
│   │   ├── setup/               # Inisialisasi akun Admin pertama kali
│   │   └── maintenance/         # Layar mode pemeliharaan sistem
│   ├── features/                # Modul domain terisolasi (order, gudang, kasir)
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.ts        # Single Source of Truth skema Drizzle (33 tabel)
│   │   │   ├── migration_*.sql  # Migrasi SQL bertahap & idempoten (v1.1 s/d v3.1)
│   │   │   ├── rls_*.sql        # Kebijakan Row-Level Security 100% tabel
│   │   │   └── backup/          # Engine Backup & Restore bervalidasi SHA-256
│   │   ├── finance/
│   │   │   └── report.ts        # Kalkulasi baku Omzet, HPP, Pool 50%, dan Laba Bersih
│   │   ├── services/            # Business Logic Layer (FEFO, StockReceive, MOD, Recap)
│   │   └── utils/
│   │       ├── auth.ts          # Sign/Verify JWT, Triple Session Cookie & Role Guards
│   │       └── rate-limit.ts    # Sliding Window Rate Limiter (InMemory + Redis Adapter Slot)
│   └── components/              # Komponen UI bersama (Navbar, BarcodeScanner, Modal)
├── docs/                        # Dokumen PRD v2.0, v3.0, v4.0, Alur Gudang & SOP Harian
├── scripts/                     # Skrip CLI DevOps (db-backup.ts, db-restore.ts, cek-demo.ts)
├── AGENTS.md                    # Hukum arsitektur & domain wajib bagi AI Agent
├── CLAUDE.md                    # Instruksi cepat untuk Claude / AI Pair Programmer
└── package.json
```

---

## ⚙️ Variabel Lingkungan (`.env.local`)

Salin `.env.example` menjadi `.env.local` dan lengkapi variabel berikut:

```env
# --- SUPABASE PUBLIC ---
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key

# --- DATABASE POSTGRESQL (WAJIB Transaction Pooler port 6543 di Vercel) ---
DATABASE_URL=postgresql://postgres.[project-id]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# --- KEAMANAN & AUTENTIKASI ---
JWT_SECRET=minimal-32-karakter-acak-kriptografis
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key
CRON_SECRET=secret-untuk-otorisasi-vercel-cron

# --- IDENTITAS APLIKASI ---
NEXT_PUBLIC_APP_NAME=wiramart
NEXT_PUBLIC_APP_URL=http://localhost:3000

# --- OPSIONAL: WHATSAPP GATEWAY FONNTE ---
FONNTE_API_KEY=your-fonnte-api-key
FONNTE_DEVICE_TOKEN=your-fonnte-device-token
```

---

## 🚀 Panduan Instalasi & Pengembangan Lokal

### 1. Instalasi Dependensi
```bash
cd app
npm install
```

### 2. Konfigurasi Database (Migrasi Bertahap)
> ⛔ **PERINGATAN KERAS:** `npm run db:push` telah **dinonaktifkan secara permanen** untuk mencegah penghapusan/penimpaan skema produksi.

Jalankan migrasi melalui Drizzle Kit:
```bash
npm run db:migrate
```
Atau eksekusi berkas SQL secara berurutan di **Supabase SQL Editor**:
1. `src/lib/db/migration_v1_1_jadwal_piket.sql` hingga `migration_v3_1_transaction_logs.sql` (semua bersifat *idempotent* `IF NOT EXISTS`).
2. `src/lib/db/rls_setup.sql` diikuti `src/lib/db/rls_hardening_v1_2.sql`.

### 3. Menjalankan Server Development
```bash
npm run dev
```
Buka `http://localhost:3000`:
- **Setup Awal Admin:** `/setup` (hanya aktif bila tabel `admins` masih kosong)
- **Portal Admin & Manager:** `/login`
- **Terminal Kasir, Gudang & Absensi:** `/kasir/login`
- **Katalog & Pesanan Online Kampus:** `/order`

---

## 📜 Daftar Perintah (`package.json`)

| Perintah | Deskripsi |
|---|---|
| `npm run dev` | Menjalankan server pengembangan Next.js 16 |
| `npm run build` | Membangun bundel produksi |
| `npm run start` | Menjalankan server produksi hasil build |
| `npm run lint` | Memeriksa kualitas kode dengan ESLint |
| `npm run db:generate` | Menghasilkan berkas migrasi SQL dari perubahan `schema.ts` |
| `npm run db:migrate` | Menjalankan migrasi database secara aman |
| `npm run db:studio` | Membuka antarmuka visual Drizzle Studio |
| `npm run db:backup` | Membuat cadangan penuh database via CLI (`scripts/db-backup.ts`) |
| `npm run db:restore` | Memulihkan database dari berkas backup terenkripsi/checksum |
| `npm run demo:cek` | Memverifikasi koneksi dan kesiapan data demo |
| `npm run test` | Menjalankan pengujian otomatis TCL transaksi & invarian keuangan |

---

## 📚 Dokumentasi Terkait

- **Aturan AI & Arsitektur Kode:** [`AGENTS.md`](./AGENTS.md) · [`CLAUDE.md`](./CLAUDE.md)
- **Dokumen Spesifikasi (PRD & SOP):**
  - [`docs/SOP_Operasional_Wiramart.md`](./docs/SOP_Operasional_Wiramart.md) — SOP mutlak seluruh petugas shift
  - [`docs/PRD_Wiramart_v2.0.md`](./docs/PRD_Wiramart_v2.0.md) — Spesifikasi Online Order & Delivery PWA
  - [`docs/PRD_Wiramart_v3.0_Gudang.md`](./docs/PRD_Wiramart_v3.0_Gudang.md) — Spesifikasi Gudang, Batch FEFO & Diskon Darurat
  - [`docs/Alur_Gudang_PRDv3.md`](./docs/Alur_Gudang_PRDv3.md) — Panduan end-to-end alur gudang & Manager approval
  - [`docs/PRD_Wiramart_v4.0_Kasir_OAuth.md`](./docs/PRD_Wiramart_v4.0_Kasir_OAuth.md) — Spesifikasi Rekap Kasir & rencana Google OAuth (`@student.unperba.ac.id`)
  - [`docs/rekap_masukan_manajer_implementasi.md`](./docs/rekap_masukan_manajer_implementasi.md) — Keputusan arsitektur & rumus baku keuangan
- **Obsidian Knowledge Graph:** Buka folder `../Wiramart-Vault` sebagai vault di Obsidian untuk menelusuri peta arsitektur, ERD 33 tabel, 7 role, dan 11 workflow operasional secara visual.

---

**Dibangun untuk UKM Kewirausahaan (Wiramart) — Universitas Perwira Purbalingga (UNPERBA)**
