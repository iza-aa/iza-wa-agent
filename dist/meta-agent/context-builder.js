import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { config } from "../config/env.js";
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
     * Performs an instant real-time audit between transactions and receipt items, including division totals
     */
    async getAuditData() {
        try {
            const { data: trxs } = await this.supabase
                .from("transactions")
                .select("id, merchant, total_amount, date, category")
                .order("date", { ascending: false });
            const { data: items } = await this.supabase
                .from("receipt_items")
                .select("transaction_id, total_price, category, department");
            const departmentTotals = {
                Dapur: 0,
                Barista: 0,
                Kasir: 0,
                Waiters: 0,
                Kafe: 0,
            };
            const itemSums = {};
            for (const it of items || []) {
                const dept = (it.department || it.category || "Kafe").trim();
                const price = Number(it.total_price) || 0;
                departmentTotals[dept] = (departmentTotals[dept] || 0) + price;
                if (it.transaction_id) {
                    itemSums[it.transaction_id] = (itemSums[it.transaction_id] || 0) + price;
                }
            }
            let totalTrxExpense = 0;
            let totalItemsExpense = 0;
            const unitemized = [];
            const mismatched = [];
            for (const t of trxs || []) {
                const isInc = t.category?.startsWith("Pemasukan");
                if (!isInc) {
                    const trxAmount = Number(t.total_amount) || 0;
                    totalTrxExpense += trxAmount;
                    const itemsTotal = itemSums[t.id] || 0;
                    totalItemsExpense += itemsTotal;
                    if (!itemSums[t.id] || itemsTotal === 0) {
                        unitemized.push({
                            id: t.id,
                            merchant: t.merchant,
                            date: t.date,
                            amount: trxAmount,
                            category: t.category,
                        });
                    }
                    else if (Math.abs(itemsTotal - trxAmount) > 1) {
                        mismatched.push({
                            id: t.id,
                            merchant: t.merchant,
                            date: t.date,
                            trxAmount,
                            itemsTotal,
                            diff: trxAmount - itemsTotal,
                        });
                    }
                }
            }
            return {
                totalTrxExpense,
                totalItemsExpense,
                difference: totalTrxExpense - totalItemsExpense,
                departmentTotals,
                unitemized,
                mismatched,
            };
        }
        catch (err) {
            logger.error({ err }, "Failed to compute audit data");
            return {
                totalTrxExpense: 0,
                totalItemsExpense: 0,
                difference: 0,
                departmentTotals: {},
                unitemized: [],
                mismatched: [],
            };
        }
    }
    /**
     * Computes Month-to-date and Today financial summaries
     */
    async getFinancialAggregates(todayStr, monthStr) {
        try {
            const { data: trxs } = await this.supabase
                .from("transactions")
                .select("id, merchant, total_amount, date, category")
                .order("date", { ascending: false });
            let monthIncome = 0;
            let monthExpense = 0;
            let todayIncome = 0;
            let todayExpense = 0;
            const categoryTotals = {};
            const todayTrx = [];
            for (const t of trxs || []) {
                const amt = Number(t.total_amount) || 0;
                const isInc = t.category?.startsWith("Pemasukan");
                const tDate = t.date || "";
                if (tDate.startsWith(monthStr)) {
                    if (isInc) {
                        monthIncome += amt;
                    }
                    else {
                        monthExpense += amt;
                        const cat = t.category || "Operasional";
                        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
                    }
                }
                if (tDate === todayStr) {
                    if (isInc) {
                        todayIncome += amt;
                    }
                    else {
                        todayExpense += amt;
                    }
                    todayTrx.push({
                        id: t.id,
                        merchant: t.merchant,
                        amount: amt,
                        type: isInc ? "Pemasukan" : "Pengeluaran",
                        category: t.category,
                    });
                }
            }
            return {
                monthIncome,
                monthExpense,
                monthNet: monthIncome - monthExpense,
                categoryTotals,
                todayIncome,
                todayExpense,
                todayTrx,
            };
        }
        catch (err) {
            logger.error({ err }, "Failed to compute financial aggregates");
            return {
                monthIncome: 0,
                monthExpense: 0,
                monthNet: 0,
                categoryTotals: {},
                todayIncome: 0,
                todayExpense: 0,
                todayTrx: [],
            };
        }
    }
    /**
     * Resolves requested yearMonth from user text if specified (e.g. "agustus" -> "2026-08", "bulan lalu" -> previous month)
     */
    resolveRequestedMonth(currentMessage, currentYearMonth) {
        const text = currentMessage.toLowerCase();
        const [currYearStr, currMonthStr] = currentYearMonth.split("-");
        const currentYear = parseInt(currYearStr, 10);
        const currentMonth = parseInt(currMonthStr, 10);
        const monthNames = {
            januari: 1, jan: 1, january: 1,
            februari: 2, feb: 2, february: 2,
            maret: 3, mar: 3, march: 3,
            april: 4, apr: 4,
            mei: 5, may: 5,
            juni: 6, jun: 6, june: 6,
            juli: 7, jul: 7, july: 7,
            agustus: 8, agu: 8, agt: 8, august: 8,
            september: 9, sep: 9,
            oktober: 10, okt: 10, oct: 10, october: 10,
            november: 11, nov: 11,
            desember: 12, des: 12, dec: 12, december: 12,
        };
        if (text.includes("bulan lalu") || text.includes("kemarin")) {
            const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
            const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
            return `${prevYear}-${prevMonth.toString().padStart(2, "0")}`;
        }
        for (const [name, mNum] of Object.entries(monthNames)) {
            const regex = new RegExp(`\\b${name}\\b`, "i");
            if (regex.test(text)) {
                // If year is also mentioned, e.g. "agustus 2025" or "agustus 2026"
                const yearMatch = text.match(/\b(202[0-9])\b/);
                const targetYear = yearMatch ? parseInt(yearMatch[1], 10) : currentYear;
                return `${targetYear}-${mNum.toString().padStart(2, "0")}`;
            }
        }
        return currentYearMonth;
    }
    /**
     * Fetches live database records from all 7 Supabase tables to construct rich context
     */
    async buildContext(userPhone, userName, currentMessage) {
        try {
            const isSuperAdmin = await this.userRepo.isSuperAdminAsync(userPhone);
            const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
            const currentMonthStr = todayStr.slice(0, 7); // YYYY-MM
            const requestedMonthStr = this.resolveRequestedMonth(currentMessage, currentMonthStr);
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
            // 2. Fetch real-time Financial Aggregates for both Current Month and Requested Month
            const currentAggregates = await this.getFinancialAggregates(todayStr, currentMonthStr);
            const targetAggregates = requestedMonthStr === currentMonthStr
                ? currentAggregates
                : await this.getFinancialAggregates(todayStr, requestedMonthStr);
            // 3. Fetch real-time Audit Data & Division Totals
            const audit = await this.getAuditData();
            // 4. Fetch ALL Registered Users from 'users' table
            let allUsersSummary = "";
            try {
                const { data: usersList } = await this.supabase
                    .from("users")
                    .select("phone_number, name, role, status")
                    .order("name", { ascending: true });
                if (usersList && usersList.length > 0) {
                    allUsersSummary = usersList
                        .map((u) => `• ${u.name} (WA: +${u.phone_number}) — Role: ${u.role === "super_admin" ? "Super Admin" : "Member"} [Status: ${u.status}]`)
                        .join("\n");
                }
                else {
                    allUsersSummary = "(Belum ada data user)";
                }
            }
            catch (uErr) {
                allUsersSummary = `• ${userName} (+${userPhone})`;
            }
            // 5. Fetch Budgets & Bills
            let budgetsSummary = "Belum ada batas anggaran aktif.";
            try {
                const { data: budgets } = await this.supabase.from("budgets").select("*");
                if (budgets && budgets.length > 0) {
                    budgetsSummary = budgets
                        .map((b) => `• Kategori ${b.category}: Limit ${formatRupiah(b.monthly_limit)}`)
                        .join("\n");
                }
            }
            catch { }
            let billsSummary = "Belum ada tagihan rutin terdaftar.";
            try {
                const { data: bills } = await this.supabase.from("bills").select("*");
                if (bills && bills.length > 0) {
                    billsSummary = bills
                        .map((b) => `• ${b.name}: ${formatRupiah(b.amount)} (Jatuh tempo tgl ${b.due_day}, Status: ${b.is_paid ? "LUNAS" : "BELUM BAYAR"})`)
                        .join("\n");
                }
            }
            catch { }
            // 6. Fetch Pending Actions Status
            let pendingActionsSummary = "Tidak ada draf transaksi yang sedang tertunda.";
            try {
                const { data: pendingActions } = await this.supabase
                    .from("pending_agent_actions")
                    .select("*")
                    .order("created_at", { ascending: false })
                    .limit(3);
                if (pendingActions && pendingActions.length > 0) {
                    const activePending = pendingActions.filter((p) => p.status === "PENDING");
                    if (activePending.length > 0) {
                        pendingActionsSummary = activePending
                            .map((p) => `• Draf Aktif: ${p.action_type} oleh ${p.user_name} (${p.user_phone}) — Payload: ${JSON.stringify(p.payload)}`)
                            .join("\n");
                    }
                    else {
                        const lastResolved = pendingActions[0];
                        pendingActionsSummary = `Saat ini TIDAK ADA draf PENDING aktif. Transaksi terakhir (${lastResolved.action_type} - ID: ${lastResolved.id}) sudah berstatus ${lastResolved.status}.`;
                    }
                }
            }
            catch { }
            // 7. Fetch recent chat history (last 6 messages)
            const chatLogs = await this.chatRepo.getRecentChatHistory(userPhone, 6);
            const recentChatStrings = chatLogs.map((log) => `${log.direction === "inbound" ? "User" : "Asisten AI"}: ${log.content || ""}`);
            // 8. Inspect if a specific transaction ID was mentioned (e.g. H120, H123, T026-H120)
            const idMatch = currentMessage.match(/T0\d{2}-[A-L]\d{3}|[A-L]\d{3}|\b\d{3}\b/i);
            let targetedTrxDetail = "";
            if (idMatch) {
                try {
                    const rawMatch = idMatch[0].toUpperCase();
                    const target = await this.trxRepo.getTransactionWithItems(rawMatch);
                    if (target && target.trx) {
                        const targetTrx = target.trx;
                        const targetItems = target.items || [];
                        targetedTrxDetail = `\n--- DETAIL TRANSAKSI YANG DITANYAKAN (${targetTrx.id}) ---\n` +
                            `• Merchant: ${targetTrx.merchant} | Tanggal: ${targetTrx.date} | Total: ${formatRupiah(targetTrx.total_amount)} | Metode: ${targetTrx.payment_method} | Kategori: ${targetTrx.category}\n` +
                            `• Rincian Item (${targetItems.length} item):\n` +
                            (targetItems.length > 0
                                ? targetItems.map((it) => `  - ${it.item_name} (${it.qty} ${it.unit || "unit"}) = ${formatRupiah(it.total_price)} [${it.department || "Kafe"}]`).join("\n")
                                : "  (Belum ada rincian item barang)");
                    }
                }
                catch (findErr) {
                    logger.debug({ findErr }, "Targeted transaction lookup note");
                }
            }
            // 9. Fetch sample recent & searched transactions
            let sampleTrxList = [];
            try {
                const cleanWords = currentMessage
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, "")
                    .split(/\s+/)
                    .filter((w) => w.length >= 3 && !["beli", "buat", "tadi", "tolong", "mau", "saya", "uang", "audit", "cek", "selisih", "user", "siapa", "dapur", "barista"].includes(w));
                const searchKeyword = cleanWords.length > 0 ? cleanWords[0] : "";
                if (searchKeyword) {
                    sampleTrxList = await this.trxRepo.searchTransactions({
                        keyword: searchKeyword,
                        limit: 6,
                    });
                }
                if (sampleTrxList.length < 6) {
                    const recentTrx = await this.trxRepo.getAllRecentTransactions(10);
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
            const trxExamples = sampleTrxList.slice(0, 10).map((t) => {
                const typeSign = t.category?.startsWith("Pemasukan") ? "+" : "-";
                return `• [ID: ${t.id}] ${t.date} | "${t.merchant}" | ${typeSign}${formatRupiah(t.total_amount)} | Kat: "${t.category}" | Metode: "${t.payment_method || "Cash"}" | Input: "${t.raw_text || "-"}"`;
            });
            // 10. Format balance block
            let balanceSummary = `Total Saldo Kas: ${formatRupiah(totalBalance)}\n`;
            if (Object.keys(pocketBalances).length > 0) {
                balanceSummary += "Rincian per Rekening/Kantong:\n";
                for (const [pocket, bal] of Object.entries(pocketBalances)) {
                    balanceSummary += `  - ${pocket}: ${formatRupiah(bal)}\n`;
                }
            }
            // 11. Format Monthly Summary
            const topExpenseCategories = Object.entries(targetAggregates.categoryTotals)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([c, v]) => `  - ${c}: ${formatRupiah(v)}`)
                .join("\n");
            let monthlyFinancialSummary = `• Periode: Bulan ${requestedMonthStr}\n` +
                `• Total Pemasukan: ${formatRupiah(targetAggregates.monthIncome)}\n` +
                `• Total Pengeluaran: ${formatRupiah(targetAggregates.monthExpense)}\n` +
                `• Arus Kas Bersih (Net Cashflow): ${formatRupiah(targetAggregates.monthNet)} (${targetAggregates.monthNet >= 0 ? "Surplus" : "Defisit"})\n` +
                (topExpenseCategories ? `• Kategori Pengeluaran Terbesar:\n${topExpenseCategories}` : "");
            // 12. Format Today's Summary
            let todaySummaryText = `• Tanggal: ${todayStr}\n` +
                `• Pemasukan Hari Ini: ${formatRupiah(currentAggregates.todayIncome)}\n` +
                `• Pengeluaran Hari Ini: ${formatRupiah(currentAggregates.todayExpense)}\n`;
            if (currentAggregates.todayTrx.length > 0) {
                todaySummaryText += `• Transaksi Terjadi Hari Ini (${currentAggregates.todayTrx.length} trx):\n` +
                    currentAggregates.todayTrx.map((t) => `  - [${t.id}] ${t.type}: ${t.merchant} (${formatRupiah(t.amount)})`).join("\n");
            }
            else {
                todaySummaryText += `• (Belum ada transaksi yang dicatat hari ini)`;
            }
            // 13. Format Audit Data
            let auditSummary = `Total Pengeluaran di Tabset Transaksi: ${formatRupiah(audit.totalTrxExpense)}\n` +
                `Total Pengeluaran di Tabset Rincian Belanja: ${formatRupiah(audit.totalItemsExpense)}\n` +
                `Selisih: ${formatRupiah(audit.difference)}\n\n`;
            if (audit.unitemized.length > 0) {
                auditSummary += `👉 Transaksi Pengeluaran yang BELUM DIRINCI (${audit.unitemized.length} transaksi):\n`;
                audit.unitemized.slice(0, 10).forEach((u) => {
                    auditSummary += `  • [${u.id}] ${u.date} - ${u.merchant}: ${formatRupiah(u.amount)} (Kategori: ${u.category})\n`;
                });
            }
            else {
                auditSummary += `👉 Tidak ada transaksi pengeluaran yang belum dirinci.\n`;
            }
            if (audit.mismatched.length > 0) {
                auditSummary += `\n👉 Transaksi dengan TOTAL RINCIAN BERBEDA dari Total Transaksi (${audit.mismatched.length} transaksi):\n`;
                audit.mismatched.slice(0, 10).forEach((m) => {
                    auditSummary += `  • [${m.id}] ${m.date} - ${m.merchant}: Total Trx ${formatRupiah(m.trxAmount)} vs Total Rincian ${formatRupiah(m.itemsTotal)} (Selisih: ${formatRupiah(m.diff)})\n`;
                });
            }
            // 14. Department breakdown summary
            let deptSummary = "Total Pengeluaran per Divisi (dari Tabset Rincian Belanja & Dashboard):\n";
            for (const [dept, total] of Object.entries(audit.departmentTotals)) {
                deptSummary += `• ${dept}: ${formatRupiah(total)}\n`;
            }
            const contextText = `
--- DATA USER PENGIRIM CHAT ---
- Nama: ${userName}
- Nomor WhatsApp: ${userPhone}
- Hak Akses: ${isSuperAdmin ? "SUPER ADMIN / OWNER" : "ANGGOTA OPERASIONAL"}

--- SALDO KAS REAL-TIME (SUMBER DATA SUPABASE) ---
${balanceSummary.trim()}

--- RINGKASAN KEUANGAN PERIODE TARGET (${requestedMonthStr}) ---
${monthlyFinancialSummary.trim()}

--- RINGKASAN TRANSAKSI HARI INI (${todayStr}) ---
${todaySummaryText.trim()}

--- REKAP PENGELUARAN PER DIVISI OPERASIONAL ---
${deptSummary.trim()}

--- DATA AUDIT & REKONSILIASI KAS REAL-TIME ---
${auditSummary.trim()}
${targetedTrxDetail}

--- DAFTAR ANGGOTA TIM TERDAFTAR (TABEL USERS) ---
${allUsersSummary}

--- STATUS DRAF TRANSAKSI TERAKHIR (TABEL PENDING_AGENT_ACTIONS) ---
${pendingActionsSummary}

--- TAUTAN SISTEM RESMI ---
• Google Spreadsheet Utama: https://docs.google.com/spreadsheets/d/${config.GOOGLE_SHEET_ID}/edit
• Google Drive Folder Nota: https://drive.google.com/drive/folders/${config.GOOGLE_DRIVE_FOLDER_ID}

--- ANGGARAN & TAGIHAN RUTIN (TABEL BUDGETS & BILLS) ---
• Anggaran: ${budgetsSummary}
• Tagihan: ${billsSummary}

--- 10 TRANSAKSI TERBARU (SOURCE OF TRUTH) ---
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