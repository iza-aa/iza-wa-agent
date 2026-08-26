import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedTransaction, ExtractedTransactionSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";

const RECEIPT_SYSTEM_INSTRUCTION = `Kamu adalah OCR AI ekstraktor struk belanja, nota, kwitansi, tabel belanja, dan bukti transfer pembayaran tingkat tinggi.
Tugasmu adalah membaca gambar struk/tabel dan mengekstrak rincian belanja selengkap dan seakurat mungkin ke format JSON.

Pedoman Ekstraksi Struk & Rincian Belanja:
1. merchant: Nama toko/restoran/badan usaha di bagian atas struk (misal Indomaret, Alfamart, Pertamina, Starbucks, Tokopedia, dll.). Jika berupa catatan/tabel belanja internal, gunakan judul catatan (misal "Belanja Harian", "Kasir", "Dapur", dll.).
2. date: Tanggal yang tercetak pada struk/tabel (Format: YYYY-MM-DD). Jika tahun tidak tertulis, gunakan tahun saat ini.
3. items: Daftar rincian barang yang dibeli (nama barang, qty, unit/satuan, harga satuan, total harga item, dan divisi/keperluan).
   - item_name: Nama barang murni (misal: "Sayur", "Sirup", "Cairan pembersih", "Air minum", "Minyak Goreng", "Ayam", "Token Listrik"). Jangan sertakan jumlah/satuan jika sudah dipisah ke qty & unit.
   - qty: Angka jumlah barang (misal: 6, 1, 2, 3, 5, 1, 1).
   - unit: Satuan barang jika tertera di struk/tabel (misal: "ikat", "dos", "botol", "karton", "liter", "pax", "kali", "kg", "pack", "pcs", "roll", dll.).
   - department: Divisi atau Keperluan barang. JIKA PADA GAMBAR TERDAPAT KOLOM "KEPERLUAN" / "DIVISI" / "BAGIAN", BACA DAN AMBIL NILAI KOLOM TERSEBUT lalu petakan ke salah satu: "Dapur", "Barista", "Waiters", "Kasir", "Kafe". (Contoh: 'Dapur'/'dapur' -> 'Dapur', 'Barista' -> 'Barista', 'Waiters' -> 'Waiters', 'Kasir' -> 'Kasir', 'Kafe' -> 'Kafe').
   - ATURAN PENTING HARGA (AS-IS CONSUME):
     * Jika struk/tabel/catatan hanya mencantumkan 1 kolom/nilai harga per baris (misal: 'Sayur 6 ikat ... Rp 6.000', 'Minyak Goreng 5 liter ... Rp 120.000', 'Air minum 3 karton ... Rp 120.000'), ANGGAP angka tersebut adalah TOTAL HARGA untuk baris item tersebut (total_price).
     * JANGAN PERNAH mengalikan harga tersebut dengan qty (misal JANGAN hitung 5 x 120.000 = 600.000 atau 6 x 6.000 = 36.000), KECUALI di gambar tertulis sangat jelas dan terpisah antara kolom "Harga Satuan (@)" dan kolom "Total Harga".
     * Isi "total_price" dengan nominal yang tertulis di baris tersebut.
     * Isi "price" (harga satuan) dengan "total_price / qty" jika tidak ada harga satuan terpisah.
4. subtotal: Total harga barang sebelum diskon/pajak. Jika tidak ada baris Subtotal terpisah, hitung dari penjumlahan seluruh total_price item.
5. tax: PPN / Pajak Restoran (PB1) jika ada.
6. discount: Potongan harga / diskon / voucher jika ada.
7. total_amount: Total akhir (Grand Total / Net Total) yang wajib dibayarkan. Jika pada gambar tidak tertulis Grand Total eksplisit, gunakan penjumlahan seluruh total_price item ditambah pajak dikurangi diskon.
8. payment_method: Deteksi dari baris pembayaran / bukti transfer / header tabel (Mandiri, BCA, BRI, BNI, BSI, QRIS, Cash, Debit, ShopeePay, dll.). Jika tidak tertera jelas, gunakan "Cash" (untuk struk belanja) atau "Transfer Bank" (untuk mutasi).
9. category: Pilih kategori yang paling tepat dari: "Pemasukan: Transfer Masuk", "Pemasukan: Gaji", "Pemasukan: Setoran Tunai", "Pemasukan: Penjualan", "Makanan & Minuman", "Belanja Bulanan", "Transportasi & Bensin", "Tagihan & Utilitas", "Kesehatan & Obat", "Pendidikan", "Hiburan & Rekreasi", "Operasional Kantor", "Lain-lain". Jika gambar berupa bukti transfer masuk / setoran tunai / penerimaan dana, gunakan awalan "Pemasukan: ".
10. confidence_score: Berikan skor 0.0 - 1.0 seberapa jelas gambar struk tersebut terbaca.`;

export async function parseReceiptVision(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
  userCaption: string = ""
): Promise<ExtractedTransaction | null> {
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
    const prompt = "Ekstrak seluruh informasi transaksi dan rincian belanja dari gambar/dokumen struk ini ke format JSON. Pastikan nominal harga dikonsumsi apa adanya (as-is) tanpa mengalikan harga dengan Qty kecuali rincian harga satuan dan total tertulis eksplisit terpisah." + captionContext;

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
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(parsedDate)) {
        parsedDate = todayStr;
      }

      const normalizedItems = (parsedJson.items || []).map((it: any) => {
        const qty = Number(it.qty || it.quantity || 1) || 1;
        const hasTotalPrice = it.total_price !== undefined && it.total_price !== null && Number(it.total_price) > 0;
        const hasPrice = it.price !== undefined && it.price !== null && Number(it.price || it.unit_price) > 0;

        let totalPrice = 0;
        let unitPrice = 0;

        if (hasTotalPrice && hasPrice) {
          totalPrice = Number(it.total_price);
          unitPrice = Number(it.price || it.unit_price);
        } else if (hasTotalPrice) {
          totalPrice = Number(it.total_price);
          unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
        } else if (hasPrice) {
          // As-is consume: if only one price is available, it is the line total_price
          totalPrice = Number(it.price || it.unit_price);
          unitPrice = qty > 0 ? totalPrice / qty : totalPrice;
        }

        // Map department case-insensitively and intelligently
        let dept: "Dapur" | "Barista" | "Waiters" | "Kasir" | "Kafe" = "Kafe";
        const rawDept = (it.department || it.keperluan || it.divisi || "").toString().trim().toLowerCase();
        if (rawDept.includes("dapur") || rawDept.includes("kitchen")) dept = "Dapur";
        else if (rawDept.includes("barista") || rawDept.includes("bar") || rawDept.includes("kopi")) dept = "Barista";
        else if (rawDept.includes("waiter") || rawDept.includes("pelayan") || rawDept.includes("service")) dept = "Waiters";
        else if (rawDept.includes("kasir") || rawDept.includes("cashier") || rawDept.includes("pos")) dept = "Kasir";
        else if (rawDept.includes("kafe") || rawDept.includes("cafe") || rawDept.includes("umum")) dept = "Kafe";

        let finalUnit = it.unit || "unit";
        let finalQty = qty;
        if (it.notes && /\b(\d+(\.\d+)?\s*(gantung|biji|bks|bungkus|rak|kotak|bal|ikat|btl|botol|kaleng|ekor|dos|karton|roll|lembar|pax|pack|pcs|grm|gram|ons|kg|liter|unit|buah))\b/i.test(it.notes)) {
          const match = it.notes.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
          if (match) {
            finalQty = Number(match[1]) || qty;
            finalUnit = match[2] || finalUnit;
          } else {
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

      const calculatedItemsTotal = normalizedItems.reduce((acc: number, item: any) => acc + item.total_price, 0);
      const tax = Number(parsedJson.tax || 0);
      const discount = Number(parsedJson.discount || 0);

      // If calculated items total is present and differs from parsed total (e.g. AI wrongly multiplied or no grand total in table), use calculated total
      let finalTotal = Number(parsedJson.total_amount || parsedJson.subtotal || 0);
      if (calculatedItemsTotal > 0 && (finalTotal <= 0 || (tax === 0 && discount === 0 && finalTotal !== calculatedItemsTotal))) {
        finalTotal = calculatedItemsTotal + tax - discount;
      }

      const finalSubtotal = Number(parsedJson.subtotal || calculatedItemsTotal || finalTotal);

      const normalizedTrx = {
        merchant: parsedJson.merchant || "Toko / Merchant",
        date: parsedDate,
        category: parsedJson.category || "Makanan & Minuman",
        subtotal: finalSubtotal,
        tax: tax,
        discount: discount,
        total_amount: finalTotal,
        payment_method: parsedJson.payment_method || "Cash",
        confidence_score: Number(parsedJson.confidence_score || 1.0),
        items: normalizedItems,
      };

      return ExtractedTransactionSchema.parse(normalizedTrx);
    } catch (err) {
      logger.error({ err, textResponse }, "Failed to validate receipt vision JSON");
      return null;
    }
  });
}
