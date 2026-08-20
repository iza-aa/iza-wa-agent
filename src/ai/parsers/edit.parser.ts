import { geminiKeyManager } from "../gemini-client.js";
import { TransactionRecord } from "../../db/repositories/transaction.repository.js";
import { logger } from "../../utils/logger.js";

export interface ParsedTransactionEdit {
  merchant?: string;
  category?: string;
  total_amount?: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  date?: string;
  payment_method?: string;
  status?: string;
  raw_text?: string;
}

export async function parseTransactionEdit(
  existingTrx: TransactionRecord,
  editInstruction: string
): Promise<ParsedTransactionEdit> {
  const prompt = `Anda adalah asisten cerdas untuk mengedit data transaksi keuangan yang sudah tercatat.

DATA TRANSAKSI SAAT INI:
- Merchant: ${existingTrx.merchant}
- Kategori: ${existingTrx.category}
- Tanggal: ${existingTrx.date}
- Total: ${existingTrx.total_amount}
- Subtotal: ${existingTrx.subtotal || existingTrx.total_amount}
- Pajak: ${existingTrx.tax || 0}
- Diskon: ${existingTrx.discount || 0}
- Metode Pembayaran: ${existingTrx.payment_method || "Cash"}
- Catatan: ${existingTrx.raw_text || "-"}

INSTRUKSI KOREKSI / EDIT DARI PENGGUNA:
"${editInstruction}"

TUGAS:
Analisis instruksi pengguna dan tentukan kolom-kolom apa saja yang ingin diubah.
HANYA kembalikan JSON berisi field yang diubah. Jika suatu field tidak diubah, JANGAN sertakan di JSON.

Format JSON yang valid:
{
  "merchant": "Nama baru jika diubah",
  "category": "Makanan & Minuman | Belanja Bulanan | Transportasi & Bensin | Tagihan & Utilitas | Kesehatan & Obat | Pendidikan | Hiburan & Rekreasi | Operasional Kantor | Lain-lain",
  "total_amount": 50000,
  "subtotal": 50000,
  "tax": 0,
  "discount": 0,
  "date": "YYYY-MM-DD",
  "payment_method": "Cash | QRIS | Transfer Bank | Debit | Kartu Kredit",
  "raw_text": "Catatan baru jika ada"
}
`;

  try {
    return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const response = await model.generateContent(prompt);
      const rawJson = response.response.text() || "{}";
      const parsed = JSON.parse(rawJson);
      return parsed as ParsedTransactionEdit;
    });
  } catch (err) {
    logger.error({ err, editInstruction }, "Failed to parse transaction edit with Gemini");
    const numMatch = editInstruction.replace(/[^0-9]/g, "");
    if (numMatch && numMatch.length >= 3) {
      return { total_amount: parseInt(numMatch, 10) };
    }
    return {};
  }
}
