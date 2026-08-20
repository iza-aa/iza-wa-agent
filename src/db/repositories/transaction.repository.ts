import { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../utils/logger.js";

export interface TransactionItem {
  item_name: string;
  qty: number;
  price: number;
  total_price: number;
  category?: string;
}

export interface TransactionRecord {
  id: string;
  user_phone: string;
  user_name: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  category: string;
  subtotal: number;
  tax: number;
  discount: number;
  total_amount: number;
  payment_method?: string;
  raw_text?: string;
  gdrive_file_id?: string;
  gdrive_web_view_link?: string;
  gdrive_download_link?: string;
  gsheet_row_index?: number;
  status?: string;
  confidence_score?: number;
  created_at?: string;
  updated_at?: string;
}

export class TransactionRepository {
  constructor(private supabase: SupabaseClient) {}

  generateTransactionId(): string {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TRX-${today}-${randomHex}`;
  }

  async createTransaction(
    trx: Omit<TransactionRecord, "id"> & { id?: string },
    items: TransactionItem[] = []
  ): Promise<TransactionRecord> {
    const trxId = trx.id || this.generateTransactionId();
    const payload: TransactionRecord = {
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

    return data as TransactionRecord;
  }

  async getRecentTransactions(phone: string, limit = 5): Promise<TransactionRecord[]> {
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
    return (data || []) as TransactionRecord[];
  }

  async updateGSheetRow(trxId: string, rowIndex: number): Promise<void> {
    await this.supabase
      .from("transactions")
      .update({ gsheet_row_index: rowIndex, updated_at: new Date().toISOString() })
      .eq("id", trxId);
  }

  async getLatestTransaction(): Promise<TransactionRecord | null> {
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
    return data as TransactionRecord | null;
  }

  async deleteTransaction(id: string): Promise<TransactionRecord | null> {
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
    return existing as TransactionRecord;
  }

  async getMonthlySummary(yearMonth: string): Promise<{
    total: number;
    count: number;
    byCategory: { [cat: string]: number };
    byUser: { [user: string]: number };
    topTransactions: TransactionRecord[];
  }> {
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
    const byCategory: { [cat: string]: number } = {};
    const byUser: { [user: string]: number } = {};

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
      topTransactions: data.slice(0, 3) as TransactionRecord[],
    };
  }
}
