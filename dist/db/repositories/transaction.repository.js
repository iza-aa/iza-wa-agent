import { logger } from "../../utils/logger.js";
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
        try {
            const { data, error } = await this.supabase
                .from("transactions")
                .select("id")
                .like("id", `${prefix}%`)
                .order("id", { ascending: false })
                .limit(1);
            if (!error && data && data.length > 0) {
                const lastId = data[0].id;
                const lastNumMatch = lastId.match(/(\d{3})$/);
                const lastNum = lastNumMatch ? parseInt(lastNumMatch[1], 10) : 0;
                const nextNum = String(lastNum + 1).padStart(3, "0");
                return `${prefix}${nextNum}`;
            }
        }
        catch (err) {
            logger.warn({ err }, "Could not determine last transaction sequence, starting from 001");
        }
        return `${prefix}001`;
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
        // 2. Format MonthLetter + Number (e.g. "H001" or "H1" or "A005")
        const letterMatch = cleaned.match(/^([A-L])(\d{1,3})$/);
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
            .insert(payload)
            .select()
            .single();
        if (error) {
            logger.error({ error, payload }, "Failed to insert transaction into Supabase");
            throw error;
        }
        if (items.length > 0) {
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
    async updateGSheetRow(trxId, rowIndex) {
        await this.supabase
            .from("transactions")
            .update({ gsheet_row_index: rowIndex, updated_at: new Date().toISOString() })
            .eq("id", trxId);
    }
    async getLatestTransaction() {
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            logger.error({ error }, "Failed to fetch latest transaction");
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
        const { data, error } = await this.supabase
            .from("transactions")
            .select("*")
            .gte("date", `${yearMonth}-01`)
            .lte("date", `${yearMonth}-31`)
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
}
//# sourceMappingURL=transaction.repository.js.map