# Panduan Perintah Sistem (Command Reference)

AI Agent dapat merujuk atau menjalankan fungsi yang setara dengan perintah-perintah ini secara otomatis ketika user bertanya lewat percakapan natural.

---

## 1. Perintah Umum (Semua Anggota)
- **Cek Panduan:** `/menu` — Melihat petunjuk pencatatan.
- **Catat Pemasukan:** `/pemasukan <nominal> <keterangan> [metode]` (Contoh: `/pemasukan 2.5jt Penjualan Kafe Mandiri`).
- **Catat Pengeluaran:** `/pengeluaran <nominal> <keterangan> [metode]` (Contoh: `/pengeluaran 50rb Bensin Cash`).
- **Cari Catatan:** `/cari <kata_kunci>` (Contoh: `/cari bensin`, `/cari beras`).
- **Lihat Rincian Item:** `/detail <ID>` (Contoh: `/detail H054`).
- **Tambah Rincian Belanja:** `/rinci <ID>` diikuti daftar item per baris.
- **Batal Transaksi Terakhir:** `/batal` — Membatalkan transaksi terakhir yang baru saja diinput user.
- **Riwayat Transaksi:** `/rekap` atau `/rekap <jumlah>` (Contoh: `/rekap 10`).
- **Ubah Nama Tampilan:** `/nama <NamaBaru>` (Contoh: `/nama Budi`).

---

## 2. Perintah Khusus Super Admin / Owner
- **Cek Saldo Kas:** `/saldo` atau `/saldo detail` (rincian saldo per rekening/bank).
- **Mutasi Antar Rekening:** `/transfer <dari> <ke> <nominal> [keterangan]` (Contoh: `/transfer bca cash 500rb Tarik tunai`).
- **Hapus Transaksi Tertentu:** `/hapus <ID>` (Contoh: `/hapus H054`).
- **Edit Transaksi:** `/edit <ID> <koreksi>` (Contoh: `/edit H054 total: 45000`).
- **Laporan Bulanan:** `/laporan` atau `/laporan <YYYY-MM>` (Contoh: `/laporan 2026-08`).
- **Export Laporan PDF:** `/export pdf` — Mengunduh dokumen PDF resmi laporan arus kas.
- **Atur Anggaran / Budget:** `/budget <kategori> <nominal>` (Contoh: `/budget Makanan & Minuman 10000000`).
- **Kelola Tagihan Rutin:** `/tagihan` atau `/tagihan tambah <nama> <nominal> tgl <tanggal>`.
- **Daftarkan Anggota Baru:** `/tambah <nomor_hp> [nama] [peran]`.
- **Kelola Anggota:** `/pengguna`, `/blokir <nomor/nama>`, `/aktifkan <nomor/nama>`.
- **Link Cloud & Drive:** `/link` — Tautan langsung ke Google Spreadsheet dan folder Google Drive.
- **Sinkronisasi Database:** `/sync` — Tarik data perubahan manual dari Google Sheets ke database.
