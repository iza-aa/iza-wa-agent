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
}
//# sourceMappingURL=transaction.repository.js.map