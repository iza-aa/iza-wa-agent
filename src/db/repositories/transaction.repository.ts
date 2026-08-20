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
}
