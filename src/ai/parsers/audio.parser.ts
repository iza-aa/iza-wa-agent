import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransaction, ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";

const AUDIO_SYSTEM_INSTRUCTION = `Kamu adalah asisten AI yang mendengarkan rekaman suara (Voice Note WhatsApp) dan mengekstrak transaksi keuangan ke dalam format JSON.
Dengarkan audio, transkripsi pembicaraan, dan ekstrak rincian transaksi (Merchant, Tanggal, Kategori, Total Amount, Payment Method, Items).`;

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
    "date": "YYYY-MM-DD",
    "category": "Makanan & Minuman | Belanja Bulanan | Transportasi & Bensin | Tagihan & Utilitas | Kesehatan & Obat | Pendidikan | Hiburan & Rekreasi | Operasional Kantor | Lain-lain",
    "subtotal": 0,
    "tax": 0,
    "discount": 0,
    "total_amount": 0,
    "payment_method": "Cash",
    "items": [],
    "confidence_score": 1.0
  }
}`;

    const result = await model.generateContent([prompt, audioPart]);
    const textResponse = result.response.text();
    logger.debug({ modelName, textResponse }, "Gemini Audio Voice Note Raw Response");

    try {
      const parsed = JSON.parse(textResponse);
      const validatedTrx = parsed.transaction
        ? ExtractedTransactionSchema.parse(parsed.transaction)
        : null;
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
