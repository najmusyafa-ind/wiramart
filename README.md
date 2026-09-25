# 🛍️ Smartkasir Perwira — Sistem Kasir Digital UNPERBA

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?style=flat&logo=supabase)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)

**Smartkasir Perwira** adalah sistem Point of Sale (POS) modern, cepat, dan terotomasi yang dirancang khusus untuk ekosistem kampus **Universitas Perwira M. Purbalingga (UNPERBA)**. Sistem ini menghubungkan manajemen kasir kantin/koperasi kampus dengan sistem kerja mahasiswa (part-time / student staff) dan pengawasan dosen/admin secara real-time.

---

## ✨ Fitur Unggulan

### 1. 🛒 POS & Transaksi Cepat
- **Pencarian Produk & Barcode Scanner**: Scan barcode kamera atau input manual kode barcode produk.
- **Keranjang Belanja Realtime**: Penyesuaian kuantitas, kalkulasi subtotal, diskon, dan pajak otomatis.
- **Multi-Payment**: Mendukung pembayaran Tunai (Cash dengan hitung kembalian cepat) dan QRIS.
- **Cetak Struk**: Format struk standar kasir belanja.

### 2. 🔐 Dual-Role Registrasi Mandiri (Self-Service Onboarding)
- **Dosen / Admin**: Registrasi langsung menggunakan **NIDN** dan password. Tidak memerlukan input manual oleh developer — akun langsung aktif dan siap digunakan.
- **Mahasiswa / Siswi (Kasir)**: Registrasi mandiri menggunakan **Nama Lengkap**, **NIM Wajib 8 Digit**, dan pilihan Program Studi.
- **Role Developer**: Bersifat observer murni (mantau arus keluar-masuk kasir, audit log, dan status sistem secara otomatis via Supabase).

### 3. ⏱️ Manajemen Shift & Slot Jadwal Terkunci
- **Pemilihan Slot Shift**: Mahasiswa memilih jadwal shift (Pagi / Siang) saat onboarding.
- **Slot Lock Protection**: Slot shift yang sudah penuh terkunci secara otomatis agar tidak terjadi bentrok penugasan kasir.
- **Rotasi / Tukar Shift**: Mekanisme terstruktur jika terjadi pertukaran jadwal jaga kasir.

### 4. 📊 Dashboard Analitik & Laporan
- **Laporan Komprehensif**: Monitoring transaksi harian, mingguan, bulanan, dan 6-bulanan (semester).
- **Export Excel**: Unduh rekapitulasi penjualan untuk pembukuan akuntansi.
- **Live Monitor**: Memantau kasir yang sedang aktif bertugas di terminal kasir.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, Server Actions & React Server Components)
- **Bahasa**: [TypeScript](https://www.typescriptlang.org/) (Strict Type Safety)
- **Database**: [Supabase](https://supabase.com/) (Managed PostgreSQL dengan Row-Level Security)
- **ORM / Query**: Drizzle ORM & Migrasi SQL Terstruktur
- **Desain & Styling**: Modern Vanilla CSS Token System (HSL 60-30-10, Responsive, Smooth Micro-animations)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Keamanan**: Bcrypt Password Hashing, Environment Segregation, Stateless Session Security

---

## 📁 Struktur Direktori

```text
app/
├── public/                 # Aset statis & logo UNPERBA
├── src/
│   ├── app/                # Next.js App Router
│   │   ├── (auth)/         # Halaman login & otentikasi
│   │   ├── admin/          # Dashboard Admin / Dosen
│   │   ├── api/            # API Route Handlers (Auth, Kasir, Shift, Transaksi)
│   │   ├── daftar/         # Registrasi mandiri Mahasiswa & Dosen
│   │   ├── kasir/          # Antarmuka utama Terminal Kasir POS
│   │   └── page.tsx        # Landing page utama
│   ├── components/         # Komponen UI modular (Navbar, Modal, Cart, Scanner)
│   └── lib/                # Konfigurasi database & utilitas
│       └── db/
│           ├── migrations/ # File skema migrasi database SQL (v1.0, v1.1, v1.2)
│           └── schema.ts   # Drizzle schema definitions
├── .env.example            # Contoh variabel lingkungan
├── package.json
└── README.md
```

---

## 🚀 Panduan Instalasi Lokal

### 1. Kloning Repositori
```bash
git clone https://github.com/<username>/smartkasir-perwira.git
cd smartkasir-perwira
```

### 2. Pasang Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment Variables
Salin template `.env.example` ke `.env.local`:
```bash
cp .env.example .env.local
```
Sesuaikan nilainya dengan kredensial Supabase Anda:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
DATABASE_URL=postgresql://postgres:[password]@db.your-project.supabase.co:5432/postgres
JWT_SECRET=rahasia-jwt-minimal-32-karakter
```

### 4. Eksekusi Skema Database
Setup database Supabase Anda melalui Drizzle atau SQL Editor:
```bash
npm run db:push
```
Atau jalankan berkas migrasi tambahan di **Supabase SQL Editor**:
1. `src/lib/db/migrations/v1.1_barcode_shift_schedule.sql` (Fitur barcode & penjadwalan shift)
2. `src/lib/db/migrations/v1.2_nidn_selfregister.sql` (Registrasi mandiri NIDN & relaksasi constraint)

### 5. Jalankan Server Development
```bash
npm run dev
```
Buka browser di [http://localhost:3000](http://localhost:3000).

---

## 👥 Kontributor

- **Pengembang**: Tim Pengembang Smartkasir Perwira UNPERBA
- **Institusi**: Universitas Perwira M. Purbalingga (UNPERBA)

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah lisensi [MIT](LICENSE).
