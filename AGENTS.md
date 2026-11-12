# AGENTS.md — Wiramart Smartkasir Perwira

> **Baca ini sebelum menyentuh satu baris pun.**
> Proyek ini sudah **berjalan di produksi** dengan data nyata (684+ transaksi, kasir mahasiswa aktif).
> Kesalahan kecil = data uang rusak = kepercayaan UKM hilang.

---

## 1. Stack & Versi — Jangan Asumsikan

| Komponen | Versi / Detail |
|---|---|
| Framework | **Next.js 16.4.3** App Router — `proxy.ts` menggantikan `middleware.ts` |
| Runtime | Node.js 20+ (`export const runtime = 'nodejs'` di semua route) |
| React | 19.2.8 |
| Database | Supabase PostgreSQL via **Drizzle ORM** (`src/lib/db/schema.ts`) |
| Auth | JWT custom: `jose` + `bcryptjs`, **bukan** NextAuth / Supabase Auth |
| Deploy | Vercel + Vercel Cron |
| Styling | **Vanilla CSS** — tidak ada Tailwind, tidak ada CSS-in-JS |
| Icons | Lucide React |
| Notifikasi | WhatsApp via Fonnte (fire-and-forget, tidak pernah blocking) |

> ⚠️ Next.js 16 punya breaking changes dari Next.js 14/15. Jika ragu, baca `node_modules/next/dist/docs/` atau tanya.

---

## 2. Arsitektur Berlapis — Wajib Diikuti

```
Route Handler (≤ 30 baris)
  → Zod DTO validation
  → Service Layer  (src/lib/services/* atau src/features/*)
    → Repository / Drizzle query  (terindeks, berpaginasi)
      → db.transaction() untuk mutasi multi-tabel
```

**Larangan mutlak:**
- ❌ Logika bisnis di Route Handler
- ❌ Query Drizzle langsung di komponen React
- ❌ `db.push` / `drizzle-kit push` — gunakan file migrasi SQL di `src/lib/db/`
- ❌ `any` / `unknown` tanpa Zod runtime validator
- ❌ `@ts-ignore` tanpa komentar jelas kenapa

---

## 3. Database — Aturan Tidak Bisa Dilanggar

### 3a. Skema Hanya Additive
Setiap versi PRD (v1 → v2 → v3 → v4) **hanya menambah** tabel/kolom baru.
**Dilarang keras:** `DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, `RENAME`.

### 3b. Migrasi
- Semua migrasi ada di `src/lib/db/` sebagai file SQL bernama `migration_vX_Y.sql`.
- Semua migrasi harus **idempoten** (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Jalankan via: `npm run db:migrate` (Drizzle Kit migrate).

### 3c. Soft Delete
Semua data bisnis bernilai pakai `deleted_at TIMESTAMPTZ` — **jangan hard delete**.
Tabel yang berlaku: `products`, `buyers`, `stock_receive_drafts`, `online_orders`, `admins`, `employees`.

### 3d. Transaksi ACID
Semua operasi multi-tabel WAJIB dalam `db.transaction()`. Tidak ada "partial commit".
```typescript
await db.transaction(async (tx) => {
  // semua mutasi di sini
});
```

### 3e. Partial Unique Index
Barcode produk unik hanya di antara produk yang belum dihapus:
```sql
WHERE barcode IS NOT NULL AND deleted_at IS NULL
```
Jangan buat full unique index pada kolom nullable yang soft-deleted.

### 3f. Sumber Kebenaran Skema
`src/lib/db/schema.ts` = satu-satunya sumber. Jika ada konflik dengan dokumen PRD lama → percayai schema.ts.

---

## 4. Keamanan — Zero Trust

### 4a. Tiga Cookie Sesi (bisa berjalan bersamaan)
| Cookie | Untuk | Masa berlaku |
|---|---|---|
| `sk_admin` | Admin Shift & Manager | 8 jam |
| `sk_kasir` | Kasir, Gudang, CS (semua `employees`) | 8 jam |
| `sk_buyer` | Pembeli PWA | 7 hari |

Gunakan `verifyJwt(req)` dari `src/lib/utils/auth.ts`. **Jangan** buat verifikasi JWT sendiri.

### 4b. Pemisahan Role
```
adminRole: 'MANAGER' | 'ADMIN_SHIFT'   → tabel admins
jabatan:   'kasir' | 'gudang' | 'cs'  → tabel employees (kolom jabatan)
```

Guard khusus Manager: `session.role === 'admin' && session.adminRole === 'MANAGER'`
Guard Gudang: `requireGudang(session)` dari auth utils.

### 4c. IDOR Protection
Semua query harus menyertakan `employeeId` / `adminId` dari JWT session, **bukan** dari body/param:
```typescript
// ✅ Benar
where: and(eq(table.id, params.id), eq(table.employeeId, session.sub))

// ❌ Salah
where: eq(table.id, body.targetId)
```

### 4d. Harga Selalu Dihitung Server
`costPrice` produk **tidak pernah** dikirim ke API employee/buyer.
Ongkir dihitung dari `calculateDeliveryFee()` di `order.types.ts` — tidak percaya nilai dari client.

### 4e. Rate Limiter
Gunakan instance dari `src/lib/utils/rate-limit.ts`. Jangan buat `Map` baru sendiri.
| Limiter | Limit |
|---|---|
| `adminAuthLimiter` | 10x / 1 jam / per NIDN |
| `kasirAuthLimiter` | 25x / 30 menit / per NIM |
| `swapRequestLimiter` | 3x / 7 hari / per NIM |
| `buyerOrderLimiter` | 5x / 24 jam / per buyer_id |

### 4f. RLS
Semua tabel memiliki Row Level Security aktif (`rls_hardening_v1_2.sql`).
Jika menambah tabel baru, tambahkan ke `rls_setup.sql` dan aktifkan RLS-nya.

---

## 5. Konvensi Kode

### 5a. Response API
```typescript
// Selalu gunakan helper dari auth utils:
return apiOk(data);           // { success: true, data }
return apiError(message, 422); // { success: false, error }
```

### 5b. Validasi Input
Selalu Zod **sebelum** menyentuh database. Contoh:
```typescript
const parsed = MySchema.safeParse(body);
if (!parsed.success) return apiError(parsed.error.format(), 422);
```

### 5c. Route Handler Header
Setiap file route handler wajib ada:
```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```

### 5d. Idempotensi Transaksi Kasir
Transaksi POS mendukung `Idempotency-Key` header. Saat menambah endpoint mutasi krusial, pertimbangkan idempotency.

### 5e. Komponen React
- **Server Components by default.** `'use client'` hanya di daun interaktif terkecil.
- Styling: class CSS dari `globals.css` atau modul CSS. Tidak ada inline style kecuali dynamic value.
- Desain token: HSL — `hsl(145, 63%, 32%)` hijau primer, `hsl(47, 96%, 53%)` amber aksen.

---

## 6. Domain Bisnis — Aturan Operasional

### 6a. Hierarki Role (siapa bisa apa)
```
Manager        → approve penerimaan barang, putuskan FEFO, laporan laba, MOD check-in
Admin Shift    → konfirmasi order online, manajemen kasir, maintenance mode
Kasir          → transaksi POS, buka/tutup shift
Gudang         → draft penerimaan barang, lapor kondisi FEFO
CS / Runner    → antar pesanan online, verifikasi PIN
Buyer          → pesan online, tracking, batal (saat WAITING_*)
```

### 6b. FEFO — Enum dari schema.ts (bukan PRD lama)
```
Tabel : product_condition_reports  (BUKAN fefo_alerts)
Level : H1_KRITIS, H3_URGENT, H5_WARNING, H7_WATCH
Aksi  : DISCOUNT, DISPLAY_FRONT, DESTROY, RETURN_SUPPLIER, HOLD
Status: ALERT_ONLY → SUBMITTED → MANAGER_REVIEW → APPROVED/REJECTED → EXECUTED → CLOSED
```

### 6c. Ongkir Delivery (dari order.types.ts)
```
Lantai 1 / Pickup : Rp 0
Lantai 2          : Rp 1.000
Lantai 3, 4, 99   : Rp 2.000  (99 = Auditorium)
```
Hanya lantai 1,2,3,4,99 yang valid. Input lain → error.

### 6d. Formula Keuangan (dari lib/finance/report.ts)
```
Omzet         = Σ gross_amount transaksi COMPLETED
HPP Terjual   = Σ subtotal_cost item ber-HPP (cost_price_snapshot > 0)
Laba Kotor    = Σ subtotal_sell ber-HPP − HPP Terjual
Pool Mahasiswa = 50% × max(0, Laba Kotor − Biaya Operasional)
Laba Bersih   = Laba Kotor − Pool Mahasiswa − Biaya Operasional
```
Item tanpa HPP (cost_price = 0) → masuk `omzetTanpaHpp`, tidak dihitung laba.

### 6e. Shift Kasir
- Satu shift ACTIVE per karyawan ditegakkan di **application layer** (bukan DB unique index — lihat D8 di Catatan Inkonsistensi vault).
- `modalAwal` wajib diisi saat buka shift; `actualCash` blind count saat tutup.
- Manager wajib MOD check-in hari itu untuk approve penerimaan barang.

### 6f. Tukar Shift
Swap mengubah `shift_schedules` (template berulang per hari-dalam-seminggu), **bukan** tanggal spesifik.
"Tukar Senin ini" = permanen setiap Senin. SOP wajib menjelaskan ini ke kasir.

---

## 7. Cron Jobs
| Endpoint | Fungsi | Jadwal |
|---|---|---|
| `/api/cron/scan-fefo` | Scan batch mendekati expired → `product_condition_reports` | 06:00 WIB |
| `/api/cron/expire-orders` | Kedaluwarsakan pesanan > 2 jam | Setiap 15 menit |
| `/api/cron/auto-close-shift` | Tutup paksa shift lewat 15 menit jadwal | Per jadwal |

---

## 8. Perintah Penting
```bash
npm run dev          # development server
npm run build        # production build
npm run lint         # ESLint check
npm run db:generate  # generate migrasi dari schema.ts
npm run db:migrate   # jalankan migrasi ke DB
npm run db:studio    # Drizzle Studio (browser DB viewer)
npm run db:backup    # backup DB via CLI
npm run test         # jalankan test transaksi TCL + invariants
```

> ⛔ `npm run db:push` — **DINONAKTIFKAN**. Akan menimpa skema produksi. Gunakan `db:migrate`.

---

## 9. File Penting yang Harus Dibaca Dulu

Sebelum mengubah area kode tertentu, baca file ini:

| Area | File |
|---|---|
| Skema DB / tabel / enum | `src/lib/db/schema.ts` |
| Auth & cookie session | `src/lib/utils/auth.ts` |
| Kalkulasi keuangan | `src/lib/finance/report.ts` |
| Rate limiter | `src/lib/utils/rate-limit.ts` |
| Delivery & ongkir | `src/features/order/order.types.ts` |
| Routing & auth guard | `src/proxy.ts` |
| Transaksi POS (referensi pola) | `src/app/api/kasir/transaksi/route.ts` |
| PRD lengkap | `docs/PRD_Wiramart_v2.0.md`, `docs/PRD_Wiramart_v3.0_Gudang.md`, `docs/PRD_Wiramart_v4.0_Kasir_OAuth.md` |

---

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
