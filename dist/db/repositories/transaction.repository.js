import { logger } from "../../utils/logger.js";
export class TransactionRepository {
    supabase;
    constructor(supabase) {
        this.supabase = supabase;
    }
    generateTransactionId() {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `TRX-${today}-${randomHex}`;
    }
    async createTransaction(trx, items = []) {
        const trxId = trx.id || this.generateTransactionId();
        const payload = {
            ...trx,
            id: trxId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
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
    async deleteTransaction(id) {
        const { data: existing, error: getErr } = await this.supabase
            .from("transactions")
            .select("*")
            .eq("id", id)
            .maybeSingle();
        if (getErr || !existing) {
            logger.warn({ id, getErr }, "Transaction not found for deletion");
            return null;
        }
        // Delete receipt items first
        await this.supabase.from("receipt_items").delete().eq("transaction_id", id);
        // Delete transaction
        const { error: delErr } = await this.supabase
            .from("transactions")
            .delete()
            .eq("id", id);
        if (delErr) {
            logger.error({ delErr, id }, "Failed to delete transaction from Supabase");
            return null;
        }
        logger.info({ id }, "Transaction deleted from database");
        return existing;
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
            return { total: 0, count: 0, byCategory: {}, byUser: {}, topTransactions: [] };
        }
        let total = 0;
        const byCategory = {};
        const byUser = {};
        for (const trx of data) {
            const amount = Number(trx.total_amount) || 0;
            total += amount;
            const cat = trx.category || "Lain-lain";
            byCategory[cat] = (byCategory[cat] || 0) + amount;
            const user = trx.user_name || trx.user_phone;
            byUser[user] = (byUser[user] || 0) + amount;
        }
        return {
            total,
            count: data.length,
            byCategory,
            byUser,
            topTransactions: data.slice(0, 3),
        };
    }
}
//# sourceMappingURL=transaction.repository.js.map