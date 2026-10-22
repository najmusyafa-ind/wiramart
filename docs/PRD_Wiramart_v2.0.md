# 📋 PRD — Wiramart v2.0: Campus Delivery System
> **Versi:** 2.1.0 — Campus Reality Edition  
> **Tanggal Dibuat:** 2026-10-13 | **Terakhir Diperbarui:** 2026-10-22  
> **Pemilik Produk:** Najmusyafa (Developer / Mahasiswa UNPERBA)  
> **Status:** 🟡 DRAFT — Menunggu Final Approval Dosen/Manager  

---

> [!IMPORTANT]
> **Prinsip Absolut:** PRD ini adalah ekstensi ekosistem. TIDAK BOLEH ada perubahan pada kode, tabel, atau logika yang sudah berjalan di v1.x. Semua pengembangan bersifat **purely additive**.

---

## 🏫 Bab 1 — Konteks dan Masalah Nyata

### 1.1 Realita Fisik Kampus UNPERBA

Gedung utama terdiri dari **4 lantai + Auditorium**. Tidak ada lift. Tangga adalah satu-satunya akses vertikal. Wiramart di **Lantai 1**.

### 1.2 Persona Pengguna

**Persona A — Rini, Mahasiswi Semester 5 (Lantai 3)**
> Jeda kelas 15 menit tidak cukup untuk turun-naik 3 lantai tangga. Harus memilih antara makan atau hadir tepat waktu.

**Persona B — Pak Deden, Dosen (Lantai 4)**
> Mengajar 3 SKS non-stop. Tidak bisa meninggalkan kelas hanya untuk beli air minum.

**Persona C — Kelompok Skripsi (Lantai 2)**
> Rapat dari jam 13.00. Jika satu orang turun belikan, ketinggalan diskusi penting.

**Persona D — Mahasiswa Disabilitas (Lantai 2)**
> Naik-turun tangga butuh 2x lebih lama dan melelahkan. Sering pilih tidak makan daripada capek.

### 1.3 Solusi

Sistem **delivery internal kampus** berbasis PWA: pembeli pesan dari HP, runner (CS/Pelayan piket lantai 1) antarkan ke lantai tujuan. Ongkir = insentif langsung runner.

---

## 🗺️ Bab 2 — Arsitektur Sistem

```
CONSUMER PWA (/order)          INTERNAL DASHBOARD (existing)
─ Katalog real-time            MANAGER     → full access
─ Keranjang & Checkout         ADMIN_SHIFT → /admin/pesanan-online
─ Delivery/Pickup picker       CS/PELAYAN  → Tab "Pengiriman Saya"
─ Upload bukti transfer        KASIR       → POS + Badge Notif
─ Tracking + PIN serah terima

API Layer (Next.js Route Handlers — Controller max 30 baris)
/api/order/*          → PUBLIC + rate-limited
/api/admin/pesanan/*  → PROTECTED: ADMIN_SHIFT + MANAGER
/api/cs/pengiriman/*  → PROTECTED: CS/PELAYAN only
/api/system/*         → INTERNAL: Cron + secret header

Supabase PostgreSQL
existing: admins, employees, shifts, products, transactions, stock_batches
new v2.0: buyers, online_orders, online_order_items, notification_logs
```

### 2.1 Prinsip Non-Negotiable

| Prinsip | Detail |
|---|---|
| Purely Additive | TIDAK ada DROP/ALTER/RENAME tabel existing |
| Stok Reserve Late | Stok dikurangi HANYA saat admin CONFIRM (bukan saat order) |
| Server-Side Trust | Harga, ongkir, total — selalu dihitung ulang di server |
| No cost_price Leak | ProductPublic type wajib — HPP tidak pernah ke PWA |
| IDOR by Default | Ownership check sebelum return data di setiap endpoint |
| Delivery Fee = Insentif | Ongkir bukan profit toko — langsung jadi insentif runner |

---

## 👥 Bab 3 — Aktor dan Role

| Aktor | Tabel DB | Hak Akses v2.0 |
|---|---|---|
| Buyer | buyers (baru) | PWA: katalog, order, payment, tracking |
| CS/Pelayan | employees | Tab Pengiriman + PIN verify + no-show report |
| Admin Shift | admins (ADMIN_SHIFT) | /admin/pesanan-online: konfirmasi, assign, kelola |
| Kasir | employees (Kasir) | Badge notif di navbar POS existing |
| Manager | admins (MANAGER) | Full akses + laporan delivery + leaderboard |

### 3.1 Insentif Runner (Kritis untuk Motivasi)

| Lantai Tujuan | Ongkir Buyer | Insentif Runner |
|---|---|---|
| Lantai 1 / Pickup | Rp 0 | Rp 0 |
| Lantai 2 | Rp 1.000 | Rp 1.000 |
| Lantai 3 | Rp 2.000 | Rp 2.000 |
| Lantai 4 | Rp 2.000 | Rp 2.000 |
| Auditorium | Rp 2.000 | Rp 2.000 |

---

## 📊 Bab 4 — ERD (Entity Relationship Diagram)

### 4.1 Tabel Baru v2.0

**buyers**
- id UUID PK
- full_name VARCHAR(200)
- nim VARCHAR(20) — UNIQUE partial index (WHERE deleted_at IS NULL)
- whatsapp VARCHAR(20) — format internasional 628xx
- is_active BOOLEAN DEFAULT TRUE
- is_flagged BOOLEAN DEFAULT FALSE
- flagged_reason TEXT
- flagged_by → admins.id
- flagged_at TIMESTAMPTZ
- created_at, updated_at, deleted_at

**online_orders**
- id UUID PK
- order_number VARCHAR(25) UNIQUE — format WM-YYYYMMDD-XXXX
- buyer_id → buyers.id
- delivery_type ENUM(PICKUP, DELIVERY)
- delivery_floor SMALLINT (1, 2, 3, 4, 99=Auditorium)
- delivery_fee INTEGER IDR
- delivery_note VARCHAR(200)
- **room_detail VARCHAR(100)** — *BARU* wajib untuk DELIVERY ("R.301", "Lab Komputer B")
- assigned_cs_id → employees.id
- assigned_at, assigned_by → admins.id
- **handover_pin VARCHAR(6)** — *BARU* 6-digit, di-generate saat CONFIRMED
- **handover_confirmed_at TIMESTAMPTZ** — *BARU* saat PIN cocok
- **no_show_count SMALLINT DEFAULT 0** — *BARU* counter buyer tidak ada di lokasi
- payment_method ENUM(QRIS, TRANSFER)
- payment_reference VARCHAR(25)
- payment_proof_url TEXT
- payment_verified_at, payment_verified_by → admins.id
- status ENUM (9 nilai — lihat Bab 5)
- cancelled_reason, rejected_reason TEXT
- confirmed_by → admins.id, confirmed_at
- completed_at, expired_at, cancelled_by → admins.id
- subtotal, total_amount INTEGER IDR
- created_at, updated_at, deleted_at

**online_order_items**
- id UUID PK
- order_id → online_orders.id (ON DELETE CASCADE)
- product_id → products.id
- product_name VARCHAR(200) — SNAPSHOT saat order dibuat
- selling_price INTEGER — SNAPSHOT saat order dibuat
- quantity INTEGER
- subtotal INTEGER
- created_at

**notification_logs**
- id UUID PK
- event_type VARCHAR(50)
- recipient_wa VARCHAR(20)
- recipient_name VARCHAR(200)
- message TEXT
- status VARCHAR(20) DEFAULT 'PENDING' — (PENDING, SENT, FAILED)
- provider_response JSONB
- error_message TEXT
- order_id → online_orders.id
- sent_at, created_at

### 4.2 Kolom Baru — Penjelasan

| Kolom | Fungsi |
|---|---|
| room_detail | Lokasi spesifik "R.301" — wajib diisi agar runner tidak salah ruang |
| handover_pin | PIN 6 digit anti-fraud serah terima — buyer tunjukkan ke runner |
| handover_confirmed_at | Bukti digital serah terima berhasil |
| no_show_count | Counter buyer tidak ada — jika 2x admin dinotif untuk cancel |

### 4.3 Index Kritis

```sql
-- Dashboard admin (query terbanyak)
CREATE INDEX idx_online_orders_status
  ON online_orders(status, created_at DESC) WHERE deleted_at IS NULL;

-- Badge kasir
CREATE INDEX idx_online_orders_pending
  ON online_orders(created_at DESC)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION','WAITING_CONFIRMATION')
    AND deleted_at IS NULL;

-- Tab CS (IDOR-safe per runner)
CREATE INDEX idx_online_orders_cs
  ON online_orders(assigned_cs_id, status)
  WHERE assigned_cs_id IS NOT NULL AND deleted_at IS NULL;

-- Login buyer
CREATE UNIQUE INDEX idx_buyers_nim_active
  ON buyers(nim) WHERE deleted_at IS NULL;
```

---

## 🔄 Bab 5 — State Machine Pesanan

### 5.1 Diagram State

```
[Buyer submit pesanan]
        │
        ├─ QRIS ──────────────────────────────┐
        │                                     │
        └─ TRANSFER ──►[WAITING_PAYMENT_VERIFICATION]
                            │
                       Admin cek foto bukti:
                       OK  → [WAITING_CONFIRMATION]
                       Palsu → [REJECTED]
                                     │
                             [WAITING_CONFIRMATION] (dari QRIS juga)
                                     │
                       ├── 2 jam berlalu → [EXPIRED] (cron)
                       ├── Buyer cancel → [CANCELLED]
                       ├── Admin tolak  → [REJECTED]
                       │
                  Admin KONFIRMASI (ACID Transaction):
                  ├── SELECT FOR UPDATE order
                  ├── Kurangi stock_qty tiap item
                  ├── Generate handover_pin
                  └── status → [CONFIRMED]
                             │
                  Admin assign CS + klik Proses
                             │
                         [PREPARING]
                             │
                  CS klik "Sedang Diantar"
                             │
                    [OUT_FOR_DELIVERY]
                             │
              ┌──────────────┤
              │              │
    Buyer ada + PIN cocok    Buyer tidak ada
    CS input PIN             no_show_count++
    [COMPLETED]              WA peringatan ke buyer
                             Jika >= 2x: admin cancel
                             stok dikembalikan
                             buyer di-flag
```

### 5.2 Tabel Transisi (Exhaustive)

| Status Awal | Event | Status Baru | Trigger | Efek Stok |
|---|---|---|---|---|
| — | Checkout QRIS | WAITING_CONFIRMATION | Buyer | Tidak berubah |
| — | Checkout TRANSFER | WAITING_PAYMENT_VERIFICATION | Buyer | Tidak berubah |
| WAITING_PAYMENT_VERIFICATION | Foto valid | WAITING_CONFIRMATION | Admin | Tidak berubah |
| WAITING_PAYMENT_VERIFICATION | Foto palsu | REJECTED | Admin | Tidak berubah |
| WAITING_* | 2 jam berlalu | EXPIRED | System (cron) | Tidak berubah |
| WAITING_* | Buyer cancel | CANCELLED | Buyer | Tidak berubah |
| WAITING_CONFIRMATION | Admin Konfirmasi | CONFIRMED | Admin | **Stok berkurang (ACID)** |
| WAITING_CONFIRMATION | Admin Tolak | REJECTED | Admin | Tidak berubah |
| CONFIRMED | Assign CS + Proses | PREPARING | Admin | Tidak berubah |
| CONFIRMED | Admin Cancel | CANCELLED | Admin | **Stok kembali (ACID)** |
| PREPARING | CS berangkat | OUT_FOR_DELIVERY | CS | Tidak berubah |
| OUT_FOR_DELIVERY | PIN cocok | COMPLETED | CS + Buyer | Tidak berubah |
| OUT_FOR_DELIVERY | 2x no-show + cancel | CANCELLED | Admin | **Stok kembali (ACID)** |

### 5.3 Logika PIN Handover

```typescript
function generateHandoverPin(): string {
  let pin: string;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (/^(.)\1{5}$/.test(pin)); // reject semua digit sama (000000, 111111)
  return pin;
}
// PIN dikirim ke buyer via WA dan tampil di halaman status
// CS input PIN di Tab Pengiriman → verifikasi → COMPLETED
```

### 5.4 Skenario No-Show

```
CS naik ke lantai 3, R.301 — buyer tidak ada
→ CS klik "Buyer Tidak Ada"
→ no_show_count++ (misal: 1)
→ WA ke buyer: "Runner menunggu di Lantai 3 R.301, segera ke sana!"
→ Runner tunggu 5 menit

Jika no_show_count = 2:
→ CS klik "2x No-Show"
→ Admin SHIFT dinotif WA
→ Admin cancel order → CANCELLED + stok kembali (ACID)
→ Buyer: is_flagged = TRUE, is_active = FALSE (7 hari)
→ WA buyer: "Pesanan dibatalkan karena 2x tidak ada saat pengiriman."
```

---

## 📱 Bab 6 — User Journey Lengkap

### 6.1 Journey Buyer

**Step 1 — Buka Katalog (tanpa login)**
Buka [url]/order → katalog tampil public → lihat produk, harga, stok → filter kategori

**Step 2 — Login/Daftar**
Klik tambah produk → prompt login
- Daftar: Nama + NIM + No.WA → langsung login
- Login: NIM + Nama Lengkap → langsung masuk
- Cookie sk_buyer: HttpOnly, path=/order, 7 hari

**Step 3 — Isi Keranjang**
Tambah produk → quantity max stok → maks 10 jenis produk → lihat CartDrawer

**Step 4 — Checkout**
```
Pilih metode:
  ○ Ambil Sendiri (Pickup) → ongkir Rp 0
  ● Diantarkan             → pilih lantai → isi detail ruang (WAJIB)

Catatan pesanan (opsional, maks 200 char)

Pilih pembayaran:
  ○ QRIS — scan QR di Wiramart
  ● Transfer Bank — transfer ke rekening + upload struk

Ringkasan:
  Aqua 600ml x2 = Rp 8.000
  Oreo Original x1 = Rp 6.000
  Subtotal = Rp 14.000
  Ongkir L3 = Rp 2.000
  TOTAL = Rp 16.000

[Pesan Sekarang]
```

**Step 5 — Pembayaran**
- QRIS: scan → isi nominal → klik "Sudah Bayar" → WAITING_CONFIRMATION
- TRANSFER: transfer → foto struk → upload → WAITING_PAYMENT_VERIFICATION

**Step 6 — Tracking**
```
/order/status/[orderId]
Progress: [Menunggu]→[Dikonfirmasi]→[Disiapkan]→[Diantar]→[Selesai]

Jika CONFIRMED: tampil PIN = 123456 (untuk ditunjukkan ke runner)
Jika OUT_FOR_DELIVERY: "Budi Santoso sedang naik ke Lantai 3"
Polling setiap 30 detik (bukan Realtime — hemat koneksi)
Tombol "Batalkan" tersedia selama WAITING_*
```

**Step 7 — Serah Terima**
Runner tiba → buyer tunjukkan PIN → runner input PIN → PIN cocok → COMPLETED

### 6.2 Journey Admin Shift

```
/admin/pesanan-online

Tab: [Menunggu ●3] [Diproses ●1] [Selesai] [Dibatalkan/Ditolak]

Card pesanan:
  #WM-20261013-0042 | Rini Andriani (NIM: 12345678)
  DELIVERY Lantai 3 — R.301 | "Ketuk pelan"
  TRANSFER [Lihat Foto Bukti] | 10 menit lalu | Expire 1j 50m
  Aqua 600ml x2 + Oreo x1 | Total Rp 16.000
  [✅ Konfirmasi] [❌ Tolak] [🚫 Batalkan]

Setelah konfirmasi:
  Assign runner → dropdown CS yang HADIR shift hari ini
  [Assign & Proses]
```

### 6.3 Journey CS/Pelayan

```
Tab "Pengiriman Saya"

#WM-20261013-0042
  Lantai 3 — R.301 | "Ketuk pelan"
  Rini Andriani | WA: 0812xxxx

  ☐ Aqua 600ml x2
  ☐ Oreo Original x1

  [🚀 Siapkan & Berangkat] → OUT_FOR_DELIVERY

Sampai di lokasi:
  Input PIN buyer: [_ _ _ _ _ _]
  [✅ Konfirmasi Serah Terima] → COMPLETED

  Atau: [⚠️ Buyer Tidak Ada] → no_show_count++
```

---

## 🛠️ Bab 7 — Spesifikasi Teknis

### 7.1 SQL Migration

#### v2_6_buyers.sql
```sql
CREATE TABLE IF NOT EXISTS buyers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      VARCHAR(200) NOT NULL,
  nim            VARCHAR(20) NOT NULL,
  whatsapp       VARCHAR(20) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_flagged     BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_reason TEXT,
  flagged_by     UUID REFERENCES admins(id),
  flagged_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_buyers_nim_active
  ON buyers(nim) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_buyers_whatsapp
  ON buyers(whatsapp) WHERE deleted_at IS NULL;

ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buyers_self_read" ON buyers FOR SELECT
  USING (auth.uid()::text = id::text
    OR EXISTS (
      SELECT 1 FROM admins
      WHERE admins.id::text = auth.uid()::text AND admins.deleted_at IS NULL
    ));

CREATE POLICY "buyers_service_role_all" ON buyers FOR ALL
  USING (auth.role() = 'service_role');
```

#### v2_5_online_orders.sql (ringkas)
```sql
DO $$ BEGIN
  CREATE TYPE online_order_status AS ENUM (
    'WAITING_PAYMENT_VERIFICATION','WAITING_CONFIRMATION',
    'CONFIRMED','PREPARING','OUT_FOR_DELIVERY',
    'COMPLETED','CANCELLED','REJECTED','EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE online_delivery_type AS ENUM ('PICKUP','DELIVERY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE online_payment_method AS ENUM ('QRIS','TRANSFER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS online_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number          VARCHAR(25) NOT NULL UNIQUE,
  buyer_id              UUID NOT NULL REFERENCES buyers(id),
  delivery_type         online_delivery_type NOT NULL,
  delivery_floor        SMALLINT CHECK (delivery_floor IN (1,2,3,4,99)),
  delivery_fee          INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_note         VARCHAR(200),
  room_detail           VARCHAR(100),
  assigned_cs_id        UUID REFERENCES employees(id),
  assigned_at           TIMESTAMPTZ,
  assigned_by           UUID REFERENCES admins(id),
  handover_pin          VARCHAR(6),
  handover_confirmed_at TIMESTAMPTZ,
  no_show_count         SMALLINT NOT NULL DEFAULT 0,
  payment_method        online_payment_method NOT NULL,
  payment_reference     VARCHAR(25),
  payment_proof_url     TEXT,
  payment_verified_at   TIMESTAMPTZ,
  payment_verified_by   UUID REFERENCES admins(id),
  status                online_order_status NOT NULL DEFAULT 'WAITING_CONFIRMATION',
  cancelled_reason      TEXT,
  rejected_reason       TEXT,
  cancelled_by          UUID REFERENCES admins(id),
  confirmed_by          UUID REFERENCES admins(id),
  confirmed_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,
  subtotal              INTEGER NOT NULL CHECK (subtotal > 0),
  total_amount          INTEGER NOT NULL CHECK (total_amount > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS online_order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  product_name  VARCHAR(200) NOT NULL,
  selling_price INTEGER NOT NULL CHECK (selling_price > 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  subtotal      INTEGER NOT NULL CHECK (subtotal > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_online_orders_status
  ON online_orders(status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_online_orders_pending
  ON online_orders(created_at DESC)
  WHERE status IN ('WAITING_PAYMENT_VERIFICATION','WAITING_CONFIRMATION')
    AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_online_orders_cs
  ON online_orders(assigned_cs_id, status)
  WHERE assigned_cs_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_online_order_items_order
  ON online_order_items(order_id);

-- RLS
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "online_orders_buyer_self" ON online_orders FOR SELECT
  USING (buyer_id::text = auth.uid()::text);
CREATE POLICY "online_orders_staff_read" ON online_orders FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND deleted_at IS NULL)
  );
CREATE POLICY "online_orders_service_role" ON online_orders FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "online_order_items_service_role" ON online_order_items FOR ALL
  USING (auth.role() = 'service_role');
```

#### v2_7_notification_logs.sql
```sql
CREATE TABLE IF NOT EXISTS notification_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        VARCHAR(50) NOT NULL,
  recipient_wa      VARCHAR(20) NOT NULL,
  recipient_name    VARCHAR(200),
  message           TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  provider_response JSONB,
  error_message     TEXT,
  order_id          UUID REFERENCES online_orders(id),
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_logs_order
  ON notification_logs(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs(status, created_at DESC);
```

### 7.2 API Routes

```
BUYER AUTH
  POST /api/order/auth/daftar    — 3 reg/jam/IP
  POST /api/order/auth/login     — 10 attempt/15min/NIM
  POST /api/order/auth/logout

KATALOG (PUBLIC)
  GET  /api/order/katalog        — 30 req/min/IP, cache 30s, no cost_price

ORDER LIFECYCLE
  POST /api/order/pesanan                    — 5 order/24jam/buyer_id
  POST /api/order/pesanan/[id]/bukti-transfer — 3 upload/jam/buyer_id
  GET  /api/order/pesanan/[id]               — IDOR: buyer_id check
  POST /api/order/pesanan/[id]/batalkan      — hanya saat WAITING_*

ADMIN PESANAN
  GET  /api/admin/pesanan?status=&page=&limit=20
  POST /api/admin/pesanan/[id]/konfirmasi    — ACID: stok + PIN + status
  POST /api/admin/pesanan/[id]/tolak         — body: { reason }
  POST /api/admin/pesanan/[id]/batalkan      — ACID: kembalikan stok jika CONFIRMED
  POST /api/admin/pesanan/[id]/assign-cs     — validasi CS hadir shift aktif
  POST /api/admin/pesanan/[id]/proses        — status PREPARING

CS PENGIRIMAN
  GET  /api/cs/pengiriman            — WAJIB WHERE assigned_cs_id=payload.sub
  POST /api/cs/pengiriman/[id]/berangkat       — status OUT_FOR_DELIVERY
  POST /api/cs/pengiriman/[id]/verifikasi-pin  — { pin } → COMPLETED
  POST /api/cs/pengiriman/[id]/no-show         — no_show_count++

SYSTEM
  GET  /api/system/expire-orders  — Authorization: Bearer {CRON_SECRET}
```

### 7.3 Delivery Fee (Server-Side)

```typescript
// TIDAK PERNAH percaya deliveryFee dari client request
const DELIVERY_FEE_MAP: Record<number, number> = {
  1: 0, 2: 1_000, 3: 2_000, 4: 2_000, 99: 2_000,
};

function calculateDeliveryFee(type: 'PICKUP' | 'DELIVERY', floor?: number): number {
  if (type === 'PICKUP') return 0;
  if (!floor) throw new ValidationError('Lantai tujuan wajib untuk delivery');
  const fee = DELIVERY_FEE_MAP[floor];
  if (fee === undefined) throw new ValidationError(`Lantai ${floor} tidak valid`);
  return fee;
}
```

### 7.4 ACID Transaction — Konfirmasi + Reserve Stok

```typescript
async function confirmOrder(orderId: string, adminId: string, items: OrderItem[]) {
  return db.transaction(async (tx) => {
    // 1. Lock order row — prevent double confirmation
    const [order] = await tx.select().from(online_orders)
      .where(and(
        eq(online_orders.id, orderId),
        eq(online_orders.status, 'WAITING_CONFIRMATION'),
      ))
      .for('update').limit(1);

    if (!order) throw new AppError('ORDER_NOT_CONFIRMABLE', 409);

    // 2. Reserve stok tiap item
    for (const item of items) {
      const [updated] = await tx.update(products)
        .set({ stockQty: sql`stock_qty - ${item.quantity}`, updatedAt: new Date() })
        .where(and(
          eq(products.id, item.productId),
          gte(products.stockQty, item.quantity),
        ))
        .returning({ id: products.id });

      if (!updated) throw new AppError(`STOCK_INSUFFICIENT:${item.productId}`, 409);
    }

    // 3. Generate PIN + update status
    const pin = generateHandoverPin();
    await tx.update(online_orders)
      .set({ status: 'CONFIRMED', confirmedBy: adminId, confirmedAt: new Date(),
             handoverPin: pin, updatedAt: new Date() })
      .where(eq(online_orders.id, orderId));

    return { handoverPin: pin };
  });
}
```

### 7.5 Zod Schemas

```typescript
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
  deliveryType: z.enum(['PICKUP','DELIVERY']),
  deliveryFloor: z.number().int()
    .refine(v => [1,2,3,4,99].includes(v), 'Lantai tidak valid').optional(),
  roomDetail: z.string().trim().min(1).max(100).optional(),
  deliveryNote: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(['QRIS','TRANSFER']),
})
.refine(d => d.deliveryType === 'PICKUP' || d.deliveryFloor !== undefined,
  { message: 'Lantai tujuan wajib untuk delivery', path: ['deliveryFloor'] })
.refine(d => d.deliveryType === 'PICKUP' || (d.roomDetail && d.roomDetail.length > 0),
  { message: 'Detail ruang wajib diisi untuk delivery', path: ['roomDetail'] });

export const PinVerifySchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN harus 6 digit angka'),
});

export const OrderActionSchema = z.object({
  reason: z.string().trim().min(10, 'Min 10 karakter').max(500),
});
```

### 7.6 WA Notification Templates

```typescript
// Fire-and-forget — TIDAK blocking alur utama order
const T = {
  ORDER_CREATED: (name: string, no: string, total: number) =>
    `Halo ${name}! 🎉\nPesanan *#${no}* diterima!\nTotal: *Rp ${total.toLocaleString('id-ID')}*\nBayar dalam 2 jam ya.\n\n_Wiramart UNPERBA_`,

  ORDER_CONFIRMED: (no: string, pin: string) =>
    `Pesanan *#${no}* dikonfirmasi! ✅\nSedang disiapkan.\n🔐 *PIN Serah Terima: ${pin}*\nTunjukkan ke runner saat barang tiba.\n\n_Wiramart UNPERBA_`,

  OUT_FOR_DELIVERY: (no: string, cs: string, floor: number | string) =>
    `Pesanan *#${no}* diantar! 🏃\n*${cs}* naik ke *Lantai ${floor}*.\nSiapkan PIN kamu!\n\n_Wiramart UNPERBA_`,

  ORDER_COMPLETED: (no: string) =>
    `Pesanan *#${no}* selesai! 😊\nTerima kasih sudah pesan di Wiramart UNPERBA!\n\n_Wiramart UNPERBA_`,

  ORDER_CANCELLED: (no: string, reason: string) =>
    `Pesanan *#${no}* dibatalkan.\nAlasan: ${reason}\n\n_Wiramart UNPERBA_`,

  NO_SHOW_WARNING: (no: string, floor: number | string, room: string) =>
    `⚠️ Runner menunggu di *Lantai ${floor} — ${room}*.\nOrder: *#${no}*\nSegera ke lokasi dalam 5 menit!\n\n_Wiramart UNPERBA_`,

  NEW_ORDER_ADMIN: (no: string, buyer: string, total: number, method: string) =>
    `🛒 *[Pesanan Baru]* #${no}\nDari: ${buyer}\nTotal: Rp ${total.toLocaleString('id-ID')} | ${method}\nSegera konfirmasi di dashboard.`,

  CS_ASSIGNED: (no: string, buyer: string, floor: number | string, room: string, note?: string) =>
    `📦 *Pesanan untuk kamu antar!*\n#${no} ke *Lantai ${floor} — ${room}*\nPembeli: ${buyer}${note ? '\nCatatan: ' + note : ''}\n\n_Wiramart UNPERBA_`,
};
```

---

## 🔐 Bab 8 — Keamanan

### 8.1 Authentication

| Layer | Cookie | Path | Expiry |
|---|---|---|---|
| Admin/Manager | sk_admin | /admin | 8 jam |
| Kasir/Karyawan | sk_kasir | / | 8 jam |
| Buyer (BARU) | sk_buyer | /order | 7 hari |

### 8.2 Rate Limiting

| Endpoint | Jenis Limiter | Max | Window |
|---|---|---|---|
| GET /api/order/katalog | IP | 30 req | 1 menit |
| POST .../auth/daftar | IP | 3 | 1 jam |
| POST .../auth/login | NIM | 10 | 15 menit |
| POST /api/order/pesanan | buyer_id | 5 | 24 jam |
| POST .../bukti-transfer | buyer_id | 3 | 1 jam |

### 8.3 IDOR Prevention

```typescript
// ❌ Jangan return 403 (expose resource ada tapi bukan milikmu)
// ✅ Selalu return 404 generik

// Buyer endpoint:
const [order] = await db.select().from(online_orders)
  .where(and(
    eq(online_orders.id, orderId),
    eq(online_orders.buyerId, buyerPayload.sub), // ownership check IN query
    isNull(online_orders.deletedAt),
  )).limit(1);
if (!order) return apiError('Pesanan tidak ditemukan', 404);

// CS endpoint:
const [order] = await db.select().from(online_orders)
  .where(and(
    eq(online_orders.id, orderId),
    eq(online_orders.assignedCsId, csPayload.sub),
    isNull(online_orders.deletedAt),
  )).limit(1);
if (!order) return apiError('Pesanan tidak ditemukan', 404);
```

### 8.4 File Upload — Magic Bytes Validation

```typescript
async function validateImageBuffer(buffer: Buffer): Promise<void> {
  const h = buffer.slice(0, 12);
  const isJpeg = h[0]===0xFF && h[1]===0xD8 && h[2]===0xFF;
  const isPng  = h[0]===0x89 && h.slice(1,4).toString()==='PNG';
  const isWebp = h.slice(0,4).toString()==='RIFF' && h.slice(8,12).toString()==='WEBP';
  if (!isJpeg && !isPng && !isWebp)
    throw new ValidationError('Format tidak didukung. Gunakan JPG, PNG, atau WebP.');
  if (buffer.byteLength > 2 * 1024 * 1024)
    throw new ValidationError('Ukuran file maksimal 2MB.');
}
```

### 8.5 Storage Config

| Bucket | READ | WRITE | Path |
|---|---|---|---|
| product-images | Public | Service Role only | {product_id}.webp |
| payment-proofs | Signed URL 1 jam | Service Role only | {order_id}.jpg |

---

## 📅 Bab 9 — Roadmap

### 9.1 Fase dan Timeline

| Fase | Isi | Estimasi |
|---|---|---|
| Fase 1 Foundation | DB migration, upload foto produk, buyer auth, PWA manifest | 1-2 minggu |
| Fase 2 Core Ordering | Katalog PWA, checkout, payment, tracking, riwayat | 3-4 minggu |
| Fase 3 Internal Mgmt | Badge kasir, dashboard admin pesanan, tab CS, cron expire | 1-2 minggu (paralel) |
| Fase 4 Polish | WA notif Fonnte, laporan insentif runner, update leaderboard | 1 minggu |

### 9.2 Migration Plan

| File | Aksi | Risk |
|---|---|---|
| v2_5_online_orders.sql | CREATE TABLE + ENUM + INDEX + RLS | ✅ SAFE |
| v2_6_buyers.sql | CREATE TABLE + INDEX + RLS | ✅ SAFE |
| v2_7_notification_logs.sql | CREATE TABLE + INDEX | ✅ SAFE |

**Rollback:** DROP ketiga tabel baru. Tidak ada FK dari tabel existing ke tabel baru.

### 9.3 Environment Variables Baru

```bash
FONNTE_TOKEN=your_fonnte_api_token
CRON_SECRET=random_32_char_string
```

---

## ✅ Bab 10 — Definition of Done

### Fase 1 Done jika:
- [ ] Upload foto produk JPG/PNG/WebP <= 2MB dari halaman admin
- [ ] Foto tampil di katalog PWA; placeholder SVG jika belum ada foto
- [ ] Buyer bisa daftar (NIM+Nama+WA) dan langsung login
- [ ] Cookie sk_buyer: HttpOnly, path=/order, Secure (prod), 7 hari
- [ ] PWA installable ke home screen Android (Lighthouse PWA >= 90)

### Fase 2 Done jika:
- [ ] Buyer di lantai 3 bisa pesan, pilih DELIVERY Lantai 3, isi "R.301"
- [ ] room_detail kosong → server tolak 422 (jika deliveryType DELIVERY)
- [ ] Ongkir L3 = Rp 2.000 tidak bisa dimanipulasi (test Burp Suite)
- [ ] Stok TIDAK berkurang sebelum admin konfirmasi (cek DB langsung)
- [ ] IDOR test: buyer A tidak bisa akses order buyer B → 404
- [ ] Upload file .exe → 422
- [ ] Order ke-6 dalam 24 jam → 429

### Fase 3 Done jika:
- [ ] Badge notif kasir muncul real-time tanpa refresh halaman
- [ ] Race condition: 2 konfirmasi bersamaan stok=1 → hanya 1 sukses, 1 dapat 409
- [ ] PIN 6 digit ter-generate, terkirim via WA ke buyer
- [ ] CS input PIN benar → COMPLETED + handover_confirmed_at ter-isi
- [ ] No-show 2x → admin dinotif, cancel → stok kembali → buyer di-flag
- [ ] CS A tidak bisa akses pesanan CS B → 404
- [ ] Cron expire berjalan (verifikasi via Vercel cron logs)

### Fase 4 Done jika:
- [ ] WA notif terkirim < 5 detik setelah setiap event
- [ ] notification_logs mencatat semua event: SENT/FAILED
- [ ] Laporan insentif runner per shift tersedia di dashboard Manager

---

## 🚫 Bab 11 — Out of Scope v2.0

| Feature | Alasan |
|---|---|
| Real-time GPS tracking runner | Over-engineering untuk 1 gedung. PIN handover sudah cukup. |
| Payment gateway otomatis (Midtrans/Xendit) | Volume pesanan masih rendah. |
| Sistem poin/reward buyer | Kompleks, belum ada permintaan. |
| Rating & review produk | Belum prioritas. |
| Push notification (FCM/APNs) | WA notif sudah cukup. |
| Multi-toko / multi-lokasi | Wiramart hanya 1 lokasi. |
| Chat in-app buyer-runner | WA sudah ada. |
| Pre-order untuk hari besok | Hanya untuk kebutuhan hari ini. |

---

## 🔖 Bab 12 — Glosarium

| Term | Definisi |
|---|---|
| Buyer | Mahasiswa/dosen yang memesan via PWA. Tabel buyers, bukan employees. |
| Runner | CS/Pelayan yang mengantarkan pesanan naik tangga ke lantai pembeli. |
| Online Order | Pesanan dari PWA (tabel online_orders). Berbeda dari transactions kasir POS. |
| Reserve Stok | Pengurangan stock_qty yang terjadi saat admin CONFIRM via ACID transaction. |
| PIN Handover | 6-digit PIN yang di-generate saat CONFIRMED. Bukti digital serah terima. |
| No-show | Buyer tidak ada di lokasi saat runner tiba. 2x → buyer di-flag. |
| room_detail | Nomor ruang spesifik. Wajib diisi untuk DELIVERY. |
| Delivery Fee | Ongkir buyer = insentif langsung runner. Bukan profit toko. |
| FEFO | First Expired First Out. Sistem stok existing v1.x. Tidak berubah. |
| sk_buyer | Cookie HttpOnly session buyer, scoped path=/order. |
| ProductPublic | Omit<Product, costPrice>. Wajib di semua API PWA. HPP tidak terekspos. |
| IDOR | Insecure Direct Object Reference. User A tidak boleh akses resource user B. |

---

## ✍️ Approval dan Sign-off

| Pihak | Nama | Status | Tanggal |
|---|---|---|---|
| Developer / Pemilik Produk | Najmusyafa | 🟡 Review | 2026-10-22 |
| Manager / Dosen Pembimbing | — | ⬜ Belum | — |

---

*Setiap keputusan teknis dalam dokumen ini — dari PIN handover, room_detail yang wajib diisi, hingga floor-based fee map — dirancang berdasarkan satu realita yang sangat konkret: **Gedung kampus UNPERBA tidak punya lift, dan mahasiswa berhak mendapatkan akses yang setara ke layanan Wiramart tanpa harus berjuang di tangga.***
