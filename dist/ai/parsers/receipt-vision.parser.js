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
8. payment_method: Deteksi dari baris pembayaran / bukti transfer (Mandiri, BCA, BRI, BNI, BSI, QRIS, Cash, Debit, ShopeePay, dll.). Jika tidak tertera jelas, gunakan "Cash" (untuk struk belanja) atau "Transfer Bank" (untuk mutasi).
9. category: Pilih kategori yang paling tepat dari: "Pemasukan: Transfer Masuk", "Pemasukan: Gaji", "Pemasukan: Setoran Tunai", "Pemasukan: Penjualan", "Makanan & Minuman", "Belanja Bulanan", "Transportasi & Bensin", "Tagihan & Utilitas", "Kesehatan & Obat", "Pendidikan", "Hiburan & Rekreasi", "Operasional Kantor", "Lain-lain". Jika gambar berupa bukti transfer masuk / setoran tunai / penerimaan dana, gunakan awalan "Pemasukan: ".
10. confidence_score: Berikan skor 0.0 - 1.0 seberapa jelas gambar struk tersebut terbaca.`;
export async function parseReceiptVision(imageBuffer, mimeType = "image/jpeg", userCaption = "") {
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
        const captionContext = userCaption.trim() ? "\nCatatan/keterangan tambahan dari user: \"" + userCaption.trim() + "\"." : "";
        const prompt = "Ekstrak seluruh informasi transaksi dan rincian belanja dari gambar/dokumen struk ini ke format JSON." + captionContext;
        const result = await model.generateContent([prompt, imagePart]);
        const textResponse = result.response.text();
        logger.debug({ modelName, textResponse }, "Gemini Receipt Vision Raw Response");
        try {
            const parsedJson = JSON.parse(textResponse);
            const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
            const normalizedTrx = {
                merchant: parsedJson.merchant || "Toko / Merchant",
                date: parsedJson.date || todayStr,
                category: parsedJson.category || "Makanan & Minuman",
                subtotal: Number(parsedJson.subtotal || parsedJson.total_amount || 0),
                tax: Number(parsedJson.tax || 0),
                discount: Number(parsedJson.discount || 0),
                total_amount: Number(parsedJson.total_amount || parsedJson.subtotal || 0),
                payment_method: parsedJson.payment_method || "Cash",
                confidence_score: Number(parsedJson.confidence_score || 1.0),
                items: (parsedJson.items || []).map((it) => ({
                    item_name: it.item_name || it.name || "Item",
                    qty: Number(it.qty || it.quantity || 1),
                    price: Number(it.price || it.unit_price || (it.total_price && it.qty ? it.total_price / it.qty : it.total_price) || 0),
                    total_price: Number(it.total_price || (it.price && it.qty ? it.price * it.qty : it.price) || 0),
                    category: it.category || undefined,
                })),
            };
            return ExtractedTransactionSchema.parse(normalizedTrx);
        }
        catch (err) {
            logger.error({ err, textResponse }, "Failed to validate receipt vision JSON");
            return null;
        }
    });
}
//# sourceMappingURL=receipt-vision.parser.js.map