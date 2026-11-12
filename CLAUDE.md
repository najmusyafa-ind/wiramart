@AGENTS.md

# CLAUDE.md — Wiramart Smartkasir Perwira

Instruksi lengkap ada di [`AGENTS.md`](./AGENTS.md). File ini berlaku untuk Claude dan AI agent lain.

---

## Catatan Khusus untuk Claude

### Prioritas membaca konteks
1. **`AGENTS.md`** (file ini merujuk ke sana) — aturan arsitektur & domain
2. **`src/lib/db/schema.ts`** — sumber kebenaran skema
3. **`app/task.md`** — status sesi terakhir & fase aktif
4. **`docs/`** — PRD v2/v3/v4 untuk konteks bisnis

### Jangan pernah
- Mengubah enum di schema.ts tanpa migrasi SQL
- Menambahkan logika bisnis di komponen React (harus di Service layer)
- Menggunakan `db.push` (sudah dinonaktifkan)
- Membuat rate limiter baru selain yang ada di `rate-limit.ts`
- Hard-delete data bisnis (gunakan `deleted_at`)

### Pola yang benar untuk fitur baru
```
1. Tambah tabel/kolom di schema.ts → generate migrasi
2. Buat/update Zod DTO di features/ atau types file
3. Implementasi Repository (query) di lib/ atau features/
4. Implementasi Service (logika bisnis)
5. Buat Route Handler tipis (≤ 30 baris) di app/api/
6. Buat/update komponen UI (Server Component dulu, 'use client' hanya jika perlu)
```

### Status implementasi fitur
| Fitur | Status |
|---|---|
| POS Kasir (transaksi, shift, stok) | ✅ Production |
| Delivery & Online Order | ✅ Production |
| Gudang (penerimaan, approval) | ✅ Production |
| FEFO Radar & Diskon Darurat | ✅ Production |
| Manager on Duty & Closing Harian | ✅ Production |
| Laporan Keuangan (harian/mingguan/bulanan/6-bulanan) | ✅ Production |
| Backup & Restore Database | ✅ Production |
| Google OAuth Kasir (PRD v4 F2) | ⬜ Belum dibuat |
| Deployment ke production Vercel | 🔄 Belum final |
