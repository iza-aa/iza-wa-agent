import { logger } from "../../utils/logger.js";
import { googleSheetsService } from "../../google/sheets.service.js";
export function isIncome(trx) {
    return (trx.type === "income" ||
        trx.status === "income" ||
        !!(trx.category && trx.category.toLowerCase().startsWith("pemasukan")));
}
const MONTH_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
export class TransactionRepository {
    supabase;
    constructor(supabase) {
        this.supabase = supabase;
    }
    async generateTransactionId(dateStr) {
        const targetDate = dateStr ? new Date(dateStr) : new Date();
        const yearStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" })
            .format(targetDate)
            .slice(0, 4);
        const monthStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" })
            .format(targetDate)
            .slice(5, 7);
        const monthIdx = parseInt(monthStr, 10) - 1;
        const monthLetter = MONTH_LETTERS[monthIdx] || "H";
        // Format: T026-H
        const yearPrefix = "T" + yearStr.slice(-3);
        const prefix = `${yearPrefix}-${monthLetter}`;
        // 1. Get highest sequence number from Supabase Database
        let lastNumDB = 0;
        try {
            const { data, error } = await this.supabase
                .from("transactions")
                .select("id")
                .like("id", `${prefix}%`);
            if (!error && data && data.length > 0) {
                for (const row of data) {
                    const match = (row.id || "").match(/(\d+)$/);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num) && num > lastNumDB) {
                            lastNumDB = num;
                        }
                    }
                }
            }
        }
        catch (err) {
            logger.warn({ err }, "Could not determine last sequence from Supabase");
        }
        // 2. Get highest sequence number from Google Sheets (Transaksi Column A)
        let lastNumSheet = 0;
        try {
            lastNumSheet = await googleSheetsService.getHighestTransactionSequence(prefix);
        }
        catch (sheetErr) {
            logger.warn({ sheetErr }, "Could not determine last sequence from Sheets");
        }
        // 3. Collision-free: Take the mathematical maximum of both sources + 1
        const maxExisting = Math.max(lastNumDB, lastNumSheet);
        const nextNum = String(maxExisting + 1).padStart(3, "0");
        return `${prefix}${nextNum}`;
    }
    async findTransactionByIdOrShortCode(query) {
        if (!query)
            return null;
        const cleaned = query.trim().toUpperCase().replace(/^#/, "");
        // 1. Direct exact match (e.g. "T026-H001" or legacy "TRX-...")
        const { data: exactMatch } = await this.supabase
            .from("transactions")
            .select("*")
            .eq("id", cleaned)
            .maybeSingle();
        if (exactMatch)
            return exactMatch;
        const today = new Date();
        const currentYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" })
            .format(today)
            .slice(0, 4);
        const currentYearPrefix = "T" + currentYear.slice(-3);
        const currentMonthIdx = parseInt(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(today).slice(5, 7), 10) - 1;
        const currentMonthLetter = MONTH_LETTERS[currentMonthIdx] || "H";
        // 2. Format MonthLetter + Number (e.g. "H001", "H-118", "H 118", "A005")
        const letterMatch = cleaned.match(/^([A-L])[-_\s]?(\d{1,3})$/);
        if (letterMatch) {
            const letter = letterMatch[1];
            const num = letterMatch[2].padStart(3, "0");
            const targetId = `${currentYearPrefix}-${letter}${num}`;
            const { data: match } = await this.supabase
                .from("transactions")
                .select("*")
                .eq("id", targetId)
                .maybeSingle();
            if (match)
                return match;
            // Fallback search suffix
            const { data: suffixMatch } = await this.supabase
                .from("transactions")
                .select("*")
                .ilike("id", `%${letter}${num}`)
                .maybeSingle();
            if (suffixMatch)
                return suffixMatch;
        }
        // 3. Pure Number in Current Month (e.g. "1" -> "T026-H001", "001" -> "T026-H001")
        const pureNumMatch = cleaned.match(/^(\d{1,3})$/);
        if (pureNumMatch) {
            const num = pureNumMatch[1].padStart(3, "0");
            const targetId = `${currentYearPrefix}-${currentMonthLetter}${num}`;
            const { data: match } = await this.supabase
                .from("transactions")
                .select("*")
                .eq("id", targetId)
                .maybeSingle();
            if (match)
                return match;
        }
        return null;
    }
    async createTransaction(trx, items = []) {
        const trxId = trx.id || (await this.generateTransactionId(trx.date));
        const isInc = isIncome(trx);
        const payload = {
            ...trx,
            status: isInc ? "income" : (trx.status || "recorded"),
            id: trxId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        delete payload.type;
        const { data, error } = await this.supabase
            .from("transactions")
            .upsert(payload, { onConflict: "id" })
            .select()
            .single();
        if (error) {
            logger.error({ error, payload }, "Failed to insert transaction into Supabase");
            throw error;
        }
        if (!isInc && items.length > 0) {
            const itemsPayload = items.map((it) => ({
                transaction_id: trxId,
                item_name: it.item_name,
                qty: it.qty || 1,
                price: it.price,
                total_price: it.total_price || (it.qty || 1) * it.price,
                category: it.category || trx.category,
            }));
            const { error: itemsError } = await this.supabase
                .from("receipt_items")
                .insert(itemsPayload);
            if (itemsError) {
                logger.error({ itemsError, trxId }, "Failed to insert receipt items");
            }
        }
        return data;
    }
    async getRecentTransactions(phone, limit = 5) {
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .eq("user_phone", phone)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) {
            logger.error({ error, phone }, "Failed to fetch recent transactions");
            return [];
        }
        return (data || []);
    }
    async getAllRecentTransactions(limit = 10) {
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) {
            logger.error({ error }, "Failed to fetch all recent transactions");
            return [];
        }
        return (data || []);
    }
    async getTransactionsByDateRange(startDate, endDate) {
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .gte("date", startDate)
            .lte("date", endDate)
            .order("date", { ascending: true })
            .order("created_at", { ascending: true });
        if (error) {
            logger.error({ error, startDate, endDate }, "Failed to fetch transactions by date range");
            return [];
        }
        return (data || []);
    }
    async updateGSheetRow(trxId, rowIndex) {
        await this.supabase
            .from("transactions")
            .update({ gsheet_row_index: rowIndex, updated_at: new Date().toISOString() })
            .eq("id", trxId);
    }
    async getLatestTransaction(userPhone) {
        let query = this.supabase
            .from("transactions")
            .select("*")
            .order("created_at", { ascending: false });
        if (userPhone) {
            query = query.eq("user_phone", userPhone);
        }
        const { data, error } = await query.limit(1).maybeSingle();
        if (error) {
            logger.error({ error, userPhone }, "Failed to fetch latest transaction");
            return null;
        }
        return data;
    }
    async getTransactionWithItems(id) {
        const trx = await this.findTransactionByIdOrShortCode(id);
        if (!trx) {
            logger.warn({ id }, "Transaction not found");
            return null;
        }
        const realId = trx.id;
        const { data: items, error: itemsErr } = await this.supabase
            .from("receipt_items")
            .select("*")
            .eq("transaction_id", realId);
        if (itemsErr) {
            logger.error({ itemsErr, id: realId }, "Failed to fetch transaction items");
        }
        return {
            trx: trx,
            items: (items || []),
        };
    }
    async addTransactionItems(transactionId, items) {
        if (!items || items.length === 0)
            return [];
        const trx = await this.findTransactionByIdOrShortCode(transactionId);
        if (!trx) {
            throw new Error(`Transaksi dengan ID ${transactionId} tidak ditemukan.`);
        }
        const realId = trx.id;
        const itemsPayload = items.map((it) => {
            const dept = it.department || it.category || trx.category || "Kafe";
            const unitSuffix = it.unit && it.unit !== "unit" ? ` (${it.qty || 1} ${it.unit})` : "";
            const nameWithUnit = it.item_name.includes("(") ? it.item_name : `${it.item_name}${unitSuffix}`;
            return {
                transaction_id: realId,
                item_name: nameWithUnit,
                qty: it.qty || 1,
                price: it.price,
                total_price: it.total_price || (it.qty || 1) * it.price,
                category: dept,
            };
        });
        const { data, error } = await this.supabase
            .from("receipt_items")
            .insert(itemsPayload)
            .select();
        if (error) {
            logger.error({ error, trxId: realId }, "Failed to add transaction items");
            throw error;
        }
        return (data || []);
    }
    async deleteTransactionItems(transactionId) {
        const trx = await this.findTransactionByIdOrShortCode(transactionId);
        if (!trx)
            return;
        const { error } = await this.supabase
            .from("receipt_items")
            .delete()
            .eq("transaction_id", trx.id);
        if (error) {
            logger.error({ error, trxId: trx.id }, "Failed to delete receipt items");
        }
    }
    async getAllReceiptItems() {
        const { data, error } = await this.supabase
            .from("receipt_items")
            .select("*")
            .order("created_at", { ascending: true });
        if (error) {
            logger.error({ error }, "Failed to fetch all receipt items");
            return [];
        }
        return (data || []);
    }
    async updateTransaction(id, updates) {
        const trx = await this.findTransactionByIdOrShortCode(id);
        if (!trx) {
            logger.warn({ id }, "Transaction not found for update");
            return null;
        }
        const realId = trx.id;
        const payload = {
            ...updates,
            updated_at: new Date().toISOString(),
        };
        const { data, error } = await this.supabase
            .from("transactions")
            .update(payload)
            .eq("id", realId)
            .select()
            .maybeSingle();
        if (error) {
            logger.error({ error, id: realId, updates }, "Failed to update transaction in Supabase");
            return null;
        }
        return data;
    }
    async deleteTransaction(id) {
        const existing = await this.findTransactionByIdOrShortCode(id);
        if (!existing) {
            logger.warn({ id }, "Transaction not found for deletion");
            return null;
        }
        const realId = existing.id;
        // Delete receipt items first
        await this.supabase.from("receipt_items").delete().eq("transaction_id", realId);
        // Delete transaction
        const { error: delErr } = await this.supabase
            .from("transactions")
            .delete()
            .eq("id", realId);
        if (delErr) {
            logger.error({ delErr, id: realId }, "Failed to delete transaction from Supabase");
            return null;
        }
        logger.info({ id: realId }, "Transaction deleted from database");
        return existing;
    }
    async getWalletBalance() {
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*");
        const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" })
            .format(new Date())
            .substring(0, 7);
        if (error || !data) {
            logger.error({ error }, "Failed to fetch transactions for wallet balance");
            return {
                totalIncome: 0,
                totalExpense: 0,
                balance: 0,
                monthIncome: 0,
                monthExpense: 0,
                monthBalance: 0,
                currentMonth,
            };
        }
        let totalIncome = 0;
        let totalExpense = 0;
        let monthIncome = 0;
        let monthExpense = 0;
        for (const trx of data) {
            const amount = Number(trx.total_amount) || 0;
            const isInc = isIncome(trx);
            const isThisMonth = trx.date && trx.date.startsWith(currentMonth);
            if (isInc) {
                totalIncome += amount;
                if (isThisMonth)
                    monthIncome += amount;
            }
            else {
                totalExpense += amount;
                if (isThisMonth)
                    monthExpense += amount;
            }
        }
        return {
            totalIncome,
            totalExpense,
            balance: totalIncome - totalExpense,
            monthIncome,
            monthExpense,
            monthBalance: monthIncome - monthExpense,
            currentMonth,
        };
    }
    async getMonthlySummary(yearMonth) {
        let normalizedYearMonth = yearMonth;
        const parts = yearMonth.split("-");
        if (parts.length === 2) {
            normalizedYearMonth = `${parts[0]}-${parts[1].padStart(2, "0")}`;
        }
        const [yearStr, monthStr] = normalizedYearMonth.split("-");
        const yearNum = parseInt(yearStr, 10) || new Date().getFullYear();
        const monthNum = parseInt(monthStr, 10) || 1;
        const lastDay = new Date(yearNum, monthNum, 0).getDate();
        const endDate = `${normalizedYearMonth}-${lastDay.toString().padStart(2, "0")}`;
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .gte("date", `${normalizedYearMonth}-01`)
            .lte("date", endDate)
            .order("total_amount", { ascending: false });
        if (error || !data) {
            logger.error({ error, yearMonth }, "Failed to fetch monthly transactions");
            return { total: 0, totalExpense: 0, totalIncome: 0, netCashflow: 0, count: 0, byCategory: {}, byUser: {}, topTransactions: [] };
        }
        let totalExpense = 0;
        let totalIncome = 0;
        const byCategory = {};
        const byUser = {};
        for (const trx of data) {
            const amount = Number(trx.total_amount) || 0;
            if (isIncome(trx)) {
                totalIncome += amount;
            }
            else {
                totalExpense += amount;
                const cat = trx.category || "Lain-lain";
                byCategory[cat] = (byCategory[cat] || 0) + amount;
            }
            const user = trx.user_name || trx.user_phone;
            byUser[user] = (byUser[user] || 0) + amount;
        }
        return {
            total: totalExpense,
            totalExpense,
            totalIncome,
            netCashflow: totalIncome - totalExpense,
            count: data.length,
            byCategory,
            byUser,
            topTransactions: data.filter((t) => !isIncome(t)).slice(0, 3),
        };
    }
    async getMultiPocketBalances() {
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*");
        if (error || !data) {
            logger.error({ error }, "Failed to fetch transactions for multi-pocket balances");
            return { totalBalance: 0, totalIncome: 0, totalExpense: 0, pockets: {} };
        }
        const pockets = {};
        let totalIncome = 0;
        let totalExpense = 0;
        for (const trx of data) {
            const amount = Number(trx.total_amount) || 0;
            let method = (trx.payment_method || "Cash").trim();
            if (!method)
                method = "Cash";
            if (!pockets[method]) {
                pockets[method] = { income: 0, expense: 0, balance: 0 };
            }
            if (isIncome(trx)) {
                totalIncome += amount;
                pockets[method].income += amount;
                pockets[method].balance += amount;
            }
            else {
                totalExpense += amount;
                pockets[method].expense += amount;
                pockets[method].balance -= amount;
            }
        }
        return {
            totalBalance: totalIncome - totalExpense,
            totalIncome,
            totalExpense,
            pockets,
        };
    }
    async getDailyTransactionsSummary(dateStr) {
        const targetDate = dateStr || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .eq("date", targetDate)
            .order("created_at", { ascending: true });
        if (error || !data) {
            logger.error({ error, targetDate }, "Failed to fetch daily transactions");
            return { date: targetDate, count: 0, totalIncome: 0, totalExpense: 0, netCashflow: 0, transactions: [] };
        }
        let totalIncome = 0;
        let totalExpense = 0;
        for (const trx of data) {
            const amount = Number(trx.total_amount) || 0;
            if (isIncome(trx)) {
                totalIncome += amount;
            }
            else {
                totalExpense += amount;
            }
        }
        return {
            date: targetDate,
            count: data.length,
            totalIncome,
            totalExpense,
            netCashflow: totalIncome - totalExpense,
            transactions: data,
        };
    }
    async findRecentSimilarTransaction(amount, merchant, minutesWindow = 10) {
        const windowStart = new Date(Date.now() - minutesWindow * 60 * 1000).toISOString();
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .gte("created_at", windowStart)
            .eq("total_amount", amount)
            .order("created_at", { ascending: false })
            .limit(5);
        if (error || !data || data.length === 0) {
            return null;
        }
        const cleanMerchant = (merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const item of data) {
            const itemMerchant = (item.merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if (cleanMerchant === itemMerchant ||
                cleanMerchant.includes(itemMerchant) ||
                itemMerchant.includes(cleanMerchant)) {
                return item;
            }
        }
        // If nominal matches exactly within window, flag it
        return data[0];
    }
    async searchTransactions(filters) {
        let query = this.supabase
            .from("transactions")
            .select("*")
            .order("date", { ascending: false })
            .order("created_at", { ascending: false });
        if (filters.userPhone) {
            query = query.eq("user_phone", filters.userPhone);
        }
        if (filters.start_date) {
            query = query.gte("date", filters.start_date);
        }
        if (filters.end_date) {
            query = query.lte("date", filters.end_date);
        }
        if (filters.category) {
            query = query.ilike("category", `%${filters.category}%`);
        }
        if (filters.merchant) {
            query = query.ilike("merchant", `%${filters.merchant}%`);
        }
        if (filters.payment_method) {
            query = query.ilike("payment_method", `%${filters.payment_method}%`);
        }
        const fetchLimit = Math.max(filters.limit || 30, 100);
        query = query.limit(fetchLimit);
        const { data, error } = await query;
        if (error || !data) {
            logger.error({ error, filters }, "Failed to search transactions");
            return [];
        }
        let results = data;
        // If keyword filter is provided, do fuzzy match across id, merchant, category, raw_text, and payment_method
        if (filters.keyword) {
            const kw = filters.keyword.toLowerCase().trim();
            results = results.filter((t) => {
                const id = (t.id || "").toLowerCase();
                const m = (t.merchant || "").toLowerCase();
                const c = (t.category || "").toLowerCase();
                const r = (t.raw_text || "").toLowerCase();
                const p = (t.payment_method || "").toLowerCase();
                return id.includes(kw) || m.includes(kw) || c.includes(kw) || r.includes(kw) || p.includes(kw);
            });
        }
        // If trx_type filter is provided
        if (filters.trx_type) {
            results = results.filter((t) => {
                const isInc = isIncome(t);
                return filters.trx_type === "income" ? isInc : !isInc;
            });
        }
        const maxReturn = filters.limit || 30;
        return results.slice(0, maxReturn);
    }
}
//# sourceMappingURL=transaction.repository.js.map