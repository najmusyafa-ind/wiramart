# 📋 PRD — Wiramart v4.0: Rekap Kasir & Google OAuth Kampus
> **Versi:** 4.0.0 — Kasir Intelligence + SSO Edition  
> **Tanggal Dibuat:** 2026-10-17  
> **Pemilik Produk:** Najmusyafa (Developer / Mahasiswa UNPERBA)  
> **Status:** 🟡 DRAFT — Menunggu Final Approval Dosen/Manager  
> **Dokumen Terkait:** [`PRD_Wiramart_v2.0.md`](./PRD_Wiramart_v2.0.md) · [`PRD_Wiramart_v3.0_Gudang.md`](./PRD_Wiramart_v3.0_Gudang.md) · [`schema.ts`](../../src/lib/db/schema.ts) · [`auth.ts`](../../src/lib/utils/auth.ts)

---

> [!IMPORTANT]
> **Prinsip Absolut:** PRD ini adalah update kecil di atas ekosistem yang sudah berjalan (v1.x POS + v2.0 PWA + v3.0 Gudang). Semua pengembangan bersifat **purely additive**. Tidak ada perubahan pada logika transaksi, stok, atau auth yang sudah ada.

---

## 🎯 Latar Belakang & Scope

**v4.0 terdiri dari 2 fitur yang independen satu sama lain:**

| Fitur | Status | Estimasi Waktu |
|---|---|---|
| **F1: Rekap Transaksi Harian Kasir** | 🔴 PRIORITAS UTAMA | 3–5 hari |
| **F2: Google OAuth Login @student.unperba.ac.id** | 🟡 OPSIONAL | 1–2 minggu |

> F1 dan F2 bisa dikerjakan paralel karena tidak ada dependency antar keduanya.

---

## 📋 FITUR 1 — Rekap Transaksi Harian Kasir

> **Priority:** 🔴 MUST HAVE  
> **Tidak ada schema change baru** — hanya API baru + halaman baru

### 1.1 Konteks Sistem yang Ada

Sebelum menulis spesifikasi, berikut peta data yang akan dipakai:

| Data | Sumber | Catatan |
|---|---|---|
| Identity kasir | `payload.sub` dari JWT cookie `sk_kasir` | WAJIB hardcoded dari server — tidak dari query param |
| Transaksi kasir | `transactions` WHERE `employee_id = {kasirId}` | Filter by employee_id wajib server-side |
| Detail item | `transaction_items` JOIN `transactions` | Snapshot harga — tidak ada HPP ke UI kasir |
| Pembayaran | `transaction_payments` | Split payment support sudah ada |
| Tanggal bisnis | `transactions.created_at` timezone Asia/Jakarta | Server selalu UTC, konversi ke WIB |
| Transaksi test | `transactions.is_test` | Filter: hanya tampilkan `is_test = FALSE` |

---

### 1.2 User Story

> Sebagai KASIR yang akan tutup shift, saya ingin bisa melihat rekap transaksi yang saya layani hari ini, lengkap dengan rincian pembayaran (tunai, QRIS, split), agar saya bisa cocokkan dengan uang fisik di laci — tanpa bisa mengedit atau menghapus transaksi apapun.

---

### 1.3 Acceptance Criteria

**Tampilan & Data:**
- [ ] Halaman tersedia di `/kasir/rekap` — bisa diakses dengan `sk_kasir` cookie (akun kasir)
- [ ] Default filter: **hari ini** (WIB) — tanggal otomatis, kasir tidak perlu pilih
- [ ] Filter opsional: kasir bisa pilih tanggal lain (untuk cek historis shift sebelumnya)
- [ ] Daftar transaksi: urutan **terbaru di atas** (desc by `created_at`)
- [ ] Pagination: **20 transaksi per halaman**
- [ ] Data yang tampil per transaksi:
  - Nomor invoice (`INVxxxxxxxx`)
  - Jam transaksi (format HH:mm WIB)
  - Jumlah item (count)
  - Total tagihan (`gross_amount`) — **dalam Rupiah, format ribuan**
  - Metode bayar: CASH / QRIS / SPLIT
  - Kembalian (`change_amount`) — hanya jika ada CASH
  - Status: ✅ SELESAI atau 🚫 VOID

**Ringkasan di atas daftar (Summary Card):**
- [ ] Total transaksi hari ini: angka bulat (misal: "12 Transaksi")
- [ ] Total dari CASH: Rp xxx.xxx
- [ ] Total dari QRIS: Rp xxx.xxx
- [ ] Total SPLIT (campuran): Rp xxx.xxx
- [ ] **Total Keseluruhan Diterima:** Rp xxx.xxx ← ini untuk balancing fisik
- [ ] Total VOID hari ini: N transaksi senilai Rp xxx.xxx (informatif)

**Security & Pembatasan (NON-NEGOTIABLE):**
- [ ] Kasir **HANYA** bisa lihat transaksi miliknya sendiri — tidak ada parameter override
- [ ] Tidak ada tombol **Edit**, **Void**, atau **Hapus** di halaman ini — read-only mutlak
- [ ] Data **HPP** (`cost_price_snapshot`), **gross_profit**, **total_hpp** tidak pernah dikirim ke response
- [ ] Transaksi `is_test = TRUE` tidak ditampilkan
- [ ] Jika kasir coba akses `/kasir/rekap` tanpa login: redirect ke `/kasir/login`

---

### 1.4 API Specification

```
GET /api/kasir/rekap-harian
Auth: sk_kasir cookie (verifyJwt → role = 'employee')
Query params:
  - tanggal?: string (YYYY-MM-DD) — default: hari ini WIB
  - page?: number — default: 1
  - limit?: number — default: 20, max: 50

Response: {
  success: true,
  data: {
    summary: {
      totalTransaksi: number,
      totalVoid: number,
      totalAmountCash: number,     // total dari payment_method CASH
      totalAmountQris: number,     // total dari payment_method QRIS
      totalAmountSplit: number,    // total transaksi dengan metode split (CASH+QRIS)
      totalDiterima: number,       // totalCash + totalQris + totalSplit (untuk balancing)
      totalKembalian: number,      // sum(change_amount) untuk cek uang keluar
      totalVoidAmount: number,
    },
    transaksi: Array<{
      id: string,
      invoiceNumber: string,
      createdAt: string,           // ISO UTC (frontend konversi ke WIB)
      itemCount: number,
      grossAmount: number,
      changeAmount: number | null,
      paymentMethod: 'CASH' | 'QRIS',   // metode primer
      payments: Array<{               // detail split payment
        paymentMethod: 'CASH' | 'QRIS',
        amount: number,
      }>,
      status: 'COMPLETED' | 'VOID',
      isVoid: boolean,
    }>,
    pagination: {
      page: number,
      limit: number,
      total: number,
      totalPages: number,
    },
    tanggal: string,  // tanggal yang diquery (YYYY-MM-DD WIB)
    kasir: {
      fullName: string,
      nim: string,
    }
  }
}
```

**TIDAK ADA dalam response (wajib di-exclude dari SELECT):**
```typescript
// BANNED dari response kasir:
// ❌ cost_price_snapshot
// ❌ subtotal_cost
// ❌ total_hpp
// ❌ gross_profit
// ❌ voided_by_admin_id (nama admin yang void — privasi)
// ❌ is_test (internal flag)
```

---

### 1.5 Implementasi Server-Side (Security Core)

```typescript
// GET /api/kasir/rekap-harian
export async function GET(req: NextRequest) {
  // 1. Verifikasi JWT — employee only
  const payload = await verifyJwt(req);
  if (!payload || payload.role !== 'employee') {
    return apiError('Unauthorized', 401);
  }

  // 2. employee_id WAJIB dari JWT — tidak pernah dari query param
  const employeeId = payload.sub as string;  // ← IDOR-proof: hardcoded dari token

  // 3. Parse query params dengan validasi
  const url = new URL(req.url);
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1');
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '20');
  const tanggalRaw = url.searchParams.get('tanggal');

  const page = Math.max(1, isNaN(pageRaw) ? 1 : pageRaw);
  const limit = Math.min(50, Math.max(1, isNaN(limitRaw) ? 20 : limitRaw));  // cap 50

  // 4. Tentukan rentang tanggal (WIB)
  const targetDate = parseDateWIB(tanggalRaw);  // helper: default hari ini WIB
  const { startUtc, endUtc } = getWIBDayBounds(targetDate);
  // startUtc = 2026-10-17T17:00:00Z (00:00 WIB)
  // endUtc   = 2026-10-18T16:59:59Z (23:59 WIB)

  // 5. Query transaksi — WHERE employee_id wajib di semua query
  const [transaksiRows, summaryRows] = await Promise.all([
    db.select({
      id:            transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      createdAt:     transactions.createdAt,
      grossAmount:   transactions.grossAmount,
      changeAmount:  transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
      status:        transactions.status,
      // ❌ TIDAK ADA: totalHpp, grossProfit, costPrice
    })
    .from(transactions)
    .where(and(
      eq(transactions.employeeId, employeeId),    // ← filter kunci
      eq(transactions.isTest, false),              // exclude test transactions
      gte(transactions.createdAt, startUtc),
      lte(transactions.createdAt, endUtc),
    ))
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset((page - 1) * limit),

    // Summary query — terpisah untuk performa
    db.select({
      status:       transactions.status,
      grossAmount:  transactions.grossAmount,
      changeAmount: transactions.changeAmount,
      paymentMethod: transactions.paymentMethod,
    })
    .from(transactions)
    .where(and(
      eq(transactions.employeeId, employeeId),    // ← filter kunci sama
      eq(transactions.isTest, false),
      gte(transactions.createdAt, startUtc),
      lte(transactions.createdAt, endUtc),
    )),
  ]);

  // 6. Hitung summary (di application layer)
  const summary = computeSummary(summaryRows);

  return apiOk({ summary, transaksi: transaksiRows, ... });
}
```

**Helper WIB Date:**
```typescript
// src/lib/utils/date-wib.ts (file baru, tidak mengubah yang ada)
export function getTodayWIB(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

export function getWIBDayBounds(dateStr: string): { startUtc: Date; endUtc: Date } {
  // 00:00 WIB = 17:00 UTC sehari sebelumnya
  const startUtc = new Date(`${dateStr}T00:00:00+07:00`);
  const endUtc   = new Date(`${dateStr}T23:59:59.999+07:00`);
  return { startUtc, endUtc };
}
```

---

### 1.6 UI Specification

**Route:** `/kasir/rekap` (tambahan di `/kasir` existing)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [← Kembali ke POS]    Rekap Transaksi Hari Ini        │
│  Kasir: Budi Santoso (NIM: 2209001)                    │
│  📅 Sabtu, 17 Oktober 2026  [Ganti Tanggal ▾]         │
├─────────────────────────────────────────────────────────┤
│  RINGKASAN HARI INI                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  │
│  │12 Trx   │ │ CASH    │ │ QRIS    │ │ TOTAL       │  │
│  │3 Void   │ │Rp85.000 │ │Rp120.000│ │ Rp205.000   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────┘  │
├─────────────────────────────────────────────────────────┤
│  DAFTAR TRANSAKSI                                       │
│                                                         │
│  INV20261017143052001  14:30  CASH    Rp 25.000  ✅     │
│  3 item  │ Kembalian: Rp 5.000                         │
│                                                         │
│  INV20261017141820002  14:18  QRIS    Rp 18.000  ✅     │
│  2 item                                                 │
│                                                         │
│  INV20261017123045003  12:30  SPLIT   Rp 45.000  🚫VOID│
│  5 item  (Cash: Rp25.000 + QRIS: Rp20.000)             │
│                                                         │
│  [◀ Prev]  Halaman 1 dari 3  [Next ▶]                  │
└─────────────────────────────────────────────────────────┘
```

**Aturan UI:**
- Tidak ada tombol Edit, Void, Hapus, atau aksi apapun di setiap baris
- Warna badge status: Hijau = COMPLETED, Merah = VOID
- Void ditampilkan dengan strikethrough pada amount (informatif)
- Gunakan `Intl.NumberFormat('id-ID')` untuk format Rupiah

---

### 1.7 Rate Limiting

```typescript
// Tambah ke rate-limit.ts (pola yang sudah ada):
export const kasirRekapLimiter = createRateLimiter(
  'kasir:rekap',
  30,                    // 30 request
  60 * 1000,             // per 1 menit per employeeId
);
// Alasan: halaman ini di-refresh kasir berkali-kali saat balancing — limit cukup longgar
```

---

## 🔑 FITUR 2 — Google OAuth Login @student.unperba.ac.id

> **Priority:** 🟡 OPSIONAL  
> **Catatan:** Fitur ini tidak diperlukan untuk operasional, tapi mengurangi beban Admin dalam verifikasi akun kasir baru.

### 2.1 Desain Keputusan

**Mengapa Google OAuth (bukan email-password biasa)?**
- Mahasiswa sudah punya akun Google dari kampus (`@student.unperba.ac.id`)
- Admin tidak perlu verifikasi manual satu per satu
- Password mahasiswa kampus tidak perlu disimpan di sistem Wiramart

**Mengapa HANYA @student.unperba.ac.id?**
- Mencegah akun eksternal masuk ke sistem kasir
- Setiap login Google kampus sudah ter-verifikasi identitasnya oleh pihak kampus

**Alur yang dipilih: OAuth 2.0 Authorization Code Flow (Server-Side)**
- Code exchange terjadi di **server** (route handler), bukan client — `client_secret` tidak pernah ke browser
- Ini lebih aman dari Implicit Flow

---

### 2.2 Alur Login Google (End-to-End)

```
1. Kasir buka /kasir/login
2. Kasir klik tombol "Masuk dengan Google Kampus"
3. Browser redirect ke Google OAuth consent screen
   URL: accounts.google.com/oauth2/v2/auth?
        client_id={GOOGLE_CLIENT_ID}
        &redirect_uri={GOOGLE_REDIRECT_URI}
        &response_type=code
        &scope=openid email profile
        &state={CSRF_TOKEN}        ← random 32 byte, disimpan di cookie sementara
        &hd=student.unperba.ac.id  ← Google hint: tampilkan hanya akun kampus
        &prompt=select_account     ← biarkan user pilih akun jika multi-akun

4. User login/pilih akun Google → Google redirect ke:
   /api/auth/google/callback?code={AUTH_CODE}&state={CSRF_TOKEN}

5. Server (route handler) melakukan:
   a. Verifikasi state === cookie_state (CSRF check)
   b. Exchange code → access_token + id_token (POST ke accounts.google.com/token)
   c. Decode id_token (JWT dari Google) → dapatkan email + sub (Google UID)
   d. VALIDASI DOMAIN: if (!email.endsWith('@student.unperba.ac.id')) → TOLAK
   e. Extract NIM dari email: "nim@student.unperba.ac.id" → NIM = bagian sebelum @
   f. Lookup di tabel employees WHERE nim = {nim} AND is_active = TRUE
   g. Jika tidak ditemukan → redirect ke /kasir/login?error=akun_tidak_terdaftar
   h. Jika ditemukan: simpan google_sub ke employees (jika belum ada)
   i. Generate sk_kasir JWT cookie (sama dengan login biasa)
   j. Redirect ke /kasir/pos

6. Kasir sudah login via Google
```

---

### 2.3 Security Analysis Google OAuth

| Vektor Serangan | Mitigasi |
|---|---|
| CSRF (state spoofing) | `state` parameter: random 32 byte, simpan di cookie `oauth_state` (HttpOnly, maxAge: 5 menit), bandingkan di callback |
| Token Injection | Verifikasi `id_token` dari Google menggunakan Google's public keys (JWKS endpoint) atau library `google-auth-library` |
| Domain Bypass | Validasi server-side: `email.endsWith('@student.unperba.ac.id')` — tidak percaya `hd` param dari request |
| Account Enumeration | Error generic: "Akun Google ini tidak terdaftar" — tidak expose apakah NIM ada atau tidak |
| Client Secret Leak | `GOOGLE_CLIENT_SECRET` hanya di server env, tidak pernah ke client bundle |
| Replay Attack | `code` dari Google bersifat one-time (sekali pakai, expire pendek) |
| Open Redirect | Redirect setelah login hanya ke whitelist URL internal (`/kasir/pos`) |

---

### 2.4 API Routes Google OAuth

```
GET /api/auth/google/init
  Description: Generate state, set cookie, redirect ke Google OAuth URL
  Auth: Tidak perlu (endpoint publik)
  Rate limit: 10 req/menit per IP (prevent redirect loop abuse)
  Action:
    1. Generate state = crypto.randomBytes(32).toString('hex')
    2. Set cookie oauth_state (HttpOnly, SameSite: lax, maxAge: 300s)
    3. Return 302 redirect ke Google OAuth URL
  Security: Tidak expose Google client_id di response body (ada di redirect URL, ini OK)

GET /api/auth/google/callback?code={code}&state={state}
  Description: Terima callback dari Google, exchange code, validasi, set session
  Auth: Tidak perlu (Google yang callback)
  Rate limit: 10 req/menit per IP
  Flow:
    1. Cek state dari query === state dari cookie oauth_state → 400 jika tidak cocok
    2. Hapus cookie oauth_state (one-time use)
    3. POST ke https://oauth2.googleapis.com/token dengan code + client_secret
    4. Verifikasi id_token signature
    5. Ekstrak email dari id_token payload
    6. Validasi domain: if (!email.endsWith('@student.unperba.ac.id')) → redirect error
    7. Extract NIM: email.split('@')[0]
    8. Cari employee WHERE nim = NIM AND is_active = TRUE
    9. Jika tidak ada → redirect ke /kasir/login?error=not_registered
    10. Jika ada: set sk_kasir cookie (sama persis dengan login biasa)
    11. Redirect ke /kasir/pos
  Error cases:
    - Google error (deny): redirect ke /kasir/login?error=google_denied
    - Domain salah: redirect ke /kasir/login?error=domain_not_allowed
    - NIM tidak terdaftar: redirect ke /kasir/login?error=not_registered
    - Semua error: generic message di UI, tidak expose detail teknis
```

---

### 2.5 Schema Change (Minimal — Additive Only)

```sql
-- Migration v4_2_google_oauth.sql
-- ADDITIVE ONLY — tidak mengubah kolom yang ada

-- Tambah kolom google_sub ke employees
-- NULL = kasir belum pernah/tidak pakai Google login
-- NOT NULL unique = kasir sudah link akun Google
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) UNIQUE;
  -- google_sub = sub field dari Google id_token (unique per Google account)

-- Index untuk lookup O(1) di callback
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_google_sub
  ON employees(google_sub)
  WHERE google_sub IS NOT NULL AND deleted_at IS NULL;

-- Catatan: satu kasir = satu Google account (unique constraint)
-- Jika kasir punya dua NIM? Tidak mungkin — NIM unique di kampus
```

---

### 2.6 Environment Variables Baru

```bash
# Google OAuth 2.0 Credentials (dari Google Cloud Console)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://wiramart.unperba.ac.id/api/auth/google/callback

# Sudah ada (dipakai untuk JWT sign):
JWT_SECRET=...
```

> **Cara dapat credentials:**
> 1. Buka [Google Cloud Console](https://console.cloud.google.com)
> 2. Buat project baru / pakai project existing
> 3. Enable "Google+ API" / "People API"
> 4. OAuth Credentials → Authorized redirect URIs → tambahkan `GOOGLE_REDIRECT_URI`
> 5. Pastikan `Authorized JavaScript origins` kosong (tidak perlu untuk server-side flow)

---

### 2.7 Library yang Dipakai

```bash
# google-auth-library untuk verifikasi id_token (JANGAN decode manual tanpa verify)
npm install google-auth-library
```

```typescript
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Verifikasi id_token — WAJIB, jangan skip
async function verifyGoogleToken(idToken: string) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error('Invalid token');
  return payload;  // { sub, email, email_verified, name, ... }
}
```

---

### 2.8 UI — Tombol Google Login di Halaman Kasir

Tambahkan di halaman `/kasir/login` (extend yang sudah ada):

```tsx
{/* Tambahkan di bawah form login existing */}
<div className="relative my-6">
  <div className="absolute inset-0 flex items-center">
    <span className="w-full border-t border-white/10" />
  </div>
  <div className="relative flex justify-center text-xs text-white/40">
    atau masuk dengan
  </div>
</div>

<a
  href="/api/auth/google/init"
  className="flex items-center justify-center gap-3 w-full py-3 px-4 
             bg-white text-gray-800 rounded-xl font-medium
             hover:bg-gray-100 transition-colors"
>
  <GoogleIcon className="w-5 h-5" />
  Masuk dengan Google Kampus
  <span className="text-xs text-gray-500">(@student.unperba.ac.id)</span>
</a>

<p className="text-center text-xs text-white/30 mt-2">
  Hanya untuk email @student.unperba.ac.id
</p>
```

**Error Messages di UI (`/kasir/login?error={code}`):**

| Error Code | Pesan yang Ditampilkan |
|---|---|
| `domain_not_allowed` | "Email Google kamu bukan dari domain kampus (@student.unperba.ac.id). Gunakan akun Google kampusmu." |
| `not_registered` | "Akun Google ini belum terdaftar di Wiramart. Hubungi Admin untuk pendaftaran." |
| `google_denied` | "Login dengan Google dibatalkan. Silakan coba lagi." |
| `state_mismatch` | "Sesi login tidak valid. Silakan mulai ulang proses login." |
| `server_error` | "Terjadi kesalahan. Silakan coba lagi atau gunakan metode login lain." |

> **Prinsip:** Error message tidak pernah expose detail teknis (NIM ada/tidak, constraint violation, dll).

---

## 🔐 Security Architecture — v4.0

### A. Ringkasan Ancaman & Mitigasi F1 (Rekap Kasir)

| Ancaman | Mitigasi |
|---|---|
| Kasir A akses transaksi Kasir B | `employee_id = payload.sub` hardcoded di server — tidak bisa di-override dari URL/body |
| Kasir lihat HPP / margin produk | Explicit `SELECT` fields tanpa `cost_price_snapshot`, `total_hpp`, `gross_profit` |
| Kasir edit/void transaksi | Tidak ada endpoint mutasi di `/api/kasir/rekap*` — pure GET |
| Manipulasi date param untuk exploit | Validasi format YYYY-MM-DD + sanitize via `parseDate()` |
| Flood request (scraping) | `kasirRekapLimiter`: 30 req/menit per employeeId |

### B. Ringkasan Ancaman & Mitigasi F2 (Google OAuth)

| Ancaman | Mitigasi |
|---|---|
| CSRF di OAuth callback | `state` parameter random 32 byte + validasi cookie |
| Domain bypass | Validasi server-side `endsWith('@student.unperba.ac.id')` — tidak percaya `hd` param |
| Fake id_token | `verifyIdToken()` dari `google-auth-library` dengan audience check |
| Client secret leak | `GOOGLE_CLIENT_SECRET` hanya di Vercel env — tidak pernah ke client bundle |
| Account enumeration | Error message generic tidak expose apakah NIM terdaftar atau tidak |
| Open redirect setelah login | Hardcode redirect ke `/kasir/pos` — tidak ada `redirect_to` param yang bisa dimanipulasi |
| Login spray via Google init | Rate limit 10 req/menit per IP di `/api/auth/google/init` |
| google_sub collision | `UNIQUE` constraint di DB — satu Google account = satu kasir account |

### C. Audit Trail F2

Setiap Google login sukses wajib dicatat:
```typescript
// Append ke audit_logs setelah login sukses via Google
await db.insert(auditLogs).values({
  tableName: 'employees',
  recordId: employee.id,
  action: 'UPDATE',  // update google_sub (first time) atau re-login
  oldValues: JSON.stringify({ loginMethod: 'NIM+NAMA' }),
  newValues: JSON.stringify({ loginMethod: 'GOOGLE_OAUTH', email: googleEmail }),
  actorType: 'EMPLOYEE',
  actorId: employee.id,
});
```

---

## 📊 Database Migration Plan — v4.0

| # | File | Tabel | Tipe | Risk |
|---|---|---|---|---|
| — | — | — | **Tidak ada schema change untuk F1** | ✅ ZERO RISK |
| 1 | `v4_2_google_oauth.sql` | `employees` | ADD COLUMN `google_sub` nullable | ✅ SAFE |

> **Total migration: hanya 1 file SQL** dengan satu kolom nullable. Rollback: `ALTER TABLE employees DROP COLUMN google_sub;` — tidak ada cascading effect.

---

## 📅 Roadmap Implementasi

```
F1 — Rekap Transaksi Kasir (~3-5 hari, bisa langsung mulai)
├── [BE] Helper date-wib.ts: getTodayWIB(), getWIBDayBounds()
├── [BE] Rate limiter: kasirRekapLimiter
├── [BE] GET /api/kasir/rekap-harian
│         (verifyJwt, employee_id dari JWT, query + summary)
├── [FE] Halaman /kasir/rekap
│         (summary cards + daftar transaksi + pagination)
└── [TEST] IDOR test: kasir A tidak bisa lihat transaksi kasir B

F2 — Google OAuth (~1-2 minggu, bisa paralel)
├── [INFRA] Setup Google Cloud Console project + OAuth credentials
├── [DB] Migration v4_2: ADD COLUMN google_sub
├── [BE] npm install google-auth-library
├── [BE] GET /api/auth/google/init
│         (generate state, set cookie, redirect)
├── [BE] GET /api/auth/google/callback
│         (state check, code exchange, domain validation, JWT set)
├── [FE] Tambah tombol "Masuk dengan Google" di /kasir/login existing
├── [FE] Error message handler (?error= query param)
└── [TEST] End-to-end login dengan akun @student.unperba.ac.id
         + test tolak akun @gmail.com
```

---

## ✅ Definition of Done

### F1 — Rekap Transaksi DONE jika:
- [ ] Kasir A login → lihat rekap → **hanya melihat transaksinya sendiri** (verifikasi manual)
- [ ] Kasir B login → tidak bisa akses rekap Kasir A walau tahu URL + employee ID
- [ ] Response API **tidak mengandung** `cost_price_snapshot`, `total_hpp`, `gross_profit`
- [ ] Summary card: total CASH + total QRIS + total SPLIT = total keseluruhan (balancing matematis)
- [ ] Halaman tidak ada tombol aksi apapun (Edit/Void/Hapus)
- [ ] Transaksi `is_test = TRUE` tidak muncul
- [ ] Format Rupiah menggunakan `Intl.NumberFormat('id-ID')` di semua angka

### F2 — Google OAuth DONE jika:
- [ ] Login dengan `@student.unperba.ac.id` yang terdaftar → berhasil masuk
- [ ] Login dengan `@gmail.com` → ditolak dengan pesan domain tidak diizinkan
- [ ] Login dengan `@student.unperba.ac.id` yang belum terdaftar di DB → pesan "belum terdaftar"
- [ ] Manipulasi `state` parameter → 400 error (CSRF protection aktif)
- [ ] `GOOGLE_CLIENT_SECRET` tidak muncul di network tab browser (hanya server-side)
- [ ] `google_sub` tersimpan di DB setelah pertama kali login Google

---

## 🚫 Out of Scope — Wiramart v4.0

| Feature | Alasan |
|---|---|
| Google login untuk Admin/Manager | Admin pakai NIDN + Password (lebih ketat) — tidak perlu OAuth |
| Google login untuk Buyer PWA | Buyer sudah pakai NIM login (v2.0) — tidak perlu OAuth |
| Google Workspace Admin API (manage users) | Over-engineering untuk kampus kecil |
| Email notifikasi via Gmail API | Notifikasi sudah via WA (v2.0/v3.0) |
| Multi-provider OAuth (GitHub, Apple) | Hanya Google yang relevan untuk mahasiswa kampus |
| Auto-register kasir baru via Google | Terlalu permissive — admin tetap harus daftar NIM dulu |

---

## 🔗 Titik Integrasi dengan Versi Sebelumnya

| Fitur v4.0 | Integrasi dengan | Caranya |
|---|---|---|
| F1: Rekap Kasir | `transactions` (v1.x) | SELECT dengan filter `employee_id` dari JWT |
| F1: Rekap Kasir | `transaction_payments` (v1.x) | JOIN untuk detail split payment |
| F1: Rate Limiter | `rate-limit.ts` (v1.x) | `createRateLimiter()` yang sudah ada |
| F1: Auth | `verifyJwt()` di `auth.ts` (v1.x) | Tidak ada perubahan |
| F2: Google OAuth | `employees` (v1.x) | ADD COLUMN `google_sub` + lookup by NIM |
| F2: Session | `signAccessToken()` di `auth.ts` (v1.x) | Reuse existing function — output sama |
| F2: Cookie | `setAuthCookies()` di `auth.ts` (v1.x) | Reuse existing — set `sk_kasir` seperti login biasa |
| F2: Audit | `audit_logs` (v1.x) | Append-only INSERT setiap Google login |

---

## 🔖 Glosarium Teknis

| Term | Definisi |
|---|---|
| **Rekap Harian** | Halaman read-only kasir untuk melihat transaksi yang dia layani hari ini (WIB) |
| **Balancing** | Proses kasir mencocokkan total uang fisik di laci dengan total sistem |
| **IDOR** | Insecure Direct Object Reference — bug dimana user A bisa lihat data user B |
| **OAuth 2.0** | Protokol otorisasi yang memungkinkan login via pihak ketiga (Google) tanpa berbagi password |
| **Authorization Code Flow** | OAuth flow dimana `code` di-exchange di server (bukan client) — lebih aman |
| **state parameter** | Random token untuk mencegah CSRF attack di OAuth callback |
| **id_token** | JWT yang diterbitkan Google berisi info user (email, sub, name) |
| **google_sub** | Subject ID unik dari Google (`sub` field di id_token) — tidak berubah walau email ganti |
| **hd** | Hosted Domain — hint ke Google untuk tampilkan akun dari domain tertentu |
| **WIB Day Bounds** | Konversi rentang tanggal WIB ke UTC: 00:00 WIB = 17:00 UTC kemarin |

---

## ✍️ Approval & Sign-off

| Pihak | Nama | Status | Tanggal |
|---|---|---|---|
| Developer / Pemilik Produk | Najmusyafa | 🟡 Review | 2026-10-17 |
| Manager / Dosen Pembimbing | — | ⬜ Belum | — |

---

*PRD ini adalah dokumen hidup. F1 bisa langsung diimplementasikan setelah approval. F2 memerlukan akses Google Cloud Console kampus terlebih dahulu.*
