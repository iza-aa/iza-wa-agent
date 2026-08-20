import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransaction, ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";

export interface AudioAnalysisResult {
  transcription: string;
  is_complete: boolean;
  clarification_question?: string;
  transaction: ExtractedTransaction | null;
}

const AUDIO_SYSTEM_INSTRUCTION = `Kamu adalah asisten AI pencatat keuangan cerdas yang mendengarkan Voice Note WhatsApp.
Tugasmu:
1. Dengarkan audio dan transkripsi kata-kata yang diucapkan pembicara apa adanya ke dalam "transcription".
2. Analisis apakah informasi pengeluaran/pemasukan sudah lengkap untuk dicatat (wajib ada: merchant/nama barang, nominal harga, dan metode pembayaran seperti Cash, Transfer BCA, Mandiri, BRI, QRIS, dll.).
3. JIKA LENGKAP: Set is_complete: true dan isi objek "transaction".
4. JIKA TIDAK LENGKAP / METODE BELUM DISEBUTKAN:
   - Set is_complete: false
   - Buat pertanyaan klarifikasi yang ramah, sopan, dan spesifik dalam bahasa Indonesia pada "clarification_question".
   Contoh pertanyaan klarifikasi:
   - Jika metode pembayaran belum disebutkan: "Nominal [Format Rupiah] untuk [Nama Barang/Tempat] dicatat. Mohon info, transaksinya menggunakan metode pembayaran apa ya? (Contoh: Cash, Transfer BCA, Mandiri, BRI, atau QRIS)"
   - Jika nominal harga tidak ada: "Saya dengar Anda beli [nama barang/merchant], tapi berapa ya total harganya?"
   - Jika barang/tempat tidak jelas: "Saya dengar nominal Rp [jumlah], tapi ini untuk pengeluaran apa ya?"
   - Jika suara bising/tidak terdengar: "Suaranya kurang jelas terdengar. Boleh diulang atau diketik rincian pengeluarannya?"`;

export async function parseAudioVoiceNote(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg"
): Promise<AudioAnalysisResult> {
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

    const prompt = `Dengarkan rekaman suara ini. 
Format JSON output wajib:
{
  "transcription": "Teks hasil transkrip suara apa adanya",
  "is_complete": true,
  "clarification_question": "Pertanyaan jika ada info yang kurang (opsional jika lengkap)",
  "transaction": {
    "merchant": "Nama toko / tempat / jenis barang",
    "date": "${new Date().toISOString().slice(0, 10)}",
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

    const result = await model.generateContent([prompt, audioPart]);
    const textResponse = result.response.text();
    logger.debug({ modelName, textResponse }, "Gemini Audio Voice Note Raw Response");

    try {
      const parsed = JSON.parse(textResponse);
      const transcription = parsed.transcription || "";
      const isComplete = parsed.is_complete !== false && parsed.transaction?.total_amount > 0;
      const clarification = parsed.clarification_question || undefined;

      if (!isComplete || !parsed.transaction || parsed.transaction.total_amount <= 0) {
        return {
          transcription,
          is_complete: false,
          clarification_question:
            clarification ||
            `Saya dengar: "${transcription}". Namun nominal harga atau rincian belanjanya belum jelas. Berapa total biayanya ya?`,
          transaction: null,
        };
      }

      const rawTrx = parsed.transaction;
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
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
        transcription,
        is_complete: true,
        transaction: validatedTrx,
      };
    } catch (err) {
      logger.error({ err, textResponse }, "Failed to parse audio response");
      return {
        transcription: "",
        is_complete: false,
        clarification_question: "Maaf, rekaman suaranya kurang terdengar jelas. Boleh tolong diulang atau diketik pengeluarannya?",
        transaction: null,
      };
    }
  });
}
