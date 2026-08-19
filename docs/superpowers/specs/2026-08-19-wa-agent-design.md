# WA-Agent System Design Document

**Date:** 2026-08-19  
**Status:** Approved for Implementation Planning  
**Repository:** [github.com/iza-aa/iza-wa-agent](https://github.com/iza-aa/iza-wa-agent)  
**Database:** Supabase (`sfezffjtxtueqckermxh`)  

---

## 1. Executive Summary

WA-Agent adalah sistem asisten pencatatan finansial dan operasional berbasis WhatsApp Agent pintar bertenaga Multimodal AI (Gemini), terintegrasi dengan **Supabase** sebagai Single Source of Truth (Database & State Management), **Google Drive** sebagai Media Asset Vault (foto struk & dokumen), dan **Google Sheets** sebagai Live Collaborative Spreadsheet untuk pengguna.

Sistem dirancang untuk mendukung input multimodal (Teks, Foto Struk Belanja, Voice Note, PDF), manajemen hak akses hierarkis (Super Admin Ayah & Approved Members), sistem fallback multi-API Key, serta pipeline sinkronisasi background yang tahan banting untuk jangka panjang.

---

## 2. Arsitektur Sistem

```
                     ┌───────────────────────────────┐
                     │         WHATSAPP USER         │
                     │  (Text / Receipt / VN / PDF)  │
                     └───────────────┬───────────────┘
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │    WHATSAPP WORKER ENGINE     │
                     │  (whatsapp-web.js + LocalAuth)│
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     │                               │
                     ▼                               ▼
       ┌───────────────────────────┐   ┌───────────────────────────┐
       │   AUTH & ACCESS GATEWAY   │   │     AI PIPELINE (Gemini)  │
       │  (Supabase Whitelist Check)│   │  • Multi-Key Fallback     │
       │  • Super Admin: Ayah      │   │  • OCR Vision & Itemize   │
       │  • Member / Approval Flow │   │  • Audio Transcription    │
       └─────────────┬─────────────┘   │  • Structured Outputs     │
                     │                 └─────────────┬─────────────┘
                     │                               │
                     ▼                               ▼
       ┌───────────────────────────────────────────────────────────┐
       │                 SUPABASE DATABASE (PostgreSQL)            │
       │   Tables: users, transactions, receipt_items, chat_logs   │
       └─────────────────────────────┬─────────────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     │                               │ (Async Sync)
                     ▼                               ▼
       ┌───────────────────────────┐   ┌───────────────────────────┐
       │       GOOGLE DRIVE        │   │       GOOGLE SHEETS       │
       │  • Compressed WebP/JPEG   │   │  • Formatted Transactions │
       │  • /Year/Month/User/      │   │  • Link to Drive Media    │
       └───────────────────────────┘   └───────────────────────────┘
```

---

## 3. Komponen Utama & Alur Kerja

### A. WhatsApp Worker Layer (`whatsapp-web.js`)
* Menggunakan `whatsapp-web.js` dengan `LocalAuth` untuk menyimpan sesi pairing WhatsApp Web di server.
* Listener menangani:
  * Pesan teks biasa.
  * Pesan gambar/media (struk belanja, kwitansi, nota).
  * Pesan suara (voice note audio ogg/opus).
  * Dokumen (PDF invoice).
* Indikator *Typing/Recording* otomatis saat memproses request untuk pengalaman interaksi yang responsif.

### B. AI Engine & Multi-Key Fallback Strategy
* **Model**: Gemini 2.5 Flash / 1.5 Flash via `@google/genai`.
* **Multi-Key Pool & Rotation**:
  * Konfigurasi menerima array API Key (`GEMINI_API_KEYS=key1,key2,key3`).
  * Jika sebuah request terkena rate limit (HTTP 429) atau kuota habis, client otomatis fallback ke key berikutnya secara seamless.
* **Structured Output Enforcement**:
  * Ekstraksi data wajib mematuhi JSON Schema:
    ```json
    {
      "merchant": "Indomaret",
      "date": "2026-08-19",
      "items": [
        {"name": "Minyak Goreng 2L", "qty": 1, "price": 34000, "category": "Kebutuhan Rumah"}
      ],
      "subtotal": 34000,
      "discount": 0,
      "tax": 0,
      "total_amount": 34000,
      "payment_method": "QRIS",
      "category": "Kebutuhan Rumah",
      "confidence_score": 0.95
    }
    ```

### C. Supabase Database Schema
1. **`users`**:
   * `phone_number` (PK, text, e.g. `628123456789`)
   * `name` (text)
   * `role` (text: `super_admin`, `admin`, `member`)
   * `status` (text: `active`, `pending`, `blocked`)
   * `created_at` (timestamp)
2. **`transactions`**:
   * `id` (UUID / short_id e.g. `TRX-1001`)
   * `user_phone` (FK to users)
   * `date` (date)
   * `merchant` (text)
   * `total_amount` (numeric)
   * `category` (text)
   * `payment_method` (text)
   * `gdrive_file_id` (text)
   * `gdrive_web_view_link` (text)
   * `gsheet_row_index` (integer)
   * `created_at` (timestamp)
3. **`receipt_items`**:
   * `id` (UUID)
   * `transaction_id` (FK)
   * `item_name` (text)
   * `qty` (numeric)
   * `price` (numeric)
   * `category` (text)
4. **`chat_logs`**:
   * `id` (UUID)
   * `user_phone` (FK)
   * `raw_message` (text)
   * `message_type` (text: `text`, `image`, `audio`, `document`)
   * `direction` (`inbound` / `outbound`)
   * `created_at` (timestamp)

### D. Google Drive & Google Sheets Pipeline
1. **Google Drive**:
   * Gambar struk dikompresi menjadi WebP/JPEG kualitas 80% (maksimum lebar 1200px) sebelum diupload untuk menghemat kuota Google Drive hingga 95%.
   * File disimpan terstruktur: `Drive/Expenses/{YYYY}/{MM}/{Nama_User}/{TRX_ID}_{Merchant}.jpg`.
2. **Google Sheets**:
   * Menggunakan Google Sheets API v4 dengan Service Account.
   * Format Kolom Master Sheet:
     `ID Transaksi | Tanggal | Diinput Oleh | Toko/Merchant | Kategori | Total (Rp) | Metode Bayar | Link Foto Struk | Detail Item`

---

## 4. Security & Role Management

### Super Admin (Ayah)
* Nomor telepon Super Admin didaftarkan di `.env` (`SUPER_ADMIN_PHONE`) dan tabel `users`.
* Hak Istimewa:
  1. Menerima notifikasi jika ada nomor baru yang mencoba menggunakan bot.
  2. Perintah WhatsApp:
     * `/approve <nomor> <nama>` -> Mengaktifkan user baru.
     * `/block <nomor>` -> Memblokir nomor.
     * `/users` -> Menampilkan daftar user aktif.
     * `/rekap [harian/bulanan]` -> Menerima rekap seluruh pengeluaran tim/keluarga.
  3. Memiliki akses visual ke seluruh data di Supabase & Google Sheet.

### Member Biasa
* Hanya bisa mencatat pengeluaran, bertanya riwayat pengeluaran miliknya sendiri, atau mengoreksi transaksi yang baru saja dia catat.

---

## 5. Deployment & Hosting Strategy

* **WhatsApp Worker (`whatsapp-web.js`)**:
  * **TIDAK BISA** di-deploy di Vercel (karena Vercel bersifat stateless serverless dengan timeout pendek dan tidak mendukung proses Chromium/Puppeteer persisten 24/7).
  * **Rekomendasi Hosting Worker**:
    * VPS Linux (Ubuntu / Debian dengan Docker / PM2)
    * Railway / Render / Fly.io / Coolify
* **Web Dashboard (Next.js)** (Fase Berikutnya):
  * **BISA** di-deploy di Vercel, terhubung langsung ke Supabase.

---

## 6. Verification & Testing Strategy

1. **Unit & Integration Tests**:
   * Test parsing AI Gemini dengan mock input teks, foto struk, dan voice note.
   * Test failover multi-API key (key 1 mati -> switch key 2).
   * Test Supabase CRUD & Role verification.
   * Test Google Drive upload & Google Sheets row append.
2. **End-to-End Test**:
   * Mengirim simulasi pesan WhatsApp -> Verifikasi data masuk ke Supabase, file masuk ke GDrive, baris terisi di Google Sheets, dan balasan WA terkirim.
