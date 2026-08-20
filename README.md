# IZA WA-Agent 🤖📊

Asisten Pintar WhatsApp untuk Pencatatan Transaksi Finansial dan Operasional bertenaga **Gemini 2.5 Flash Multimodal AI**, terintegrasi dengan **Supabase PostgreSQL**, **Google Drive (Storage & Media Vault)**, dan **Google Sheets (Live Collaborative Spreadsheet)**.

---

## 🌟 Fitur Utama

1. **Multimodal Input via WhatsApp**:
   - 📸 **Foto Struk Belanja / Nota / Bukti Transfer**: Ekstraksi tanggal, merchant, daftar barang, subtotal, pajak, diskon, dan total akhir otomatis.
   - 🎙️ **Voice Note (Pesan Suara)**: Transkripsi audio langsung dari WhatsApp dan otomatis divalidasi ke entitas transaksi.
   - 💬 **Pesan Teks Bebas**: Format alami (*"Beli bensin 50rb di Pertamina"*, *"Makan siang warteg 25k"*).
2. **Multi-Key Gemini Pool & Fallback**:
   - Menampung banyak API Key sekaligus. Jika key pertama terkena rate limit/kuota, sistem otomatis beralih ke key berikutnya secara transparan tanpa error.
3. **Dual Storage (Supabase + Google Drive)**:
   - Gambar struk dikompresi ke **WebP kualitas 80% (Max 1200px)** sehingga menghemat memori hingga 95%.
   - File tersimpan rapi per subfolder tahun/bulan/user.
4. **1-Sheet Filterable Architecture**:
   - Seluruh data transaksi otomatis tertulis rapi di Google Sheet dengan kolom filterable (`ID Transaksi`, `Tanggal`, `Tahun`, `Bulan`, `Penginput`, `Merchant`, `Kategori`, `Total`, `Link Bukti`, `Rincian Item`).
5. **Role Management & Super Admin (Ayah)**:
   - Whitelist nomor terdaftar.
   - Perintah Super Admin: `/approve <nomor> [nama]`, `/block <nomor>`, `/users`, `/rekap`.

---

## 🚀 Cara Menjalankan Bot

### 1. Jalankan Mode Development
```bash
npm run dev
```

### 2. Scan QR Code WhatsApp
* Di terminal akan muncul **QR Code**.
* Buka aplikasi WhatsApp di HP nomor bot (`0881082854818`).
* Buka **Perangkat Tertaut (Linked Devices)** ➔ **Tautkan Perangkat** ➔ Scan QR Code.
* Selesai! Bot sekarang aktif dan siap menerima pesan dari Super Admin (`081346367235`) dan user yang disetujui.

---

## 🧪 Testing & Verifikasi

Jalankan seluruh test suite unit & integrasi:
```bash
npm test
```

Build TypeScript ke JavaScript:
```bash
npm run build
```
