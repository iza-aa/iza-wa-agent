import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransaction, ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";
import { normalizeDateToIso } from "../../google/sheets.service.js";

export interface TextAnalysisResult {
  is_complete: boolean;
  reply_message?: string;
  transaction: ExtractedTransaction | null;
}

const SYSTEM_INSTRUCTION = `Kamu adalah asisten AI keuangan pribadi, dompet digital, dan operasional kas yang cerdas, sopan, dan proaktif berbahasa Indonesia.
Tugasmu:
1. Analisis pesan teks pengguna dengan memperhatikan riwayat percakapan sebelumnya secara utuh.
2. Tentukan apakah pesan ini adalah:
   a. TRANSAKSI LENGKAP:
      Syarat Transaksi Lengkap:
      - Ada nama barang / toko / sumber pemasukan.
      - Ada nominal uang.
      - ADA METODE PEMBAYARAN (Contoh: "Cash", "Tunai", "Mandiri", "BCA", "BRI", "BNI", "BSI", "QRIS", "Debit", "Transfer", "ShopeePay", dll.). Metode ini bisa disebutkan di pesan sekarang ATAU sudah dijawab di riwayat percakapan sebelumnya.
      -> Jika ketiga unsur di atas LENGKAP: Set is_complete: true, dan isi objek "transaction".

   b. TRANSAKSI BELUM LENGKAP (Butuh Klarifikasi):
      - KASUS 1: Ada nominal & barang/sumber TETAPI BELUM ADA METODE PEMBAYARAN.
        (Contoh pesan: "Beli bensin 50rb", "Makan siang 25000", "Pemasukan 500rb", "Lunas tagihan wifi 350k")
        -> Set is_complete: false
        -> reply_message: "Nominal [Format Rupiah] untuk [Nama Barang/Sumber] dicatat. Mohon info, transaksi ini menggunakan metode pembayaran apa ya? (Contoh: Cash, Transfer BCA, Mandiri, BRI, atau QRIS)"
      - KASUS 2: Kurang nominal ATAU kurang nama barang.
        (Contoh pesan: "Beli martabak", "Habis transfer", "Dapat pemasukan")
        -> Set is_complete: false
        -> reply_message: Buat pertanyaan klarifikasi yang ramah dan spesifik.

   c. PERMINTAAN PERINTAH / MANAJEMEN SISTEM: Jika pengguna bermaksud menjalankan fungsi bot (bukan mencatat belanja):
      - Cek Saldo / Dompet ("cek saldo", "sisa saldo", "berapa uang kita", "dompet"):
        -> reply_message: "Ketik */saldo* untuk melihat total pemasukan, pengeluaran, dan sisa saldo kas dompet saat ini."
      - Ingin Tambah Pemasukan via Command ("cara catat pemasukan"):
        -> reply_message: "Untuk mencatat pemasukan, Anda bisa langsung ketik pesan bebas seperti:\n*Pemasukan 5.000.000 gaji bulan ini via Mandiri*\nAtau gunakan perintah: */pemasukan <nominal> <keterangan>*"
      - Ingin Tambah Anggota ("tambah kontak", "tambah user", "daftarkan nomor"):
        -> reply_message: "Untuk mendaftarkan anggota baru, gunakan perintah:\n*/tambah <nomor_hp> [nama] [super_admin|anggota]*\nContoh: /tambah 08123456789 Budi super_admin"
      - Ingin Ganti Nama ("ganti nama", "ubah nama saya"):
        -> reply_message: "Untuk mengubah nama tampilan Anda, gunakan perintah:\n*/nama [Nama Baru]*\nContoh: /nama Budi"
      - Ingin Hapus / Batal ("hapus pencatatan", "batalkan transaksi", "salah input"):
        -> reply_message: "Untuk membatalkan transaksi terakhir, gunakan perintah */batal*.\nUntuk menghapus transaksi tertentu, gunakan */hapus [ID_TRANSAKSI]*."
      - Ingin Laporan / Rekap ("laporan bulan ini", "berapa pengeluaran", "rekap"):
        -> reply_message: "Untuk melihat analisis arus kas bulanan, gunakan perintah */laporan*.\nUntuk melihat riwayat transaksi terakhir, gunakan */rekap*."
      - Ingin Lihat Anggota ("siapa saja yang terdaftar", "lihat pengguna"):
        -> reply_message: "Untuk melihat daftar anggota terdaftar, gunakan perintah */pengguna*."
      - Ingin Ubah Hak Akses / Role ("jadikan admin", "ubah peran"):
        -> reply_message: "Untuk mengubah hak akses anggota, gunakan perintah:\n*/peran <nomor_hp> <super_admin|anggota>*"
      - Minta Link Spreadsheet / Drive / Laporan Keuangan ("mana link spreadsheet", "minta link google sheet", "link drive", "buka sheet", "lihat laporan"):
        -> reply_message: "Tautan Google Sheets, Google Drive, dan Laporan Keuangan hanya dapat diakses oleh Super Admin untuk menjaga privasi data keuangan."
      - Tanya Menu / Panduan ("menu apa saja", "bisa ngapain aja", "bantuan"):
        -> reply_message: "Ketik */menu* untuk melihat seluruh panduan dan cara mencatat transaksi."
   d. PERCAKAPAN UMUM / SAPAAN: Pengguna menyapa ("halo", "selamat pagi", "siapa kamu?").
      -> Set is_complete: false, dan berikan balasan yang ramah dan singkat di "reply_message".

Format JSON Wajib:
{
  "is_complete": true | false,
  "reply_message": "Pesan balasan ramah jika is_complete false",
  "transaction": {
    "merchant": "Nama tempat / sumber pemasukan / vendor",
    "date": "2026-08-20",
    "category": "Pemasukan: Gaji | Pemasukan: Transfer Masuk | Pemasukan: Penjualan | Pemasukan: Top Up Kas | Pemasukan: Lain-lain | Makanan & Minuman | Belanja Bulanan | Transportasi & Bensin | Tagihan & Utilitas | Kesehatan & Obat | Pendidikan | Hiburan & Rekreasi | Operasional Kantor | Lain-lain",
    "subtotal": 0,
    "tax": 0,
    "discount": 0,
    "total_amount": 0,
    "payment_method": "Cash | Mandiri | BCA | BRI | BNI | BSI | QRIS | Transfer Bank | Lainnya",
    "items": [
      {
        "item_name": "Nama item / barang",
        "qty": 1,
        "unit": "ikat | dos | botol | karton | liter | pax | kg | kali | unit | Truk | pack | piring",
        "price": 0,
        "total_price": 0,
        "department": "Dapur | Barista | Waiters | Kasir | Kafe",
        "notes": ""
      }
    ],
    "confidence_score": 1.0
  }
}

Pedoman Penentuan Department / Divisi Butir Belanja:
- ATURAN PRIORITAS TERTINGGI: Jika judul/pesan pengguna secara eksplisit menyebutkan "keperluan [Divisi]" atau "untuk [Divisi]" atau "buat [Divisi]" (misal: "keperluan Barista", "keperluan Dapur", "keperluan Waiters", "keperluan Kasir"), maka SELURUH butir belanjaan di bawahnya WAJIB menggunakan divisi yang ditentukan pengguna tersebut!
- Jika tidak ada penegasan di judul, klasifikasikan berdasarkan jenis barang:
  * "Dapur": Ayam, daging, ikan, sayur, buah, minyak goreng, beras, telur, bumbu dapur, gas LPG, bahan masakan dapur.
  * "Barista": Biji kopi, sirup, susu cair/kental, bubuk minuman, matcha, cup kopi, sedotan, bahan minuman.
  * "Waiters": Sabun cuci piring, cairan pembersih lantai, kantong sampah, tisu meja, operasional pelayan/kebersihan.
  * "Kasir": Kertas struk kasir, plastik kresek kasir, bolpoin kasir.
  * "Kafe": Token listrik PLN, tagihan WiFi internet, PDAM/air minum galon umum, renovasi, ATK umum, sewa, operasional umum.`;

export async function parseTransactionText(
  userText: string,
  contextHistory: string[] = []
): Promise<TextAnalysisResult> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
    const prompt = `Hari ini adalah tanggal: ${todayStr} (Tahun 2026).
Gunakan tanggal hari ini (${todayStr}) untuk field "date" kecuali pengguna secara spesifik menyebutkan tanggal transaksi lain. Jika pengguna menyebut tanggal/bulan tanpa tahun (contoh: "tanggal 6 Agustus"), gunakan tahun 2026.

Riwayat Percakapan Sebelumnya:
${contextHistory.join("\n")}

Pesan Pengguna Baru:
"${userText}"

Analisis pesan di atas dan kembalikan JSON sesuai instruksi.`;

    const result = await model.generateContent(prompt);
    const textResponse = result.response.text();
    logger.debug({ modelName, textResponse }, "Gemini Text Parser Raw Response");

    try {
      const parsedJson = JSON.parse(textResponse);
      if (!parsedJson.is_complete || !parsedJson.transaction) {
        return {
          is_complete: false,
          reply_message: parsedJson.reply_message || "Boleh tolong jelaskan lebih rinci pengeluaran ini?",
          transaction: null,
        };
      }

      const rawTrx = parsedJson.transaction;
      let finalDate = normalizeDateToIso(rawTrx.date || todayStr);
      if (finalDate.startsWith("2023") || finalDate.startsWith("2024") || finalDate.startsWith("2025")) {
        finalDate = todayStr.slice(0, 4) + finalDate.slice(4);
      }

      // Check explicit header override from user text
      let headerDept: "Dapur" | "Barista" | "Waiters" | "Kasir" | "Kafe" | null = null;
      if (/\b(?:keperluan|untuk|buat|divisi|pos|bagian)\s+barista\b/i.test(userText)) headerDept = "Barista";
      else if (/\b(?:keperluan|untuk|buat|divisi|pos|bagian)\s+dapur\b/i.test(userText)) headerDept = "Dapur";
      else if (/\b(?:keperluan|untuk|buat|divisi|pos|bagian)\s+waiters?\b/i.test(userText)) headerDept = "Waiters";
      else if (/\b(?:keperluan|untuk|buat|divisi|pos|bagian)\s+kasir\b/i.test(userText)) headerDept = "Kasir";
      else if (/\b(?:keperluan|untuk|buat|divisi|pos|bagian)\s+kafe\b/i.test(userText)) headerDept = "Kafe";

      const normalizedItems = (rawTrx.items || []).map((it: any) => {
        const qty = Number(it.qty || it.quantity || 1) || 1;
        const hasTotalPrice = it.total_price !== undefined && it.total_price !== null && Number(it.total_price) > 0;
        const hasPrice = it.price !== undefined && it.price !== null && Number(it.price || it.unit_price) > 0;

        let totalPrice = 0;
        let unitPrice = 0;

        if (hasTotalPrice && hasPrice) {
          totalPrice = Number(it.total_price);
          unitPrice = Number(it.price || it.unit_price);
        } else if (hasTotalPrice) {
          totalPrice = Number(it.total_price);
          unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
        } else if (hasPrice) {
          totalPrice = Number(it.price || it.unit_price);
          unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
        }

        // Smart department determination with strict hierarchy
        let dept: "Dapur" | "Barista" | "Waiters" | "Kasir" | "Kafe" = "Kafe";
        const rawDept = (it.department || it.keperluan || it.divisi || "").toString().trim().toLowerCase();

        if (headerDept) {
          dept = headerDept;
        } else if (rawDept.includes("barista") || rawDept.includes("bar") || rawDept.includes("kopi")) {
          dept = "Barista";
        } else if (rawDept.includes("dapur") || rawDept.includes("kitchen")) {
          dept = "Dapur";
        } else if (rawDept.includes("waiter") || rawDept.includes("pelayan") || rawDept.includes("service")) {
          dept = "Waiters";
        } else if (rawDept.includes("kasir") || rawDept.includes("cashier") || rawDept.includes("pos")) {
          dept = "Kasir";
        } else if (rawDept.includes("kafe") || rawDept.includes("cafe")) {
          dept = "Kafe";
        } else {
          // Fallback by item name keywords
          const itemNameLower = (it.item_name || it.name || "").toString().toLowerCase();
          if (/kopi|sirup|syrup|susu|tea|teh|powder|creamer|sedotan|cup/i.test(itemNameLower)) dept = "Barista";
          else if (/ayam|sayur|daging|ikan|minyak|beras|telur|bumbu|bawang|cabe|tomat/i.test(itemNameLower)) dept = "Dapur";
          else if (/sabun|sunlight|pel|tisu|tissue|plastik\s*sampah/i.test(itemNameLower)) dept = "Waiters";
          else if (/thermal|struk|kresek/i.test(itemNameLower)) dept = "Kasir";
          else if (/token|listrik|pln|wifi|indihome|pdam/i.test(itemNameLower)) dept = "Kafe";
        }

        let finalUnit = it.unit || "unit";
        let finalQty = qty;
        if (it.notes && /\b(\d+(\.\d+)?\s*(gantung|biji|bks|bungkus|rak|kotak|bal|ikat|btl|botol|kaleng|ekor|dos|karton|roll|lembar|pax|pack|pcs|grm|gram|ons|kg|liter|unit|buah))\b/i.test(it.notes)) {
          const match = it.notes.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
          if (match) {
            finalQty = Number(match[1]) || qty;
            finalUnit = match[2] || finalUnit;
          } else {
            finalUnit = it.notes;
          }
        }

        return {
          item_name: it.item_name || it.name || "Item",
          qty: finalQty,
          unit: finalUnit,
          price: unitPrice,
          total_price: totalPrice,
          department: dept,
          category: it.category || undefined,
          notes: undefined,
        };
      });

      const calculatedItemsTotal = normalizedItems.reduce(
        (acc: number, it: any) => acc + (Number(it.total_price) || 0),
        0
      );
      const tax = Number(rawTrx.tax || 0);
      const discount = Number(rawTrx.discount || 0);

      let finalTotal = Number(rawTrx.total_amount || rawTrx.subtotal || 0);
      let finalSubtotal = Number(rawTrx.subtotal || rawTrx.total_amount || 0);

      // Deterministic math check: if items with valid total_price exist, enforce exact CPU sum!
      if (calculatedItemsTotal > 0) {
        finalSubtotal = calculatedItemsTotal;
        finalTotal = calculatedItemsTotal + tax - discount;
      }

      const normalizedTrx = {
        merchant: rawTrx.merchant || "Penjual",
        date: finalDate,
        category: rawTrx.category || "Lain-lain",
        subtotal: finalSubtotal,
        tax: tax,
        discount: discount,
        total_amount: finalTotal,
        payment_method: rawTrx.payment_method || "Cash",
        confidence_score: Number(rawTrx.confidence_score || 1.0),
        items: normalizedItems,
      };

      const validatedTrx = ExtractedTransactionSchema.parse(normalizedTrx);
      return {
        is_complete: true,
        transaction: validatedTrx,
      };
    } catch (err) {
      logger.error({ err, textResponse }, "Failed to validate extracted transaction JSON");
      return {
        is_complete: false,
        reply_message: "💬 Pesan Anda diterima! Ketik pengeluaran (contoh: *Beli bensin 50rb*) atau kirim foto struk/voice note untuk dicatat.",
        transaction: null,
      };
    }
  });
}
