import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransaction, ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";

const AUDIO_SYSTEM_INSTRUCTION = `Kamu adalah asisten AI yang mendengarkan rekaman suara (Voice Note WhatsApp) dan mengekstrak transaksi keuangan ke dalam format JSON yang valid.

Aturan Penting:
1. Transkripsi suara apa adanya ke dalam "transcription".
2. date: Tanggal transaksi (YYYY-MM-DD). Wajib string tanggal hari ini jika tidak disebutkan di audio (${new Date().toISOString().slice(0, 10)}). Jangan pernah null.
3. merchant: Nama toko / tempat / jenis penjual (contoh: Toko Roti, SPBU Pertamina, Warung Makan, dll.).
4. category: Pilih salah satu dari: "Makanan & Minuman", "Belanja Bulanan", "Transportasi & Bensin", "Tagihan & Utilitas", "Kesehatan & Obat", "Pendidikan", "Hiburan & Rekreasi", "Operasional Kantor", "Lain-lain".
5. total_amount: Total nominal dalam angka integer rupiah (contoh 20000 untuk 20 ribu / 20k / dua puluh ribu).
6. payment_method: "Cash" | "QRIS" | "Transfer BCA" | dll.
7. items: Daftar rincian barang: [{ "item_name": "Roti", "qty": 1, "price": 20000, "total_price": 20000 }].`;

export async function parseAudioVoiceNote(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg"
): Promise<{ transcription: string; transaction: ExtractedTransaction | null }> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: AUDIO_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const audioPart = {
      inlineData: {
        data: audioBuffer.toString("base64"),
        mimeType: mimeType,
      },
    };

    const prompt = `Dengarkan rekaman suara ini dan ekstrak transaksi keuangan. 
Format JSON output wajib:
{
  "transcription": "Teks hasil transkrip suara apa adanya",
  "transaction": {
    "merchant": "Nama toko / tempat",
    "date": "${new Date().toISOString().slice(0, 10)}",
    "category": "Makanan & Minuman",
    "subtotal": 20000,
    "tax": 0,
    "discount": 0,
    "total_amount": 20000,
    "payment_method": "Cash",
    "items": [
      {
        "item_name": "Nama barang",
        "qty": 1,
        "price": 20000,
        "total_price": 20000
      }
    ],
    "confidence_score": 1.0
  }
}`;

    const result = await model.generateContent([prompt, audioPart]);
    const textResponse = result.response.text();
    logger.debug({ modelName, textResponse }, "Gemini Audio Voice Note Raw Response");

    try {
      const parsed = JSON.parse(textResponse);
      const rawTrx = parsed.transaction;

      if (!rawTrx) {
        return { transcription: parsed.transcription || "", transaction: null };
      }

      // Normalization layer
      const todayStr = new Date().toISOString().slice(0, 10);
      const normalizedTrx = {
        merchant: rawTrx.merchant || "Penjual",
        date: rawTrx.date || todayStr,
        category: rawTrx.category || "Makanan & Minuman",
        subtotal: Number(rawTrx.subtotal || rawTrx.total_amount || 0),
        tax: Number(rawTrx.tax || 0),
        discount: Number(rawTrx.discount || 0),
        total_amount: Number(rawTrx.total_amount || rawTrx.subtotal || 0),
        payment_method: rawTrx.payment_method || "Cash",
        confidence_score: Number(rawTrx.confidence_score || 1.0),
        items: (rawTrx.items || []).map((it: any) => ({
          item_name: it.item_name || it.name || "Item",
          qty: Number(it.qty || it.quantity || 1),
          price: Number(it.price || it.unit_price || it.total_price || 0),
          total_price: Number(it.total_price || it.price || 0),
          category: it.category || undefined,
        })),
      };

      const validatedTrx = ExtractedTransactionSchema.parse(normalizedTrx);
      return {
        transcription: parsed.transcription || "",
        transaction: validatedTrx,
      };
    } catch (err) {
      logger.error({ err, textResponse }, "Failed to validate audio transaction JSON");
      return { transcription: "", transaction: null };
    }
  });
}
