import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransaction, ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";

const SYSTEM_INSTRUCTION = `Kamu adalah asisten AI pencatat keuangan dan operasional pintar yang sangat teliti.
Tugasmu adalah menganalisis pesan teks dari WhatsApp dan mengekstrak informasi transaksi keuangan ke dalam format JSON yang valid.

Aturan Ekstraksi:
1. Tanggal: Gunakan tanggal transaksi jika disebutkan (misal "kemarin", "tadi pagi", "15 Agustus"). Jika tidak ada, gunakan tanggal hari ini (${new Date().toISOString().slice(0, 10)}). Format wajib YYYY-MM-DD.
2. Merchant: Nama toko, restoran, tempat, vendor, atau penerima pembayaran.
3. Kategori: Pilih salah satu dari: "Makanan & Minuman", "Belanja Bulanan", "Transportasi & Bensin", "Tagihan & Utilitas", "Kesehatan & Obat", "Pendidikan", "Hiburan & Rekreasi", "Operasional Kantor", "Lain-lain".
4. Total Amount: Total uang keluar dalam bentuk angka bulat integer (contoh 25000 untuk 25rb / 25k).
5. Payment Method: Deteksi apakah Cash, QRIS, Transfer BCA/Mandiri, Gopay, OVO, ShopeePay, dll.
6. JSON Wajib valid dan mematuhi skema yang diberikan.`;

export async function parseTransactionText(
  userText: string,
  contextHistory: string[] = []
): Promise<ExtractedTransaction | null> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const prompt = `Riwayat Chat Sebelumnya:
${contextHistory.join("\n")}

Pesan Pengguna Saat Ini:
"${userText}"

Ekstrak transaksi keuangan dari pesan di atas ke dalam format JSON.`;

    const result = await model.generateContent(prompt);
    const textResponse = result.response.text();
    logger.debug({ modelName, textResponse }, "Gemini Text Parser Raw Response");

    try {
      const parsedJson = JSON.parse(textResponse);
      if (Array.isArray(parsedJson)) {
        if (parsedJson.length === 0) return null;
        return ExtractedTransactionSchema.parse(parsedJson[0]);
      }
      if (!parsedJson || typeof parsedJson !== "object" || Object.keys(parsedJson).length === 0) {
        return null;
      }
      return ExtractedTransactionSchema.parse(parsedJson);
    } catch (err) {
      logger.debug({ err, textResponse }, "Non-transaction or malformed JSON returned");
      return null;
    }
  });
}
