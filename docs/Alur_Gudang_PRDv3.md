# 🏪 Alur Lengkap Gudang — Wiramart PRD v3.0

> Dokumen ini menjelaskan **seluruh alur logika gudang** secara end-to-end setelah fitur PRD v3.0 ditambahkan.
> Mencakup: Penerimaan Barang, Manajemen Batch FEFO, Radar Alert, Laporan Kondisi, Keputusan Manager, dan Eksekusi Lapangan.

---

## 🗺️ Peta Aktor & Hak Akses Gudang

| Aktor | Role di Sistem | Apa yang boleh dilakukan |
|---|---|---|
| **Petugas Gudang** | `employee` | Buat draft penerimaan, edit draft, submit ke manager, scan FEFO radar, lapor kondisi fisik barang, eksekusi diskon di lapangan |
| **Admin Shift** | `admin` + `ADMIN_SHIFT` | **TIDAK BISA** akses gudang. Hanya kasir & manajemen shift. |
| **Manager (Dosen)** | `admin` + `MANAGER` | Approve/Revisi/Tolak penerimaan barang, lihat semua batch, putuskan tindakan FEFO (`DISCOUNT`/`DISPLAY_FRONT`/`DESTROY`/`RETURN_SUPPLIER`/`HOLD`), generate barcode diskon |

> [!IMPORTANT]
> **Admin Shift ≠ Manager.** Admin Shift hanya mengelola kasir dan shift karyawan. Seluruh keputusan gudang adalah **hak eksklusif Manager**.

---

## 🔄 ALUR BESAR (Overview)

```mermaid
flowchart TD
    A([Barang Datang dari Supplier]) --> B[1. GUDANG: Buat Draft Penerimaan]
    B --> C[2. GUDANG: Edit & Lengkapi Item]
    C --> D[3. GUDANG: Submit ke Manager]
    D --> E{4. MANAGER: Review Draft}
    E -- ✅ Approve --> F[5. Stok Masuk ke Sistem & Batch FEFO Terbuat]
    E -- ✏️ Revisi --> C
    E -- ❌ Tolak --> G([Draft Ditolak / Arsip])
    
    F --> H[6. FEFO RADAR: Scan Otomatis Batch Mendekati Expired]
    H --> I{Ada batch mau expired?}
    I -- Tidak --> H
    I -- Ya → Alert Muncul --> J[7. GUDANG: Lapor Kondisi Fisik Barang]
    J --> K{8. MANAGER: Putuskan Tindakan}
    K -- DISCOUNT --> L[9. Auto-Generate Barcode Diskon]
    K -- DISPLAY_FRONT --> M1[9a. Geser ke Rak Depan Kasir]
    K -- DESTROY / RETURN_SUPPLIER --> M[9b. Musnahkan / Retur Supplier]
    K -- HOLD --> N[9c. Tahan & Monitor]
    L --> O[10. GUDANG: Eksekusi Diskon di Lapangan]
    O --> P([Kasir: Scan Barcode Diskon → Harga Otomatis Turun])
```

---

## 📦 FASE 1 — Penerimaan Barang Masuk

### Langkah 1: Petugas Gudang Buat Draft

**Siapa:** `employee` (petugas toko/gudang)
**Endpoint:** `POST /api/gudang/penerimaan`

Petugas membuat **draft penerimaan** (seperti form pengisian nota masuk barang) dengan data:
- Nama supplier (opsional)
- Catatan pengiriman (opsional)
- Daftar item barang: nama produk, kode batch, jumlah, HPP, tanggal kadaluarsa, catatan kondisi fisik

**Validasi otomatis:**
- Produk harus terdaftar & aktif di sistem
- Tanggal kadaluarsa tidak boleh sudah lewat
- Minimal 1 item

Draft terbuat dengan status: `DRAFT`

---

### Langkah 2: Petugas Edit Draft (Opsional)

**Endpoint:** `PATCH /api/gudang/penerimaan/{id}`

Kalau ada salah input, petugas bisa edit draft selama statusnya masih `DRAFT` atau `REVISED` (dikembalikan manager untuk diperbaiki). **IDOR-safe:** hanya pembuat draft sendiri yang bisa edit.

---

### Langkah 3: Petugas Submit ke Manager

**Endpoint:** `POST /api/gudang/penerimaan/{id}/submit`

Petugas "klik tombol ajukan" → status berubah ke `SUBMITTED`. Draft kini masuk **antrian Manager**.

**Limit:** Maksimal **10 submit per 24 jam** per petugas (rate limiter, anti-spam).

---

### Langkah 4: Manager Review & Putuskan

**Endpoint (Approve):** `POST /api/admin/gudang/penerimaan/{id}/approve`
**Endpoint (Revisi):** `POST /api/admin/gudang/penerimaan/{id}/revisi`
**Endpoint (Tolak):** `POST /api/admin/gudang/penerimaan/{id}/tolak`

> [!IMPORTANT]
> **Manager harus sudah Check-In sesi kerja hari ini** sebelum bisa approve. Jika Manager belum mulai sesi, sistem menolak dengan error 403.

| Keputusan | Status berubah | Efek |
|---|---|---|
| **Approve** | `APPROVED` | Stok langsung masuk ke sistem, batch FEFO terbuat |
| **Revisi** | `REVISED` | Dikembalikan ke petugas + catatan, petugas bisa edit ulang |
| **Tolak** | `REJECTED` | Draft diarsipkan, stok tidak masuk |

---

### ✅ Saat Approved — ACID Transaction Terjadi:

```
Untuk setiap item dalam draft:
  1. Insert baris baru ke tabel stock_batches (batch FEFO baru terbuat)
  2. Hitung expiry_class: HARIAN (≤2 hari) / PENDEK (≤14 hari) / PANJANG (>14 hari)
  3. Update stock_qty produk di tabel master products (+qty)
  4. Update status draft → APPROVED + simpan ID manager yang approve
  5. Catat audit_log
```

**Semua operasi ini adalah 1 transaksi ACID** — kalau 1 gagal, semua dibatalkan (rollback).

---

## 📊 FASE 2 — Radar FEFO & Monitoring Batch

Setelah barang masuk, sistem otomatis memantau **semua batch yang mendekati expired**.

### Cara Kerja FEFO Radar

**Engine:** `fefoAlertService.ts`

1. Sistem **scan semua batch aktif** yang `expiry_date` ≤ 7 hari ke depan
2. Setiap batch dikategorikan ke alert level:

| Alert Level | Kondisi | Arti |
|---|---|---|
| `H1` (`H1_KRITIS`) | Expired dalam ≤ 1 hari | 🔴 KRITIS — harus segera ditangani |
| `H3` (`H3_URGENT`) | Expired dalam 2–3 hari | 🟠 URGENT |
| `H5` (`H5_WARNING`) | Expired dalam 4–5 hari | 🟡 WARNING (Waspada) |
| `H7` (`H7_WATCH`) | Expired dalam 6–7 hari | 🔵 WATCH (Monitor) |

3. Alert disimpan di tabel `product_condition_reports` di database dengan status awal `ALERT_ONLY`
4. Badge merah muncul di UI gudang

> [!NOTE]
> FEFO Radar dijalankan oleh Cron setiap hari pukul **06:00 WIB** (`/api/cron/scan-fefo`) dan juga dapat di-trigger manual saat **petugas klik tombol Scan FEFO Radar** — bukan auto-refresh tiap detik agar tidak membebani server.

---

## 📋 FASE 3 — Laporan Kondisi Fisik (oleh Petugas Gudang)

Saat radar mendeteksi alert, petugas wajib **turun ke gudang dan lihat kondisi fisik barang** lalu buat laporan.

**Endpoint:** `POST /api/gudang/fefo-alerts/{id}/lapor`

Petugas mengisi:
- Deskripsi kondisi fisik barang (kemasan penyok? jamuran? bau? dll)
- Foto kondisi (opsional)
- Rekomendasi tindakan dari sudut pandang petugas (+ usulan persentase diskon bila relevan)

Status laporan di `product_condition_reports` berubah ke: `SUBMITTED` → masuk antrian keputusan Manager (`MANAGER_REVIEW`).

---

## ⚖️ FASE 4 — Keputusan Manager (Tindakan FEFO)

**Endpoint:** `POST /api/admin/gudang/fefo-alerts/{id}/decide`

Manager membuka laporan kondisi yang diajukan petugas, lalu memutuskan (`manager_decision` di `schema.ts`):

| Keputusan | Kode Enum (`manager_decision`) | Efek Otomatis di Sistem |
|---|---|---|
| **Diskon Darurat** | `DISCOUNT` | ✨ **Auto-generate policy & barcode diskon khusus** (`DISC-...`) untuk batch itu |
| **Majukan ke Etalase Depan** | `DISPLAY_FRONT` | Instruksi pemindahan ke rak utama kasir |
| **Musnahkan** | `DESTROY` | Barang dimusnahkan, tercatat di laporan kerugian/mutasi |
| **Retur ke Supplier** | `RETURN_SUPPLIER` | Barang dikembalikan ke pemasok/konsinyasi |
| **Tahan & Pantau** | `HOLD` | Ditahan sementara dan terus dimonitor |

> [!IMPORTANT]
> Hanya **Manager** yang bisa putuskan (`APPROVED` / `REJECTED`). Admin Shift ❌ tidak bisa akses endpoint ini.

---

### 🏷️ Auto-Generate Barcode Diskon (Jika Pilih `DISCOUNT`)

Saat Manager pilih `DISCOUNT`, sistem otomatis:
1. Membuat kebijakan di `discount_policies` dan generate **kode barcode unik** di `discount_barcodes` (format: `DISC-{batch_code}-{timestamp}`)
2. Simpan barcode + persentase diskon yang ditetapkan Manager
3. Kembalikan barcode ke layar Manager

Manager kemudian **cetak/kirim barcode** ke petugas gudang.

---

## 🛠️ FASE 5 — Eksekusi Lapangan (oleh Petugas Gudang)

**Endpoint:** `POST /api/gudang/fefo-alerts/{id}/execute`

Petugas gudang pergi ke fisik barang, **tempel label barcode diskon** menutupi barcode asli produk, lalu klik "Tandai Sudah Dieksekusi" di sistem.

Status laporan kondisi berubah ke: `EXECUTED` → `CLOSED`.

**Efek di kasir:** Saat kasir scan barcode `DISC-...` tersebut, sistem mendeteksi harga override → **harga otomatis turun** sesuai persentase yang ditetapkan Manager dan kuota `remaining_qty` berkurang secara atomik.

---

## 🧵 Ringkasan Status Flow Lengkap (Sesuai `schema.ts`)

### Penerimaan Barang (`stock_receive_status`):
```
DRAFT → SUBMITTED → APPROVED ✅
                 ↘ REVISED → (edit oleh gudang) → SUBMITTED
                 ↘ REJECTED ❌
```

### Laporan Kondisi & FEFO (`condition_report_status` + `manager_decision`):
```
ALERT_ONLY → SUBMITTED → MANAGER_REVIEW → APPROVED → EXECUTED → CLOSED ✅
                                        ↘ REJECTED ❌
```

---

## 🔒 Separation of Duty Summary

| Aksi | Employee (Gudang) | Admin Shift | Manager (Dosen) |
|---|---|---|---|
| Buat draft penerimaan | ✅ | ❌ | ❌ |
| Edit draft | ✅ (milik sendiri) | ❌ | ❌ |
| Submit ke manager | ✅ (milik sendiri) | ❌ | ❌ |
| Approve/Revisi/Tolak penerimaan | ❌ | ❌ | ✅ |
| Lihat semua batch | ❌ | ❌ | ✅ |
| Scan FEFO radar | ✅ | ❌ | ✅ (view) |
| Lapor kondisi fisik | ✅ | ❌ | ❌ |
| Putuskan tindakan FEFO | ❌ | ❌ | ✅ |
| Generate barcode diskon | ❌ | ❌ | ✅ (otomatis) |
| Eksekusi lapangan | ✅ | ❌ | ❌ |

---

> **Filosofi Desain:** Petugas gudang adalah "tangan" yang kerja fisik. Manager adalah "otak" yang ambil keputusan strategis. Admin Shift hanya tahu dunia kasir. Mereka tidak pernah campur aduk.
