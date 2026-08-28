import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { logger } from "../utils/logger.js";
export class ContextBuilder {
    supabase;
    trxRepo;
    chatRepo;
    userRepo;
    constructor(supabase, trxRepo, chatRepo, userRepo) {
        this.supabase = supabase;
        this.trxRepo = trxRepo;
        this.chatRepo = chatRepo;
        this.userRepo = userRepo;
    }
    /**
     * Fetches live database records & history to construct the context for AI reasoning
     */
    async buildContext(userPhone, userName, currentMessage) {
        try {
            const isSuperAdmin = await this.userRepo.isSuperAdminAsync(userPhone);
            // 1. Fetch live multi-pocket balances
            let totalBalance = 0;
            const pocketBalances = {};
            try {
                const multiWallet = await this.trxRepo.getMultiPocketBalances();
                totalBalance = multiWallet.totalBalance || 0;
                const pockets = multiWallet.pockets || {};
                for (const [pocketName, data] of Object.entries(pockets)) {
                    pocketBalances[pocketName] = data.balance || 0;
                }
            }
            catch (balErr) {
                logger.warn({ balErr }, "Failed to fetch live balance for context");
            }
            // 2. Fetch recent chat history (last 5 messages)
            const chatLogs = await this.chatRepo.getRecentChatHistory(userPhone, 5);
            const recentChatStrings = chatLogs.map((log) => `${log.direction === "inbound" ? "User" : "Asisten AI"}: ${log.content || ""}`);
            // 3. Fetch sample historical transactions for few-shot learning
            // We search by keywords from the user message or get the last 8 transactions
            let sampleTrxList = [];
            try {
                // Extract candidate keywords
                const cleanWords = currentMessage
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, "")
                    .split(/\s+/)
                    .filter((w) => w.length >= 3 && !["beli", "buat", "tadi", "tolong", "mau", "saya", "uang"].includes(w));
                const searchKeyword = cleanWords.length > 0 ? cleanWords[0] : "";
                if (searchKeyword) {
                    sampleTrxList = await this.trxRepo.searchTransactions({
                        keyword: searchKeyword,
                        limit: 5,
                    });
                }
                if (sampleTrxList.length < 5) {
                    const recentTrx = await this.trxRepo.getAllRecentTransactions(8);
                    // Deduplicate
                    const existingIds = new Set(sampleTrxList.map((t) => t.id));
                    for (const r of recentTrx) {
                        if (!existingIds.has(r.id)) {
                            sampleTrxList.push(r);
                        }
                    }
                }
            }
            catch (trxErr) {
                logger.warn({ trxErr }, "Failed to fetch sample historical transactions");
            }
            // Format historical examples
            const trxExamples = sampleTrxList.slice(0, 8).map((t) => {
                const typeSign = t.category?.startsWith("Pemasukan") ? "+" : "-";
                return `• [ID: ${t.id}] Toko/Sumber: "${t.merchant}" | Nominal: ${typeSign}${formatRupiah(t.total_amount)} | Kategori: "${t.category}" | Metode: "${t.payment_method || "Cash"}" | Teks Asli: "${t.raw_text || "-"}"`;
            });
            // 4. Format everything into a clean prompt context block
            let balanceSummary = `Total Saldo Kas: ${formatRupiah(totalBalance)}\n`;
            if (Object.keys(pocketBalances).length > 0) {
                balanceSummary += "Rincian per Rekening/Kantong:\n";
                for (const [pocket, bal] of Object.entries(pocketBalances)) {
                    balanceSummary += `  - ${pocket}: ${formatRupiah(bal)}\n`;
                }
            }
            const contextText = `
--- DATA USER & HAK AKSES ---
- Nama Pengguna: ${userName}
- Nomor WhatsApp: ${userPhone}
- Hak Akses: ${isSuperAdmin ? "SUPER ADMIN / OWNER" : "ANGGOTA OPERASIONAL"}

--- SALDO KAS REAL-TIME (SUMBER DATA SUPABASE) ---
${balanceSummary.trim()}

--- CONTOH TRANSAKSI NYATA SEBELUMNYA (SOURCE OF TRUTH) ---
${trxExamples.length > 0 ? trxExamples.join("\n") : "(Belum ada transaksi historis)"}

--- RIWAYAT PERCAKAPAN TERAKHIR DENGAN USER INI ---
${recentChatStrings.length > 0 ? recentChatStrings.join("\n") : "(Belum ada riwayat percakapan baru)"}
`.trim();
            return contextText;
        }
        catch (err) {
            logger.error({ err, userPhone }, "Exception constructing AI context");
            return `User: ${userName} (${userPhone})\nSaldo Kas: Rp 0`;
        }
    }
}
//# sourceMappingURL=context-builder.js.map