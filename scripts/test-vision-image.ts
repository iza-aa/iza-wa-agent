import fs from "fs";
import { geminiKeyManager } from "../src/ai/gemini-client.js";

async function main() {
  const imageBuffer = fs.readFileSync("/Users/heizaaa/.gemini/antigravity/brain/47af44f8-ce07-4785-bf79-91b3be06bb9d/.user_uploaded/media_1787466312887.png");

  const RECEIPT_SYSTEM_INSTRUCTION = `Kamu adalah OCR AI ekstraktor struk belanja, nota, kwitansi, tabel belanja, dan bukti transfer pembayaran tingkat tinggi.
Tugasmu adalah membaca gambar struk/tabel dan mengekstrak rincian belanja selengkap dan seakurat mungkin ke format JSON.

Pedoman Ekstraksi Struk & Rincian Belanja:
1. merchant: Nama toko/badan usaha atau judul catatan (misal "Belanja Harian", "Kasir", "Dapur", dll.).
2. date: Tanggal yang tercetak pada struk/tabel (Format: YYYY-MM-DD). Misal "1 AGUSTUS 2026" -> "2026-08-01".
3. items: Array objek rincian barang yang dibeli:
   - item_name: Nama barang yang dibeli (misal "Sayur", "Sirup", "Cairan pembersih", "Air minum", "Minyak Goreng", "Ayam", "Token Listrik"). Bersihkan dari kata jumlah/satuan jika sudah dipisah ke qty/unit.
   - qty: Angka jumlah barang (integer/float, misal 6, 1, 2, 3, 5, 1, 1).
   - unit: Satuan barang (misal "ikat", "dos", "botol", "karton", "liter", "pax", "kali", "pack", "kg", "pcs", "roll", dll.).
   - price: Harga satuan.
   - total_price: Total harga baris tersebut (konsumsi apa adanya/as-is dari kolom HARGA).
   - department: Divisi / Keperluan barang. Jika di gambar ada kolom "KEPERLUAN" / "DIVISI", AMBIL DARI KOLOM TERSEBUT dan petakan ke salah satu dari: "Dapur", "Barista", "Waiters", "Kasir", "Kafe". (Contoh: "Dapur" -> "Dapur", "Barista" -> "Barista", "Waiters" -> "Waiters", "Kasir" -> "Kasir", "Kafe" -> "Kafe").
4. payment_method: "Cash", "Transfer Bank", "QRIS", dll.
5. category: Kategori pengeluaran.
6. total_amount: Total pengeluaran.`;

  const res = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: RECEIPT_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const prompt = "Ekstrak seluruh informasi transaksi dan rincian belanja tabel ini ke format JSON sesuai panduan.";
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType: "image/jpeg",
        },
      },
    ]);
    return result.response.text();
  });

  console.log("Gemini Vision Extraction Output:\n", JSON.stringify(JSON.parse(res), null, 2));
}

main().catch(console.error);
