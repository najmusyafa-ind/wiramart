# SOP OPERASIONAL HARIAN WIRAMART UNPERBA

Dokumen ini merupakan prosedur standar operasional resmi (Revisi Produksi 20 November 2026) yang berlaku bagi seluruh pengelola dan petugas shift Wiramart UNPERBA. Seluruh aktivitas terekam otomatis di sistem dan menjadi dasar perhitungan Bagi Hasil 50% mahasiswa.

---

## 1. PEMBAGIAN PERAN DAN KUOTA SHIFT

Jadwal operasional berjalan pada 10 shift per minggu (Senin-Jumat Pagi & Siang, 24 anggota aktif). Setiap shift membagi peran sebagai berikut:

1. **Manager / Dosen (Pengawas Utama):** Login di `/login` (Tab Manager, NIDN + Password). Memegang hak eksklusif atas keputusan tindakan FEFO (diskon/retur/musnahkan) di `/manager/gudang-approval`, pengesahan tutup buku harian (Check-In MOD), VOID transaksi, laporan keuangan, bagi hasil 50% + Slip WA, rekonsiliasi QRIS, dan pengaturan global.
2. **Admin Shift (Maksimal 1 orang/shift):** Login di `/login` (Tab Admin Shift, NIM/No. HP + PIN 6-8 digit). Saling backup penuh dengan Petugas Gudang untuk kelola produk, restock (+ bonus supplier + ED wajib), koreksi stok, dan edit tanggal expired di `/admin/produk` & `/gudang`, serta menangani pesanan online (`/admin/pesanan-online`), jadwal (`/admin/jadwal`), dan tukar shift (`/admin/swap-request`). Tidak dapat memutuskan FEFO maupun mengakses laporan keuangan/bagi hasil.
3. **Kasir (Maksimal 1 kasir utama/shift, mendukung co-cashier):** Login di `/kasir/login` (NIM + PIN 6-8 digit). Bertanggung jawab penuh atas laci kas tunggal, buka/tutup shift, transaksi di `/kasir/pos`, pencatatan Kas Gerak (termasuk `BAYAR_SUPPLIER`), Tutup Awal Resmi (bila izin kuliah/dosen), Laporan Serah Terima Kas WA, laporan sisa makanan pukul 15:00 WIB, serta pengecekan `/kasir/riwayat` dan `/kasir/rekap`.
4. **Petugas Gudang (Minimal 1 orang/shift):** Login di `/gudang/login` (NIM + PIN 6-8 digit). Saling backup penuh dengan Admin Shift di `/gudang` untuk input produk baru langsung aktif, restock langsung (+ ED wajib + bonus supplier gratis), edit produk & tanggal expired per batch, soft-delete produk, arsip Faktur Pemasok, pemindaian Radar FEFO, pelaporan kondisi fisik, dan eksekusi stiker diskon FEFO di lapangan.
5. **CS Pelayan (Tugas Fisik & Runner Delivery):** Bertanggung jawab atas kerapian rak/toko fisik dan pengantaran pesanan online kampus melalui `/kasir/pengiriman`.

---

## 2. ABSENSI SESI, PULANG, DAN TUKAR SHIFT

1. **Absen Masuk:** Buka `/kasir/login` tab Presensi Kehadiran -> klik nama pada jadwal aktif -> pilih peran shift -> klik Konfirmasi Hadir hingga status menjadi `HADIR`.
2. **Batas Keterlambatan:** Toleransi 15 menit dari jam mulai shift; lewat 15 menit otomatis tercatat `TELAT`.
3. **Aturan Bagi Hasil 50%:** Hanya status `HADIR`, `TELAT`, atau `PENGGANTI` yang menerima porsi bagi hasil (distribusi tepat 100%, dukungan penuh untuk Kamis Pagi & dobel shift pada hari yang sama). Tidak absen hingga 30 menit setelah shift berakhir -> otomatis `TIDAK_HADIR` (Rp 0).
4. **Absen Pulang:** Setelah shift dan penutupan kasir selesai, klik Absen Pulang pada tab Presensi Kehadiran.
5. **Tukar Shift:** Wajib diinput melalui `/kasir/tukar-shift` (maksimal 3 kali/minggu), disetujui rekan pengganti, dan disahkan Admin di `/admin/swap-request` sebelum shift dimulai. Karena tukar shift mengubah template `shift_schedules` berulang, ajukan tukar kembali pada minggu berikutnya bila hanya untuk 1 minggu tertentu.

---

## 3. MANAGER (DOSEN): MOD, KEPUTUSAN FEFO, REKAP SHIFT, DAN AUDIT

1. **Check-In Sesi Kerja Harian (`/manager/dashboard`):** Wajib klik Check-In MOD sebelum menyetujui tutup buku atau draft faktur formal (`403` bila belum Check-In).
2. **Keputusan Eksklusif Radar FEFO (`/manager/gudang-approval`):**
   - Tinjau laporan kondisi fisik dari Gudang dan tetapkan: `DISCOUNT` (menerbitkan barcode `DISC-...` otomatis), `DISPLAY_FRONT`, `DESTROY`, `RETURN_SUPPLIER`, atau `HOLD`.
   - **Aturan Mutlak Barang Expired:** Batch dengan tanggal kedaluwarsa sudah lewat (`< hari ini WIB`) diblokir dari opsi `DISCOUNT` dan `DISPLAY_FRONT` (`422`); hanya dapat ditetapkan `DESTROY` atau `RETURN_SUPPLIER`.
3. **Audit Gudang & Persetujuan Draft Formal:** Memantau riwayat `stock_adjustments` (`RESTOCK GUDANG`, `EDIT PRODUK GUDANG`, `EDIT EXPIRED GUDANG`), mengelola Master Supplier, dan meninjau laporan mutasi stok.
4. **Rekap Shift, Bagi Hasil 50%, & Distribusi Slip Gaji (`/manager/laporan`):** Gunakan tombol **Salin Rekap WA**, **Salin Slip WA**, dan **Cetak Slip** untuk membagikan rincian bagi hasil per anggota secara transparan.

---

## 4. ADMIN SHIFT: BACKUP GUDANG, KATALOG PRODUK, DAN PESANAN ONLINE

1. **Kelola Produk & Backup Gudang (`/admin/produk` & `/gudang`):**
   - Saling backup penuh dengan Petugas Gudang: input produk baru langsung aktif (ber-barcode & non-barcode), input restock langsung (+ ED wajib + bonus supplier), edit produk & tanggal expired per batch, koreksi stok opname (wajib alasan jelas), soft-delete produk berhenti dijual, serta menindaklanjuti usulan dari Kasir.
   - Wajib mengisi HPP > Rp 0 (HPP Rp 0 masuk Omzet Tanpa HPP dan tidak dihitung ke Bagi Hasil 50%) serta Harga Jual >= HPP.
2. **Pesanan Online (`/admin/pesanan-online`):** Verifikasi bukti transfer, klik Konfirmasi (potong stok atomik + terbitkan PIN 6 digit pembeli), lalu tugaskan CS Pelayan yang bertugas.
3. **Batas Wewenang:** Enam rute eksklusif Manager (`/gudang-approval`, `/restock`, `/laporan`, `/export`, `/qris`, `/pengaturan`) diblokir dan diarahkan ke `/admin/dashboard`.

---

## 5. PETUGAS GUDANG: STOK FISIK, EXPIRED MULTI-BATCH, RESTOCK BONUS, DAN FEFO

Seluruh operasional dijalankan melalui `/gudang` (login `/gudang/login` dengan NIM + PIN 6-8 digit).

1. **Cek KPI & Indikator Tanggal Expired Belum Diisi:**
   - Periksa kartu `Habis`, `Kritis`, `FEFO Exp`, dan `Restock Hari Ini`.
   - Produk berstok > 0 yang belum punya tanggal kedaluwarsa menampilkan indikator kuning `Tanggal Expired belum diisi` + tombol cepat `Isi Exp`.
2. **Isi / Ubah Tanggal Expired per Batch (`Edit Produk & Tanggal Expired` / `Rincian Batch`):**
   - Klik `Isi Exp` atau `Edit` -> sistem menampilkan seluruh batch aktif produk (mendukung multi-batch) lengkap dengan tombol cepat (`Hari Ini`, `+30h`, `+6bln`, `+1th`).
   - Dapat juga membuka `Rincian Batch` lalu klik `Isi Exp` / `Ubah Exp` secara inline. Perubahan otomatis menyinkronkan Radar FEFO dan diskon aktif.
3. **Restock / Barang Masuk Langsung (`Restock / Barang Masuk`):**
   - Isi jumlah beli, isi kolom **Bonus / Barang Gratis Supplier** (opsional, contoh beli 10 dus gratis 1 dus; HPP efektif otomatis menyesuaikan), isi **Tanggal Kedaluwarsa wajib (`>= hari ini WIB`)**, dan catatan -> klik `Simpan Stok Masuk` (stok langsung bertambah di Kasir & Gudang).
4. **Tambah Produk / Varian Baru (`Tambah Produk Baru`):**
   - Isi nama spesifik per varian, kategori, barcode opsional, HPP, harga jual, qty awal, dan **Tanggal Kedaluwarsa wajib (`>= hari ini WIB`)** -> klik `Simpan Produk Baru` (langsung aktif di Kasir & Gudang).
5. **Arsip Faktur Pemasok:** Unggah foto nota dan kelola arsip di tab `Faktur Pemasok & Penerimaan` (Tabel Buku Nota).
6. **Pemindaian FEFO Radar & Eksekusi Lapangan (`Tindakan FEFO & Diskon`):**
   - Sudah Expired: tarik dari rak, lapor Manager hanya dengan saran `DESTROY` atau `RETURN_SUPPLIER`.
   - H-1 Kritis: tarik dari rak display + lapor Manager.
   - H-3 Urgent / H-5 Warning: cek kondisi kemasan -> lapor Manager + saran tindakan.
   - H-7 Watch: geser batch ke barisan paling depan rak.
   - Jika Manager menyetujui `DISCOUNT`, tempel stiker `DISC-...` menutupi barcode asli lalu klik `Tandai Sudah Dieksekusi`.
7. **Tutup Sesi Gudang:** Klik tombol `Keluar` di pojok kanan atas header setiap kali selesai shift.

---

## 6. KASIR: BUKA SHIFT, TRANSAKSI, KAS GERAK, TUTUP AWAL, DAN SERAH TERIMA WA

1. **Buka Shift & Modal Awal Paten Rp 100.000 (`/kasir/pos`):**
   - Pastikan shift sebelumnya sudah ditutup. Modal awal laci paten Rp 100.000 (dilarang menggulung omzet pagi). Selisih > Rp 2.000 tercatat sebagai `SERAH_TERIMA_SELISIH`.
2. **Pengecekan Sebelum & Sesudah Bayar:**
   - Cocokkan fisik barang dengan keranjang; untuk barang diskon FEFO, wajib pindai barcode stiker `DISC-...`.
   - Tunai (`CASH`): hitung fisik lebih dulu dan serahkan kembalian sesuai layar.
   - QRIS: wajib cek layar HP pembeli (Berhasil, tujuan Wiramart UNPERBA, nominal & jam tepat) sebelum klik selesai.
   - Split (`CASH + QRIS`): total kedua porsi harus tepat sama dengan tagihan.
   - Cek `/kasir/riwayat` setelah transaksi (termasuk preview rincian item inline dan badge **`Diskon FEFO (Tempel Stiker)`**). Salah input wajib dilaporkan ke Manager untuk `VOID` resmi.
3. **Skema Paket Permen:**
   - `Permen Antangin (Isi 3 pcs)`: **Rp 1.000 / 3 pcs**.
   - Permen eceran lainnya (`Permen Relaxa`, dll.): **Rp 500 / 2 pcs (Rp 1.000 / 4 pcs)**.
4. **Kas Gerak (Termasuk `BAYAR_SUPPLIER`):**
   - Setiap uang keluar/masuk laci wajib dicatat lewat Kas Gerak disertai nota fisik. Pembayaran nota supplier tunai dari laci wajib menggunakan kategori **`BAYAR_SUPPLIER`**.
5. **Cut-Off Makanan Harian Pukul 15:00 WIB:**
   - Laporkan sisa seluruh makanan harian melalui `SisaMakananModal` (`HABIS`, `RETUR`, `BUANG_BASI`, `MAKAN_PETUGAS`, `OBRAL`, `SIMPAN`). Tidak melapor -> auto-reset 0 pukul 00:00 WIB (`[AUTO-CRON-MIDNIGHT]`).
6. **Tutup Shift (Blind Count), Tutup Awal Resmi, & Laporan WA:**
   - Pisahkan modal paten Rp 100.000, lalu hitung tunai fisik aktual per pecahan (*blind count*). Kas aktual = modal padahal ada penjualan tunai -> `FRAUD_CASH_SUSPICIOUS`.
   - **Tutup Awal Resmi:** Bila shift harus tutup lebih awal karena jadwal mata kuliah atau izin dosen, centang opsi Tutup Awal Resmi dan tuliskan alasan singkat agar tidak terkena status `AUTO_CLOSED_OVERDUE`.
   - Setelah tutup shift, klik **Salin Laporan WA** pada ringkasan Serah Terima Kas Shift untuk dibagikan ke grup shift / Manager.

---

## 7. CS PELAYAN DAN LAYANAN PEMBELI ONLINE (PWA `/order`)

1. Pembeli kampus mengakses katalog pesan antar di `/order` (mendukung Install App PWA 1-tap, ongkir otomatis L1 Rp 0, L2 Rp 1.000, L3/L4/Auditorium Rp 2.000).
2. CS Pelayan membuka `/kasir/pengiriman`, klik `Siapkan & Berangkat Sekarang`, lalu wajib memverifikasi **PIN Serah Terima 6 Digit** dari pembeli hingga status menjadi `COMPLETED`. Bila pembeli tidak hadir di ruangan, klik `Pembeli Tidak Ada` dan tunggu 5 menit.
