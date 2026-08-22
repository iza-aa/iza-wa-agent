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
    livin: "Mandiri",
    bca: "BCA",
    blu: "BCA",
    bri: "BRI",
    brimo: "BRI",
    bni: "BNI",
    bsi: "BSI",
    cimb: "CIMB",
    "cimb niaga": "CIMB",
    permata: "Permata",
    danamon: "Danamon",
    cash: "Cash",
    tunai: "Cash",
    kesh: "Cash",
    qris: "QRIS",
    kris: "QRIS",
    gopay: "GoPay",
    "go pay": "GoPay",
    "go-pay": "GoPay",
    ovo: "OVO",
    dana: "DANA",
    shopeepay: "ShopeePay",
    "shopee pay": "ShopeePay",
    shoopepay: "ShopeePay",
    shoppepay: "ShopeePay",
    shopee: "ShopeePay",
    spay: "ShopeePay",
    transfer: "Transfer Bank",
    "transfer bank": "Transfer Bank",
    tf: "Transfer Bank",
    trf: "Transfer Bank",
    tranfer: "Transfer Bank",
    debit: "Debit",
    kredit: "Kredit",
};
const STOP_WORDS = new Set([
    "berapa", "cek", "total", "lihat", "tampilkan", "ada", "daftar", "rekap", "laporan",
    "apa", "saja", "sisa", "yang", "di", "ke", "dari", "pada", "untuk", "dan", "atau",
    "pengeluaran", "belanja", "beli", "keluar", "biaya", "pemasukan", "masuk", "terima", "gaji",
    "transaksi", "hari", "ini", "kemarin", "minggu", "pekan", "lalu", "bulan", "tahun", "toko",
    "nota", "struk", "semua", "kami", "kita", "saya", "ayah", "sekarang", "saat", "dong", "ya", "nih", "kah",
    "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember",
    "bagaimana", "gimana", "cara", "caranya", "menginput", "input", "mencatat", "catat", "masukkan", "data", "panduan", "bantuan", "tata", "mau", "tahu", "jumlah",
]);
export function parseDateRange(lower, today) {
    const yStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(today);
    const [yearStr, monthStr, dayStr] = yStr.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    // 1. Last N Days (e.g. "7 hari terakhir", "30 hari terakhir", "3 hari terakhir")
    const nDaysMatch = lower.match(/(\d+)\s*hari\s*terakhir/i);
    if (nDaysMatch) {
        const days = parseInt(nDaysMatch[1], 10);
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - days);
        const startStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(startDate);
        return {
            start_date: startStr,
            end_date: yStr,
            period_label: `${days} Hari Terakhir (${startStr} s/d ${yStr})`,
        };
    }
    // 2. Tahun lalu / Tahun kemarin / Last year
    if (lower.includes("tahun lalu") || lower.includes("tahun kemarin") || lower.includes("last year")) {
        const prevYear = year - 1;
        return {
            start_date: `${prevYear}-01-01`,
            end_date: `${prevYear}-12-31`,
            period_label: `Tahun Lalu (${prevYear})`,
        };
    }
    // 3. Tahun ini / This year
    if (lower.includes("tahun ini") || lower.includes("this year") || lower.includes("sepanjang tahun")) {
        return {
            start_date: `${year}-01-01`,
            end_date: `${year}-12-31`,
            period_label: `Tahun Ini (${year})`,
        };
    }
    // 4. Specific Year Mention (e.g. "tahun 2024", "tahun 2025", "thn 2023")
    const yearMatch = lower.match(/(?:tahun|thn)\s+(20\d\d)\b/i);
    if (yearMatch) {
        const targetYear = yearMatch[1];
        return {
            start_date: `${targetYear}-01-01`,
            end_date: `${targetYear}-12-31`,
            period_label: `Tahun ${targetYear}`,
        };
    }
    // 5. Minggu ini / Pekan ini / This week
    if (lower.includes("minggu ini") || lower.includes("pekan ini") || lower.includes("this week")) {
        const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon ...
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(today);
        monday.setDate(today.getDate() + diffToMonday);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const monStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(monday);
        const sunStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(sunday);
        return {
            start_date: monStr,
            end_date: sunStr,
            period_label: `Minggu Ini (${monStr} s/d ${sunStr})`,
        };
    }
    // 6. Minggu lalu / Minggu kemarin / Pekan lalu / Last week
    if (lower.includes("minggu lalu") || lower.includes("minggu kemarin") || lower.includes("pekan lalu") || lower.includes("last week")) {
        const dayOfWeek = today.getDay();
        const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) - 7;
        const monday = new Date(today);
        monday.setDate(today.getDate() + diffToMonday);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const monStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(monday);
        const sunStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(sunday);
        return {
            start_date: monStr,
            end_date: sunStr,
            period_label: `Minggu Lalu (${monStr} s/d ${sunStr})`,
        };
    }
    // 7. Bulan kemarin / Bulan lalu / Last month
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
    // 8. Bulan ini / This month
    if (lower.includes("bulan ini") || lower.includes("this month")) {
        const lastDay = new Date(year, month, 0).getDate();
        return {
            start_date: `${year}-${monthStr}-01`,
            end_date: `${year}-${monthStr}-${lastDay}`,
            period_label: `Bulan Ini (${monthStr}/${year})`,
        };
    }
    // 9. Specific Month Name (e.g. "bulan juli", "agustus")
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
    // 10. Hari ini / Today
    if (lower.includes("hari ini") || lower.includes("today")) {
        return {
            start_date: yStr,
            end_date: yStr,
            period_label: `Hari Ini (${yStr})`,
        };
    }
    // 11. Kemarin
    if (/\bkemarin\b/.test(lower) && !lower.includes("bulan") && !lower.includes("minggu") && !lower.includes("pekan") && !lower.includes("tahun")) {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const prevDayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(yesterday);
        return {
            start_date: prevDayStr,
            end_date: prevDayStr,
            period_label: `Kemarin (${prevDayStr})`,
        };
    }
    return {};
}
export function extractDeterministicSearchIntent(userQuery) {
    const trimmed = userQuery.trim();
    const lower = trimmed.toLowerCase();
    const today = new Date();
    // 0. Check General How-To / Panduan / Pertanyaan Cara Input
    if (/(?:bagaimana|gimana|tata\s+cara|panduan|cara(?:\s+nya)?)\s+(?:cara(?:nya)?\s+)?(?:input|menginput|catat|mencatat|masuk(?:kan)?|tambah(?:kan)?|tulis|rekam|bikin|buat|pakai|penggunaan)\b/i.test(lower) ||
        /^(?:bagaimana|gimana)\s+(?:cara|caranya|menginput|mencatat|input|catat)\b/i.test(lower) ||
        /^(?:cara|panduan|bantuan)\s+(?:input|menginput|catat|mencatat|pengeluaran|pemasukan|pakai|penggunaan)\b/i.test(lower) ||
        /(?:bagaimana|gimana)\s+caranya\s+kalau\s+mau\s+tahu\s+jumlah\s+pemasukan/i.test(lower)) {
        if (lower.includes("pemasukan") || lower.includes("uang masuk") || lower.includes("saldo")) {
            return {
                intent_type: "general_qa",
                clarification_response: `💡 *CARA MENCATAT PEMASUKAN UANG:*\n\nAnda bisa mencatat pemasukan dengan mudah:\n\n1. ⌨️ *Perintah Cepat:*\n• \`/pemasukan 1.5jt Gaji Bulanan Mandiri\`\n• \`/pemasukan 500rb Penjualan Kopi Cash\`\n• \`/pemasukan 250000 Transfer Masuk BCA\`\n\n2. 🎙️ *Pesan Suara (Voice Note):*\nRekam suara Anda, contoh: *"Pemasukan dari penjualan 500 ribu cash"*.\n\n3. 💬 *Teks Bebas:*\nKetik langsung: *"Pemasukan 500rb penjualan cash"*.\n\n💡 Ketik \`/menu\` untuk melihat panduan lengkap.`,
            };
        }
        return {
            intent_type: "general_qa",
            clarification_response: `💡 *CARA MENCATAT PENGELUARAN BELANJA:*\n\nAnda bisa mencatat pengeluaran dengan 4 cara mudah:\n\n1. 💬 *Ketik Teks Langsung (Paling Praktis):*\n• \`Beli bensin 50rb Pertamina cash\`\n• \`Makan siang 35.000 Mandiri\`\n• \`Belanja Kasir 274000 Kafe Mammi tanggal 21 Agustus Cash\`\n\n2. 📸 *Kirim Foto Struk / Nota:*\nCukup foto struk belanja Anda dan kirim ke sini. AI akan otomatis membaca rincian item, total harga, dan menyimpannya ke Google Sheets.\n\n3. 🎙️ *Pesan Suara (Voice Note):*\nRekam suara Anda, contoh: *"Beli token listrik 100 ribu lewat Mandiri"*.\n\n4. ⌨️ *Gunakan Perintah Slash:*\n• \`/pengeluaran 274000 Belanja Kasir Cash\`\n\n💡 Ketik \`/menu\` untuk melihat seluruh panduan & fitur lainnya.`,
        };
    }
    // 1. Check general wallet balance
    if (/(?:saldo|uang\s+kas|sisa\s+uang|uang\s+kita|dompet)/i.test(lower) &&
        !lower.includes("pengeluaran") &&
        !lower.includes("pemasukan") &&
        !lower.includes("belanja") &&
        !lower.includes("nota") &&
        !lower.includes("struk")) {
        // Check specific bank pocket balance
        for (const [key, val] of Object.entries(PAYMENT_METHOD_MAP)) {
            if (new RegExp(`(?:saldo|uang(?:\\s+di)?|kas)\\s+${key}\\b`, "i").test(lower)) {
                return { intent_type: "multi_pocket_balance", target_pocket: val.toUpperCase() };
            }
        }
        return { intent_type: "wallet_balance" };
    }
    // 2. Detect payment method from aliases
    let paymentMethod = undefined;
    for (const [key, val] of Object.entries(PAYMENT_METHOD_MAP)) {
        if (new RegExp(`\\b${key}\\b`, "i").test(lower)) {
            paymentMethod = val;
            break;
        }
    }
    // Check specific bank pocket balance
    if (paymentMethod &&
        /(?:saldo|uang(?:\s+di)?|kas)/i.test(lower) &&
        !lower.includes("pengeluaran") &&
        !lower.includes("pemasukan") &&
        !lower.includes("belanja")) {
        return { intent_type: "multi_pocket_balance", target_pocket: paymentMethod.toUpperCase() };
    }
    // 3. Transactions search
    // If the text contains a nominal and is NOT an explicit inquiry, do not classify as search
    const hasNominal = /(?:rp\.?\s*)?\b\d+(?:[\.,]\d+)*(?:\s*(?:rb|ribu|k|jt|juta|milyar))?\b/i.test(trimmed);
    const isExplicitSearch = /^(berapa|cek|cari|search|find|lihat|total|rekap|laporan|riwayat|ada|apakah)\b/i.test(lower) || trimmed.endsWith("?") || lower.includes("cari nota") || lower.includes("cari belanja");
    if (hasNominal && !isExplicitSearch) {
        return null;
    }
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
    const dateRange = parseDateRange(lower, today);
    // Extract residual words for custom keywords (e.g. "bitcoin", "semen", "indomaret")
    const words = lower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const residualWords = words.filter((w) => !STOP_WORDS.has(w) && !PAYMENT_METHOD_MAP[w]);
    const residualKeyword = residualWords.length > 0 ? residualWords.join(" ") : undefined;
    // Keyword search with explicit trigger (e.g. "cari nota indomaret", "cari belanja semen")
    const cariMatch = lower.match(/(?:cari(?:\s+(?:nota|struk|belanja|transaksi))?|lihat nota|cek nota)\s+([^?]+)/i);
    let explicitKeyword = undefined;
    if (cariMatch) {
        const rawKw = cariMatch[1].trim();
        if (rawKw && rawKw.length >= 2) {
            explicitKeyword = rawKw;
        }
    }
    const finalKeyword = explicitKeyword || residualKeyword;
    if (isExpense || isIncome || paymentMethod || dateRange.start_date || finalKeyword) {
        return {
            intent_type: "search_transactions",
            search_params: {
                keyword: finalKeyword,
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
    // Guard: If the text contains a clear transaction nominal (e.g. "274000", "50rb", "Rp 50.000")
    // and is NOT an explicit inquiry (does not start with 'berapa', 'cek', 'cari', 'lihat', 'total', etc. and doesn't end with '?'),
    // it is definitely a new transaction recording, NOT a query!
    const hasNominal = /(?:rp\.?\s*)?\b\d+(?:[\.,]\d+)*(?:\s*(?:rb|ribu|k|jt|juta|milyar))?\b/i.test(trimmed);
    const isExplicitQuestionStart = /^(berapa|cek|cari|search|find|lihat|rekap|laporan|riwayat|apakah|bagaimana|mana|siapa|total(?:\s+(?:pengeluaran|pemasukan|saldo|kas|belanja))?)\b/i.test(lower);
    const endsWithQuestionMark = trimmed.endsWith("?");
    const hasExplicitCariPhrase = lower.includes("cari nota") || lower.includes("cari belanja") || lower.includes("cek nota") || lower.includes("lihat nota");
    if (hasNominal && !isExplicitQuestionStart && !endsWithQuestionMark && !hasExplicitCariPhrase) {
        return { isQuery: false, replyText: "" };
    }
    // Fast heuristic: Only evaluate if the text contains question indicators or inquiry keywords
    const isQuestionLike = endsWithQuestionMark ||
        isExplicitQuestionStart ||
        hasExplicitCariPhrase ||
        lower.startsWith("bagaimana") ||
        lower.startsWith("gimana") ||
        lower.startsWith("cara") ||
        lower.startsWith("panduan") ||
        lower.includes("caranya") ||
        lower.includes("saldo") ||
        lower.includes("berapa") ||
        lower.includes("terakhir") ||
        lower.startsWith("rekap") ||
        lower.startsWith("laporan");
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