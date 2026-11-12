# SOP OPERASIONAL HARIAN WIRAMART UNPERBA

Dokumen ini berlaku mutlak bagi seluruh petugas shift Wiramart UNPERBA. Seluruh aktivitas terekam otomatis di sistem dan menentukan pembagian Bagi Hasil 50% mahasiswa.

---

## 1. PEMBAGIAN PERAN DAN KUOTA SHIFT

Setiap shift wajib membagi peran saat absen di `/kasir/login`:

1. **Admin Shift (Maksimal 1 orang/shift):** Login di `/login` (Tab Admin Shift, NIM + PIN 6 digit). Bertanggung jawab atas input, edit, koreksi stok, dan hapus barang di `/admin/produk`, konfirmasi pesanan online di `/admin/pesanan-online`, serta persetujuan tukar shift di `/admin/swap-request`. Dilarang merangkap kasir dan tidak bisa menyetujui barang masuk gudang.
2. **Kasir (Maksimal 1 orang/shift):** Login di `/kasir/login` (Tab Login POS). Bertanggung jawab penuh atas laci kas tunggal, buka/tutup shift, transaksi di `/kasir/pos`, pencatatan kas gerak, laporan sisa makanan basah pukul 15:00 WIB, serta pengecekan `/kasir/riwayat` dan `/kasir/rekap`.
3. **Gudang (Minimal 1 orang/shift):** Otomatis masuk ke `/kasir/gudang` setelah absen. Bertanggung jawab atas pengecekan stok fisik setiap shift, pengajuan draft barang masuk ke Manager, pemindaian FEFO Radar, dan penempelan barcode diskon.
4. **CS Pelayan (Minimal 1 orang/shift):** Bertanggung jawab atas kerapian rak lantai 1 dan pengantaran pesanan online kampus melalui `/kasir/pengiriman`.

---

## 2. ABSENSI SESI, PULANG, DAN TUKAR SHIFT

1. **Absen Masuk:** Buka `/kasir/login` tab Presensi Kehadiran -> klik nama pada jadwal aktif -> pilih peran shift -> klik Konfirmasi Hadir hingga status berubah menjadi HADIR.
2. **Batas Keterlambatan:** Toleransi sistem 15 menit dari jam mulai shift. Lewat 15 menit otomatis tercatat TELAT.
3. **Aturan Bagi Hasil 50%:** Sistem hanya membagikan jatah bagi hasil kepada petugas yang tercatat HADIR, TELAT, atau PENGGANTI di sistem. Petugas yang tidak absen sampai 30 menit setelah shift berakhir otomatis dikunci menjadi TIDAK_HADIR dan hak bagi hasil hari itu hangus (Rp 0).
4. **Absen Pulang:** Setelah seluruh tugas shift dan penutupan kasir selesai, buka `/kasir/login` tab Presensi Kehadiran -> klik Absen Pulang pada nama masing-masing -> klik OK.
5. **Tukar Shift:** Dilarang tukar shift hanya melalui kesepakatan WhatsApp. Pengajuan wajib diinput di `/kasir/tukar-shift` (maksimal 3 kali per minggu), disetujui rekan pengganti, dan disahkan Admin di `/admin/swap-request` sebelum jam shift dimulai. **Penting:** Tukar shift di sistem mengubah template jadwal mingguan (`shift_schedules`) secara berulang; bila pertukaran hanya berlaku untuk 1 minggu tertentu, wajib diajukan tukar kembali pada minggu berikutnya atau dikoordinasikan ke Admin Shift.

---

## 3. ADMIN SHIFT: INPUT, EDIT, KOREKSI STOK, DAN HAPUS BARANG

1. **Input Barang Baru (`/admin/produk`):**
   - Klik Tambah Produk, pindai barcode, lalu isi Nama, Kategori, Satuan, Stok Awal, HPP (Harga Beli), dan Harga Jual.
   - Wajib mengisi HPP lebih dari Rp 0. Barang dengan HPP Rp 0 akan masuk ke kategori Omzet Tanpa HPP sehingga labanya tidak dihitung ke dalam Bagi Hasil 50% mahasiswa.
   - Harga Jual wajib lebih besar atau sama dengan HPP.
   - Cek tab Usulan Produk secara berkala untuk melengkapi HPP dan mengaktifkan barang yang diusulkan kasir.
2. **Edit Barang dan Koreksi Stok (`/admin/produk`):**
   - Gunakan ikon Edit (Pensil) hanya untuk mengubah nama, kategori, barcode, HPP, atau harga jual.
   - Dilarang mengubah jumlah stok melalui menu Edit (Pensil) saat kasir sedang berjualan karena akan ditolak sistem.
   - Untuk menyesuaikan selisih stok fisik hasil opname, wajib gunakan tombol Koreksi Stok (Ikon Clipboard), isi jumlah fisik terbaru, dan tulis alasan koreksi secara jelas.
3. **Hapus Barang (`/admin/produk`):**
   - Hanya Admin Shift atau Manager yang berhak menghapus produk melalui ikon Hapus (Tempat Sampah) untuk barang yang sudah berhenti dijual permanen.
4. **Pesanan Online (`/admin/pesanan-online`):**
   - Periksa bukti transfer pembeli dengan teliti. Klik Konfirmasi untuk memotong stok dan menerbitkan PIN 6 digit pembeli, lalu tugaskan CS Pelayan yang hadir pada shift aktif.

---

## 4. GUDANG: CEK STOK WAJIB SETIAP SHIFT, BARANG MASUK, DAN FEFO

Petugas gudang wajib menjalankan 4 prosedur ini di `/kasir/gudang` pada setiap shift:

1. **Cek Stok Habis dan Kritis (Awal Shift):**
   - Periksa tab Habis dan Kritis. Segera isi ulang rak etalase depan dari stok cadangan gudang.
2. **Cek Fisik vs Sistem (Wajib Setiap Shift):**
   - Gunakan fitur Scan Kamera di `/kasir/gudang` untuk memeriksa minimal 10 sampai 15 barang cepat laku di rak.
   - Cocokkan jumlah fisik di rak dengan angka stok di sistem. Jika terdapat selisih, langsung laporkan ke Admin Shift pada shift tersebut untuk dikoreksi.
3. **Penerimaan Barang Masuk Supplier (Tab Penerimaan):**
   - Dilarang menaruh barang kiriman baru di rak jual sebelum diinput dan disetujui Manager.
   - Buat Draft Penerimaan, hitung fisik barang secara mandiri, isi Qty, HPP sesuai nota, Kode Batch, serta Tanggal Kedaluwarsa, lalu klik Ajukan ke Manager.
   - Stok baru akan bertambah di kasir setelah disetujui (ACC) oleh Manager. Jika dikembalikan (REVISED), segera perbaiki sesuai catatan Manager.
4. **Pemindaian FEFO Radar dan Eksekusi Diskon:**
   - Buka tab FEFO dan klik Scan FEFO Radar setiap shift.
   - Status H-1 (sisa 1 hari atau kurang): tarik barang dari rak display saat itu juga dan laporkan ke Manager.
   - Status H-3 dan H-5 (sisa 2 sampai 5 hari): cek kondisi fisik kemasan, klik Laporkan ke Manager, dan ajukan saran diskon atau penarikan.
   - Status H-7 (sisa 6 sampai 7 hari): geser posisi barang ke barisan paling depan rak.
   - Jika Manager menyetujui diskon, tempelkan kode Barcode Diskon (`DISC-...`) menutupi barcode asli kemasan, klik Tandai Sudah Dieksekusi, dan informasikan ke Kasir.

---

## 5. KASIR: BUKA SHIFT, CEK SEBELUM DAN SESUDAH TRANSAKSI, TUTUP SHIFT

1. **Buka Shift dan Modal Awal Paten Rp 100.000 (`/kasir/pos`):**
   - Pastikan shift kasir sebelumnya sudah ditutup. Dilarang bertransaksi menggunakan sesi milik kasir shift sebelumnya.
   - Modal awal laci setiap shift adalah Rp 100.000 tetap. Dilarang menggulung uang omzet shift pagi ke dalam modal awal shift siang. Selisih serah terima di atas Rp 2.000 otomatis tercatat sebagai pelanggaran `SERAH_TERIMA_SELISIH`.
2. **Pengecekan Wajib SEBELUM Klik Bayar:**
   - Pastikan jumlah dan jenis barang fisik di meja kasir sama persis dengan daftar di keranjang layar POS.
   - Untuk barang diskon FEFO, wajib pindai Barcode Diskon (`DISC-...`) hingga label diskon tampil di layar, bukan barcode asli kemasan.
   - Pembayaran Tunai (CASH): terima dan hitung uang fisik lebih dulu, ketik nominal uang diterima dengan tepat di sistem, lalu berikan kembalian sesuai layar.
   - Pembayaran QRIS: dilarang menekan tombol selesai sebelum memeriksa langsung layar HP pembeli. Pastikan status Berhasil, nama tujuan Wiramart UNPERBA, nominal tepat, dan jam transaksi sesuai waktu saat itu (bukan tangkapan layar lama).
   - Pembayaran Campuran (SPLIT): pastikan nominal tunai ditambah QRIS sama persis dengan total tagihan.
3. **Pengecekan Wajib SESUDAH Klik Bayar:**
   - Pastikan notifikasi transaksi berhasil muncul, nomor struk (`INV...`) terbit, dan keranjang kembali kosong.
   - Wajib membuka menu Riwayat (`/kasir/riwayat`) setiap selesai transaksi untuk memastikan nomor struk, nominal, dan metode bayar (`CASH`, `QRIS`, atau `SPLIT`) sudah tercatat di daftar teratas. Langkah ini mencegah transaksi belum tersimpan atau salah pilih metode bayar yang menyebabkan kas tekor saat tutup shift.
   - Jika terjadi salah input transaksi, kasir tidak dapat menghapus sendiri. Catat nomor `INV...` di `/kasir/riwayat` dan segera lapor ke Admin atau Manager untuk dilakukan VOID resmi.
4. **Kas Gerak (Uang Masuk/Keluar Laci):**
   - Setiap pengambilan uang dari laci untuk operasional toko (galon, plastik, es batu, tukar receh) wajib dicatat saat itu juga melalui tombol Kas Gerak (`CASH_OUT` atau `CASH_IN`) disertai keterangan jelas dan penyimpanan nota fisik di laci.
5. **Cut-Off Makanan Basah Pukul 15:00 WIB (Khusus Shift Siang/Sore):**
   - Pukul 15:00 WIB, kasir wajib membuka menu Sisa Makanan di POS dan menginput jumlah sisa fisik seluruh makanan harian/konsinyasi beserta statusnya (`HABIS`, `RETUR`, `BUANG_BASI`, `MAKAN_PETUGAS`, `OBRAL`, atau `SIMPAN`).
   - Jika tidak dilaporkan, pukul 00:00 WIB sistem otomatis mereset stok ke 0 dengan catatan pelanggaran `[AUTO-CRON-MIDNIGHT] Kasir tidak melapor`.
6. **Tutup Shift (Hitung Buta / Blind Count):**
   - Periksa ringkasan di `/kasir/rekap`, lalu buka menu Tutup Shift.
   - Pisahkan uang modal Rp 100.000 untuk shift berikutnya, lalu hitung uang tunai aktual di laci per pecahan.
   - Jika terdapat penjualan tunai namun kasir menginput kas aktual sama dengan modal awal, sistem otomatis menandai shift dengan `FRAUD_CASH_SUSPICIOUS`.
   - Dilarang pulang tanpa menekan tombol Tutup Shift. Lewat 15 menit dari jadwal berakhir, sistem otomatis menutup paksa shift dengan status pelanggaran `AUTO_CLOSED_OVERDUE`.

---

## 6. CS PELAYAN: PENGIRIMAN PESANAN ONLINE KAMPUS

1. Buka `/kasir/pengiriman` saat menerima penugasan pengantaran dari Admin Shift.
2. Periksa nomor pesanan, nama pembeli, lantai tujuan, detail ruangan, dan daftar barang, lalu klik Siapkan & Berangkat.
3. Saat tiba di lokasi, wajib meminta 6 digit PIN Serah Terima dari pembeli dan menginputnya ke sistem hingga berstatus selesai (`COMPLETED`). Dilarang menyerahkan barang tanpa verifikasi PIN.
4. Jika pembeli tidak ada di ruangan, klik tombol Buyer Tidak Ada dan tunggu maksimal 5 menit. Jika tidak hadir sebanyak 2 kali, laporkan ke Admin Shift untuk pembatalan pesanan.
