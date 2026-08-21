import { geminiKeyManager } from "../gemini-client.js";
import { TransactionRecord } from "../../db/repositories/transaction.repository.js";
import { logger } from "../../utils/logger.js";
import { parseHumanNominal } from "../../bot/handlers/command.handler.js";
import { getCanonicalPaymentMethod, CANONICAL_PAYMENT_MAP } from "../../utils/payment-methods.js";

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

export function extractDeterministicEdits(editInstruction: string): ParsedTransactionEdit {
  const result: ParsedTransactionEdit = {};
  const trimmed = editInstruction.trim();
  const lower = trimmed.toLowerCase();

  // 1. Payment Method
  const methodRegex = /(?:metode(?:\s+pembayaran)?|pembayaran|bayar(?:\s+(?:via|pakai|lewat))?|via|pakai|lewat|rekening|bank)\s*[:=]?\s*([a-zA-Z0-9\s]+)/i;
  const methodMatch = trimmed.match(methodRegex);
  if (methodMatch) {
    const rawVal = methodMatch[1].trim();
    const canonical = getCanonicalPaymentMethod(rawVal);
    if (canonical) {
      result.payment_method = canonical;
    } else if (rawVal) {
      result.payment_method = rawVal;
    }
  } else {
    const canonicalDirect = getCanonicalPaymentMethod(trimmed);
    if (canonicalDirect) {
      result.payment_method = canonicalDirect;
    }
  }

  // 2. Date / Tanggal
  const dateRegex = /(?:tanggal|tgl|date)\s*[:=]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i;
  const dateMatch = trimmed.match(dateRegex);
  if (dateMatch) {
    const rawDate = dateMatch[1].trim();
    const dmyMatch = rawDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
      result.date = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
    } else {
      result.date = rawDate;
    }
  }

  // 3. Merchant / Toko (Gap 43)
  const merchantRegex = /(?:toko|merchant|vendor|tempat|penjual|sumber)\s*[:=]\s*([^,;\n]+)/i;
  const merchantMatch = trimmed.match(merchantRegex);
  if (merchantMatch) {
    const rawMerchant = merchantMatch[1].trim();
    if (rawMerchant) {
      result.merchant = rawMerchant;
    }
  }

  // 4. Category / Kategori
  const categoryRegex = /(?:kategori|pos)\s*[:=]?\s*([^,;\n]+)/i;
  const categoryMatch = trimmed.match(categoryRegex);
  if (categoryMatch) {
    const raw = categoryMatch[1].trim();
    if (raw && !/^(metode|tanggal|nominal|total|toko|diskon|pajak|catatan)/i.test(raw)) {
      result.category = raw;
    }
  }

  // 5. Notes / Catatan (Gap 43)
  const notesRegex = /(?:catatan|notes?|ket(?:erangan)?)\s*[:=]\s*([^,;\n]+)/i;
  const notesMatch = trimmed.match(notesRegex);
  if (notesMatch) {
    const rawNotes = notesMatch[1].trim();
    if (rawNotes) {
      result.raw_text = rawNotes;
    }
  }

  // 6. Diskon (Gap 7)
  const diskonRegex = /(?:diskon|potongan|discount)\s*[:=]?\s*(?:rp\.?\s*)?([\d\.,]+(?:\s*(?:rb|ribu|k|jt|juta))?)/i;
  const diskonMatch = trimmed.match(diskonRegex);
  if (diskonMatch) {
    const parsedDiskon = parseHumanNominal(diskonMatch[1]);
    if (parsedDiskon >= 0) {
      result.discount = parsedDiskon;
    }
  }

  // 7. Pajak / Tax (Gap 7)
  const taxRegex = /(?:pajak|tax|ppn)\s*[:=]?\s*(?:rp\.?\s*)?([\d\.,]+(?:\s*(?:rb|ribu|k|jt|juta))?)/i;
  const taxMatch = trimmed.match(taxRegex);
  if (taxMatch) {
    const parsedTax = parseHumanNominal(taxMatch[1]);
    if (parsedTax >= 0) {
      result.tax = parsedTax;
    }
  }

  // 8. Total Amount / Nominal
  const nominalRegex = /(?:nominal|total|harga|jumlah|sebesar|ganti)\s*[:=]?\s*(?:rp\.?\s*)?([\d\.,]+(?:\s*(?:rb|ribu|k|jt|juta|milyar))?)/i;
  const nominalMatch = trimmed.match(nominalRegex);
  if (nominalMatch) {
    const parsedAmount = parseHumanNominal(nominalMatch[1]);
    if (parsedAmount > 0) {
      result.total_amount = parsedAmount;
      result.subtotal = parsedAmount;
    }
  } else if (/^\s*(?:rp\.?\s*)?[\d\.,]+(?:\s*(?:rb|ribu|k|jt|juta))?\s*$/i.test(trimmed)) {
    const directParsed = parseHumanNominal(trimmed);
    if (directParsed > 0) {
      result.total_amount = directParsed;
      result.subtotal = directParsed;
    }
  }

  return result;
}

export async function parseTransactionEdit(
  existingTrx: TransactionRecord,
  editInstruction: string
): Promise<ParsedTransactionEdit> {
  const deterministic = extractDeterministicEdits(editInstruction);

  // If deterministic rules already parsed all or key intended edits, return immediately for instant execution
  if (Object.keys(deterministic).length > 0) {
    logger.info({ deterministic, editInstruction }, "Deterministic transaction edit matched instantly");
    return deterministic;
  }

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
  "payment_method": "Cash | QRIS | Transfer Bank | Mandiri | BCA | BRI | BNI | Debit | Kartu Kredit",
  "raw_text": "Catatan baru jika ada"
}
`;

  try {
    const aiResult = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
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

    return { ...aiResult, ...deterministic };
  } catch (err) {
    logger.error({ err, editInstruction }, "Failed to parse transaction edit with Gemini, using deterministic fallback");
    return deterministic;
  }
}
