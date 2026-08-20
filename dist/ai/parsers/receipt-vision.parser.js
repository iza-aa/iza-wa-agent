import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";
const RECEIPT_SYSTEM_INSTRUCTION = `Kamu adalah OCR AI ekstraktor struk belanja, nota, kwitansi, dan bukti transfer pembayaran tingkat tinggi.
Tugasmu adalah membaca gambar struk dan mengekstrak rincian belanja selengkap dan seakurat mungkin ke format JSON.

Pedoman Ekstraksi Struk:
1. merchant: Nama toko/restoran/badan usaha di bagian atas struk (misal Indomaret, Alfamart, Pertamina, Starbucks, Tokopedia, dll.).
2. date: Tanggal yang tercetak pada struk (Format: YYYY-MM-DD). Jika tahun tidak tertulis, gunakan tahun saat ini.
3. items: Daftar rincian barang yang dibeli (nama barang, qty, harga satuan, dan total harga item).
4. subtotal: Total harga barang sebelum diskon/pajak.
5. tax: PPN / Pajak Restoran (PB1) jika ada.
6. discount: Potongan harga / diskon / voucher jika ada.
7. total_amount: Total akhir (Grand Total / Net Total) yang wajib dibayarkan.
8. payment_method: Deteksi dari baris pembayaran (Cash, Debit Card, QRIS, BCA, ShopeePay, dll.).
9. category: Pilih kategori yang paling tepat dari: "Makanan & Minuman", "Belanja Bulanan", "Transportasi & Bensin", "Tagihan & Utilitas", "Kesehatan & Obat", "Pendidikan", "Hiburan & Rekreasi", "Operasional Kantor", "Lain-lain".
10. confidence_score: Berikan skor 0.0 - 1.0 seberapa jelas gambar struk tersebut terbaca.`;
export async function parseReceiptVision(imageBuffer, mimeType = "image/jpeg") {
    return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: RECEIPT_SYSTEM_INSTRUCTION,
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
            },
        });
        const imagePart = {
            inlineData: {
                data: imageBuffer.toString("base64"),
                mimeType: mimeType,
            },
        };
        const prompt = "Ekstrak seluruh informasi transaksi dan rincian belanja dari gambar struk ini ke format JSON.";
        const result = await model.generateContent([prompt, imagePart]);
        const textResponse = result.response.text();
        logger.debug({ modelName, textResponse }, "Gemini Receipt Vision Raw Response");
        try {
            const parsedJson = JSON.parse(textResponse);
            return ExtractedTransactionSchema.parse(parsedJson);
        }
        catch (err) {
            logger.error({ err, textResponse }, "Failed to validate receipt vision JSON");
            return null;
        }
    });
}
//# sourceMappingURL=receipt-vision.parser.js.map