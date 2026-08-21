import { geminiKeyManager } from "../gemini-client.js";
import { isIncome } from "../../db/repositories/transaction.repository.js";
import { formatRupiah, formatWalletBalance, formatMultiPocketBalance } from "../../bot/formatters/reply.formatter.js";
import { logger } from "../../utils/logger.js";
const SEARCH_SYSTEM_INSTRUCTION = `Kamu adalah AI Analis Keuangan & Asisten Tanya Jawab Database Keuangan WhatsApp.
Tugasmu adalah menganalisis pesan pertanyaan pengguna dalam Bahasa Indonesia untuk mencari riwayat transaksi atau mengecek saldo.

Klasifikasikan pesan ke salah satu "intent_type":
1. "wallet_balance": Pengguna bertanya saldo umum kas / dompet.
   Contoh: "Berapa sisa uang kas kita?", "Saldo kita berapa?", "Cek dompet", "Ada uang berapa sekarang?"
2. "multi_pocket_balance": Pengguna bertanya saldo bank / kas tertentu.
   Contoh: "Berapa saldo Mandiri?", "Uang di BCA sisa berapa?", "Ada berapa uang cash di laci?", "Cek saldo QRIS"
   -> Isi "target_pocket" dengan nama bank/kas terkait (misal: "Mandiri", "BCA", "Cash", "QRIS").
3. "search_transactions": Pengguna mencari riwayat transaksi lama atau bertanya total belanja/pemasukan tertentu.
   Contoh:
   - "Berapa kali beli bensin bulan ini?" -> keyword: "bensin", category: "Transportasi & Bensin"
   - "Cari nota belanja di Mitra10" -> merchant: "Mitra10"
   - "Berapa total belanja makanan minggu ini?" -> category: "Makanan & Minuman"
   - "Kemarin beli apa saja?" -> start_date & end_date disesuaikan
   - "Ada pemasukan apa saja bulan ini?" -> trx_type: "income"
4. "general_qa": Pertanyaan umum tentang cara kerja bot atau bantuan.
5. "not_a_query": Pesan bukan berupa pertanyaan (misal pesan pencatatan belanja biasa seperti "Beli kopi 25rb").`;
export async function parseQueryIntent(userQuery, todayStr) {
    const today = todayStr || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
    return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SEARCH_SYSTEM_INSTRUCTION,
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
            },
        });
        const prompt = `Tanggal hari ini di Indonesia (WITA): ${today}
Pesan Pengguna: "${userQuery}"

Format JSON Wajib:
{
  "intent_type": "wallet_balance | multi_pocket_balance | search_transactions | general_qa | not_a_query",
  "target_pocket": "Mandiri | BCA | Cash | QRIS (opsional)",
  "search_params": {
    "keyword": "kata kunci pencarian (opsional)",
    "merchant": "nama toko/sumber (opsional)",
    "category": "kategori (opsional)",
    "payment_method": "metode bayar (opsional)",
    "start_date": "YYYY-MM-DD (opsional)",
    "end_date": "YYYY-MM-DD (opsional)",
    "trx_type": "income | expense (opsional)"
  },
  "clarification_response": "Jawaban jika pertanyaan umum (opsional)"
}`;
        const result = await model.generateContent(prompt);
        const textResponse = result.response.text();
        logger.debug({ modelName, textResponse }, "Gemini Query Intent Response");
        try {
            return JSON.parse(textResponse);
        }
        catch {
            return { intent_type: "not_a_query" };
        }
    });
}
export function extractDeterministicSearchIntent(userQuery) {
    const trimmed = userQuery.trim();
    const lower = trimmed.toLowerCase();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
    const [year, month] = today.split("-");
    const currentMonthStart = `${year}-${month}-01`;
    const currentMonthEnd = `${year}-${month}-31`;
    // 1. Check general wallet balance
    if (/^(berapa|cek|sisa|total)?\s*(saldo|uang|kas|dompet)(\s*kita|\s*sekarang)?\??$/i.test(lower) ||
        lower === "saldo" ||
        lower === "cek saldo" ||
        lower === "sisa saldo") {
        return { intent_type: "wallet_balance" };
    }
    // 2. Check specific bank pocket balance
    const bankMatch = lower.match(/(?:saldo|uang(?:\s+di)?|kas)\s+(mandiri|bca|bri|bni|cash|qris|tunai)/i);
    if (bankMatch) {
        let pocket = bankMatch[1].toUpperCase();
        if (pocket === "TUNAI")
            pocket = "CASH";
        return { intent_type: "multi_pocket_balance", target_pocket: pocket };
    }
    // 3. Check monthly expense / income inquiries
    const isExpenseInquiry = lower.includes("pengeluaran") || lower.includes("belanja") || lower.includes("keluar");
    const isIncomeInquiry = lower.includes("pemasukan") || lower.includes("uang masuk") || lower.includes("terima");
    const isMonthInquiry = lower.includes("bulan ini") || lower.includes("agustus") || lower.includes("month");
    if (isExpenseInquiry || isIncomeInquiry) {
        let paymentMethod = undefined;
        if (lower.includes("cash") || lower.includes("tunai"))
            paymentMethod = "Cash";
        else if (lower.includes("mandiri"))
            paymentMethod = "Mandiri";
        else if (lower.includes("bca"))
            paymentMethod = "BCA";
        else if (lower.includes("bri"))
            paymentMethod = "BRI";
        else if (lower.includes("qris"))
            paymentMethod = "QRIS";
        return {
            intent_type: "search_transactions",
            search_params: {
                trx_type: isIncomeInquiry ? "income" : "expense",
                payment_method: paymentMethod,
                start_date: isMonthInquiry ? currentMonthStart : undefined,
                end_date: isMonthInquiry ? currentMonthEnd : undefined,
            },
        };
    }
    return null;
}
export async function executeNaturalQuerySearch(userQuery, trxRepo, isSuperAdmin, senderPhone) {
    const trimmed = (userQuery || "").trim();
    const lower = trimmed.toLowerCase();
    // Fast heuristic: Only evaluate if the text contains question indicators or inquiry keywords
    const isQuestionLike = trimmed.endsWith("?") ||
        /^(berapa|cek|saldo|dompet|kas|riwayat|cari|rekap|laporan|apakah|bagaimana|mana|total|siapa|ada|terakhir|transaksi|pengeluaran|pemasukan)\b/i.test(lower) ||
        lower.includes("saldo") ||
        lower.includes("berapa") ||
        lower.includes("cari nota") ||
        lower.includes("cari belanja") ||
        lower.includes("terakhir") ||
        lower.includes("pengeluaran") ||
        lower.includes("pemasukan") ||
        lower.includes("transaksi") ||
        lower.includes("belanja");
    if (!isQuestionLike) {
        return { isQuery: false, replyText: "" };
    }
    // 1. Check deterministic rule-based intent first
    let intent = extractDeterministicSearchIntent(userQuery);
    // 2. If no deterministic intent matched, use Gemini AI
    if (!intent) {
        intent = await parseQueryIntent(userQuery);
    }
    if (intent.intent_type === "not_a_query") {
        return { isQuery: false, replyText: "" };
    }
    // 1. Check Wallet Balance
    if (intent.intent_type === "wallet_balance") {
        if (!isSuperAdmin) {
            return {
                isQuery: true,
                replyText: "⚠️ Informasi saldo kas hanya dapat diakses oleh Super Admin untuk menjaga privasi data keuangan.",
            };
        }
        const wallet = await trxRepo.getWalletBalance();
        return { isQuery: true, replyText: formatWalletBalance(wallet) };
    }
    // 2. Check Multi Pocket / Bank Balance
    if (intent.intent_type === "multi_pocket_balance") {
        if (!isSuperAdmin) {
            return {
                isQuery: true,
                replyText: "⚠️ Informasi saldo bank/kas hanya dapat diakses oleh Super Admin.",
            };
        }
        const multi = await trxRepo.getMultiPocketBalances();
        return {
            isQuery: true,
            replyText: formatMultiPocketBalance(multi, intent.target_pocket),
        };
    }
    // 3. Search Historical Transactions
    if (intent.intent_type === "search_transactions") {
        const params = intent.search_params || {};
        const results = await trxRepo.searchTransactions({
            ...params,
            userPhone: isSuperAdmin ? undefined : senderPhone, // Non-admin only sees own transactions
            limit: 30,
        });
        if (results.length === 0) {
            let notFound = `🔍 *Pencarian Riwayat Transaksi:*\n\nTidak ditemukan transaksi yang cocok untuk: *"${userQuery}"*`;
            if (params.start_date || params.end_date) {
                notFound += ` pada periode ${params.start_date || ""} s/d ${params.end_date || ""}`;
            }
            return { isQuery: true, replyText: notFound };
        }
        let totalAmount = 0;
        results.forEach((t) => {
            totalAmount += Number(t.total_amount) || 0;
        });
        let reply = `🔍 *HASIL PENCARIAN TRANSAKSI*\n`;
        reply += `📝 *Pertanyaan:* "${userQuery}"\n`;
        reply += `📊 *Ditemukan:* ${results.length} transaksi\n`;
        reply += `💰 *Total Nilai:* *${formatRupiah(totalAmount)}*\n`;
        reply += `────────────────────────\n\n`;
        results.slice(0, 15).forEach((t, i) => {
            const isInc = isIncome(t);
            const sign = isInc ? "🟢" : "🔴";
            const method = t.payment_method ? ` • ${t.payment_method}` : "";
            const shortId = t.id.includes("-") ? t.id.split("-").slice(1).join("") : t.id;
            reply += `${i + 1}. ${sign} *${t.merchant}* (${t.category}) • \`${shortId}\`\n`;
            reply += `   📅 ${t.date} | 💰 *${formatRupiah(t.total_amount)}*${method} | 👤 ${t.user_name}\n\n`;
        });
        if (results.length > 15) {
            reply += `_...dan ${results.length - 15} transaksi lainnya._\n\n`;
        }
        reply += `💡 _Ketik \`/detail <ID>\` untuk melihat rincian item lengkap._`;
        return { isQuery: true, replyText: reply };
    }
    if (intent.intent_type === "general_qa" && intent.clarification_response) {
        return { isQuery: true, replyText: intent.clarification_response };
    }
    return { isQuery: false, replyText: "" };
}
//# sourceMappingURL=search.parser.js.map