# 📋 PRD — Wiramart v2.0: Online Ordering & Ecosystem Enhancement
> **Versi:** 2.0.1 — Security Deep-Dive Edition  
> **Tanggal Dibuat:** 2026-10-13 | **Terakhir Diperbarui:** 2026-10-17  
> **Pemilik Produk:** Najmusyafa (Developer / Mahasiswa UNPERBA)  
> **Status:** 🟡 DRAFT — Menunggu Final Approval Dosen/Manager  
> **Dokumen Terkait:** [`task.md`](../../task.md) · [`schema.ts`](../../src/lib/db/schema.ts) · [`auth.ts`](../../src/lib/utils/auth.ts) · [`rate-limit.ts`](../../src/lib/utils/rate-limit.ts)

---

> [!IMPORTANT]
> **Prinsip Absolut:** PRD ini adalah ekstensi ekosistem. TIDAK BOLEH ada perubahan pada kode, tabel, atau logika yang sudah berjalan di v1.x. Semua pengembangan bersifat **purely additive**. Sistem kasir, shift, transaksi, stok FEFO, dan semua RLS yang ada tetap tidak tersentuh.

---

## 🎯 Latar Belakang & Problem Statement

Wiramart UNPERBA beroperasi 100% stabil sebagai sistem POS internal dengan **Stack DNA: Profile A — Next.js + Supabase + Vercel + Drizzle ORM**. Seluruh audit v1.x sudah selesai: 14 tabel dengan RLS 100%, backup/restore dengan SHA-256 checksum, idempotency key pada transaksi, rate limiting berlapis. Sistem ini sudah production-grade.

**Gap yang ada saat ini:**
1. Pembeli di lantai 2–4 tidak bisa memesan tanpa datang fisik ke lantai 1
2. `products.photo_url` sudah ada di schema (kolom `photoUrl`) tapi belum ada UI upload
3. Leaderboard kinerja mahasiswa piket ada tapi metrik kehadiran belum terintegrasi
4. Tidak ada mekanisme notifikasi otomatis ke pembeli pasca transaksi

**Solusi:** Lapisan *consumer-facing* (PWA) yang berdiri di atas sistem POS yang sudah ada, ditambah penyempurnaan fitur internal yang sudah ada.

---

## 🏗️ Arsitektur Sistem v2.0

```
┌────────────────────────────────────────────────────────────────────┐
│                     WIRAMART ECOSYSTEM v2.0                        │
├──────────────────────────┬─────────────────────────────────────────┤
│  CONSUMER PWA (/order)   │  INTERNAL DASHBOARD (existing)          │
│  (Pembeli Luar)          │                                         │
│                          │  MANAGER     → /admin (full access)     │
│  ─ Katalog real-time     │  ADMIN_SHIFT → koordinasi pesanan       │
│  ─ Ordering              │  GUDANG      → manajemen stok           │
│  ─ Payment QRIS/TF       │  CS/PELAYAN  → delivery runner          │
│  ─ Order tracking        │  KASIR       → POS checkout + notif     │
│  ─ Notifikasi WA         │                                         │
├──────────────────────────┴─────────────────────────────────────────┤
│                                                                    │
│   API Layer (Next.js Route Handlers — Controller ≤ 30 baris)       │
│   /api/order/*    (PUBLIC — rate-limited)                          │
│   /api/admin/pesanan/*  (PROTECTED — ADMIN_SHIFT + MANAGER only)   │
│   /api/cs/pengiriman/*  (PROTECTED — CS/PELAYAN only)              │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                  Supabase PostgreSQL (Single Source of Truth)      │
│            existing tables         new tables (v2.0)              │
│   admins, employees, shifts    +   buyers, online_orders,          │
│   products, transactions, ...  +   online_order_items,             │
│   attendances, shift_schedules +   notification_logs               │
└────────────────────────────────────────────────────────────────────┘
```

**Prinsip non-negotiable:**
- PWA adalah **read layer** untuk katalog — satu sumber stok dari tabel `products`
- Pesanan dari PWA **TIDAK otomatis jadi transaksi kasir** — kasir input manual setelah barang disiapkan fisik
- Stok di-reserve **hanya setelah admin CONFIRM** → mencegah stok zombie dari order abandoned
- `cost_price` dari produk **TIDAK PERNAH terekspos** ke PWA — hanya `selling_price` (sesuai `ProductPublic` type yang sudah ada)
- Tidak ada `service_role` key di client bundle — semua mutasi via API route server-side

---

## 👥 User Personas & Role Mapping

| Persona | Role DB | Akses Baru di v2.0 |
|---|---|---|
| **Pembeli** | `buyers` (tabel baru) | PWA: katalog, order, payment, tracking |
| **CS / Pelayan** | `employees` (jabatan CS) | Tab "Pengiriman Saya" di dashboard existing |
| **ADMIN_SHIFT** | `admins.role = ADMIN_SHIFT` | Halaman /admin/pesanan-online |
| **KASIR** | `employees` (jabatan Kasir) | Badge notif pesanan online di navbar |
| **MANAGER (Dosen)** | `admins.role = MANAGER` | Full akses laporan pesanan online |

---

## 🔎 TEMUAN KRITIS DARI AUDIT SCHEMA EXISTING

> Sebelum coding dimulai, ini harus diketahui oleh developer:

1. **`products.photoUrl` sudah ada** di `schema.ts` line 224 (kolom `photo_url`). Artinya migration untuk kolom gambar **TIDAK diperlukan** — hanya perlu membuat UI upload dan API Storage saja.
2. **`ProductPublic` type sudah ada** di schema (`Omit<Product, 'costPrice'>`). Seluruh API PWA wajib pakai type ini — tidak boleh ekspos HPP ke publik.
3. **`admins.role`** saat ini adalah `MANAGER | ADMIN_SHIFT`. Belum ada pemisahan untuk CS/Pelayan di tabel `admins` — CS adalah `employees` dengan jabatan tertentu.
4. **Rate limiter yang ada** (`rate-limit.ts`) adalah in-memory singleton — sudah ada pola `createRateLimiter()` yang tinggal dipakai untuk endpoint PWA baru.
5. **JWT auth yang ada** (`auth.ts`) menggunakan dua cookie terpisah: `sk_admin` dan `sk_kasir`. PWA buyer perlu **cookie baru ketiga**: `sk_buyer` dengan mekanisme yang sama (HttpOnly, Secure, SameSite: lax).

---

## 📱 FASE 1 — Fondasi: Upload Foto Produk & PWA Shell

> **Estimasi Kompleksitas:** Medium  
> **Priority:** 🔴 MUST HAVE — fondasi untuk semua fase berikutnya  
> **Blocking:** Fase 2 tidak bisa dimulai sebelum Fase 1 selesai

### 1.1 Upload & Manajemen Foto Produk (Admin)

**Konteks:** Kolom `photo_url` sudah ada di tabel `products`. Yang dibutuhkan hanya API route untuk upload ke Supabase Storage dan UI di halaman edit produk yang sudah ada.

**User Story:**
> Sebagai ADMIN_SHIFT atau MANAGER, saya ingin upload foto produk dari halaman edit produk agar pembeli di PWA bisa melihat produk secara visual.

**Acceptance Criteria:**
- [ ] Tombol upload foto muncul di form edit produk yang sudah ada (`/admin/produk/[id]`)
- [ ] Format diterima: JPG, PNG, WebP — validasi MIME type di **server-side** (bukan hanya client)
- [ ] Ukuran maksimum: 2MB per file — validasi di server sebelum diteruskan ke Storage
- [ ] Gambar dikompresi ke WebP via `sharp` library sebelum diupload (target ≤ 500KB)
- [ ] URL gambar tersimpan ke kolom `products.photo_url` via UPDATE
- [ ] Foto lama dihapus dari Storage saat foto baru diupload (tidak ada orphaned file)
- [ ] Jika foto tidak ada, tampilkan placeholder SVG bergradien (bukan broken image)

**Technical Spec — API Route:**
```
POST /api/admin/produk/[id]/foto
Auth: requireAdmin() dari auth.ts yang sudah ada
Body: FormData { foto: File }
Validasi server:
  1. Cek auth (requireAdmin)
  2. Cek MIME type dari buffer (bukan dari client header)
  3. Cek size ≤ 2MB
  4. Compress dengan sharp → WebP
  5. Upload ke bucket product-images/{product_id}.webp
  6. UPDATE products SET photo_url = url WHERE id = productId
  7. Hapus file lama dari Storage jika ada
Response: { success: true, data: { photoUrl: string } }
```

**Supabase Storage Config:**
- Bucket: `product-images` — **public read** (gambar bisa diakses tanpa auth)
- RLS Storage Policy:
  - `SELECT`: semua orang (public)
  - `INSERT/UPDATE/DELETE`: hanya via API route server-side (service_role key di server env)
- File naming: `{product_id}.webp` — overwrite jika upload ulang (tidak ada accumulation)

**Migration:** TIDAK DIPERLUKAN — kolom `photo_url` sudah ada di schema.

**Security Notes:**
- Validasi MIME dari magic bytes buffer (`sharp` bisa mendeteksi ini), bukan dari `file.type` yang bisa di-spoof
- Gunakan UUID product ID sebagai nama file — tidak bisa ditebak
- `service_role` key HANYA di server env (`SUPABASE_SERVICE_ROLE_KEY`) — tidak pernah ke client

---

### 1.2 PWA Shell & Infrastruktur

**User Story:**
> Sebagai mahasiswa di lantai 3, saya ingin bisa buka Wiramart di HP dan langsung melihat produk yang tersedia.

**Acceptance Criteria:**
- [ ] PWA bisa di-install ke home screen Android (manifest.json + service worker)
- [ ] Load awal halaman katalog < 2.5 detik di koneksi 4G tipikal kampus
- [ ] Offline state: halaman informatif "Tidak ada koneksi, coba lagi nanti" — tidak crash
- [ ] PWA responsive: optimal di HP 375px width (entry level) hingga tablet
- [ ] SEO: `<title>Wiramart UNPERBA — Pesan Online</title>`, meta description, og:image
- [ ] Tidak ada `'use client'` di page level — hanya di komponen interaktif terkecil
- [ ] Icon PWA: menggunakan logo Wiramart yang sudah ada di `/public`

**Route Structure:**
```
/order                    → Halaman katalog (public, no auth required)
/order/checkout           → Keranjang & checkout (auth: buyer required)
/order/payment/[orderId]  → Halaman pembayaran (auth: buyer required)
/order/status/[orderId]   → Tracking pesanan (auth: buyer required)
/order/login              → Login buyer
/order/daftar             → Registrasi buyer
/order/riwayat            → Histori pesanan buyer
```

**Keputusan Deploy:** PWA di **route `/order` yang sama** (bukan subdomain) — lebih mudah di Vercel, tidak perlu DNS config tambahan, dan cookie bisa di-share untuk kebutuhan masa depan.

**PWA Manifest (`/public/order-manifest.json`):**
```json
{
  "name": "Wiramart UNPERBA",
  "short_name": "Wiramart",
  "description": "Pesan makanan & minuman dari Wiramart UNPERBA",
  "start_url": "/order",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#6366f1",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Service Worker Strategy:** Cache-first untuk aset statis (CSS, font, icon). Network-first untuk API calls (stok harus real-time). Tidak ada cache untuk data pesanan.

---

## 🛒 FASE 2 — Core: Ordering & Payment

> **Estimasi Kompleksitas:** Tinggi  
> **Priority:** 🔴 MUST HAVE  
> **Dependencies:** Fase 1 selesai

### 2.1 Sistem Autentikasi Buyer (BARU)

**Desain keputusan:** Buyer menggunakan NIM + Nama sebagai identitas, tanpa password. Ini bukan security hole — NIM + nama adalah identitas sosial kampus yang tidak sensitif, dan tidak ada data finansial yang terikat ke akun buyer (yang finansial ada di sisi admin).

**User Story:**
> Sebagai mahasiswa UNPERBA, saya ingin daftar dengan NIM saya sekali saja, lalu bisa login kapanpun tanpa menghafal password.

**Acceptance Criteria — Registrasi:**
- [ ] Form: Nama Lengkap (maks 200 char) + NIM (validasi 8–15 digit angka) + No. WA (format 08xx atau 628xx, 10–15 digit)
- [ ] No. WA dinormalisasi ke format internasional `628xxxx` sebelum disimpan
- [ ] Satu NIM = satu akun. Jika NIM sudah terdaftar: tampilkan "NIM ini sudah terdaftar, silakan login"
- [ ] Setelah registrasi sukses: langsung login (set cookie `sk_buyer`)

**Acceptance Criteria — Login:**
- [ ] Form: NIM + Nama Lengkap (case-insensitive, trim whitespace)
- [ ] Jika NIM tidak ditemukan: "NIM tidak terdaftar. Silakan daftar terlebih dahulu"
- [ ] Jika nama tidak cocok dengan NIM: "Nama tidak sesuai. Periksa kembali data kamu" ← **generic, tidak expose "NIM ada tapi nama salah"**
- [ ] Setelah login sukses: set cookie `sk_buyer` (HttpOnly, Secure, SameSite: lax, maxAge: 7 hari)
- [ ] Setelah 7 hari: buyer harus login ulang (tidak ada refresh token untuk buyer)

**Token Payload Buyer (baru, tambahkan ke `auth.ts`):**
```typescript
export type BuyerTokenPayload = {
  sub: string;     // buyer.id (UUID)
  role: 'buyer';
  nim: string;
  name: string;
};
```

**Cookie baru:**
```typescript
const BUYER_ACCESS_COOKIE = 'sk_buyer';
// maxAge: 7 hari (lebih lama dari shift kasir 8 jam — buyer tidak perlu login tiap hari)
// HttpOnly: true | Secure: production | SameSite: 'lax'
```

**Security — Rate Limiting Buyer Auth (tambah ke `rate-limit.ts`):**
```typescript
// Buyer login: 10 percobaan / 15 menit / per NIM
// Alasan: NIM adalah identitas publik — tidak perlu terlalu ketat,
// tapi cukup untuk mencegah enumeration attack (coba-coba NIM orang lain)
export const buyerAuthLimiter = createRateLimiter(
  'auth:buyer',
  10,
  15 * 60 * 1000, // 15 menit
);

// Buyer registrasi: 3 registrasi / 1 jam / per IP
// Alasan: Mencegah spam akun baru dari IP yang sama
export const buyerRegisterLimiter = createRateLimiter(
  'register:buyer',
  3,
  60 * 60 * 1000, // 1 jam
);
```

**API Routes:**
```
POST /api/order/auth/daftar
  Body: { fullName, nim, whatsapp }
  Rate limit: buyerRegisterLimiter per IP
  Response: { success, data: { buyerId, token } }

POST /api/order/auth/login
  Body: { nim, fullName }
  Rate limit: buyerAuthLimiter per NIM
  Response: { success, data: { buyerId } }

POST /api/order/auth/logout
  Auth: sk_buyer cookie
  Response: 204 No Content (clear cookie)
```

---

### 2.2 Schema Tabel Baru (Migration Additive)

**Tabel `buyers` (Migration `v2_6_buyers.sql`):**
```sql
-- ADDITIVE ONLY — tidak menyentuh tabel existing
CREATE TABLE IF NOT EXISTS buyers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    VARCHAR(200) NOT NULL,
  nim          VARCHAR(20) NOT NULL,
  -- Disimpan format internasional: 628xxxx (tanpa +)
  whatsapp     VARCHAR(20) NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Flag fraud: admin bisa tandai buyer bermasalah
  is_flagged   BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_reason TEXT,
  flagged_by   UUID REFERENCES admins(id),
  flagged_at   TIMESTAMPTZ,
  -- Audit
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ  -- soft delete
);

-- NIM unik di antara buyer aktif (belum dihapus)
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyers_nim_active
  ON buyers(nim)
  WHERE deleted_at IS NULL;

-- Index untuk lookup WA (dipakai saat kirim notifikasi)
CREATE INDEX IF NOT EXISTS idx_buyers_whatsapp
  ON buyers(whatsapp)
  WHERE deleted_at IS NULL;

-- RLS: Buyer hanya bisa baca data dirinya sendiri
-- Admin bisa baca semua
ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buyers: self read"
  ON buyers FOR SELECT
  USING (
    auth.uid()::text = id::text  -- buyer JWT
    OR EXISTS (
      SELECT 1 FROM admins
      WHERE admins.id::text = auth.uid()::text
        AND admins.deleted_at IS NULL
    )
  );

CREATE POLICY "buyers: insert via service_role only"
  ON buyers FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "buyers: update via service_role only"
  ON buyers FOR UPDATE
  USING (auth.role() = 'service_role');
```

**Tabel `online_orders` & `online_order_items` (Migration `v2_5_online_orders.sql`):**
```sql
-- ENUM baru (tidak konflik dengan enum yang ada karena nama berbeda)
DO $$ BEGIN
  CREATE TYPE online_order_status AS ENUM (
    'WAITING_PAYMENT_VERIFICATION', -- transfer, menunggu cek bukti
    'WAITING_CONFIRMATION',          -- QRIS, menunggu konfirmasi admin
    'CONFIRMED',                     -- admin approve → stok di-reserve
    'PREPARING',                     -- kasir/CS sedang siapkan
    'READY_FOR_PICKUP',              -- siap diambil (pickup mode)
    'OUT_FOR_DELIVERY',              -- sedang diantar (delivery mode)
    'COMPLETED',                     -- selesai
    'CANCELLED',                     -- dibatalkan (buyer atau admin)
    'REJECTED',                      -- ditolak admin (bukti tidak valid, dll)
    'EXPIRED'                        -- otomatis expired setelah 2 jam tanpa konfirmasi
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE online_delivery_type AS ENUM ('PICKUP', 'DELIVERY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE online_payment_method AS ENUM ('QRIS', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS online_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Format: WM-YYYYMMDD-XXXX (misal WM-20261013-0042)
  -- Di-generate server-side dengan counter harian + fallback random
  order_number          VARCHAR(25) NOT NULL UNIQUE,

  buyer_id              UUID NOT NULL REFERENCES buyers(id),

  -- ── Delivery ──────────────────────────────────────────────────
  delivery_type         online_delivery_type NOT NULL,
  -- NULL jika PICKUP. 1-4 untuk lantai, 99 untuk auditorium.
  delivery_floor        SMALLINT CHECK (delivery_floor IN (1, 2, 3, 4, 99)),
  -- Dalam Rupiah (integer, tidak ada desimal untuk ongkir)
  delivery_fee          INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_note         VARCHAR(200),  -- catatan tambahan pembeli, maks 200 char

  -- ── CS Assignment ──────────────────────────────────────────────
  -- CS yang ditugaskan antar — hanya dari employees yang hadir shift aktif hari ini
  assigned_cs_id        UUID REFERENCES employees(id),
  assigned_at           TIMESTAMPTZ,
  assigned_by           UUID REFERENCES admins(id),

  -- ── Payment ────────────────────────────────────────────────────
  payment_method        online_payment_method NOT NULL,
  -- Nomor referensi unik untuk transfer: WM-20261013-0042
  -- Sama dengan order_number — digunakan sebagai keterangan transfer
  payment_reference     VARCHAR(25),
  -- URL bukti transfer di Supabase Storage bucket 'payment-proofs'
  payment_proof_url     TEXT,
  payment_verified_at   TIMESTAMPTZ,
  payment_verified_by   UUID REFERENCES admins(id),

  -- ── Status & Audit Trail ────────────────────────────────────────
  status                online_order_status NOT NULL DEFAULT 'WAITING_CONFIRMATION',
  cancelled_reason      TEXT,
  rejected_reason       TEXT,
  cancelled_by          UUID REFERENCES admins(id),  -- NULL jika buyer yang cancel

  confirmed_by          UUID REFERENCES admins(id),
  confirmed_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,  -- di-set saat order dibuat: NOW() + 2 jam

  -- ── Pricing (snapshot saat checkout) ───────────────────────────
  -- Semua dalam Rupiah (integer)
  subtotal              INTEGER NOT NULL CHECK (subtotal > 0),
  total_amount          INTEGER NOT NULL CHECK (total_amount > 0),
  -- total_amount = subtotal + delivery_fee (divalidasi di service layer)

  -- ── System ─────────────────────────────────────────────────────
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS online_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id),
  -- Snapshot nama & harga SAAT order dibuat — tidak berubah walau produk diupdate
  product_name      VARCHAR(200) NOT NULL,
  selling_price     INTEGER NOT NULL CHECK (selling_price > 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  -- subtotal = selling_price × quantity (divalidasi di service layer)
  subtotal          INTEGER NOT NULL CHECK (subtotal > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes (kritis untuk performa query dashboard) ─────────────
CREATE INDEX IF NOT EXISTS idx_online_orders_buyer
  ON online_orders(buyer_id) WHERE deleted_at IS NULL;

-- Query utama dashboard admin: filter by status
CREATE INDEX IF NOT EXISTS idx_online_orders_status
  ON online_orders(status, created_at DESC) WHERE deleted_at IS NULL;

-- Query Supabase Realtime listener kasir: status IN pending
CREATE INDEX IF NOT EXISTS idx_online_orders_pending
  ON online_orders(created_at DESC)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION', 'WAITING_CONFIRMATION')
    AND deleted_at IS NULL;

-- Query halaman CS: assigned_cs_id filter
CREATE INDEX IF NOT EXISTS idx_online_orders_cs
  ON online_orders(assigned_cs_id, status)
  WHERE assigned_cs_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_online_order_items_order
  ON online_order_items(order_id);

-- ── RLS Policies ────────────────────────────────────────────────
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;

-- Buyer: hanya bisa lihat pesanannya sendiri
CREATE POLICY "online_orders: buyer self read"
  ON online_orders FOR SELECT
  USING (buyer_id::text = auth.uid()::text);

-- Admin & employees: bisa baca semua (untuk dashboard)
CREATE POLICY "online_orders: staff read all"
  ON online_orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND deleted_at IS NULL)
  );

-- Mutasi: hanya via service_role (API routes server-side)
CREATE POLICY "online_orders: service_role all"
  ON online_orders FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "online_order_items: service_role all"
  ON online_order_items FOR ALL
  USING (auth.role() = 'service_role');
```

**Tabel `notification_logs` (Migration `v2_7_notification_logs.sql`):**
```sql
-- Log semua notifikasi WA yang dikirim — untuk audit dan debugging
CREATE TABLE IF NOT EXISTS notification_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tipe notifikasi
  event_type     VARCHAR(50) NOT NULL,  -- ORDER_CREATED, ORDER_CONFIRMED, dll
  -- Penerima
  recipient_wa   VARCHAR(20) NOT NULL,
  recipient_name VARCHAR(200),
  -- Konten
  message        TEXT NOT NULL,
  -- Status pengiriman
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING, SENT, FAILED
  -- Response dari provider (Fonnte/dll)
  provider_response JSONB,
  error_message  TEXT,
  -- Referensi ke order (opsional)
  order_id       UUID REFERENCES online_orders(id),
  -- Audit
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_order
  ON notification_logs(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs(status, created_at DESC);
```

---

### 2.3 Katalog Produk (PWA Read-Only)

**User Story:**
> Sebagai pembeli, saya ingin melihat produk yang tersedia beserta foto, harga, dan sisa stok secara real-time.

**Acceptance Criteria:**
- [ ] Tampilkan produk `is_active = TRUE` AND `deleted_at IS NULL` AND `stock_qty >= 0`
- [ ] Field yang dikirim ke PWA: `id`, `name`, `description`, `selling_price`, `stock_qty`, `photo_url`, `category_name` — **TIDAK ADA** `cost_price` (sesuai `ProductPublic` type)
- [ ] Produk stok = 0: tampil dengan badge "Habis", tombol "Tambah" disabled
- [ ] Filter by kategori (client-side dari data yang sudah di-fetch)
- [ ] Search by nama produk (client-side, debounce 300ms)
- [ ] Pull-to-refresh untuk update stok terbaru
- [ ] Skeleton loading (CLS = 0 — dimensi skeleton sama persis dengan card asli)

**API Route:**
```
GET /api/order/katalog
Auth: TIDAK DIPERLUKAN (public endpoint)
Rate limit: 30 req/menit per IP (InMemoryRateLimiter yang sudah ada)
Cache: revalidate = 30 (30 detik — stok bisa berubah sering)
Response: {
  success: true,
  data: {
    products: Array<{
      id: string,
      name: string,
      description: string | null,
      sellingPrice: number,       // integer Rupiah
      stockQty: number,
      photoUrl: string | null,
      categoryName: string
    }>,
    lastUpdated: string           // ISO timestamp
  }
}
```

> **Security:** Response tidak pernah include `cost_price`, `created_by_admin_id`, atau kolom internal apapun. Gunakan explicit SELECT fields, bukan `SELECT *`.

---

### 2.4 Keranjang & Checkout

**User Story:**
> Sebagai pembeli yang sudah login, saya ingin tambah produk ke keranjang dan pilih metode pengambilan.

**Acceptance Criteria:**
- [ ] Keranjang disimpan di `sessionStorage` (bukan `localStorage`) — bersih saat tab ditutup, tidak ada cart stale lintas sesi
- [ ] Maksimum 10 jenis produk berbeda per keranjang (prevent orderan yang tidak realistis)
- [ ] Maksimum quantity per produk: `stock_qty` yang ada (divalidasi ulang di server saat checkout)
- [ ] Pilihan: **Ambil Sendiri** atau **Diantarkan ke Lantai**
- [ ] Jika Diantarkan: pilih lantai tujuan (dropdown: L1, L2, L3, Auditorium)
- [ ] Catatan pesanan: opsional, maks 200 karakter
- [ ] Ringkasan: subtotal + ongkir + **total** semua dalam Rupiah integer (tidak ada desimal)
- [ ] Checkout button disabled jika: keranjang kosong ATAU buyer belum login

**Ongkir Rules (server-side enforced, bukan hanya client):**
```typescript
// Dalam OnlineOrderService.ts
function calculateDeliveryFee(deliveryType: 'PICKUP' | 'DELIVERY', floor?: number): number {
  if (deliveryType === 'PICKUP') return 0;
  if (!floor) throw new ValidationError('Lantai tujuan wajib dipilih untuk delivery');
  const feeMap: Record<number, number> = { 1: 0, 2: 1000, 3: 2000, 4: 2000, 99: 2000 };
  const fee = feeMap[floor];
  if (fee === undefined) throw new ValidationError('Lantai tidak valid');
  return fee;
}
```

> **Anti-Tampering:** Client mengirim `deliveryFloor`, server menghitung ulang `deliveryFee` — **tidak pernah percaya nilai `deliveryFee` dari client**.

---

### 2.5 Payment Flow

**User Story:**
> Sebagai pembeli, saya ingin membayar via QRIS atau Transfer Bank dengan instruksi yang jelas.

#### 2.5.1 Generate Order (API)

```
POST /api/order/pesanan
Auth: sk_buyer (wajib)
Rate limit: orderCreationLimiter — 5 order / 24 jam / per buyer_id
Idempotency: Header X-Idempotency-Key (16-64 karakter, opsional — konsisten dengan pola existing)
Body: {
  items: Array<{ productId: string, quantity: number }>,
  deliveryType: 'PICKUP' | 'DELIVERY',
  deliveryFloor?: number,
  deliveryNote?: string,
  paymentMethod: 'QRIS' | 'TRANSFER'
}
```

**Business Logic di `OnlineOrderService.ts`:**
1. Validasi Zod schema
2. Cek buyer `is_active = TRUE` dan `is_flagged = FALSE`
3. Cek stok produk: SELECT fresh dari DB (bukan dari body client) → validasi `stock_qty >= quantity` untuk tiap item
4. Hitung `subtotal` server-side (price × qty) — tidak percaya nilai dari client
5. Hitung `delivery_fee` server-side (dari `calculateDeliveryFee()`)
6. Hitung `total_amount = subtotal + delivery_fee`
7. Generate `order_number`: format `WM-YYYYMMDD-XXXX` dimana XXXX adalah counter harian yang atomic (PostgreSQL sequence per hari) + fallback random 4 digit jika sequence gagal
8. Set `expired_at = NOW() + 2 jam`
9. Jika QRIS: status = `WAITING_CONFIRMATION`
10. Jika TRANSFER: status = `WAITING_PAYMENT_VERIFICATION`, set `payment_reference = order_number`
11. INSERT atomic ke `online_orders` + `online_order_items` dalam satu DB transaction
12. Return order data

**Validasi Server-Side Kritis (wajib, tidak bisa di-skip):**
```typescript
// Di OnlineOrderService.ts
// WAJIB: Validasi total dari server, bukan dari client
const serverSubtotal = items.reduce((acc, item) => {
  const product = productRows.find(p => p.id === item.productId);
  if (!product) throw new NotFoundError(`Produk tidak ditemukan`);
  if (product.stockQty < item.quantity) throw new ValidationError(`Stok ${product.name} tidak cukup`);
  return acc + (product.sellingPrice * item.quantity);
}, 0);
// TIDAK PERNAH pakai subtotal dari request body
```

#### 2.5.2 Upload Bukti Transfer

```
POST /api/order/pesanan/[orderId]/bukti-transfer
Auth: sk_buyer (wajib, harus pemilik order)
Content-Type: multipart/form-data
Body: FormData { bukti: File }
Validasi server:
  1. Cek ownership: order.buyer_id === payload.sub
  2. Cek status: harus WAITING_PAYMENT_VERIFICATION
  3. Validasi MIME dari magic bytes (JPEG: FFD8FF, PNG: 89504E47)
  4. Validasi ukuran ≤ 2MB
  5. Upload ke bucket 'payment-proofs/{orderId}.jpg'
  6. UPDATE online_orders SET payment_proof_url = url
Response: { success: true, data: { proofUrl: string } }
```

**Security — Upload Anti-Abuse:**
```typescript
// Rate limit upload bukti: 3 upload / 1 jam / per buyer
// Mencegah storage abuse dari upload berulang
export const proofUploadLimiter = createRateLimiter(
  'upload:proof',
  3,
  60 * 60 * 1000,
);
```

#### 2.5.3 Status Machine Pesanan (Lengkap)

```
                ┌──────────────────────────────────────────────────────┐
                │              STATUS MACHINE ONLINE ORDER              │
                └──────────────────────────────────────────────────────┘

[Buyer submit QRIS]          [Buyer submit TRANSFER]
        │                            │
        ▼                            ▼
[WAITING_CONFIRMATION]    [WAITING_PAYMENT_VERIFICATION]
        │                   │ (buyer upload bukti transfer)
        │                   ▼ (admin cek bukti → valid)
        │              [WAITING_CONFIRMATION]
        │                            │
        └────────────────────────────┘
                         │
                [Admin klik Konfirmasi]
                         │ ← Stok di-reserve di sini (ACID transaction)
                         ▼
                    [CONFIRMED]
                         │
                [Admin assign CS, klik Proses]
                         │
                         ▼
                    [PREPARING]
                         │
              ┌──────────┴───────────┐
     [PICKUP] │                      │ [DELIVERY]
              ▼                      ▼
    [READY_FOR_PICKUP]     [OUT_FOR_DELIVERY]
              │                      │
     [Buyer konfirmasi]   [CS klik Sudah Diantar]
              │            [Admin konfirmasi]
              └──────────┬───────────┘
                         ▼
                    [COMPLETED]
                    
── Early Exits ──────────────────────────────────────
[WAITING_*] + 2 jam berlalu → [EXPIRED] (via cron job / pg_cron)
[WAITING_*] → [CANCELLED] (buyer batalkan atau admin tolak sebelum CONFIRMED)
[WAITING_PAYMENT_VERIFICATION] → [REJECTED] (bukti transfer tidak valid)
[CONFIRMED] → [CANCELLED] (admin batalkan, stok dikembalikan via ACID transaction)
```

**Stok Reserve Logic (KRITIS):**
```sql
-- Saat admin klik CONFIRM:
-- UPDATE products SET stock_qty = stock_qty - qty WHERE id = ? AND stock_qty >= qty
-- Jika UPDATE mengembalikan 0 rows → stok tidak cukup → rollback seluruh konfirmasi

-- Saat order CANCELLED setelah CONFIRMED (stok harus dikembalikan):
-- UPDATE products SET stock_qty = stock_qty + qty WHERE id = ?
-- WAJIB dalam satu ACID transaction bersama UPDATE status order
```

---

### 2.6 Order Tracking (PWA)

**User Story:**
> Sebagai pembeli, saya ingin bisa pantau status pesanan saya secara real-time.

**Acceptance Criteria:**
- [ ] Halaman `/order/status/[orderId]` — hanya bisa diakses pemilik order
- [ ] Tampilkan: nomor order, status visual (progress bar), item list, total, estimasi
- [ ] Status update real-time via **polling 30 detik** (tidak pakai Supabase Realtime di sisi PWA untuk hemat connection — buyer bisa banyak)
- [ ] Tombol "Batalkan" tersedia selama status masih `WAITING_*`
- [ ] Jika DELIVERY: tampilkan nama CS yang ditugaskan + nomor WA CS (untuk kontak langsung)

---

## 🖥️ FASE 3 — Internal Management & Delivery Coordination

> **Estimasi Kompleksitas:** Medium  
> **Priority:** 🔴 MUST HAVE

### 3.1 Badge Notifikasi di Layar Kasir

**User Story:**
> Sebagai KASIR yang aktif di POS, saya ingin tahu ada pesanan online masuk tanpa keluar dari layar transaksi.

**Acceptance Criteria:**
- [ ] Badge merah dengan angka di navbar kasir yang sudah ada
- [ ] Angka = jumlah pesanan dengan status `WAITING_CONFIRMATION` + `WAITING_PAYMENT_VERIFICATION`
- [ ] Update via **Supabase Realtime** `on('postgres_changes')` — event `INSERT` dan `UPDATE` pada tabel `online_orders`
- [ ] Klik badge → navigasi ke `/admin/pesanan-online` (bukan popup yang ganggu kasir)
- [ ] Badge = 0 saat tidak ada pesanan pending
- [ ] Cleanup subscription saat component unmount (mencegah memory leak)

**Technical Implementation:**
```typescript
// Di komponen navbar kasir (Client Component)
useEffect(() => {
  const channel = supabase
    .channel('online-orders-badge')
    .on('postgres_changes', {
      event: '*',  // INSERT dan UPDATE
      schema: 'public',
      table: 'online_orders',
      filter: `status=in.(WAITING_CONFIRMATION,WAITING_PAYMENT_VERIFICATION)`,
    }, () => {
      // Refetch count
      fetchPendingCount();
    })
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, []);
```

> **Security:** Supabase Realtime menggunakan anon key (public) — ini aman karena RLS pada tabel `online_orders` sudah dikonfigurasi. Employee hanya bisa subscribe ke event, tidak bisa mutasi via realtime.

---

### 3.2 Dashboard Manajemen Pesanan Online

**User Story:**
> Sebagai ADMIN_SHIFT, saya ingin kelola semua pesanan online dari satu halaman.

**Route:** `/admin/pesanan-online` — hanya `ADMIN_SHIFT` dan `MANAGER`

**Acceptance Criteria:**
- [ ] Tab: **Menunggu** | **Diproses** | **Selesai** | **Dibatalkan/Ditolak**
- [ ] Setiap card: nomor order, nama pembeli + NIM, item list, total, metode bayar, delivery type + lantai, waktu order
- [ ] Tab Menunggu — aksi tersedia:
  - Jika TRANSFER: tampilkan foto bukti + nomor referensi (klik untuk zoom)
  - Tombol **✅ Konfirmasi** → CONFIRMED (stok reserve atomic)
  - Tombol **❌ Tolak** → form alasan wajib diisi → REJECTED
  - Tombol **🚫 Batalkan** → form alasan → CANCELLED
- [ ] Setelah CONFIRMED: dropdown assign CS → tampilkan **hanya** employee dengan jabatan CS/Pelayan yang `attendance.status = 'HADIR'` di shift aktif hari ini
- [ ] Tombol **Siap** → READY_FOR_PICKUP atau OUT_FOR_DELIVERY (tergantung delivery_type)
- [ ] Tombol **Selesai** → COMPLETED
- [ ] Filter by tanggal (default: hari ini)
- [ ] Pagination: 20 item per halaman

**API Routes (Controller ≤ 30 baris, logic di Service):**
```
GET  /api/admin/pesanan?status=&page=&limit=
     Auth: requireAdmin()
     
POST /api/admin/pesanan/[id]/konfirmasi
     Auth: requireAdmin()
     Body: { assignedCsId?: string }
     Action: status → CONFIRMED + reserve stok (atomic)

POST /api/admin/pesanan/[id]/tolak
     Auth: requireAdmin()
     Body: { reason: string (min 10 char) }
     Action: status → REJECTED

POST /api/admin/pesanan/[id]/batalkan
     Auth: requireAdmin()
     Body: { reason: string (min 10 char) }
     Action: status → CANCELLED + kembalikan stok jika sudah CONFIRMED (atomic)

POST /api/admin/pesanan/[id]/assign-cs
     Auth: requireAdmin()
     Body: { csEmployeeId: string }
     Validasi: employee.jabatan harus 'CS' atau 'Pelayan' + hadir hari ini

POST /api/admin/pesanan/[id]/selesai
     Auth: requireAdmin()
     Action: status → COMPLETED + completed_at = NOW()
```

**Security — IDOR Prevention (wajib di setiap endpoint mutasi):**
```typescript
// Di setiap route mutasi — verifikasi order exist sebelum mutasi
const [order] = await db.select().from(online_orders)
  .where(and(eq(online_orders.id, orderId), isNull(online_orders.deletedAt)))
  .limit(1);
if (!order) return apiError('Pesanan tidak ditemukan', 404);
// Tidak expose apakah order tidak ada atau akses ditolak
```

**Race Condition pada Konfirmasi (kritis):**
```typescript
// Dalam OnlineOrderRepository.confirmOrder()
// HARUS atomic: update status + reserve stok dalam satu transaction
await db.transaction(async (tx) => {
  // 1. Lock order row
  const [order] = await tx.select()
    .from(online_orders)
    .where(and(
      eq(online_orders.id, orderId),
      eq(online_orders.status, 'WAITING_CONFIRMATION'),  // status check di dalam tx
    ))
    .for('update')  // Drizzle: .for('update') = SELECT ... FOR UPDATE
    .limit(1);
  
  if (!order) throw new Error('ORDER_NOT_CONFIRMABLE');

  // 2. Reserve stok tiap item
  for (const item of orderItems) {
    const result = await tx
      .update(products)
      .set({ stockQty: sql`stock_qty - ${item.quantity}` })
      .where(and(
        eq(products.id, item.productId),
        gte(products.stockQty, item.quantity),  // guard: tidak kurang dari 0
      ))
      .returning({ id: products.id });

    if (result.length === 0) {
      throw new Error(`STOCK_INSUFFICIENT:${item.productId}`);
    }
  }

  // 3. Update status order
  await tx.update(online_orders)
    .set({
      status: 'CONFIRMED',
      confirmedBy: adminId,
      confirmedAt: new Date(),
    })
    .where(eq(online_orders.id, orderId));
});
```

---

### 3.3 Halaman CS/Pelayan — Pengiriman Saya

**User Story:**
> Sebagai CS yang bertugas, saya ingin tahu pesanan mana yang harus saya antar.

**Route:** Tab baru "Pengiriman" di dashboard CS yang sudah ada

**Acceptance Criteria:**
- [ ] Tampilkan pesanan yang di-assign ke saya dengan status `OUT_FOR_DELIVERY`
- [ ] Info: nama pembeli, lokasi (lantai X / Auditorium), item list, catatan pesanan
- [ ] Tombol **"Sudah Diantar"** → notifikasi ke admin, status update ke COMPLETED pending konfirmasi
- [ ] **IDOR Prevention**: API hanya return pesanan yang `assigned_cs_id = current_employee_id`

**API Routes:**
```
GET  /api/cs/pengiriman
     Auth: requireEmployee() (dari auth.ts yang sudah ada)
     Query: ?status=OUT_FOR_DELIVERY (default)
     Where: assigned_cs_id = payload.sub  ← WAJIB, mencegah IDOR
     
POST /api/cs/pengiriman/[id]/selesai
     Auth: requireEmployee()
     Validasi: order.assigned_cs_id === payload.sub  ← IDOR check wajib
     Action: notifikasi ke admin (atau langsung COMPLETED tergantung keputusan)
```

---

### 3.4 Order Expiry (Background Job)

**User Story:**
> Sebagai sistem, saya ingin otomatis expire pesanan yang tidak dikonfirmasi dalam 2 jam untuk mencegah stok terkunci.

**Implementation Options:**

| Opsi | Cara | Trade-off |
|---|---|---|
| **A (Rekomendasi)** | Vercel Cron Job (`vercel.json`) setiap 15 menit | Gratis di Vercel, reliable |
| B | `pg_cron` extension di Supabase | Butuh extension di-enable, tidak tersedia semua tier |
| C | Check saat admin buka dashboard | Lazy expiry — tidak real-time |

**Vercel Cron Route:**
```
// vercel.json
{
  "crons": [{ "path": "/api/system/expire-orders", "schedule": "*/15 * * * *" }]
}

// GET /api/system/expire-orders
// Auth: cek secret header CRON_SECRET dari env
// Action: UPDATE online_orders SET status = 'EXPIRED', expired_at = NOW()
//         WHERE status IN ('WAITING_CONFIRMATION', 'WAITING_PAYMENT_VERIFICATION')
//         AND expired_at < NOW()
//         AND deleted_at IS NULL
```

**Security Cron Route:**
```typescript
// Hanya Vercel yang bisa trigger endpoint ini
const cronSecret = req.headers.get('Authorization');
if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
  return apiError('Unauthorized', 401);
}
```

---

## 📲 FASE 4 — Polish: Notifikasi WA & Leaderboard

> **Estimasi Kompleksitas:** Low-Medium  
> **Priority:** 🟡 SHOULD HAVE

### 4.1 Notifikasi WhatsApp via Fonnte

**Pilihan provider:** [Fonnte.com](https://fonnte.com) — Rp 300/pesan, tidak perlu WABA approval, cocok skala kampus.

**Event → Template WA:**

| Event | Status | Penerima | Template Pesan |
|---|---|---|---|
| Order dibuat | WAITING_* | Buyer | `Halo [nama]! Pesanan #[nomor] diterima 🎉\nTotal: Rp [total]\nSilakan selesaikan pembayaran dalam 2 jam.\n\nWiramart UNPERBA` |
| Dikonfirmasi | CONFIRMED | Buyer | `Pesanan #[nomor] dikonfirmasi! ✅\nSedang kami siapkan, tunggu sebentar ya.` |
| Siap diambil | READY_FOR_PICKUP | Buyer | `Pesanan #[nomor] siap! 🛍️\nSilakan ambil di Wiramart Lantai 1.` |
| Diantar | OUT_FOR_DELIVERY | Buyer | `Pesanan #[nomor] sedang dalam perjalanan ke Lantai [X]! 🏃\nCS: [nama_cs]` |
| Selesai | COMPLETED | Buyer | `Terima kasih sudah pesan di Wiramart! 😊\nPesanan #[nomor] selesai.` |
| Ditolak | REJECTED | Buyer | `Pesanan #[nomor] tidak dapat diproses.\nAlasan: [alasan]\nHubungi admin Wiramart untuk info lebih lanjut.` |
| Pesanan baru masuk | WAITING_* | ADMIN_SHIFT aktif | `[Pesanan Baru] #[nomor] dari [nama_buyer]\nTotal: Rp [total] \| [metode]\nSegera konfirmasi di dashboard.` |

**Implementasi (`NotificationService.ts`):**
```typescript
// Async fire-and-forget — notifikasi TIDAK boleh blocking alur utama
// Jika notifikasi gagal, order tetap jalan normal
async function sendWANotification(
  waNumber: string,
  message: string,
  orderId: string,
  eventType: string
): Promise<void> {
  try {
    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': process.env.FONNTE_TOKEN!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: waNumber, message }),
    });
    
    // Log ke notification_logs
    await db.insert(notification_logs).values({
      eventType,
      recipientWa: waNumber,
      message,
      status: response.ok ? 'SENT' : 'FAILED',
      providerResponse: await response.json(),
      orderId,
      sentAt: new Date(),
    });
  } catch (err) {
    // Log error tapi jangan propagate — notifikasi adalah non-critical
    await db.insert(notification_logs).values({
      eventType, recipientWa: waNumber, message,
      status: 'FAILED', errorMessage: String(err), orderId,
    });
  }
}
```

**Env var baru:**
```bash
FONNTE_TOKEN=your_fonnte_token_here
CRON_SECRET=random_32_char_secret_for_cron_auth
```

---

### 4.2 Penyempurnaan Leaderboard Mahasiswa

**User Story:**
> Sebagai MANAGER, saya ingin leaderboard yang akurat untuk bahan penilaian UAS mahasiswa.

**Metrik yang perlu ditambahkan/diperbaiki:**

| Metrik | Source | Keterangan |
|---|---|---|
| Total transaksi | `transactions` JOIN `shifts` | Sudah ada, perlu filter per periode |
| Total omzet | `transactions.gross_amount` | Sudah ada |
| Kehadiran (%) | `attendances.status` | HADIR + TELAT / total jadwal |
| Rata-rata keterlambatan | `attendances` WHERE `status = 'TELAT'` | Dalam menit |
| Perubahan ranking | Bandingkan periode N vs N-1 | Computed di service layer |

**API Baru:**
```
GET /api/admin/laporan/leaderboard?periode=minggu|bulan|semester&from=&to=
Auth: requireAdmin()
Response: {
  employees: Array<{
    rank: number,
    previousRank: number | null,
    employee: { id, fullName, nim, jabatan },
    metrics: {
      totalTransaksi: number,
      totalOmzet: number,
      kehadiranPersen: number,
      rataKeterlambatanMenit: number | null
    }
  }>
}
```

**Export Excel:** Endpoint tambahan `GET /api/admin/laporan/leaderboard/export?...` — mengembalikan XLSX menggunakan library `xlsx` (sudah ada di package.json? perlu cek).

---

## 🔐 SECURITY ARCHITECTURE LENGKAP

> Bagian ini adalah panduan implementasi keamanan yang wajib diikuti tanpa pengecualian.

### A. Authentication & Session

| Layer | Mekanisme | Token | Expiry |
|---|---|---|---|
| Admin/Manager | JWT + bcrypt | `sk_admin` cookie (HttpOnly) | 8 jam (1 shift) |
| Kasir/Karyawan | JWT | `sk_kasir` cookie (HttpOnly) | 8 jam (1 shift) |
| **Buyer (BARU)** | JWT (no password) | `sk_buyer` cookie (HttpOnly) | **7 hari** |

**Cookie Security Config (wajib sama dengan yang sudah ada):**
```typescript
// sk_buyer — HttpOnly, Secure (prod), SameSite: lax, Path: /order
cookieStore.set('sk_buyer', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/order',  // scoped ke /order saja — tidak bocor ke /admin atau /kasir
  maxAge: 60 * 60 * 24 * 7,  // 7 hari
});
```

**JWT Secret:** Sama `JWT_SECRET` yang sudah ada — tidak perlu secret baru.

### B. Rate Limiting (Semua Endpoint Publik PWA)

Menggunakan `createRateLimiter()` yang sudah ada di `rate-limit.ts`:

| Endpoint | Limiter | Max | Window |
|---|---|---|---|
| `GET /api/order/katalog` | IP | 30 req | 1 menit |
| `POST /api/order/auth/daftar` | IP | 3 reg | 1 jam |
| `POST /api/order/auth/login` | NIM | 10 attempt | 15 menit |
| `POST /api/order/pesanan` | buyer_id | 5 order | 24 jam |
| `POST /api/order/pesanan/[id]/bukti-transfer` | buyer_id | 3 upload | 1 jam |

### C. Input Validation (Semua Route)

Wajib menggunakan Zod schema parse di controller sebelum menyentuh service:
```typescript
const body = BuyerRegisterSchema.safeParse(await req.json());
if (!body.success) return apiError(body.error.flatten().fieldErrors, 422);
```

### D. Zod Schemas (Buyer Domain)

```typescript
// src/features/order/order.types.ts

export const BuyerRegisterSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  nim: z.string().trim().regex(/^\d{8,15}$/, 'NIM harus 8-15 digit angka'),
  whatsapp: z.string().trim().regex(/^(08|628)\d{8,12}$/, 'Format WA tidak valid'),
});

export const BuyerLoginSchema = z.object({
  nim: z.string().trim().regex(/^\d{8,15}$/),
  fullName: z.string().trim().min(2).max(200),
});

export const CreateOrderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1).max(10),
  deliveryType: z.enum(['PICKUP', 'DELIVERY']),
  deliveryFloor: z.number().int().min(1).max(99).optional(),
  deliveryNote: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(['QRIS', 'TRANSFER']),
}).refine(
  data => data.deliveryType === 'PICKUP' || data.deliveryFloor !== undefined,
  { message: 'Lantai tujuan wajib untuk delivery', path: ['deliveryFloor'] }
);

export const OrderActionSchema = z.object({
  reason: z.string().trim().min(10, 'Alasan minimal 10 karakter').max(500),
});
```

### E. File Upload Security

```typescript
// Validasi MIME dari magic bytes (bukan dari Content-Type header yang bisa di-forge)
const ALLOWED_MAGIC_BYTES: Record<string, string> = {
  'image/jpeg': '\xFF\xD8\xFF',  // JPEG: FFD8FF
  'image/png':  '\x89PNG',       // PNG: 89504E47
  'image/webp': 'RIFF',          // WebP: 52494646 (perlu cek 8 byte ke-9: WEBP)
};

async function validateImageMime(buffer: Buffer): Promise<string> {
  const signature = buffer.slice(0, 4).toString('binary');
  if (signature.startsWith('\xFF\xD8\xFF')) return 'image/jpeg';
  if (signature.startsWith('\x89PNG')) return 'image/png';
  if (signature.startsWith('RIFF') && buffer.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new ValidationError('Format file tidak didukung. Gunakan JPG, PNG, atau WebP.');
}
```

### F. IDOR Prevention (Wajib di Setiap Endpoint)

```typescript
// Pattern wajib di setiap endpoint yang akses resource spesifik:
// 1. Fetch resource dengan ID dari URL
// 2. Cek ownership SEBELUM return data
// 3. Return 404 (bukan 403) jika tidak ditemukan ATAU bukan punya user

// ❌ BANNED: Return 403 yang expose "resource ada tapi bukan punyamu"
// ✅ CORRECT: Return 404 yang generik
if (!order || order.buyerId !== buyerId) {
  return apiError('Pesanan tidak ditemukan', 404);
}
```

### G. Supabase Storage Security

```
Bucket: product-images
  - Public read (URL bisa diakses siapapun — ini OK karena foto produk memang public)
  - Write: hanya via API route dengan SUPABASE_SERVICE_ROLE_KEY di server env

Bucket: payment-proofs
  - Private read (TIDAK public — foto bukti transfer sensitif)
  - Signed URL untuk akses admin: expire 1 jam
  - Write: hanya via API route dengan SUPABASE_SERVICE_ROLE_KEY

RLS Storage:
  - product-images: SELECT public, INSERT/UPDATE via service_role only
  - payment-proofs: SELECT via service_role only, INSERT via service_role only
```

### H. Error Response Standard

Konsisten dengan `apiError()` yang sudah ada di `auth.ts`:
```typescript
// Selalu:
return NextResponse.json({ success: false, error: 'Pesan generik' }, { status: 4xx });

// TIDAK PERNAH expose:
// - Stack trace
// - Nama tabel/kolom DB
// - "Email sudah terdaftar" (terlalu informatif — gunakan "Data sudah terdaftar")
// - "NIM tidak ditemukan" → gunakan "NIM atau nama tidak sesuai"
```

### I. Content Security Policy (CSP) untuk PWA

```typescript
// Tambahkan ke next.config.ts header yang sudah ada:
{
  key: 'Content-Security-Policy',
  value: [
    "default-src 'self'",
    "img-src 'self' data: https://*.supabase.co",  // foto produk dari Supabase
    "script-src 'self' 'unsafe-inline'",             // Next.js butuh inline scripts
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",  // Realtime
    "font-src 'self'",
  ].join('; ')
}
```

---

## 📊 Database Migration Plan

| # | File | Tabel | Tipe | Risk Assessment |
|---|---|---|---|---|
| 1 | `v2_4_storage_bucket.sql` | — | CREATE Supabase Bucket + RLS | ✅ SAFE |
| 2 | `v2_5_online_orders.sql` | `online_orders`, `online_order_items` | CREATE TABLE + ENUM + RLS | ✅ SAFE |
| 3 | `v2_6_buyers.sql` | `buyers` | CREATE TABLE + RLS | ✅ SAFE |
| 4 | `v2_7_notification_logs.sql` | `notification_logs` | CREATE TABLE | ✅ SAFE |

> **Prinsip absolut:** Tidak ada DROP, tidak ada RENAME, tidak ada ALTER pada tabel existing. Kolom `photo_url` di `products` sudah ada — tidak perlu migration. Semua migration idempoten (`IF NOT EXISTS` + `IF NOT EXISTS` pada enum via `DO $$ EXCEPTION`).

**Rollback Plan:** Semua tabel baru dapat di-DROP tanpa dampak ke sistem v1.x karena tidak ada FK dari tabel existing ke tabel baru.

---

## 📅 Roadmap Implementasi

```
FASE 1 — Foundation (~1-2 minggu)
├── 1.1 [BE] API route: POST /api/admin/produk/[id]/foto
│         (upload ke Supabase Storage, update photo_url)
├── 1.2 [FE] UI upload foto di halaman edit produk existing
├── 1.3 [BE+FE] PWA manifest.json + service worker setup
└── 1.4 [FE] Halaman /order katalog (read-only, tanpa auth)

FASE 2 — Core Ordering (~3-4 minggu)
├── 2.1 [DB] Migration v2_6: tabel buyers + RLS
├── 2.2 [DB] Migration v2_5: online_orders + order_items + RLS
├── 2.3 [BE] BuyerAuthService + BuyerRepository
│         (register, login, set sk_buyer cookie)
├── 2.4 [BE] Rate limiters baru (buyer auth, order creation, proof upload)
├── 2.5 [FE] Halaman /order/daftar + /order/login
├── 2.6 [BE] OnlineOrderService + OnlineOrderRepository
│         (create order, validate stock, generate order_number)
├── 2.7 [FE] Halaman /order/checkout (keranjang + delivery options)
├── 2.8 [FE] Halaman /order/payment/[id] (QRIS + transfer + upload bukti)
└── 2.9 [FE] Halaman /order/status/[id] (tracking, polling 30 detik)

FASE 3 — Internal Management (~1-2 minggu, paralel dgn Fase 2)
├── 3.1 [DB] Migration v2_7: notification_logs
├── 3.2 [BE] API admin: konfirmasi, tolak, assign CS, selesai
│         (dengan ACID transaction + race condition guard)
├── 3.3 [FE] Halaman /admin/pesanan-online (tab Menunggu/Proses/Selesai)
├── 3.4 [FE] Badge notifikasi Supabase Realtime di navbar kasir
├── 3.5 [BE] API cs: GET pengiriman saya + POST selesai
└── 3.6 [FE] Tab Pengiriman di dashboard CS

FASE 4 — Polish (~1 minggu)
├── 4.1 [BE] NotificationService (Fonnte WA) + env FONNTE_TOKEN
├── 4.2 [BE] Vercel Cron Job: expire orders (setiap 15 menit)
├── 4.3 [BE+FE] Perbaikan leaderboard mahasiswa (metrik kehadiran)
└── 4.4 QA end-to-end + load test endpoint publik PWA
```

---

## ✅ Definition of Done (Per Fase)

### Fase 1 DONE jika:
- [ ] Foto produk bisa diupload (JPG/PNG/WebP ≤ 2MB) dari halaman admin
- [ ] Foto tampil di halaman admin produk yang sudah ada
- [ ] PWA bisa di-install ke home screen (manifest valid)
- [ ] Katalog PWA tampil dengan foto + stok real-time
- [ ] Lighthouse score: Performance ≥ 85, Accessibility ≥ 95

### Fase 2 DONE jika:
- [ ] Buyer bisa daftar, login, lihat katalog, checkout, upload bukti transfer
- [ ] Nomor order WM-YYYYMMDD-XXXX ter-generate dengan benar dan unik
- [ ] Stok **tidak berkurang** sebelum admin konfirmasi
- [ ] Rate limiting aktif di semua endpoint publik
- [ ] IDOR test: buyer A tidak bisa akses order buyer B (harus dapat 404)
- [ ] Upload hanya terima JPG/PNG/WebP — file .exe ditolak dengan 422

### Fase 3 DONE jika:
- [ ] Badge notif muncul real-time di navbar kasir
- [ ] Admin bisa konfirmasi order — stok berkurang atomic (race condition test: 2 konfirmasi bersamaan untuk stok 1, hanya 1 yang sukses)
- [ ] CS hanya melihat pengiriman yang di-assign ke mereka
- [ ] Cron job expire berjalan setiap 15 menit (test via Vercel cron logs)

### Fase 4 DONE jika:
- [ ] WA notifikasi terkirim < 5 detik setelah event (test dengan nomor WA aktif)
- [ ] Leaderboard menampilkan kehadiran% yang akurat dibanding data manual
- [ ] `notification_logs` mencatat semua event dengan status SENT/FAILED

---

## 🚫 Out of Scope — Wiramart v2.0

| Feature | Alasan Ditunda |
|---|---|
| Sistem poin/reward pembeli | Kompleksitas tinggi, tidak ada permintaan |
| Real-time GPS tracking delivery | Over-engineering untuk skala 1 gedung |
| Payment gateway auto (Midtrans/Xendit) | Volume pesanan masih rendah |
| Multi-lokasi / multi-toko | Wiramart hanya 1 lokasi |
| Rating & review produk | Belum prioritas |
| Push notification (FCM) | Kompleks setup, WA notif cukup untuk sekarang |

---

## 🔖 Glosarium Teknis

| Term | Definisi |
|---|---|
| **Buyer** | Pembeli eksternal via PWA — tabel `buyers`, bukan `employees` atau `admins` |
| **Online Order** | Pesanan dari PWA — tabel `online_orders`, berbeda dari `transactions` kasir POS |
| **Reserve Stok** | Pengurangan `products.stock_qty` yang terjadi **saat admin CONFIRM** (bukan saat order dibuat) via ACID transaction |
| **Delivery Runner** | Employee dengan jabatan CS/Pelayan yang di-assign antar pesanan |
| **Order Number** | Format `WM-YYYYMMDD-XXXX` — di-generate server-side, dipakai juga sebagai `payment_reference` untuk transfer |
| **FEFO** | First Expired First Out — sistem stok existing di v1.x, tidak berubah |
| **sk_buyer** | Cookie HttpOnly untuk session buyer PWA — parallel dengan `sk_admin` dan `sk_kasir` yang sudah ada |
| **ProductPublic** | Type Drizzle `Omit<Product, 'costPrice'>` — wajib dipakai di semua API PWA untuk menyembunyikan HPP |
| **IDOR** | Insecure Direct Object Reference — celah dimana user A bisa akses resource user B via manipulasi ID di URL |

---

## ✍️ Approval & Sign-off

*PRD ini adalah dokumen hidup. Perubahan scope apapun setelah sign-off wajib didiskusikan dan dicatat di sini.*

| Pihak | Nama | Status | Tanggal |
|---|---|---|---|
| Developer / Pemilik Produk | Najmusyafa | 🟡 Review | — |
| Manager / Dosen Pembimbing | — | ⬜ Belum | — |
