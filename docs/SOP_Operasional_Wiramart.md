# SOP OPERASIONAL HARIAN WIRAMART UNPERBA

Dokumen ini merupakan prosedur standar operasional resmi yang berlaku bagi seluruh pengelola dan petugas shift Wiramart UNPERBA. Seluruh aktivitas terekam otomatis di sistem dan menjadi dasar perhitungan Bagi Hasil 50% mahasiswa.

---

## 1. PEMBAGIAN PERAN DAN KUOTA SHIFT

Setiap shift wajib membagi peran saat absen di `/kasir/login`:

1. **Manager / Dosen (Pengawas Utama):** Login di `/login` (Tab Manager, NIDN + Password). Wajib melakukan Check-In sesi kerja harian di `/manager/dashboard` sebelum menyetujui barang masuk atau keputusan FEFO. Memegang hak eksklusif persetujuan penerimaan barang, persetujuan usulan produk baru beserta penetapan harga jual/HPP, serta keputusan tindakan barang mendekati kedaluwarsa di `/manager/gudang-approval`.
2. **Admin Shift (Maksimal 1 orang/shift):** Login di `/login` (Tab Admin Shift, NIM + PIN 6 digit). Bertanggung jawab atas kelola katalog di `/admin/produk`, konfirmasi pesanan online di `/admin/pesanan-online`, persetujuan tukar shift di `/admin/swap-request`, serta pemantauan stok dan arsip Buku Nota Supplier di `/gudang` (mode pantau). Dilarang merangkap kasir, tidak dapat memutasi stok langsung di gudang, dan tidak dapat menyetujui barang masuk maupun keputusan FEFO.
3. **Kasir (Maksimal 1 orang/shift):** Login di `/kasir/login` (Tab Login POS). Bertanggung jawab penuh atas laci kas tunggal, buka/tutup shift, transaksi di `/kasir/pos`, pencatatan kas gerak, laporan sisa makanan harian pukul 15:00 WIB, serta pengecekan `/kasir/riwayat` dan `/kasir/rekap`.
4. **Petugas Gudang (Minimal 1 orang/shift):** Login di `/gudang/login` atau otomatis masuk ke `/gudang` setelah absen (jalur `/kasir/gudang` tetap tersedia sebagai jalur alternatif). Bertanggung jawab atas pengecekan stok fisik setiap shift, pengajuan restock, pengajuan produk baru, pencatatan faktur pemasok, pemindaian FEFO Radar, serta eksekusi tindakan lapangan sesuai keputusan Manager.
5. **CS Pelayan (Minimal 1 orang/shift):** Bertanggung jawab atas kerapian rak etalase dan pengantaran pesanan online kampus melalui `/kasir/pengiriman`.

---

## 2. ABSENSI SESI, PULANG, DAN TUKAR SHIFT

1. **Absen Masuk:** Buka `/kasir/login` tab Presensi Kehadiran -> klik nama pada jadwal aktif -> pilih peran shift -> klik Konfirmasi Hadir hingga status menjadi `HADIR`.
2. **Batas Keterlambatan:** Toleransi sistem 15 menit dari jam mulai shift. Lewat 15 menit otomatis tercatat `TELAT`.
3. **Aturan Bagi Hasil 50%:** Sistem hanya membagikan hak bagi hasil kepada petugas berstatus `HADIR`, `TELAT`, atau `PENGGANTI`. Petugas yang tidak absen sampai 30 menit setelah shift berakhir otomatis dikunci menjadi `TIDAK_HADIR` dan hak bagi hasil hari tersebut hangus (Rp 0).
4. **Absen Pulang:** Setelah tugas shift dan penutupan kasir selesai, buka `/kasir/login` tab Presensi Kehadiran -> klik Absen Pulang pada nama masing-masing -> klik OK.
5. **Tukar Shift:** Dilarang tukar shift hanya lewat WhatsApp. Pengajuan wajib diinput di `/kasir/tukar-shift` (maksimal 3 kali per minggu), disetujui rekan pengganti, dan disahkan Admin di `/admin/swap-request` sebelum shift dimulai. Catatan: tukar shift mengubah template jadwal mingguan (`shift_schedules`) secara berulang; bila hanya untuk 1 minggu tertentu, wajib diajukan tukar kembali pada minggu berikutnya atau dikoordinasikan ke Admin Shift.

---

## 3. MANAGER (DOSEN): CHECK-IN SESI, APPROVAL GUDANG, DAN KEPUTUSAN FEFO

1. **Check-In Sesi Kerja Harian (`/manager/dashboard`):**
   - Manager wajib menekan tombol Mulai Sesi Kerja (Check-In) setiap hari operasional sebelum memproses persetujuan gudang. Tanpa sesi aktif hari itu, sistem menolak aksi persetujuan dengan status 403.
2. **Persetujuan Barang Masuk dan Restock (`/manager/gudang-approval`):**
   - Tinjau seluruh pengajuan berstatus `SUBMITTED` dari petugas gudang (baik dari tombol `+ Restock / Barang Masuk` maupun dari tab `Faktur Pemasok & Penerimaan`).
   - Pastikan jumlah fisik, HPP, kode batch, dan tanggal kedaluwarsa (`Expiry Date`) valid dan tidak melewati hari ini.
   - Pilih salah satu keputusan:
     - **Setujui (Approve):** Stok bertambah otomatis ke katalog kasir, batch FEFO terbentuk, dan log restock tercatat di `stock_adjustments`.
     - **Minta Revisi (Revised):** Kembalikan ke petugas gudang dengan catatan perbaikan wajib.
     - **Tolak (Rejected):** Tolak pengajuan dengan alasan tertulis; stok tidak bertambah dan notifikasi penolakan langsung terkirim ke halaman `/gudang`.
3. **Persetujuan Usulan Produk Baru (`/manager/gudang-approval`):**
   - Setiap produk/varian baru yang diajukan gudang tersimpan tersembunyi (`is_active = false`, `stock_qty = 0`) sampai disetujui Manager.
   - Sebelum menekan Setujui, Manager dapat memeriksa atau menyesuaikan **Harga Jual** dan **HPP** langsung di form persetujuan.
   - Saat disetujui, produk otomatis aktif di katalog Kasir & Buyer beserta stok awal dan batch FEFO-nya. Jika ditolak, draf produk otomatis di-soft-delete agar katalog tetap bersih.
4. **Keputusan Laporan FEFO Radar (`/manager/gudang-approval`):**
   - Tinjau laporan kondisi fisik dari petugas gudang dan tetapkan salah satu keputusan: `DISCOUNT`, `DISPLAY_FRONT`, `DESTROY`, `RETURN_SUPPLIER`, atau `HOLD`.
   - **Aturan Mutlak Barang Kedaluwarsa:** Untuk batch yang tanggal kedaluwarsanya sudah terlewat (sudah expired), sistem memblokir opsi `DISCOUNT` dan `DISPLAY_FRONT`. Manager hanya dapat menetapkan `DESTROY` (Musnahkan) atau `RETURN_SUPPLIER` (Retur ke Pemasok).
   - Jika memilih `DISCOUNT` pada batch yang belum expired, sistem otomatis menerbitkan kode Barcode Diskon (`DISC-...`) beserta potongan harga sesuai persentase yang ditetapkan.

---

## 4. ADMIN SHIFT: KATALOG PRODUK, KOREKSI STOK, PESANAN ONLINE, DAN PANTAU GUDANG

1. **Input Barang Baru (`/admin/produk`):**
   - Klik Tambah Produk, pindai barcode, lalu isi Nama, Kategori, Satuan, Stok Awal, HPP (Harga Beli), Harga Jual, dan Tanggal Kedaluwarsa (bila relevan).
   - Sistem mencegah duplikasi nama produk (case-insensitive) agar katalog tidak ganda.
   - Wajib mengisi HPP lebih dari Rp 0. Barang dengan HPP Rp 0 masuk ke kategori Omzet Tanpa HPP sehingga labanya tidak dihitung ke Bagi Hasil 50% mahasiswa.
   - Harga Jual wajib lebih besar atau sama dengan HPP.
   - Periksa tab Usulan Produk secara berkala untuk menindaklanjuti usulan dari kasir.
2. **Edit Barang dan Koreksi Stok (`/admin/produk`):**
   - Gunakan ikon Edit hanya untuk mengubah nama, kategori, barcode, HPP, atau harga jual.
   - Dilarang mengubah jumlah stok lewat menu Edit saat kasir sedang berjualan karena ditolak sistem.
   - Untuk menyesuaikan selisih stok hasil opname fisik, wajib gunakan tombol Koreksi Stok, isi jumlah fisik terbaru, dan tuliskan alasan koreksi secara jelas.
3. **Hapus Barang (`/admin/produk`):**
   - Hanya Admin Shift atau Manager yang berhak menghapus produk yang sudah berhenti dijual permanen.
4. **Pesanan Online (`/admin/pesanan-online`):**
   - Periksa bukti transfer pembeli dengan teliti. Klik Konfirmasi untuk memotong stok dan menerbitkan PIN 6 digit pembeli, lalu tugaskan CS Pelayan yang hadir pada shift aktif.
5. **Akses Mode Pantau di `/gudang`:**
   - Admin Shift dapat membuka `/gudang` untuk memantau stok kritis, melihat batch FEFO, serta mengunggah foto nota dan memeriksa Tabel Buku Nota Supplier di tab `Faktur Pemasok & Penerimaan`.
   - Admin Shift tidak memiliki akses untuk menambah stok langsung, mengajukan produk baru dari gudang, atau menyetujui antrian approval Manager.

---

## 5. PETUGAS GUDANG: STOK FISIK, BARANG MASUK, PRODUK BARU, NOTIFIKASI, DAN FEFO

Seluruh operasional gudang dijalankan melalui portal `/gudang` (login via `/gudang/login`). Petugas gudang tidak memiliki akses langsung ke endpoint pembuatan produk admin (`POST /api/admin/produk`) dan tidak melihat data HPP internal pada daftar katalog karyawan.

1. **Cek Notifikasi Keputusan Manager (Awal Shift dan Berkala):**
   - Periksa **Banner Peringatan** di bagian atas layar `/gudang` dan **tombol Lonceng Notifikasi** di pojok kanan atas header.
   - Apabila terdapat pengajuan yang **Ditolak (`REJECTED`)** atau **Perlu Revisi (`REVISED`)**, baca **Alasan / Catatan Manager**, lalu klik tombol pintasan untuk langsung membuka filter `Ditolak` atau `Perlu Revisi` di tab `Faktur Pemasok & Penerimaan`.
   - Untuk pengajuan berstatus `REVISED`, perbaiki data sesuai arahan Manager lalu kirim ulang (`SUBMITTED`).
2. **Cek Stok Habis, Menipis, dan Fisik vs Sistem (Wajib Setiap Shift):**
   - Periksa tab `Stok Habis` dan `Stok Menipis`, lalu isi ulang rak etalase depan dari stok cadangan gudang.
   - Gunakan fitur Scan Kamera di `/gudang` untuk memeriksa minimal 10 sampai 15 barang cepat laku di rak. Bila ada selisih antara fisik dan angka sistem, segera laporkan ke Admin Shift untuk koreksi stok.
   - Gunakan tab `Produk Konsumsi Harian` khusus untuk memantau makanan harian/konsinyasi (`is_perishable = true`) yang wajib habis pada hari yang sama (cut-off pukul 15:00 WIB).
3. **Restock Produk yang Sudah Ada (`+ Restock / Barang Masuk`):**
   - Dilarang menaruh barang kiriman baru di rak jual sebelum diajukan dan disetujui Manager.
   - Klik `+ Restock / Barang Masuk` pada kartu produk, isi jumlah masuk, **Tanggal Kedaluwarsa (wajib diisi dan minimal hari ini WIB)**, kode batch (opsional), dan catatan.
   - Pengajuan otomatis berstatus `SUBMITTED` masuk ke antrian Manager di `/manager/gudang-approval` (maksimal 10 pengajuan per 24 jam per petugas). Stok kasir baru bertambah setelah di-ACC Manager.
4. **Pengajuan Produk / Varian Baru (`+ Ajukan Produk Baru`):**
   - Apabila datang produk atau varian baru yang belum ada di daftar inventaris, klik tombol `+ Ajukan Produk Baru` di `/gudang`.
   - Lengkapi Nama Produk/Varian, Kategori, Barcode (opsional), Satuan, Usulan Harga Jual, Estimasi HPP, Stok Awal, **Tanggal Kedaluwarsa wajib (`>= hari ini WIB`)**, jenis produk (kemasan FEFO atau makanan harian), pemasok, dan catatan.
   - Produk tidak langsung tayang di kasir/pembeli sampai Manager melakukan verifikasi dan ACC di `/manager/gudang-approval`. Pantau status persetujuan melalui ikon Lonceng Notifikasi atau tab `Faktur Pemasok & Penerimaan`.
5. **Penerimaan Barang via Nota Supplier (Tab `Faktur Pemasok & Penerimaan`):**
   - Untuk pengiriman multi-item dari pemasok, buat Draft Penerimaan, unggah foto nota, hitung fisik barang secara mandiri, isi Qty, HPP sesuai nota, Kode Batch, dan **Tanggal Kedaluwarsa wajib (`>= hari ini WIB`)**, lalu klik Ajukan ke Manager.
6. **Pemindaian FEFO Radar dan Eksekusi Lapangan (Tab `Tindakan FEFO & Diskon`):**
   - Kartu KPI `FEFO Exp (<= 7 Hari / Exp)` sinkron dengan daftar aktif FEFO Radar (hanya menghitung batch dengan sisa stok > 0).
   - Klik `Scan Radar FEFO` setiap shift untuk memastikan deteksi terbaru (selain pemindaian otomatis harian pukul 06:00 WIB).
   - Klasifikasi dan tindakan wajib:
     - **Sudah Expired (melewati tanggal ED):** Segera tarik dari rak jual. Laporkan ke Manager dengan saran **`DESTROY` (Musnahkan)** atau **`RETURN_SUPPLIER` (Retur)**. Sistem memblokir saran maupun eksekusi `DISCOUNT` dan `DISPLAY_FRONT` pada barang expired.
     - **H-1 Kritis (sisa <= 1 hari):** Tarik dari rak display dan laporkan segera ke Manager.
     - **H-3 Urgent dan H-5 Warning (sisa 2 sampai 5 hari):** Periksa kondisi fisik kemasan, klik Laporkan ke Manager, dan ajukan saran tindakan (diskon, geser depan, retur, atau musnahkan).
     - **H-7 Watch (sisa 6 sampai 7 hari):** Geser posisi barang ke barisan paling depan rak.
   - Jika Manager menyetujui `DISCOUNT`, tempelkan label Barcode Diskon (`DISC-...`) menutupi barcode asli kemasan, klik `Tandai Sudah Dieksekusi`, dan informasikan ke Kasir.

---

## 6. KASIR: BUKA SHIFT, CEK SEBELUM DAN SESUDAH TRANSAKSI, TUTUP SHIFT

1. **Buka Shift dan Modal Awal Paten Rp 100.000 (`/kasir/pos`):**
   - Pastikan shift kasir sebelumnya sudah ditutup. Dilarang bertransaksi memakai sesi kasir shift sebelumnya.
   - Modal awal laci setiap shift adalah Rp 100.000 tetap. Dilarang menggulung uang omzet shift pagi ke modal awal shift siang. Selisih serah terima di atas Rp 2.000 otomatis tercatat sebagai pelanggaran `SERAH_TERIMA_SELISIH`.
2. **Pengecekan Wajib Sebelum Klik Bayar:**
   - Pastikan jumlah dan jenis barang fisik di meja kasir sama persis dengan daftar keranjang POS.
   - Untuk barang diskon FEFO, wajib pindai Barcode Diskon (`DISC-...`) hingga label diskon tampil di layar, bukan barcode asli kemasan.
   - Pembayaran Tunai (`CASH`): terima dan hitung uang fisik lebih dulu, ketik nominal diterima dengan tepat, lalu serahkan kembalian sesuai layar.
   - Pembayaran QRIS: dilarang menekan selesai sebelum memeriksa langsung layar HP pembeli (status Berhasil, nama tujuan Wiramart UNPERBA, nominal tepat, dan jam transaksi saat itu).
   - Pembayaran Campuran (`SPLIT`): pastikan nominal tunai ditambah QRIS sama persis dengan total tagihan.
3. **Pengecekan Wajib Sesudah Klik Bayar:**
   - Pastikan notifikasi berhasil muncul, nomor struk (`INV...`) terbit, dan keranjang kembali kosong.
   - Wajib membuka menu Riwayat (`/kasir/riwayat`) setiap selesai transaksi untuk memastikan nomor struk, nominal, dan metode bayar (`CASH`, `QRIS`, atau `SPLIT`) sudah tercatat di baris teratas.
   - Jika terjadi salah input transaksi, kasir tidak dapat menghapus sendiri. Catat nomor `INV...` dan segera lapor ke Admin atau Manager untuk VOID resmi.
4. **Kas Gerak dan Paket Permen Eceran:**
   - Setiap pengambilan atau pemasukan uang operasional laci (galon, plastik, es batu, tukar receh) wajib dicatat saat itu juga lewat tombol Kas Gerak (`CASH_OUT` atau `CASH_IN`) disertai keterangan jelas dan penyimpanan nota fisik di laci.
   - Produk permen eceran berharga satuan Rp 250 (`Permen Relaxa`, `Permen Antangin`) otomatis dijual dalam kelipatan paket 2 pcs (`Rp 500 / 2 pcs`, `Rp 1.000 / 4 pcs`) guna menghindari kembalian Rp 250.
5. **Cut-Off Makanan Harian Pukul 15:00 WIB (Shift Siang/Sore):**
   - Pukul 15:00 WIB, kasir wajib membuka menu Sisa Makanan di POS dan menginput jumlah sisa fisik seluruh makanan harian/konsinyasi beserta statusnya (`HABIS`, `RETUR`, `BUANG_BASI`, `MAKAN_PETUGAS`, `OBRAL`, atau `SIMPAN`).
   - Jika tidak dilaporkan, pukul 00:00 WIB sistem otomatis mereset stok ke 0 dengan catatan pelanggaran `[AUTO-CRON-MIDNIGHT] Kasir tidak melapor`.
6. **Tutup Shift (Hitung Buta / Blind Count):**
   - Periksa ringkasan di `/kasir/rekap`, lalu buka menu Tutup Shift.
   - Pisahkan uang modal Rp 100.000 untuk shift berikutnya, lalu hitung uang tunai aktual di laci per pecahan.
   - Jika terdapat penjualan tunai namun kasir menginput kas aktual sama dengan modal awal, sistem menandai shift dengan `FRAUD_CASH_SUSPICIOUS`.
   - Dilarang pulang tanpa menekan Tutup Shift. Lewat 15 menit dari jadwal berakhir, sistem otomatis menutup paksa shift dengan pelanggaran `AUTO_CLOSED_OVERDUE`.

---

## 7. CS PELAYAN DAN LAYANAN PEMBELI ONLINE (PWA `/order`)

1. **Akses Aplikasi Pembeli (PWA):**
   - Pembeli kampus dapat mengakses katalog pesan antar di `/order` atau meng-install aplikasi Wiramart (PWA) langsung lewat tombol `Install App` di halaman utama `/` maupun `/order`.
   - Aturan paket permen eceran (`Rp 500 / 2 pcs`) berlaku seragam di katalog `/order` sebagaimana di POS kasir.
2. **Alur Pengantaran Pesanan oleh CS Pelayan (`/kasir/pengiriman`):**
   - Buka `/kasir/pengiriman` saat menerima penugasan pengantaran dari Admin Shift.
   - Periksa nomor pesanan, nama pembeli, lantai tujuan, detail ruangan, dan daftar barang, lalu klik Siapkan & Berangkat.
   - Saat tiba di lokasi, wajib meminta 6 digit PIN Serah Terima dari pembeli dan menginputnya ke sistem hingga status menjadi `COMPLETED`. Dilarang menyerahkan barang tanpa verifikasi PIN.
   - Jika pembeli tidak ada di ruangan, klik tombol Buyer Tidak Ada dan tunggu maksimal 5 menit. Jika tidak hadir sebanyak 2 kali, laporkan ke Admin Shift untuk pembatalan pesanan.
