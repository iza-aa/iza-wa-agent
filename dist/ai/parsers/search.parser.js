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
const MONTH_NAMES = {
    januari: { month: "01", lastDay: 31 },
    februari: { month: "02", lastDay: 28 },
    maret: { month: "03", lastDay: 31 },
    april: { month: "04", lastDay: 30 },
    mei: { month: "05", lastDay: 31 },
    juni: { month: "06", lastDay: 30 },
    juli: { month: "07", lastDay: 31 },
    agustus: { month: "08", lastDay: 31 },
    september: { month: "09", lastDay: 30 },
    oktober: { month: "10", lastDay: 31 },
    november: { month: "11", lastDay: 30 },
    desember: { month: "12", lastDay: 31 },
};
const PAYMENT_METHOD_MAP = {
    mandiri: "Mandiri",
    bca: "BCA",
    bri: "BRI",
    bni: "BNI",
    bsi: "BSI",
    cimb: "CIMB",
    permata: "Permata",
    danamon: "Danamon",
    cash: "Cash",
    tunai: "Cash",
    qris: "QRIS",
    gopay: "GoPay",
    ovo: "OVO",
    dana: "DANA",
    shopeepay: "ShopeePay",
    "shopee pay": "ShopeePay",
    transfer: "Transfer Bank",
    "transfer bank": "Transfer Bank",
    tf: "Transfer Bank",
    debit: "Debit",
    kredit: "Kredit",
};
export function parseDateRange(lower, todayStr) {
    const [yearStr, monthStr] = todayStr.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    // 1. Bulan kemarin / Bulan lalu / Last month
    if (lower.includes("bulan kemarin") || lower.includes("bulan lalu") || lower.includes("last month")) {
        const prevMonthNum = month === 1 ? 12 : month - 1;
        const prevYearNum = month === 1 ? year - 1 : year;
        const prevMonthStr = String(prevMonthNum).padStart(2, "0");
        const lastDay = new Date(prevYearNum, prevMonthNum, 0).getDate();
        return {
            start_date: `${prevYearNum}-${prevMonthStr}-01`,
            end_date: `${prevYearNum}-${prevMonthStr}-${lastDay}`,
            period_label: `Bulan Lalu (${prevMonthStr}/${prevYearNum})`,
        };
    }
    // 2. Bulan ini / This month
    if (lower.includes("bulan ini") || lower.includes("this month")) {
        const lastDay = new Date(year, month, 0).getDate();
        return {
            start_date: `${year}-${monthStr}-01`,
            end_date: `${year}-${monthStr}-${lastDay}`,
            period_label: `Bulan Ini (${monthStr}/${year})`,
        };
    }
    // 3. Specific Month Name (e.g. "bulan juli", "agustus")
    for (const [mName, mInfo] of Object.entries(MONTH_NAMES)) {
        if (new RegExp(`\\b${mName}\\b`, "i").test(lower)) {
            const mNum = parseInt(mInfo.month, 10);
            const lastDay = new Date(year, mNum, 0).getDate();
            return {
                start_date: `${year}-${mInfo.month}-01`,
                end_date: `${year}-${mInfo.month}-${lastDay}`,
                period_label: `Bulan ${mName.charAt(0).toUpperCase() + mName.slice(1)} ${year}`,
            };
        }
    }
    // 4. Hari ini / Today
    if (lower.includes("hari ini") || lower.includes("today")) {
        return {
            start_date: todayStr,
            end_date: todayStr,
            period_label: `Hari Ini (${todayStr})`,
        };
    }
    // 5. Kemarin (standalone)
    if (/\bkemarin\b/.test(lower) && !lower.includes("bulan") && !lower.includes("minggu")) {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const yStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(yesterday);
        return {
            start_date: yStr,
            end_date: yStr,
            period_label: `Kemarin (${yStr})`,
        };
    }
    return {};
}
export function extractDeterministicSearchIntent(userQuery) {
    const trimmed = userQuery.trim();
    const lower = trimmed.toLowerCase();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
    // 1. Check general wallet balance
    if (/^(berapa|cek|sisa|total)?\s*(saldo|uang|kas|dompet)(\s*kita|\s*sekarang)?\??$/i.test(lower) ||
        lower === "saldo" ||
        lower === "cek saldo" ||
        lower === "sisa saldo") {
        return { intent_type: "wallet_balance" };
    }
    // 2. Check specific bank pocket balance
    for (const [key, val] of Object.entries(PAYMENT_METHOD_MAP)) {
        if (new RegExp(`(?:saldo|uang(?:\\s+di)?|kas)\\s+${key}\\b`, "i").test(lower)) {
            return { intent_type: "multi_pocket_balance", target_pocket: val.toUpperCase() };
        }
    }
    // 3. Transactions search
    const isExpense = lower.includes("pengeluaran") ||
        lower.includes("belanja") ||
        lower.includes("keluar") ||
        lower.includes("beli") ||
        lower.includes("biaya");
    const isIncome = lower.includes("pemasukan") ||
        lower.includes("uang masuk") ||
        lower.includes("terima") ||
        lower.includes("gaji") ||
        lower.includes("masuk");
    let paymentMethod = undefined;
    for (const [key, val] of Object.entries(PAYMENT_METHOD_MAP)) {
        if (new RegExp(`\\b${key}\\b`, "i").test(lower)) {
            paymentMethod = val;
            break;
        }
    }
    const dateRange = parseDateRange(lower, today);
    // 4. Keyword search (e.g. "cari nota indomaret", "cari belanja semen", "cari mitra10")
    const cariMatch = lower.match(/(?:cari(?:\s+(?:nota|struk|belanja|transaksi))?|lihat nota|cek nota)\s+([^?]+)/i);
    if (cariMatch) {
        const rawKw = cariMatch[1].trim();
        if (rawKw && rawKw.length >= 2) {
            return {
                intent_type: "search_transactions",
                search_params: {
                    keyword: rawKw,
                    payment_method: paymentMethod,
                    start_date: dateRange.start_date,
                    end_date: dateRange.end_date,
                },
            };
        }
    }
    if (isExpense || isIncome || paymentMethod || dateRange.start_date) {
        return {
            intent_type: "search_transactions",
            search_params: {
                trx_type: isIncome && !isExpense ? "income" : isExpense && !isIncome ? "expense" : undefined,
                payment_method: paymentMethod,
                start_date: dateRange.start_date,
                end_date: dateRange.end_date,
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
            let notFound = `🔍 *HASIL PENCARIAN TRANSAKSI*\n`;
            notFound += `📝 *Pertanyaan:* "${userQuery}"\n`;
            notFound += `📊 *Ditemukan:* 0 transaksi\n`;
            notFound += `💰 *Total Nilai:* *Rp 0*\n`;
            notFound += `────────────────────────\n\n`;
            notFound += `ℹ️ Tidak ditemukan transaksi yang sesuai dengan kriteria`;
            if (params.payment_method)
                notFound += ` melalui *${params.payment_method}*`;
            if (params.start_date || params.end_date) {
                notFound += ` pada periode ${params.start_date || ""} s/d ${params.end_date || ""}`;
            }
            notFound += `.\n\n💡 _Coba gunakan kata kunci lain atau periksa rentang tanggal transaksi._`;
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
        const displayLimit = 25;
        results.slice(0, displayLimit).forEach((t, i) => {
            const isInc = isIncome(t);
            const sign = isInc ? "🟢" : "🔴";
            const method = t.payment_method ? ` • ${t.payment_method}` : "";
            const shortId = t.id.includes("-") ? t.id.split("-").slice(1).join("") : t.id;
            reply += `${i + 1}. ${sign} *${t.merchant}* (${t.category}) • \`${shortId}\`\n`;
            reply += `   📅 ${t.date} | 💰 *${formatRupiah(t.total_amount)}*${method} | 👤 ${t.user_name}\n\n`;
        });
        if (results.length > displayLimit) {
            reply += `_...dan ${results.length - displayLimit} transaksi lainnya._\n\n`;
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