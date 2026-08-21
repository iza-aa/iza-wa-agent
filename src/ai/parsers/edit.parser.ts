import { geminiKeyManager } from "../gemini-client.js";
import { TransactionRecord } from "../../db/repositories/transaction.repository.js";
import { logger } from "../../utils/logger.js";
import { parseHumanNominal } from "../../bot/handlers/command.handler.js";

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
  const methodMap: Record<string, string> = {
    mandiri: "Mandiri",
    bca: "BCA",
    bri: "BRI",
    bni: "BNI",
    qris: "QRIS",
    cash: "Cash",
    tunai: "Cash",
    "transfer bank": "Transfer Bank",
    transfer: "Transfer Bank",
    tf: "Transfer Bank",
    debit: "Debit",
    "kartu kredit": "Kartu Kredit",
    kredit: "Kartu Kredit",
  };

  const methodRegex = /(?:metode(?:\s+pembayaran)?|pembayaran|bayar(?:\s+(?:via|pakai|lewat))?|via|pakai|lewat|rekening|bank)\s*[:=]?\s*([a-zA-Z0-9\s]+)/i;
  const methodMatch = trimmed.match(methodRegex);
  if (methodMatch) {
    const rawVal = methodMatch[1].trim().toLowerCase();
    for (const [key, val] of Object.entries(methodMap)) {
      if (rawVal.includes(key) || rawVal === key) {
        result.payment_method = val;
        break;
      }
    }
    if (!result.payment_method && methodMatch[1].trim()) {
      result.payment_method = methodMatch[1].trim();
    }
  } else {
    for (const [key, val] of Object.entries(methodMap)) {
      if (lower.startsWith(key) || lower.endsWith(key) || lower === key) {
        result.payment_method = val;
        break;
      }
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

  // 3. Category / Kategori
  const categoryRegex = /(?:kategori|pos)\s*[:=]?\s*([^,;\n]+)/i;
  const categoryMatch = trimmed.match(categoryRegex);
  if (categoryMatch) {
    const raw = categoryMatch[1].trim();
    if (raw && !/^(metode|tanggal|nominal|total)/i.test(raw)) {
      result.category = raw;
    }
  }

  // 4. Total Amount / Nominal
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
