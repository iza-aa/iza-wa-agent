import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";
import { normalizeDateToIso } from "../../google/sheets.service.js";
const AUDIO_SYSTEM_INSTRUCTION = `Kamu adalah asisten AI keuangan cerdas yang mendengarkan Voice Note WhatsApp.
Tugasmu:
1. Dengarkan audio dan transkripsi kata-kata yang diucapkan pembicara apa adanya ke dalam "transcription".
2. Tentukan apakah rekaman ini berupa:
   A. PERTANYAAN / TANYA SALDO / CARI RIWAYAT (contoh: "Berapa sisa uang kas kita?", "Cek saldo Mandiri", "Kemarin beli apa saja?"):
      -> Set "is_question": true, "question_text": [teks pertanyaan], "is_complete": true, "transaction": null
   B. PENCATATAN TRANSAKSI (contoh: "Beli bensin 50 ribu cash", "Pemasukan 5 juta gaji Mandiri"):
      -> Set "is_question": false
      -> Analisis kelengkapan transaksi (merchant, nominal, metode bayar).
      -> JIKA LENGKAP: Set "is_complete": true dan isi objek "transaction".
      -> JIKA KURANG LENGKAP: Set "is_complete": false dan buat "clarification_question" ramah.`;
export async function parseAudioVoiceNote(audioBuffer, mimeType = "audio/ogg") {
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
  "is_question": false,
  "question_text": "Teks pertanyaan jika is_question true",
  "is_complete": true,
  "clarification_question": "Pertanyaan jika ada info yang kurang (opsional)",
  "transaction": {
    "merchant": "Nama toko / tempat / jenis barang / sumber pemasukan",
    "date": "${new Date().toISOString().slice(0, 10)}",
    "category": "Pemasukan: Gaji | Pemasukan: Transfer Masuk | Pemasukan: Penjualan | Pemasukan: Top Up Kas | Pemasukan: Lain-lain | Makanan & Minuman | Belanja Bulanan | Transportasi & Bensin | Tagihan & Utilitas | Kesehatan & Obat | Pendidikan | Hiburan & Rekreasi | Operasional Kantor | Lain-lain",
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
            const isQuestion = parsed.is_question === true || /^(berapa|cek|ada|apakah|bagaimana|mana|siapa|cari)\b/i.test(transcription.trim());
            if (isQuestion) {
                return {
                    transcription,
                    is_question: true,
                    question_text: parsed.question_text || transcription,
                    is_complete: true,
                    transaction: null,
                };
            }
            const isComplete = parsed.is_complete !== false && parsed.transaction?.total_amount > 0;
            const clarification = parsed.clarification_question || undefined;
            if (!isComplete || !parsed.transaction || parsed.transaction.total_amount <= 0) {
                return {
                    transcription,
                    is_question: false,
                    is_complete: false,
                    clarification_question: clarification ||
                        `Saya dengar: "${transcription}". Namun nominal harga atau rincian belanjanya belum jelas. Berapa total biayanya ya?`,
                    transaction: null,
                };
            }
            const rawTrx = parsed.transaction;
            const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
            let finalDate = normalizeDateToIso(rawTrx.date || todayStr);
            if (finalDate.startsWith("2023") || finalDate.startsWith("2024") || finalDate.startsWith("2025")) {
                finalDate = todayStr.slice(0, 4) + finalDate.slice(4);
            }
            const normalizedItems = (rawTrx.items || []).map((it) => {
                const qty = Number(it.qty || it.quantity || 1) || 1;
                const hasTotalPrice = it.total_price !== undefined && it.total_price !== null && Number(it.total_price) > 0;
                const hasPrice = it.price !== undefined && it.price !== null && Number(it.price || it.unit_price) > 0;
                let totalPrice = 0;
                let unitPrice = 0;
                if (hasTotalPrice && hasPrice) {
                    totalPrice = Number(it.total_price);
                    unitPrice = Number(it.price || it.unit_price);
                }
                else if (hasTotalPrice) {
                    totalPrice = Number(it.total_price);
                    unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
                }
                else if (hasPrice) {
                    totalPrice = Number(it.price || it.unit_price);
                    unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
                }
                return {
                    item_name: it.item_name || it.name || "Item",
                    qty: qty,
                    unit: it.unit || "unit",
                    price: unitPrice,
                    total_price: totalPrice,
                    department: ["Dapur", "Barista", "Waiters", "Kasir", "Kafe"].includes(it.department) ? it.department : "Kafe",
                    category: it.category || undefined,
                    notes: it.notes || undefined,
                };
            });
            const calculatedItemsTotal = normalizedItems.reduce((acc, it) => acc + (Number(it.total_price) || 0), 0);
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
                category: rawTrx.category || "Makanan & Minuman",
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
                transcription,
                is_question: false,
                is_complete: true,
                transaction: validatedTrx,
            };
        }
        catch (err) {
            logger.error({ err, textResponse }, "Failed to parse audio response");
            return {
                transcription: "",
                is_question: false,
                is_complete: false,
                clarification_question: "Maaf, rekaman suaranya kurang terdengar jelas. Boleh tolong diulang atau diketik pengeluarannya?",
                transaction: null,
            };
        }
    });
}
//# sourceMappingURL=audio.parser.js.map