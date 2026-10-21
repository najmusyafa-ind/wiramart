# 📋 PRD — Wiramart v3.0: Sistem Manajemen Gudang Terintegrasi
> **Versi:** 3.0.0 — Warehouse Intelligence Edition  
> **Tanggal Dibuat:** 2026-10-17  
> **Pemilik Produk:** Najmusyafa (Developer / Mahasiswa UNPERBA)  
> **Status:** 🟡 DRAFT — Menunggu Final Approval Dosen/Manager  
> **Sumber Referensi:** Rekaman Operasional Wiramart (15 Menit 18 Detik)  
> **Dokumen Terkait:** [`PRD_Wiramart_v2.0.md`](./PRD_Wiramart_v2.0.md) · [`schema.ts`](../../src/lib/db/schema.ts)

---

> [!IMPORTANT]
> **Prinsip Absolut:** PRD ini adalah kelanjutan dari v1.x (POS) dan v2.0 (PWA). Semua pengembangan bersifat **purely additive**. Sistem kasir, transaksi, stok FEFO, shift, semua RLS yang ada di v1.x, dan seluruh fitur PWA di v2.0 **tidak boleh disentuh sama sekali**. PRD ini hanya menambah lapisan baru di atas fondasi yang sudah ada.

> [!NOTE]
> **Fokus Utama v3.0:** Sistem ini secara khusus memperkuat **peran GUDANG (Mahasiswa Stock)** yang selama ini paling lemah di ekosistem Wiramart — tidak ada SOP digital, tidak ada approval workflow, tidak ada early warning system yang terpadu untuk kedaluwarsa, dan beban kerja tidak terdistribusi dengan jelas.

---

## 🎯 Latar Belakang & Problem Statement

### Akar Masalah (dari Rekaman Operasional)

Berdasarkan rekaman diskusi operasional Wiramart (Durasi: 15 Menit 18 Detik), ditemukan 6 masalah fundamental di sisi gudang yang belum diakomodasi sistem digital:

| # | Masalah | Dampak Nyata |
|---|---|---|
| 1 | **Tidak ada early warning FEFO** | Gudang menemukan barang hampir expired secara manual/fisik — berisiko keracunan konsumen (kasus Basreng) |
| 2 | **Tidak ada approval workflow barang masuk** | Gudang bisa input stok baru langsung masuk kasir tanpa persetujuan Manajer → risiko manipulasi data & selisih keuangan |
| 3 | **Tidak ada mekanisme eskalasi diskon** | Manajer tidak punya interface digital untuk approve/reject/modify diskon darurat produk mendekati expired |
| 4 | **Tabel FEFO sudah ada tapi tidak actionable** | Data `stock_batches` di sistem sudah ada, tapi tidak ada To-Do List yang mengarahkan gudang untuk eksekusi |
| 5 | **Barcode produk diskon tidak bisa dipisah** | Produk yang didiskon 50% akan ter-scan dengan harga normal di kasir — tidak ada mekanisme barcode khusus diskon |
| 6 | **Tidak ada Manager on Duty digital** | Tidak ada fitur closing yang wajib di-sign-off Manajer — tidak ada pertanggungjawaban laporan harian |

---

## 🏗️ Arsitektur Sistem v3.0 (Gudang Layer)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WIRAMART ECOSYSTEM v3.0 (GUDANG LAYER)               │
├──────────────────────────┬──────────────────────────┬───────────────────┤
│  CONSUMER PWA (v2.0)     │  INTERNAL DASHBOARD       │  GUDANG MODULE    │
│  /order                  │  (v1.x existing)          │  (v3.0 NEW)       │
│                          │                           │                   │
│  ─ katalog               │  Kasir → POS              │  ─ Barang Masuk   │
│  ─ order                 │  Admin → manajemen        │  ─ FEFO Alert     │
│  ─ tracking              │  CS → delivery            │  ─ Pengajuan      │
│                          │  Kasir → badge notif      │    Diskon/Musnahk │
│                          │                           │  ─ To-Do List     │
│                          │                           │  ─ Barcode Diskon │
├──────────────────────────┴──────────────────────────┴───────────────────┤
│                  MANAJER / MANAGER ON DUTY MODULE (v3.0 NEW)            │
│  ─ Approval Barang Masuk (2-layer auth)                                 │
│  ─ Review & Keputusan Diskon/Musnahkan                                  │
│  ─ Daily Closing Sign-Off                                               │
│  ─ Laporan Mutasi Stok Harian                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                 Supabase PostgreSQL (Single Source of Truth)            │
│  existing tables (v1.x): products, stock_batches, transactions, ...     │
│  new tables (v3.0):      stock_receive_drafts, stock_receive_items,     │
│                          product_condition_reports, discount_policies,  │
│                          discount_barcodes, manager_duty_log            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Alur Integrasi Antar Modul

```
GUDANG input barang masuk
        │
        ▼
[stock_receive_drafts] status: DRAFT → SUBMITTED
        │
        ▼ (Manajer ACC)
[stock_receive_drafts] status: APPROVED
        │ ← Stok masuk ke kasir DI SINI (bukan sebelumnya)
        ▼ (ACID transaction)
[stock_batches] + UPDATE [products.stock_qty]
        │
        ├──→ FEFO engine scan stock_batches → [product_condition_reports] ALERT
        │                                              │
        │                          GUDANG isi kondisi + saran
        │                                              │
        │                          MANAJER ACC/Reject/Modify
        │                                              │
        │                    Jika ACC Diskon → [discount_barcodes] dibuat
        │                                              │
        │                    Kasir scan barcode diskon → harga override terjadi
        │
        └──→ [daily_closings] (existing) ← Manajer sign-off wajib
```

---

## 👥 Role Mapping di v3.0

| Role | Tabel DB | Akses Baru di v3.0 |
|---|---|---|
| **GUDANG (Mahasiswa Stock)** | `employees` (jabatan GUDANG) | Input barang masuk, laporan kondisi, lihat FEFO alert, lihat To-Do List |
| **MANAGER** | `admins` (adminRole = MANAGER) | Approve barang masuk, keputusan diskon/musnahkan, sign-off daily closing |
| **ADMIN_SHIFT** | `admins` (adminRole = ADMIN_SHIFT) | Bisa lihat laporan gudang, tidak bisa approve barang masuk (hanya MANAGER) |
| **KASIR** | `employees` | Tidak ada perubahan — discount barcode sudah otomatis override harga |

> **Prinsip separasi kekuasaan (wajib):** GUDANG **TIDAK BISA** approve barang masuknya sendiri. Approval hanya bisa dari `admins.adminRole = 'MANAGER'`. ADMIN_SHIFT tidak bisa approve barang masuk — ini wewenang eksklusif MANAGER untuk mencegah kolusi.

---

## 📦 FASE 1 — Alur Penerimaan Barang & 2-Layer Approval

> **Priority:** 🔴 MUST HAVE — Ini pondasi seluruh integritas data stok  
> **Blocking:** Fase 2 & 3 tidak bisa dimulai sebelum ini selesai

### 1.1 Input Barang Masuk oleh GUDANG (Draft)

**Latar Belakang:** Saat ini tidak ada alur digital untuk barang masuk. Gudang langsung input ke stok atau admin input manual. Ini membuka celah manipulasi.

**User Story:**
> Sebagai GUDANG yang sedang menerima kiriman barang dari supplier, saya ingin bisa input semua detail barang masuk di sistem, lalu mengirim ke Manajer untuk di-ACC, sehingga tidak ada barang yang masuk ke kasir tanpa persetujuan.

**Acceptance Criteria:**
- [ ] GUDANG bisa buat "Draft Penerimaan Barang" dari halaman mereka (role-gated: hanya employee jabatan GUDANG)
- [ ] Per draft = satu pengiriman barang (bisa berisi banyak produk dari satu supplier)
- [ ] Setiap item dalam draft wajib diisi: **Produk** (dari dropdown produk existing), **Qty**, **Harga Beli (HPP)**, **Tanggal Kadaluarsa**, **Kode Batch**
- [ ] Draft bisa disimpan dan dilanjutkan nanti (status = `DRAFT`) sebelum di-submit
- [ ] Setelah di-submit: status = `SUBMITTED`, muncul notifikasi ke MANAGER (badge + WA jika v4.0)
- [ ] GUDANG tidak bisa edit draft setelah di-submit — status locked
- [ ] **CRITICAL:** Stok **BELUM** bertambah di tabel `products` atau `stock_batches` saat status masih `DRAFT` atau `SUBMITTED`

**Validasi Server-Side Wajib:**
```typescript
// di StockReceiveService.ts
// Validasi per item:
// 1. product_id harus ada dan is_active = TRUE
// 2. qty > 0 (integer, tidak ada desimal)
// 3. cost_price > 0 (harga beli wajib diisi — untuk update HPP batch)
// 4. expiry_date: jika diisi, harus LEBIH DARI hari ini
//    (tidak boleh input barang yang sudah expired)
// 5. expiry_date: jika produk.isPerishable = TRUE, expiry_date WAJIB diisi

// Validasi error yang detail per item:
if (item.expiryDate && new Date(item.expiryDate) <= new Date()) {
  throw new ValidationError(`Tanggal kadaluarsa ${product.name} sudah lewat. Tidak bisa input barang expired.`);
}
```

**Route (GUDANG — Employee Auth):**
```
POST /api/gudang/penerimaan
  Auth: requireEmployee() + cek jabatan GUDANG
  Body: StockReceiveDraftSchema (Zod)
  Action: INSERT stock_receive_drafts status DRAFT

PATCH /api/gudang/penerimaan/[id]
  Auth: requireEmployee() + ownership check (drafter = current user)
  Body: Partial item update
  Validasi: status harus DRAFT (tidak bisa edit SUBMITTED)

POST /api/gudang/penerimaan/[id]/submit
  Auth: requireEmployee() + ownership check
  Validasi: status DRAFT → SUBMITTED
  Action: UPDATE status, SET submitted_at = NOW()
  Response: { success, data: { orderNumber, submittedAt } }

GET /api/gudang/penerimaan
  Auth: requireEmployee() + jabatan GUDANG
  Query: ?status=&page=&limit=20
  Response: list draft milik gudang yang sedang login (IDOR safe)
```

**Security — IDOR Prevention:**
```typescript
// Setiap route mutasi: cek draft.created_by_employee_id === payload.sub
const [draft] = await db.select()
  .from(stockReceiveDrafts)
  .where(and(
    eq(stockReceiveDrafts.id, draftId),
    eq(stockReceiveDrafts.createdByEmployeeId, employeeId),  // ownership check
    isNull(stockReceiveDrafts.deletedAt),
  ))
  .limit(1);

if (!draft) return apiError('Penerimaan tidak ditemukan', 404);  // generic — tidak expose "akses ditolak"
```

---

### 1.2 Approval Barang Masuk oleh MANAGER (Dua Lapis)

**User Story:**
> Sebagai MANAGER, saya ingin bisa review setiap pengajuan penerimaan barang dari gudang — bisa ACC, minta revisi, atau tolak — sebelum stok benar-benar masuk ke sistem kasir.

**Acceptance Criteria:**
- [ ] Halaman MANAGER: `Antrian Penerimaan Barang` — tampilkan semua draft status `SUBMITTED`
- [ ] Detail per draft: nama gudang yang input, tanggal submit, list produk + qty + HPP + expired date + kode batch
- [ ] Tombol **✅ Setujui (ACC)** → status `APPROVED` → **stok masuk ke sistem (ACID)**
- [ ] Tombol **🔄 Minta Revisi** → status kembali `DRAFT`, GUDANG bisa edit kembali, muncul catatan dari Manajer
- [ ] Tombol **❌ Tolak** → status `REJECTED`, wajib isi alasan (min 10 char)
- [ ] Setelah ACC: sistem otomatis INSERT baris baru ke `stock_batches` dan UPDATE `products.stock_qty` dalam **satu ACID transaction**
- [ ] Log ke `audit_logs` (tabel existing) setiap kali MANAGER ACC barang masuk: `action = 'INSERT'`, `tableName = 'stock_batches'`, `actorType = 'ADMIN'`

**Proses ACC (KRITIS — Harus Atomic):**
```typescript
// Di StockReceiveRepository.approveDraft(draftId, adminId):
await db.transaction(async (tx) => {
  // 1. Lock draft row
  const [draft] = await tx.select()
    .from(stockReceiveDrafts)
    .where(and(
      eq(stockReceiveDrafts.id, draftId),
      eq(stockReceiveDrafts.status, 'SUBMITTED'),  // double check status di dalam tx
    ))
    .for('update')
    .limit(1);

  if (!draft) throw new Error('DRAFT_NOT_APPROVABLE');

  // 2. Insert tiap item ke stock_batches
  for (const item of draftItems) {
    await tx.insert(stockBatches).values({
      productId: item.productId,
      batchCode: item.batchCode,
      costPrice: item.costPrice,
      initialQty: item.qty,
      currentQty: item.qty,
      expiryDate: item.expiryDate,
      expiryClass: determineExpiryClass(item.expiryDate),
      notes: `Diterima via draft #${draft.receiveNumber}`,
    });

    // 3. Tambah stock_qty di products
    await tx.update(products)
      .set({ stockQty: sql`stock_qty + ${item.qty}` })
      .where(eq(products.id, item.productId));
  }

  // 4. Update status draft
  await tx.update(stockReceiveDrafts)
    .set({
      status: 'APPROVED',
      approvedByAdminId: adminId,
      approvedAt: new Date(),
    })
    .where(eq(stockReceiveDrafts.id, draftId));
});
```

**Route (MANAGER — Admin Auth + Role Guard):**
```
GET /api/admin/gudang/penerimaan?status=SUBMITTED&page=&limit=20
  Auth: requireManager() ← WAJIB role MANAGER (bukan hanya admin biasa)

POST /api/admin/gudang/penerimaan/[id]/approve
  Auth: requireManager()
  Action: ACID: INSERT stock_batches + UPDATE products.stock_qty + UPDATE draft status

POST /api/admin/gudang/penerimaan/[id]/revisi
  Auth: requireManager()
  Body: { catatan: string (min 10 char) }
  Action: UPDATE status ke DRAFT, simpan catatan manajer

POST /api/admin/gudang/penerimaan/[id]/tolak
  Auth: requireManager()
  Body: { alasan: string (min 10 char) }
  Action: UPDATE status ke REJECTED
```

> **Security Note:** Endpoint `/api/admin/gudang/penerimaan/[id]/approve` menggunakan `requireManager()` (bukan `requireAdmin()`). Ini memastikan ADMIN_SHIFT **tidak bisa** approve barang masuk — hanya MANAGER (Dosen). Ini adalah separasi kekuasaan yang krusial.

---

### 1.3 Schema Tabel Baru — Penerimaan Barang

```sql
-- Migration v3_1_stock_receive.sql
-- ADDITIVE ONLY — tidak menyentuh tabel existing

DO $$ BEGIN
  CREATE TYPE stock_receive_status AS ENUM (
    'DRAFT',      -- gudang masih input, belum submit
    'SUBMITTED',  -- gudang submit, menunggu approval manajer
    'APPROVED',   -- manajer ACC — stok sudah masuk ke sistem
    'REJECTED',   -- manajer tolak — stok tidak masuk
    'REVISED'     -- manajer minta revisi — kembali ke DRAFT
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Header penerimaan (satu per pengiriman barang)
CREATE TABLE IF NOT EXISTS stock_receive_drafts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Format: GUD-YYYYMMDD-XXXX (misal: GUD-20261017-0003)
  receive_number         VARCHAR(25) NOT NULL UNIQUE,
  -- Siapa yang input (employee jabatan GUDANG)
  created_by_employee_id UUID NOT NULL REFERENCES employees(id),
  -- Nama supplier / catatan pengiriman
  supplier_name          VARCHAR(200),
  delivery_note          TEXT,          -- no. surat jalan, dll
  status                 stock_receive_status NOT NULL DEFAULT 'DRAFT',
  -- Waktu timeline
  submitted_at           TIMESTAMPTZ,
  approved_at            TIMESTAMPTZ,
  rejected_at            TIMESTAMPTZ,
  -- Siapa yang approve/reject/revisi (harus MANAGER)
  approved_by_admin_id   UUID REFERENCES admins(id),
  rejected_by_admin_id   UUID REFERENCES admins(id),
  -- Catatan dari manajer (untuk revisi atau penolakan)
  manager_note           TEXT,
  -- Audit
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

-- Detail per produk dalam satu penerimaan
CREATE TABLE IF NOT EXISTS stock_receive_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id        UUID NOT NULL REFERENCES stock_receive_drafts(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  -- Snapshot nama produk saat input (audit — nama bisa berubah)
  product_name    VARCHAR(200) NOT NULL,
  -- Kode batch dari supplier / internal (WAJIB unik per produk per pengiriman)
  batch_code      VARCHAR(50) NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  -- HPP per unit saat diterima (diisi gudang, bisa berbeda dari batch sebelumnya)
  cost_price      DECIMAL(15,2) NOT NULL CHECK (cost_price > 0),
  -- NULL jika produk tanpa kadaluarsa (sabun, dll)
  expiry_date     DATE,
  -- Catatan fisik barang saat diterima (kondisi packaging, dll)
  condition_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_status
  ON stock_receive_drafts(status, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_receive_drafts_employee
  ON stock_receive_drafts(created_by_employee_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_receive_items_draft
  ON stock_receive_items(draft_id);

-- RLS
ALTER TABLE stock_receive_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_receive_items ENABLE ROW LEVEL SECURITY;

-- GUDANG hanya bisa lihat draft milik mereka sendiri
CREATE POLICY "stock_receive_drafts: employee self read"
  ON stock_receive_drafts FOR SELECT
  USING (
    created_by_employee_id::text = auth.uid()::text
    OR EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
  );

-- Mutasi hanya via service_role (API route server-side)
CREATE POLICY "stock_receive_drafts: service_role all"
  ON stock_receive_drafts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "stock_receive_items: service_role all"
  ON stock_receive_items FOR ALL
  USING (auth.role() = 'service_role');
```

---

## 🚨 FASE 2 — FEFO Alert System & To-Do List Gudang

> **Priority:** 🔴 MUST HAVE — Ini adalah core value proposition v3.0  
> **Dependencies:** Fase 1 selesai (data stock_batches sudah reliable)

### 2.1 Engine Klasifikasi FEFO Alert (Background / On-Demand)

**Latar Belakang:** Tabel `stock_batches` sudah ada di schema (`schema.ts:684`) dengan kolom `expiry_date` dan `expiry_class`. Yang belum ada adalah engine yang **secara aktif membaca** data ini dan membuat alert actionable.

**Klasifikasi Alert (dari Rekaman Operasional):**

| Level | Sisa Waktu | Warna | Aksi Wajib |
|---|---|---|---|
| 🔴 **H-1 (KRITIS)** | ≤ 1 hari | Merah | Eksekusi hari ini atau musnahkan |
| 🟠 **H-3 (URGENT)** | 2–3 hari | Oranye | Evaluasi cepat, pasang diskon |
| 🟡 **H-5 (WARNING)** | 4–5 hari | Kuning | Mulai ancang-ancang diskon |
| 🔵 **H-7 (WATCH)** | 6–7 hari | Biru | Pantau pergerakan stok |

**Fungsi Engine (dijalankan via Vercel Cron + on-demand):**
```typescript
// Di FEFOAlertService.ts
// Jalankan setiap hari jam 06:00 WIB via Vercel Cron
// Juga bisa dipanggil manual dari dashboard Gudang

async function scanAndGenerateAlerts(): Promise<void> {
  const today = getTodayWIB(); // Helper: format YYYY-MM-DD timezone Asia/Jakarta

  const expiringBatches = await db
    .select({
      batchId: stockBatches.id,
      productId: stockBatches.productId,
      productName: products.name,
      batchCode: stockBatches.batchCode,
      currentQty: stockBatches.currentQty,
      expiryDate: stockBatches.expiryDate,
      daysRemaining: sql<number>`EXTRACT(DAY FROM (${stockBatches.expiryDate}::date - CURRENT_DATE))`,
    })
    .from(stockBatches)
    .innerJoin(products, eq(stockBatches.productId, products.id))
    .where(and(
      gt(stockBatches.currentQty, 0),           // stok masih ada
      lte(stockBatches.expiryDate, sql`CURRENT_DATE + INTERVAL '7 days'`),
      isNull(products.deletedAt),
      eq(products.isActive, true),
    ))
    .orderBy(asc(stockBatches.expiryDate));

  // Upsert ke product_condition_reports
  for (const batch of expiringBatches) {
    const alertLevel = classifyAlert(batch.daysRemaining);
    await upsertConditionReport(batch, alertLevel, 'SYSTEM_AUTO');
  }
}

function classifyAlert(daysRemaining: number): AlertLevel {
  if (daysRemaining <= 1) return 'H1_KRITIS';
  if (daysRemaining <= 3) return 'H3_URGENT';
  if (daysRemaining <= 5) return 'H5_WARNING';
  return 'H7_WATCH';
}
```

---

### 2.2 To-Do List Gudang (Dashboard Actionable)

**User Story:**
> Sebagai GUDANG yang baru mulai shift, saya ingin langsung tahu apa yang harus saya kerjakan hari ini terkait stok mendekati kadaluarsa, tanpa harus cek manual satu-satu.

**Acceptance Criteria:**
- [ ] Halaman GUDANG: Tab "Daftar Tugas Hari Ini" — muncul otomatis dari hasil FEFO scan
- [ ] Dikelompokkan berdasarkan level alert: H-1 paling atas (merah), H-7 paling bawah (biru)
- [ ] Setiap item tampilkan: nama produk, kode batch, qty tersisa, tanggal expired, sisa hari, **status pengajuan** ke manajer
- [ ] Tombol **"Laporkan ke Manajer"** → form isi kondisi fisik + saran tindakan (diskon % / musnahkan / pindah display)
- [ ] Jika sudah ada pengajuan yang pending (belum direview manajer): tombol berubah jadi "Menunggu Review"
- [ ] Jika manajer sudah beri keputusan: tampilkan keputusan + aksi yang harus dilakukan gudang
- [ ] Badge angka di navbar GUDANG: jumlah item H-1 yang belum ada pengajuannya

**Integrasi dengan existing `qrisSettings.lowStockThreshold`:**
- Alert stok rendah (`stock_qty < lowStockThreshold`) juga masuk ke To-Do List gudang sebagai item "Perlu Restock"

---

### 2.3 Schema Tabel Baru — Laporan Kondisi & Alert

```sql
-- Migration v3_2_condition_reports.sql

DO $$ BEGIN
  CREATE TYPE alert_level AS ENUM ('H1_KRITIS', 'H3_URGENT', 'H5_WARNING', 'H7_WATCH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE condition_report_status AS ENUM (
    'ALERT_ONLY',     -- sistem generate alert, belum ada pengajuan gudang
    'SUBMITTED',      -- gudang submit laporan + saran, menunggu manajer
    'MANAGER_REVIEW', -- manajer sedang review
    'APPROVED',       -- manajer ACC keputusan
    'REJECTED',       -- manajer tolak (dengan catatan)
    'EXECUTED',       -- gudang sudah eksekusi keputusan manajer
    'CLOSED'          -- selesai (barang habis terjual / dimusnahkan)
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE manager_decision AS ENUM (
    'DISCOUNT',       -- ACC diskon (dengan persentase)
    'DISPLAY_FRONT',  -- pindahkan ke area depan kasir
    'DESTROY',        -- musnahkan / hapus dari stok
    'RETURN_SUPPLIER',-- kembalikan ke supplier
    'HOLD'            -- tahan dulu, pantau
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS product_condition_reports (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Referensi ke batch yang bermasalah
  batch_id             UUID NOT NULL REFERENCES stock_batches(id),
  product_id           UUID NOT NULL REFERENCES products(id),

  -- Level alert yang terdeteksi sistem
  alert_level          alert_level NOT NULL,
  -- Qty tersisa di batch saat alert dibuat (snapshot)
  qty_at_alert         INTEGER NOT NULL,
  -- Tanggal expired (snapshot dari batch)
  expiry_date          DATE,
  -- Sisa hari saat alert dibuat (snapshot)
  days_remaining_at_alert INTEGER,

  -- Status alur kerja
  status               condition_report_status NOT NULL DEFAULT 'ALERT_ONLY',

  -- ── Pengisian oleh GUDANG ────────────────────────────────────
  -- Kondisi fisik barang (kemasan jebol, kempes, mau basi, rusak, dll)
  physical_condition   TEXT,
  -- Saran tindakan dari gudang
  gudang_suggestion    TEXT,
  -- Persentase diskon yang disarankan gudang (null jika saran musnahkan)
  suggested_discount_pct DECIMAL(5,2) CHECK (suggested_discount_pct BETWEEN 1 AND 100),
  submitted_by_employee_id UUID REFERENCES employees(id),
  submitted_at         TIMESTAMPTZ,

  -- ── Keputusan MANAJER ────────────────────────────────────────
  manager_decision     manager_decision,
  -- Jika DISCOUNT: berapa persen yang di-ACC manajer
  approved_discount_pct DECIMAL(5,2) CHECK (approved_discount_pct BETWEEN 1 AND 100),
  -- Catatan manajer (bisa berisi alasan modifikasi dari saran gudang)
  manager_note         TEXT,
  decided_by_admin_id  UUID REFERENCES admins(id),
  decided_at           TIMESTAMPTZ,

  -- ── Eksekusi oleh GUDANG ─────────────────────────────────────
  executed_by_employee_id UUID REFERENCES employees(id),
  executed_at          TIMESTAMPTZ,
  execution_note       TEXT,

  -- Audit
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Satu laporan aktif per batch (UPSERT safe — tidak duplikat alert)
  CONSTRAINT uq_active_report_per_batch
    UNIQUE (batch_id)  -- satu batch = satu laporan aktif
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cond_report_status_alert
  ON product_condition_reports(status, alert_level, expiry_date);

CREATE INDEX IF NOT EXISTS idx_cond_report_product
  ON product_condition_reports(product_id, status);

CREATE INDEX IF NOT EXISTS idx_cond_report_batch
  ON product_condition_reports(batch_id);

-- RLS
ALTER TABLE product_condition_reports ENABLE ROW LEVEL SECURITY;

-- Gudang dan admin bisa baca semua (seluruh tim perlu visibilitas)
CREATE POLICY "cond_reports: staff read"
  ON product_condition_reports FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
  );

CREATE POLICY "cond_reports: service_role all"
  ON product_condition_reports FOR ALL
  USING (auth.role() = 'service_role');
```

---

## 💰 FASE 3 — Sistem Diskon Darurat & Barcode Override

> **Priority:** 🔴 MUST HAVE — Solusi atas masalah barcode diskon yang disebutkan di rekaman  
> **Dependencies:** Fase 2 selesai (condition reports & manager decision flow)

### 3.1 Barcode Diskon Khusus (Discount Policy)

**Latar Belakang (dari Rekaman):** Ketika produk yang mendekati expired diberi diskon 50%, kasir yang scan barcode bawaan produk akan mendapatkan harga normal — bukan harga diskon. Solusinya adalah membuat **barcode khusus** atau **override harga** untuk produk tersebut yang berlaku selama periode diskon.

**Acceptance Criteria:**
- [ ] Setelah Manajer ACC keputusan `DISCOUNT`, sistem otomatis create `discount_policies` dan generate `discount_barcodes` yang unik
- [ ] Kasir bisa scan barcode diskon → sistem override `sellingPrice` dengan harga setelah diskon
- [ ] Barcode diskon punya masa berlaku (expired otomatis sesuai tanggal kadaluarsa batch)
- [ ] Barcode diskon bisa dicetak (tampil QR atau Code128 yang bisa discan)
- [ ] Jika qty batch = 0, barcode diskon otomatis dinonaktifkan
- [ ] **WAJIB:** Setiap transaksi dengan barcode diskon dicatat berbeda agar laporan keuangan akurat (manajer bisa lihat berapa diskon yang diberikan)

**Mekanisme Override di Kasir:**
```typescript
// Di endpoint GET /api/kasir/produk (yang sudah ada)
// Tambahkan pengecekan: apakah barcode yang discan adalah discount_barcode?

const discountBarcode = await db.select()
  .from(discountBarcodes)
  .where(and(
    eq(discountBarcodes.barcode, scannedBarcode),
    eq(discountBarcodes.isActive, true),
    gte(discountBarcodes.validUntil, getTodayWIB()),
    gt(discountBarcodes.remainingQty, 0),
  ))
  .limit(1);

if (discountBarcode.length > 0) {
  // Return produk dengan harga override (bukan harga normal)
  return { ...product, sellingPrice: discountBarcode[0].discountedPrice, isDiscounted: true, discountPct: discountBarcode[0].discountPct };
}
```

**Schema Tabel:**
```sql
-- Migration v3_3_discount_system.sql

CREATE TABLE IF NOT EXISTS discount_policies (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Referensi ke laporan kondisi yang memicu diskon
  condition_report_id  UUID NOT NULL REFERENCES product_condition_reports(id),
  product_id           UUID NOT NULL REFERENCES products(id),
  batch_id             UUID NOT NULL REFERENCES stock_batches(id),

  -- Detail diskon yang di-ACC manajer
  discount_pct         DECIMAL(5,2) NOT NULL CHECK (discount_pct BETWEEN 1 AND 100),
  original_price       INTEGER NOT NULL,  -- harga normal saat diskon dibuat (snapshot)
  discounted_price     INTEGER NOT NULL,  -- harga setelah diskon (dihitung server-side)
  -- discounted_price = FLOOR(original_price * (1 - discount_pct / 100))

  -- Qty yang diizinkan untuk dijual dengan harga diskon
  -- (tidak boleh lebih dari current_qty batch)
  allowed_qty          INTEGER NOT NULL CHECK (allowed_qty > 0),
  sold_qty             INTEGER NOT NULL DEFAULT 0,
  remaining_qty        INTEGER GENERATED ALWAYS AS (allowed_qty - sold_qty) STORED,

  -- Berlaku sampai kapan (otomatis = expiry_date batch)
  valid_from           DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until          DATE NOT NULL,

  is_active            BOOLEAN NOT NULL DEFAULT TRUE,

  -- Dibuat dan disetujui oleh
  created_by_admin_id  UUID NOT NULL REFERENCES admins(id),  -- MANAGER yang ACC
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discount_barcodes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        UUID NOT NULL REFERENCES discount_policies(id),
  product_id       UUID NOT NULL REFERENCES products(id),

  -- Barcode unik yang bisa discan kasir — format: DISC-{product_id_6char}-{random4}
  -- Contoh: DISC-A3F2B1-0042
  barcode          VARCHAR(30) NOT NULL UNIQUE,

  discounted_price INTEGER NOT NULL,
  discount_pct     DECIMAL(5,2) NOT NULL,
  remaining_qty    INTEGER NOT NULL,
  valid_until      DATE NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_discount_barcodes_barcode
  ON discount_barcodes(barcode) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_discount_policies_product
  ON discount_policies(product_id, is_active);

CREATE INDEX IF NOT EXISTS idx_discount_policies_batch
  ON discount_policies(batch_id);

-- RLS
ALTER TABLE discount_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_barcodes ENABLE ROW LEVEL SECURITY;

-- Semua staff (employee & admin) bisa baca — kasir butuh ini untuk scan
CREATE POLICY "discount_barcodes: staff read"
  ON discount_barcodes FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
  );

CREATE POLICY "discount_policies: staff read"
  ON discount_policies FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM employees WHERE employees.id::text = auth.uid()::text AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM admins WHERE admins.id::text = auth.uid()::text AND deleted_at IS NULL)
  );

CREATE POLICY "discount_barcodes: service_role all"
  ON discount_barcodes FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "discount_policies: service_role all"
  ON discount_policies FOR ALL USING (auth.role() = 'service_role');
```

### 3.2 Integrasi Barcode Diskon dengan Kasir Existing

**Perubahan di sistem kasir (MINIMAL — hanya extend, tidak ubah yang ada):**

Tambahkan pengecekan discount barcode di API yang sudah ada tanpa mengubah logika existing:

```typescript
// Di route GET /api/kasir/produk (untuk scan barcode):
// SEBELUM: cari di products.barcode
// TAMBAHKAN: cek juga di discount_barcodes.barcode

// Jika ketemu discount_barcode:
// → return product data + flag isDiscounted: true + discountedPrice
// → kasir UI tampilkan badge "DISKON XX%" di card produk
// → saat transaksi: gunakan discountedPrice sebagai sellingPrice
// → setelah transaksi: decrement discount_barcodes.remaining_qty
//   (atomic di dalam db.transaction() yang sudah ada)
```

**Laporan Keuangan — Tracking Diskon:**
```
Setiap transaction_items yang menggunakan harga diskon:
  - selling_price_snapshot = harga diskon (bukan harga normal)
  - Tambahkan kolom opsional: discount_policy_id (nullable FK ke discount_policies)
  
→ Manajer bisa query: "Total diskon yang diberikan bulan ini" = 
  SUM((original_price - discounted_price) * qty) dari transaction_items
  WHERE discount_policy_id IS NOT NULL
```

**Migration tambahan ke tabel `transaction_items` (ADDITIVE):**
```sql
-- Tambahan di v3_3:
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS discount_policy_id UUID REFERENCES discount_policies(id);
-- NULL untuk transaksi tanpa diskon. Tidak breaking change.
```

---

## 📋 FASE 4 — Manager on Duty & Daily Closing Sign-Off

> **Priority:** 🟡 SHOULD HAVE — Penting untuk pertanggungjawaban tapi tidak blocking operasional  
> **Dari Rekaman:** "Pada saat toko tutup, seluruh rekapan laporan harian harus diperiksa dan disahkan oleh satu Manager on Duty"

### 4.1 Manager on Duty (MOD) Tracking

**User Story:**
> Sebagai Manajer, saya ingin ada sistem yang mencatat siapa Manajer yang bertugas hari ini, sehingga semua persetujuan dan pengesahan laporan bisa dikaitkan ke satu penanggung jawab yang jelas.

**Acceptance Criteria:**
- [ ] Manajer harus "check-in" sebagai MOD di awal hari sebelum bisa approve barang masuk
- [ ] Satu hari = satu MOD yang aktif (tidak bisa dua manajer sekaligus menjadi MOD hari yang sama)
- [ ] Jika tidak ada MOD yang check-in, gudang tetap bisa input draft tapi tidak bisa di-approve oleh siapapun
- [ ] MOD info tampil di semua halaman admin hari itu: "MOD Hari Ini: [Nama] (Pak Afif)"

**Schema:**
```sql
-- Bagian dari migration v3_4_manager_duty.sql
CREATE TABLE IF NOT EXISTS manager_duty_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_date      DATE NOT NULL UNIQUE,  -- satu MOD per hari
  admin_id       UUID NOT NULL REFERENCES admins(id),
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out_at TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_duty_date
  ON manager_duty_log(duty_date DESC);
```

---

### 4.2 Daily Closing Sign-Off (Integrasi dengan `daily_closings` Existing)

**Latar Belakang:** Tabel `daily_closings` sudah ada di schema (`schema.ts:959`) dengan kolom `status` (`OPEN | LOCKED | AUDITED`) dan `closed_by_admin_id`. Yang belum ada adalah flow yang **mewajibkan** MOD untuk sign-off sebelum closing dianggap sah.

**Enhancement ke alur yang ada (ADDITIVE):**

Tambahkan kolom di `daily_closings` (migration additive):
```sql
-- v3_4 tambahan ke daily_closings:
ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS mod_signed_by   UUID REFERENCES admins(id),
  ADD COLUMN IF NOT EXISTS mod_signed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mod_sign_note   TEXT,
  ADD COLUMN IF NOT EXISTS stock_mutation_summary JSONB;
  -- Ringkasan mutasi stok harian: { totalIn: N, totalOut: N, totalExpired: N, alertsH1: N }
```

**Alur Closing yang Disempurnakan:**
```
Akhir hari:
  1. ADMIN_SHIFT: klik "Tutup Shift" (alur existing)
  2. Sistem hitung semua transaksi, petty cash, rekonsiliasi QRIS (existing)
  3. Sistem tambahkan: ringkasan mutasi stok gudang hari itu + status FEFO alerts
  4. MANAGER (MOD hari itu): review laporan lengkap (keuangan + stok)
  5. MANAGER klik "Sahkan Laporan Hari Ini" → daily_closings.mod_signed_at = NOW()
  6. Status daily_closings: LOCKED → AUDITED (setelah MOD sign)
```

---

## 📊 FASE 5 — Dashboard Laporan Gudang & Supplier Management

> **Priority:** 🟡 SHOULD HAVE  
> **Catatan:** Bisa paralel dengan Fase 3 & 4

### 5.1 Laporan Mutasi Stok (Gudang & Manajer)

**User Story:**
> Sebagai MANAGER, saya ingin bisa lihat berapa barang yang masuk, keluar (terjual), expired, dan dimusnahkan dalam periode tertentu.

**Acceptance Criteria:**
- [ ] Filter: hari ini / minggu ini / bulan ini / custom range
- [ ] Tabel: per produk — stok awal periode, masuk (approved), keluar (terjual di kasir), expired/dimusnahkan, stok akhir
- [ ] Kolom "Nilai HPP" (cost_price) untuk audit keuangan
- [ ] Total nilai stok yang dimusnahkan (kerugian) per periode
- [ ] Export ke Excel (XLSX)

**Sumber Data:**
```sql
-- Mutasi stok menggunakan data yang sudah ada:
-- MASUK: stock_receive_drafts status APPROVED + stock_receive_items
-- KELUAR: transaction_items (JOIN transactions WHERE status = 'COMPLETED')
-- MUSNAHKAN: product_condition_reports WHERE manager_decision = 'DESTROY' AND status = 'EXECUTED'
-- EXPIRED UNSOLD: stock_batches WHERE current_qty > 0 AND expiry_date < TODAY (stok sisa expired)
```

### 5.2 Supplier Database (Opsional tapi Berguna)

Saat ini tidak ada data supplier di sistem — setiap draft penerimaan hanya ada `supplier_name` sebagai text bebas. Untuk tracking yang lebih baik:

```sql
-- Tabel opsional, bisa di v3.1 atau v4.0
CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  contact_person  VARCHAR(200),
  phone           VARCHAR(20),
  address         TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id UUID REFERENCES admins(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
```

---

## 🔐 SECURITY ARCHITECTURE — GUDANG MODULE

### A. Role Guard untuk Endpoint Gudang

```typescript
// src/lib/utils/auth.ts — tambahkan helper baru
// (tidak mengubah yang sudah ada, hanya menambah)

export async function requireGudang(): Promise<EmployeeTokenPayload> {
  const session = await getKasirSession();  // reuse existing
  if (!session) {
    throw new AppError('FORBIDDEN', 'Akses ditolak.', 403);
  }
  // Cek jabatan di database
  const [employee] = await db.select({ jabatan: employees.jabatan })
    .from(employees)
    .where(eq(employees.id, session.sub))
    .limit(1);

  if (!employee || employee.jabatan.toLowerCase() !== 'gudang') {
    throw new AppError('FORBIDDEN', 'Akses ini hanya untuk bagian Gudang.', 403);
  }
  return session;
}
```

### B. Validasi Zod untuk Semua Input Gudang

```typescript
// src/features/gudang/gudang.types.ts

export const StockReceiveDraftSchema = z.object({
  supplierName: z.string().trim().max(200).optional(),
  deliveryNote: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    batchCode: z.string().trim().min(1).max(50),
    qty: z.number().int().min(1).max(10000),
    costPrice: z.number().positive(),
    expiryDate: z.string().date().optional().nullable(),  // YYYY-MM-DD
    conditionNote: z.string().trim().max(500).optional(),
  })).min(1).max(100),  // max 100 jenis produk per pengiriman
});

export const ConditionReportSchema = z.object({
  physicalCondition: z.string().trim().min(5, 'Deskripsikan kondisi fisik minimal 5 karakter').max(500),
  gudangSuggestion: z.string().trim().max(500).optional(),
  suggestedDiscountPct: z.number().min(1).max(100).optional().nullable(),
});

export const ManagerDecisionSchema = z.object({
  decision: z.enum(['DISCOUNT', 'DISPLAY_FRONT', 'DESTROY', 'RETURN_SUPPLIER', 'HOLD']),
  approvedDiscountPct: z.number().min(1).max(100).optional(),
  managerNote: z.string().trim().max(500).optional(),
}).refine(
  data => data.decision !== 'DISCOUNT' || data.approvedDiscountPct !== undefined,
  { message: 'Persentase diskon wajib diisi jika keputusan adalah DISKON', path: ['approvedDiscountPct'] }
);
```

### C. Pemisahan Kekuasaan (Separation of Concerns) — Wajib

| Aksi | Hanya Bisa Dilakukan | Alasan |
|---|---|---|
| Input draft penerimaan barang | GUDANG (employee jabatan gudang) | Tugas operasional gudang |
| Submit draft ke manajer | GUDANG (pemilik draft) | Hanya yang buat yang bisa submit |
| Approve / Tolak penerimaan | MANAGER (`adminRole = MANAGER`) | Tidak ada delegasi ke ADMIN_SHIFT |
| Approve / Tolak diskon | MANAGER (`adminRole = MANAGER`) | Perubahan harga = keputusan finansial |
| Input laporan kondisi | GUDANG | Observasi lapangan |
| Eksekusi keputusan manajer | GUDANG (yang submit laporan) | Traceability |
| Sign-off daily closing | MANAGER MOD hari itu | Pertanggungjawaban harian |

### D. Audit Trail Wajib

Setiap aksi berikut WAJIB menulis ke tabel `audit_logs` (existing):
```typescript
// Helper yang konsisten dengan sistem yang ada
const auditActions = {
  STOCK_RECEIVE_APPROVED:   'INSERT',  // saat manajer acc barang masuk
  STOCK_RECEIVE_REJECTED:   'UPDATE',  // saat manajer tolak
  DISCOUNT_POLICY_CREATED:  'INSERT',  // saat manajer acc diskon
  PRODUCT_DESTROYED:        'UPDATE',  // saat gudang eksekusi musnahkan
  MOD_CHECKED_IN:           'INSERT',  // saat manajer check-in sebagai MOD
  DAILY_CLOSING_SIGNED:     'UPDATE',  // saat manajer sign daily closing
};
// actorType: 'ADMIN' untuk manajer, 'EMPLOYEE' untuk gudang
```

### E. Rate Limiting Endpoint Gudang

```typescript
// Tambah ke rate-limit.ts (pola yang sudah ada):

// Submit draft penerimaan: 10 submit / 24 jam / per employee
// (mencegah spam pengajuan yang belum siap)
export const stockSubmitLimiter = createRateLimiter(
  'stock:submit',
  10,
  24 * 60 * 60 * 1000,
);

// Submit laporan kondisi: 50 submit / 24 jam / per employee
// (gudang bisa input banyak laporan kondisi sehari)
export const conditionReportLimiter = createRateLimiter(
  'condition:report',
  50,
  24 * 60 * 60 * 1000,
);
```

### F. Barcode Diskon — Anti-Abuse

```typescript
// Setiap kali kasir scan discount barcode:
// 1. Cek is_active = TRUE
// 2. Cek valid_until >= TODAY
// 3. Cek remaining_qty > 0
// 4. Saat transaksi commit: decrement remaining_qty (ATOMIC, di dalam db.transaction())
//    UPDATE discount_barcodes SET remaining_qty = remaining_qty - qty
//    WHERE id = ? AND remaining_qty >= qty
//    → Jika 0 row terpengaruh = sudah habis, rollback transaksi

// Jika remaining_qty = 0 setelah transaksi: SET is_active = FALSE otomatis
```

---

## 📅 Database Migration Plan — v3.0

| # | File | Tabel | Tipe | Risk |
|---|---|---|---|---|
| 1 | `v3_1_stock_receive.sql` | `stock_receive_drafts`, `stock_receive_items` | CREATE TABLE + ENUM + RLS | ✅ SAFE |
| 2 | `v3_2_condition_reports.sql` | `product_condition_reports` | CREATE TABLE + ENUM + RLS | ✅ SAFE |
| 3 | `v3_3_discount_system.sql` | `discount_policies`, `discount_barcodes` | CREATE TABLE + RLS | ✅ SAFE |
| 3b | `v3_3b_transaction_items_discount.sql` | `transaction_items` | ADD COLUMN nullable FK | ✅ SAFE |
| 4 | `v3_4_manager_duty.sql` | `manager_duty_log` | CREATE TABLE | ✅ SAFE |
| 4b | `v3_4b_daily_closings_mod.sql` | `daily_closings` | ADD COLUMN nullable | ✅ SAFE |
| 5 | `v3_5_suppliers.sql` | `suppliers` | CREATE TABLE | ✅ SAFE |

> **Semua migration idempoten** (`IF NOT EXISTS`, ENUM via `DO $$ EXCEPTION`). Rollback plan: semua tabel baru bisa di-DROP tanpa dampak ke sistem v1.x dan v2.0.

---

## 📅 Roadmap Implementasi

```
FASE 1 — Penerimaan Barang & Approval (~2-3 minggu)
├── 1.1 [DB] Migration v3_1: stock_receive_drafts + items + RLS
├── 1.2 [BE] StockReceiveService + StockReceiveRepository
│         (create draft, submit, approve ACID, tolak, revisi)
├── 1.3 [BE] requireGudang() middleware (extend auth.ts yang ada)
├── 1.4 [BE] Rate limiter: stockSubmitLimiter (extend rate-limit.ts)
├── 1.5 [FE] Halaman Gudang: Form input penerimaan barang
├── 1.6 [FE] Halaman Gudang: Daftar draft (status timeline)
└── 1.7 [FE] Halaman Manager: Antrian penerimaan + tombol ACC/Revisi/Tolak

FASE 2 — FEFO Alert & To-Do List (~2 minggu)
├── 2.1 [DB] Migration v3_2: product_condition_reports + RLS
├── 2.2 [BE] FEFOAlertService.scanAndGenerateAlerts()
├── 2.3 [BE] Vercel Cron: /api/system/scan-fefo (06:00 WIB setiap hari)
├── 2.4 [FE] Halaman Gudang: To-Do List (H-1, H-3, H-5, H-7)
├── 2.5 [FE] Form laporan kondisi fisik + saran
└── 2.6 [FE] Halaman Manager: Antrian laporan kondisi + form keputusan

FASE 3 — Diskon Darurat & Barcode Override (~2 minggu)
├── 3.1 [DB] Migration v3_3: discount_policies + discount_barcodes + RLS
├── 3.2 [DB] Migration v3_3b: ADD COLUMN discount_policy_id ke transaction_items
├── 3.3 [BE] DiscountService.generateDiscountBarcode() (trigger setelah manager ACC)
├── 3.4 [BE] Extend endpoint scan barcode kasir yang sudah ada (cek discount_barcodes)
├── 3.5 [BE] Atomic decrement remaining_qty di dalam db.transaction() existing
└── 3.6 [FE] UI kasir: badge "DISKON XX%" di card produk

FASE 4 — Manager on Duty & Closing Sign-Off (~1 minggu)
├── 4.1 [DB] Migration v3_4: manager_duty_log
├── 4.2 [DB] Migration v3_4b: ADD COLUMN ke daily_closings (MOD sign)
├── 4.3 [BE] MODService: check-in, check-out, get today MOD
└── 4.4 [FE] Tombol "Sahkan Laporan" di halaman tutup buku existing

FASE 5 — Laporan & Supplier (~1 minggu)
├── 5.1 [DB] Migration v3_5: suppliers
├── 5.2 [BE] API laporan mutasi stok (GET /api/admin/gudang/laporan-mutasi)
├── 5.3 [FE] Halaman laporan mutasi + export Excel
└── 5.4 [FE] Manajemen supplier (dropdown di form penerimaan barang)
```

---

## ✅ Definition of Done (Per Fase)

### Fase 1 DONE jika:
- [ ] GUDANG bisa input draft → submit → status `SUBMITTED`
- [ ] Stok **TIDAK bertambah** sebelum MANAGER approve
- [ ] Setelah MANAGER approve: `stock_batches` ter-insert + `products.stock_qty` bertambah secara atomic
- [ ] ADMIN_SHIFT tidak bisa akses endpoint `/api/admin/gudang/penerimaan/[id]/approve` (harus dapat 403)
- [ ] Audit log tercatat di `audit_logs` setiap kali ACC

### Fase 2 DONE jika:
- [ ] Cron job scan FEFO berjalan setiap hari jam 06:00 WIB (cek via Vercel logs)
- [ ] To-Do List gudang tampil dengan klasifikasi H-1/H-3/H-5/H-7
- [ ] Gudang bisa submit laporan kondisi, manajer bisa beri keputusan
- [ ] Upsert constraint: satu batch = satu laporan aktif (tidak duplikat alert)

### Fase 3 DONE jika:
- [ ] Setelah manajer ACC diskon, `discount_barcodes` ter-generate otomatis
- [ ] Kasir scan barcode diskon → harga override terjadi (bukan harga normal)
- [ ] `remaining_qty` berkurang secara atomic saat transaksi commit
- [ ] Abuse test: scan barcode diskon yang sudah `remaining_qty = 0` → sistem menolak dengan error jelas

### Fase 4 DONE jika:
- [ ] Manajer check-in sebagai MOD → satu MOD per hari
- [ ] Daily closing tidak bisa jadi status `AUDITED` tanpa MOD sign-off
- [ ] Laporan tutup buku tampilkan ringkasan stok (masuk, keluar, dimusnahkan)

### Fase 5 DONE jika:
- [ ] Laporan mutasi stok bisa di-export ke Excel (per bulan, per produk)
- [ ] Nilai kerugian barang dimusnahkan terhitung dari `cost_price` batch
- [ ] Supplier bisa dipilih dari dropdown saat input penerimaan barang

---

## 🔗 Titik Integrasi dengan v1.x & v2.0

| Fitur v3.0 | Integrasi dengan | Caranya |
|---|---|---|
| Approve barang masuk | `stock_batches` (v1.x) | INSERT + UPDATE `products.stock_qty` ACID |
| FEFO Alert | `stock_batches` (v1.x) | SELECT scan batch expired < 7 hari |
| Barcode diskon | `products` (v1.x) | Override `sellingPrice` response |
| Barcode diskon | `transaction_items` (v1.x) | ADD COLUMN `discount_policy_id` nullable |
| FEFO low stock | `qrisSettings.lowStockThreshold` (v1.x) | Reuse existing threshold setting |
| Daily Closing sign-off | `daily_closings` (v1.x) | ADD COLUMN `mod_signed_by` + `mod_signed_at` |
| Audit trail | `audit_logs` (v1.x) | Append-only INSERT (tidak pernah DELETE) |
| MOD check-in | `admins` (v1.x) | FK reference ke admins.id |
| CS assignment laporan kondisi | Online orders CS (v2.0) | Tidak ada integrasi — gudang ≠ CS |

---

## 🚫 Out of Scope — Wiramart v3.0

| Feature | Alasan Ditunda |
|---|---|
| IoT barcode scanner otomatis (NFC/RFID) | Over-engineering untuk skala kampus |
| Prediksi permintaan berbasis AI/ML | Tidak ada data historis yang cukup |
| Multi-supplier comparison / procurement | Complexity tinggi, prioritas rendah |
| Real-time supplier tracking | Tidak relevan untuk kampus |
| Batch recall / product traceability | Belum ada regulasi yang mensyaratkan |
| Automatic reorder point via PO system | Terlalu kompleks — cukup alert manual |

---

## 🔖 Glosarium Teknis

| Term | Definisi |
|---|---|
| **Draft Penerimaan** | Input GUDANG tentang barang masuk sebelum diapprove Manajer — tabel `stock_receive_drafts` |
| **ACC** | Approve / persetujuan oleh MANAGER — trigger stok masuk ke sistem |
| **FEFO Alert** | Notifikasi dari engine scan `stock_batches` bahwa ada batch yang akan expired ≤ 7 hari |
| **Laporan Kondisi** | Form yang diisi GUDANG saat melaporkan kondisi fisik barang ke Manajer — tabel `product_condition_reports` |
| **Barcode Diskon** | Barcode unik yang menggantikan barcode normal untuk produk yang sedang dalam program diskon darurat — tabel `discount_barcodes` |
| **MOD** | Manager on Duty — Manajer yang bertugas sign-off laporan harian |
| **H-1/H-3/H-5/H-7** | Klasifikasi sisa hari sebelum expired: 1 hari, 3 hari, 5 hari, 7 hari |
| **requireGudang()** | Middleware auth baru yang extend `requireEmployee()` + cek jabatan = GUDANG |
| **`discount_policy_id`** | Kolom nullable yang ditambahkan ke `transaction_items` untuk tracking transaksi yang menggunakan harga diskon darurat |

---

## ✍️ Approval & Sign-off

| Pihak | Nama | Status | Tanggal |
|---|---|---|---|
| Developer / Pemilik Produk | Najmusyafa | 🟡 Review | 2026-10-17 |
| Manager / Dosen Pembimbing (Pak Afif) | — | ⬜ Belum | — |
| Koordinator Gudang (Mbak Siska?) | — | ⬜ Belum | — |

---

*PRD ini adalah dokumen hidup. Perubahan scope apapun setelah sign-off wajib didiskusikan dan dicatat di sini sebelum implementasi dimulai.*
