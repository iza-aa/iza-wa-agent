import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";
const SYSTEM_INSTRUCTION = `Kamu adalah asisten AI keuangan pribadi dan operasional yang cerdas, sopan, dan proaktif berbahasa Indonesia.
Tugasmu:
1. Analisis pesan teks pengguna dengan memperhatikan riwayat percakapan sebelumnya.
2. Tentukan apakah pesan ini adalah:
   a. TRANSAKSI LENGKAP: Ada nama barang/toko DAN nominal uang (contoh: "Beli bensin 50rb", "Makan siang 25000", "Lunas tagihan wifi 350k").
      -> Set is_complete: true, dan isi objek "transaction".
   b. TRANSAKSI BELUM LENGKAP (Butuh Klarifikasi): Pengguna berniat mencatat pengeluaran tapi kurang nominal ATAU kurang nama barang (contoh: "Beli martabak", "Habis transfer 100rb").
      -> Set is_complete: false, dan buat pertanyaan klarifikasi yang ramah dan spesifik di "reply_message" (contoh: "Boleh tahu berapa total biaya beli martabak tersebut?", "Nominal Rp100.000 dicatat. Boleh tahu ini pembayaran untuk keperluan apa?").
   c. PERMINTAAN PERINTAH / MANAJEMEN SISTEM: Jika pengguna bermaksud menjalankan fungsi bot (bukan mencatat belanja):
      - Ingin Tambah Anggota ("tambah kontak", "tambah user", "daftarkan nomor"):
        -> reply_message: "Untuk mendaftarkan anggota baru, gunakan perintah:\n*/tambah <nomor_hp> [nama]*\nContoh: /tambah 0811422404 Ayah"
      - Ingin Ganti Nama ("ganti nama", "ubah nama saya"):
        -> reply_message: "Untuk mengubah nama tampilan Anda, gunakan perintah:\n*/nama [Nama Baru]*\nContoh: /nama Ayah"
      - Ingin Hapus / Batal ("hapus pencatatan", "batalkan transaksi", "salah input"):
        -> reply_message: "Untuk membatalkan transaksi terakhir, gunakan perintah */batal*.\nUntuk menghapus transaksi tertentu, gunakan */hapus [ID_TRANSAKSI]*."
      - Ingin Laporan / Rekap ("laporan bulan ini", "berapa pengeluaran", "rekap"):
        -> reply_message: "Untuk melihat analisis keuangan bulanan, gunakan perintah */laporan*.\nUntuk melihat 10 transaksi terakhir, gunakan */rekap*."
      - Ingin Lihat Anggota ("siapa saja yang terdaftar", "lihat pengguna"):
        -> reply_message: "Untuk melihat daftar anggota terdaftar, gunakan perintah */pengguna*."
      - Ingin Ubah Hak Akses / Role ("jadikan admin", "ubah peran"):
        -> reply_message: "Untuk mengubah hak akses anggota, gunakan perintah:\n*/peran <nomor_hp> <super_admin|anggota>*"
      - Minta Link Spreadsheet / Drive ("mana link spreadsheet", "minta link google sheet", "link drive", "buka sheet"):
        -> reply_message: "Ketik */link* untuk mendapatkan tautan langsung ke Google Sheets dan Google Drive arsip transaksi."
      - Tanya Menu / Panduan ("menu apa saja", "bisa ngapain aja", "bantuan"):
        -> reply_message: "Ketik */menu* untuk melihat seluruh panduan dan daftar perintah yang tersedia."
   d. PERCAKAPAN UMUM / SAPAAN: Pengguna menyapa ("halo", "selamat pagi", "siapa kamu?").
      -> Set is_complete: false, dan berikan balasan yang ramah dan singkat di "reply_message".

Format JSON Wajib:
{
  "is_complete": true | false,
  "reply_message": "Pesan balasan ramah jika is_complete false",
  "transaction": {
    "merchant": "Nama tempat / barang / vendor",
    "date": "2026-08-20",
    "category": "Makanan & Minuman | Belanja Bulanan | Transportasi & Bensin | Tagihan & Utilitas | Kesehatan & Obat | Pendidikan | Hiburan & Rekreasi | Operasional Kantor | Lain-lain",
    "subtotal": 0,
    "tax": 0,
    "discount": 0,
    "total_amount": 0,
    "payment_method": "Cash",
    "items": [
      {
        "item_name": "Nama item",
        "qty": 1,
        "price": 0,
        "total_price": 0
      }
    ],
    "confidence_score": 1.0
  }
}`;
export async function parseTransactionText(userText, contextHistory = []) {
    return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION,
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
            },
        });
        const prompt = `Riwayat Percakapan Sebelumnya:
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
            const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
            const rawTrx = parsedJson.transaction;
            const normalizedTrx = {
                merchant: rawTrx.merchant || "Penjual",
                date: rawTrx.date || todayStr,
                category: rawTrx.category || "Lain-lain",
                subtotal: Number(rawTrx.subtotal || rawTrx.total_amount || 0),
                tax: Number(rawTrx.tax || 0),
                discount: Number(rawTrx.discount || 0),
                total_amount: Number(rawTrx.total_amount || rawTrx.subtotal || 0),
                payment_method: rawTrx.payment_method || "Cash",
                confidence_score: Number(rawTrx.confidence_score || 1.0),
                items: (rawTrx.items || []).map((it) => ({
                    item_name: it.item_name || it.name || "Item",
                    qty: Number(it.qty || it.quantity || 1),
                    price: Number(it.price || it.unit_price || it.total_price || 0),
                    total_price: Number(it.total_price || it.price || 0),
                    category: it.category || undefined,
                })),
            };
            const validatedTrx = ExtractedTransactionSchema.parse(normalizedTrx);
            return {
                is_complete: true,
                transaction: validatedTrx,
            };
        }
        catch (err) {
            logger.error({ err, textResponse }, "Failed to validate extracted transaction JSON");
            return {
                is_complete: false,
                reply_message: "💬 Pesan Anda diterima! Ketik pengeluaran (contoh: *Beli bensin 50rb*) atau kirim foto struk/voice note untuk dicatat.",
                transaction: null,
            };
        }
    });
}
//# sourceMappingURL=text.parser.js.map