# Aturan Bisnis & Pedoman Operasional Kas

## 1. Kategori Transaksi

### Pemasukan:
- **Pemasukan: Gaji** (Gaji bulanan atau payroll masuk)
- **Pemasukan: Transfer Masuk** (Transfer uang masuk dari pihak luar)
- **Pemasukan: Penjualan** (Hasil penjualan kafe harian, order kopi, katering, event, proyek)
- **Pemasukan: Top Up Kas** (Suntikan modal kas kecil/petty cash dari owner)
- **Pemasukan: Setoran Tunai** (Uang tunai disetorkan ke rekening/kas)
- **Pemasukan: Mutasi Kas** (Perpindahan internal antar rekening/kantong)
- **Pemasukan: Lain-lain** (Pemasukan di luar kategori di atas)

### Pengeluaran:
- **Makanan & Minuman** (Bahan masakan, bumbu, ayam, sayur, buah, biji kopi, susu, sirup, teh, snack, konsumsi)
- **Belanja Bulanan** (Belanja stok bulanan dan perlengkapan rutin)
- **Transportasi & Bensin** (Bensin Pertamina/Shell, parkir, tol, ojek online, kurir/ongkir)
- **Tagihan & Utilitas** (Token listrik PLN, air PDAM, WiFi/Indihome/Biznet, pulsa/kuota internet)
- **Kesehatan & Obat** (Obat-obatan, apotek, P3K, klinik, dokter)
- **Pendidikan** (Pelatihan staf, buku panduan, kursus barista/kuliner)
- **Hiburan & Rekreasi** (Gathering tim, rekreasi, entertainment)
- **Operasional Kantor** (ATK, kasbon karyawan, gaji staf, pemeliharaan/service rutin, perlengkapan kasir)
- **Lain-lain** (Pengeluaran tak terduga / umum)

---

## 2. Pembagian Divisi Kafe & Resto

Setiap barang belanjaan harus dikelompokkan ke salah satu dari 5 divisi berikut:

1. **Dapur (Kitchen)** 🍳:
   - Ayam, daging sapi/kambing, ikan, seafood, sayuran, buah-buahan, minyak goreng, beras, telur, bumbu dapur, bawang merah/putih, cabai, tomat, saus, kecap, gas LPG, bahan masakan dapur.
2. **Barista (Beverage Bar)** ☕:
   - Biji kopi (beans/powder), sirup rasa (Monin/Torani dll), susu cair (UHT/Fresh Milk), susu kental manis, teh, matcha, bubuk cokelat/taro, creamer, sedotan, cup kopi/gelas take away, lid, bahan racikan minuman.
3. **Waiters (Service & Kebersihan)** 🍽️:
   - Sabun cuci piring (Sunlight), cairan pembersih lantai (SuperPell/Wipol), pembersih kaca, spons cuci, lap meja, tisu meja makan, kantong sampah hitam/plastik sampah, sapu/pel, perlengkapan kebersihan.
4. **Kasir (POS & Front Desk)** 🧾:
   - Kertas struk thermal, plastik kresek kasir, plastik take-away berlogo, bolpoin kasir, kalkulator, stapler.
5. **Kafe (Operasional Umum & Gedung)** 🏢:
   - Token listrik PLN, tagihan WiFi internet, PDAM/air minum galon, perbaikan gedung/tukang, sewa tempat, perlengkapan operasional umum yang dinikmati seluruh kafe.

### Aturan Prioritas Penentuan Divisi:
- Jika user secara tegas menyebut *"keperluan [Divisi]"* atau *"buat [Divisi]"* (contoh: *"Beli tisu 5 pack keperluan Barista"*), maka barang tersebut **wajib masuk divisi yang ditentukan user** (Barista), bukan defaultnya (Waiters).

---

## 3. Syarat Transaksi Lengkap
Sebuah transaksi dianggap lengkap jika memenuhi 3 syarat:
1. **Nama barang / toko / sumber pemasukan** jelas.
2. **Nominal harga** jelas dan > 0.
3. **Metode pembayaran** jelas (Cash, Mandiri, BCA, BRI, BNI, BSI, QRIS, dsb.).

Jika salah satu unsur belum ada, AI **harus menanyakan kekurangannya dengan sopan** sebelum membuat draf transaksi.

---

## 4. Format & Penomoran Transaksi
- Format ID: `T026-<BulanLetter><NomorUrut>` (Contoh: `T026-H001` untuk transaksi urutan 1 di bulan Agustus 2026).
- Kode Bulan: A=Jan, B=Feb, C=Mar, D=Apr, E=Mei, F=Jun, G=Jul, **H=Agu**, I=Sep, J=Okt, K=Nov, L=Des.
