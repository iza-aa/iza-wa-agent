import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";
const RECEIPT_SYSTEM_INSTRUCTION = `Kamu adalah OCR AI ekstraktor cerdas tingkat tinggi untuk dokumen keuangan, bukti transfer perbankan, notifikasi pembayaran QRIS, struk belanja, nota kasir, kwitansi, dan tabel belanja.
Tugasmu adalah menganalisis gambar secara mendalam dan mengekstrak data transaksi ke format JSON yang terstruktur dan akurat.

ATURAN UTAMA & LARANGAN MENULIS NGASAL:
Bot DILARANG KERAS berasumsi atau menebak bahwa semua gambar adalah "Pengeluaran" atau "Makanan & Minuman".
Kamu WAJIB mengidentifikasi arah aliran dana dengan teliti: apakah uang MASUK (Pemasukan / Income) atau uang KELUAR (Pengeluaran / Expense).

PEDOMAN DETEKSI ARAH DANA (type & category):
1. PEMASUKAN (type: "income"):
   - Bukti / Tangkapan Layar Pembayaran QRIS (misal: "QRIS Bayar", "Transaksi Pembelian QRIS", "QRIS BRI", "QRIS BCA", "QRIS Mandiri", "ShopeePay QRIS", dll.) di mana dana DITUJUKAN kepada usaha pengguna (seperti "Mammi Cafe", toko, atau kasir).
     * Contoh Kasus: Pada layar tertera "Sumber Dana: KISWAN" (Pelanggan) dan "Tujuan: Mammi Cafe" (Kafe Pengguna) -> Ini adalah PEMBAYARAN DARI PELANGGAN KE MAMMI CAFE (Pemasukan Penjualan Kafe).
     * type: "income"
     * category: "Pemasukan: Penjualan"
     * merchant: "Mammi Cafe"
     * payment_method: "QRIS" (atau "QRIS BRI", "QRIS BCA", dll.)
     * items: [] (kosongkan jika tidak ada rincian item barang di gambar)
   - Bukti Transfer Bank Masuk / Mutasi Kredit (Dana ditransfer oleh orang lain/pelanggan ke rekening pengguna/kafe):
     * type: "income"
     * category: "Pemasukan: Transfer Masuk" (atau "Pemasukan: Penjualan")
     * merchant: Nama pengirim atau nama rekening pengguna
     * payment_method: Nama bank terkait (contoh: "Transfer BRI", "Transfer BCA", "Mandiri", dll.)
   - Bukti Setoran Tunai / Top Up Kas:
     * type: "income"
     * category: "Pemasukan: Setoran Tunai" atau "Pemasukan: Top Up Kas"
   - CATATAN KATEGORI PEMASUKAN: Kategori untuk type "income" WAJIB diawali "Pemasukan: " ("Pemasukan: Penjualan", "Pemasukan: Transfer Masuk", "Pemasukan: Setoran Tunai", "Pemasukan: Top Up Kas", "Pemasukan: Gaji", "Pemasukan: Lain-lain").

2. PENGELUARAN (type: "expense"):
   - Struk belanja fisik / kertas thermal kasir (Indomaret, Alfamart, Toko Grosir, Pertamina, Pasar, dll.) di mana pengguna membeli barang/jasa untuk keperluan operasional.
     * type: "expense"
     * category: Sesuaikan dengan jenis barang ("Makanan & Minuman", "Belanja Bulanan", "Transportasi & Bensin", "Tagihan & Utilitas", "Kesehatan & Obat", "Operasional Kantor", "Lain-lain").
     * merchant: Nama toko / tempat berbelanja di bagian atas struk.
   - Bukti transfer keluar dari rekening pengguna/kafe ke pihak ketiga / supplier / pemilik sewa / tagihan listrik PLN, WiFi, PDAM:
     * type: "expense"
     * category: Sesuaikan kategori pengeluaran ("Tagihan & Utilitas", "Operasional Kantor", dll.).
   - Catatan / tabel belanja internal (daftar belanja bahan Dapur, Barista, Waiters, Kasir, Kafe).

3. Pedoman Bidang Data Lainnya:
   - merchant: Nama toko/penerima/entitas usaha.
   - date: Tanggal yang tercetak pada struk/layar (Format: YYYY-MM-DD). Jika tahun tidak tertulis, gunakan tahun saat ini.
   - items: Daftar rincian barang yang dibeli (hanya jika ada rincian item):
     * item_name: Nama barang murni tanpa jumlah/satuan.
     * qty: Angka jumlah barang (default 1).
     * unit: Satuan barang (ikat, dos, botol, karton, liter, pax, kg, dll.).
     * department: Divisi/keperluan ("Dapur", "Barista", "Waiters", "Kasir", "Kafe").
     * ATURAN PENTING HARGA (AS-IS CONSUME): Jika hanya ada 1 kolom harga per baris, anggap sebagai total_price baris tersebut (jangan kalikan dengan qty kecuali ada kolom harga satuan terpisah).
   - subtotal: Total sebelum diskon/pajak.
   - tax: PPN / Pajak jika ada.
   - discount: Diskon / Potongan jika ada.
   - total_amount: Total akhir yang dibayarkan.
   - payment_method: QRIS / Cash / BCA / BRI / Mandiri / BNI / BSI / Debit / ShopeePay / Transfer Bank / dll.
   - confidence_score: Skor keyakinan 0.0 - 1.0.`;
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
        const prompt = "Ekstrak seluruh informasi transaksi dari gambar/dokumen ini ke format JSON. Pastikan tentukan tipe transaksi secara akurat: 'income' jika dana masuk/pembayaran QRIS ke Mammi Cafe/transfer masuk, atau 'expense' jika struk belanja/transfer keluar. Jangan berasumsi semua adalah pengeluaran atau makanan & minuman jika tidak tertera jelas." + captionContext;
        const result = await model.generateContent([prompt, imagePart]);
        const textResponse = result.response.text();
        logger.debug({ modelName, textResponse }, "Gemini Receipt Vision Raw Response");
        try {
            const parsedJson = JSON.parse(textResponse);
            const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
            let parsedDate = parsedJson.date || todayStr;
            const dmyMatch = parsedDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (dmyMatch) {
                parsedDate = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
            }
            else if (!/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
                parsedDate = todayStr;
            }
            // Determine transaction type & category safely without guessing
            let trxType = parsedJson.type === "income" ? "income" : "expense";
            let parsedCategory = (parsedJson.category || "").trim();
            const combinedText = (textResponse + " " + userCaption).toLowerCase();
            const isQrisPayment = combinedText.includes("qris bayar") || combinedText.includes("transaksi pembelian qris") || (combinedText.includes("qris") && combinedText.includes("transaksi berhasil"));
            const isMammiCafeRecipient = combinedText.includes("mammi cafe") && (combinedText.includes("tujuan") || combinedText.includes("merchant") || combinedText.includes("penerima") || isQrisPayment);
            if (isMammiCafeRecipient || (isQrisPayment && combinedText.includes("sumber dana") && combinedText.includes("tujuan"))) {
                trxType = "income";
                if (!parsedCategory || !parsedCategory.toLowerCase().startsWith("pemasukan")) {
                    parsedCategory = "Pemasukan: Penjualan";
                }
            }
            if (parsedCategory.toLowerCase().startsWith("pemasukan")) {
                trxType = "income";
            }
            else if (trxType === "income") {
                parsedCategory = parsedCategory ? `Pemasukan: ${parsedCategory}` : "Pemasukan: Penjualan";
            }
            else if (!parsedCategory) {
                parsedCategory = "Lain-lain";
            }
            let paymentMethod = parsedJson.payment_method || (isQrisPayment ? "QRIS" : "Cash");
            if (isQrisPayment && !paymentMethod.toUpperCase().includes("QRIS")) {
                paymentMethod = `QRIS ${paymentMethod}`.trim();
            }
            const normalizedItems = (parsedJson.items || []).map((it) => {
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
                    // As-is consume: if only one price is available, it is the line total_price
                    totalPrice = Number(it.price || it.unit_price);
                    unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
                }
                // Map department case-insensitively and intelligently
                let dept = "Kafe";
                const rawDept = (it.department || it.keperluan || it.divisi || "").toString().trim().toLowerCase();
                if (rawDept.includes("dapur") || rawDept.includes("kitchen"))
                    dept = "Dapur";
                else if (rawDept.includes("barista") || rawDept.includes("bar") || rawDept.includes("kopi"))
                    dept = "Barista";
                else if (rawDept.includes("waiter") || rawDept.includes("pelayan") || rawDept.includes("service"))
                    dept = "Waiters";
                else if (rawDept.includes("kasir") || rawDept.includes("cashier") || rawDept.includes("pos"))
                    dept = "Kasir";
                else if (rawDept.includes("kafe") || rawDept.includes("cafe") || rawDept.includes("umum"))
                    dept = "Kafe";
                let finalUnit = it.unit || "unit";
                let finalQty = qty;
                if (it.notes && /\b(\d+(\.\d+)?\s*(gantung|biji|bks|bungkus|rak|kotak|bal|ikat|btl|botol|kaleng|ekor|dos|karton|roll|lembar|pax|pack|pcs|grm|gram|ons|kg|liter|unit|buah))\b/i.test(it.notes)) {
                    const match = it.notes.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
                    if (match) {
                        finalQty = Number(match[1]) || qty;
                        finalUnit = match[2] || finalUnit;
                    }
                    else {
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
            const calculatedItemsTotal = normalizedItems.reduce((acc, item) => acc + item.total_price, 0);
            const tax = Number(parsedJson.tax || 0);
            const discount = Number(parsedJson.discount || 0);
            // If calculated items total is present and differs from parsed total (e.g. AI wrongly multiplied or no grand total in table), use calculated total
            let finalTotal = Number(parsedJson.total_amount || parsedJson.subtotal || 0);
            if (calculatedItemsTotal > 0 && (finalTotal <= 0 || (tax === 0 && discount === 0 && finalTotal !== calculatedItemsTotal))) {
                finalTotal = calculatedItemsTotal + tax - discount;
            }
            const finalSubtotal = Number(parsedJson.subtotal || calculatedItemsTotal || finalTotal);
            const normalizedTrx = {
                type: trxType,
                merchant: parsedJson.merchant || (trxType === "income" ? "Mammi Cafe" : "Toko / Merchant"),
                date: parsedDate,
                category: parsedCategory,
                subtotal: finalSubtotal,
                tax: tax,
                discount: discount,
                total_amount: finalTotal,
                payment_method: paymentMethod,
                confidence_score: Number(parsedJson.confidence_score || 1.0),
                items: trxType === "income" ? [] : normalizedItems,
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