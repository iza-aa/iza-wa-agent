import { geminiKeyManager } from "../gemini-client.js";
import { ExtractedItem, ExtractedItemSchema } from "../schemas/transaction.schema.js";
import { logger } from "../../utils/logger.js";
import { z } from "zod";

const BreakdownResponseSchema = z.object({
  target_id: z.string().nullable().optional().transform((val) => val || undefined),
  items: z.array(ExtractedItemSchema).default([]),
  total_calculated: z.number().default(0),
});

export type BreakdownResponse = z.infer<typeof BreakdownResponseSchema>;

const BREAKDOWN_SYSTEM_INSTRUCTION = `Kamu adalah asisten AI kasir dan akuntan profesional untuk kafe & resto berbahasa Indonesia.
Tugasmu adalah menganalisis daftar rincian barang belanjaan operasional harian kafe dari input pengguna.

Aturan Ekstraksi:
1. Ekstraksi setiap butir belanjaan menjadi objek:
   - item_name: Nama barang / belanjaan (contoh: "Sayur", "Sirup", "Minyak Goreng", "Token Listrik")
   - qty: Jumlah barang (angka, default 1)
   - unit: Satuan barang (contoh: "ikat", "dos", "botol", "karton", "liter", "pax", "kg", "lembar", "kali", "unit")
   - price: Harga per unit (total_price / qty jika harga total yang disebutkan)
   - total_price: Total harga untuk baris item tersebut dalam Rupiah
   - department: Wajib dikelompokkan ke salah satu pos berikut:
     * "Dapur": Sayuran, ayam, daging, ikan, beras, bumbu dapur, gas LPG, telur, minyak goreng, bahan makanan masakan.
     * "Barista": Biji kopi, sirup, susu cair/kental, bubuk minuman, matcha, cup kopi, sedotan, bahan minuman.
     * "Waiters": Sabun cuci piring, cairan pembersih lantai, pembersih kaca, kantong sampah, tisu meja, perlengkapan operasional pelayan/kebersihan.
     * "Kasir": Kertas thermal struk kasir, plastik take away, kantong kresek kasir, bolpoin kasir.
     * "Kafe": Token listrik PLN, tagihan WiFi internet, PDAM/air minum galon umum, renovasi kecil/tukang, ATK umum, sewa, operasional umum.
   - notes: Catatan penting jika ada (misal nomor meteran listrik, merk, ukuran).
2. Jika ada ID transaksi di awal pesan (misal "H070" atau "T026-H070"), masukkan ke "target_id".
3. Hitung "total_calculated" sebagai penjumlahan dari seluruh total_price item.

Format JSON Wajib:
{
  "target_id": "T026-H070" | null,
  "items": [
    {
      "item_name": "Sayur",
      "qty": 6,
      "unit": "ikat",
      "price": 1000,
      "total_price": 6000,
      "department": "Dapur",
      "notes": ""
    }
  ],
  "total_calculated": 6000
}`;

export async function parseBreakdownItems(rawText: string): Promise<BreakdownResponse> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: BREAKDOWN_SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const prompt = `Teks Rincian Belanja Pengguna:
"""${rawText}"""

Ekstraksi seluruh daftar rincian butir belanjaan di atas ke dalam format JSON yang valid.`;

    const result = await model.generateContent(prompt);
    const textResponse = result.response.text();
    logger.debug({ modelName, textResponse }, "Gemini Breakdown Parser Raw Response");

    try {
      const parsedJson = JSON.parse(textResponse);
      const validated = BreakdownResponseSchema.parse(parsedJson);
      return validated;
    } catch (parseErr) {
      logger.error({ parseErr, textResponse }, "Failed to parse Breakdown JSON");
      return { target_id: undefined, items: [], total_calculated: 0 };
    }
  });
}
