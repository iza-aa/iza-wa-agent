import { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../utils/logger.js";

export interface RecurringBillRecord {
  id?: string;
  bill_name: string;
  amount: number;
  due_day: number; // 1 - 31
  category?: string;
  payment_method?: string;
  reminder_days_before?: number;
  last_paid_period?: string; // 'YYYY-MM'
  status?: string; // 'active' | 'paused'
  created_at?: string;
  updated_at?: string;
}

export class BillRepository {
  private inMemoryBills: Map<string, RecurringBillRecord> = new Map();

  constructor(private supabase: SupabaseClient) {}

  async createBill(bill: {
    bill_name: string;
    amount: number;
    due_day: number;
    category?: string;
    payment_method?: string;
    reminder_days_before?: number;
  }): Promise<RecurringBillRecord> {
    const cleanName = bill.bill_name.trim();
    const record: RecurringBillRecord = {
      bill_name: cleanName,
      amount: bill.amount,
      due_day: bill.due_day,
      category: bill.category || "Tagihan & Utilitas",
      payment_method: bill.payment_method || "Cash",
      reminder_days_before: bill.reminder_days_before || 3,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.inMemoryBills.set(cleanName.toLowerCase(), record);

    try {
      const { data, error } = await this.supabase
        .from("recurring_bills")
        .insert(record)
        .select()
        .maybeSingle();

      if (!error && data) {
        return data as RecurringBillRecord;
      }
    } catch (err) {
      logger.warn({ err }, "Database table recurring_bills not reachable, using in-memory");
    }

    return record;
  }

  async listActiveBills(): Promise<RecurringBillRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from("recurring_bills")
        .select("*")
        .eq("status", "active")
        .order("due_day", { ascending: true });

      if (!error && data && data.length > 0) {
        return data as RecurringBillRecord[];
      }
    } catch (err) {
      logger.debug({ err }, "Fallback to in-memory bills");
    }

    return Array.from(this.inMemoryBills.values()).filter((b) => b.status === "active");
  }

  async getBillByName(name: string): Promise<RecurringBillRecord | null> {
    const cleanName = name.toLowerCase().trim();

    try {
      const { data, error } = await this.supabase
        .from("recurring_bills")
        .select("*")
        .ilike("bill_name", `%${cleanName}%`)
        .maybeSingle();

      if (!error && data) return data as RecurringBillRecord;
    } catch (err) {
      logger.debug({ err }, "Fallback to in-memory bill lookup");
    }

    for (const [key, val] of this.inMemoryBills.entries()) {
      if (key.includes(cleanName) || cleanName.includes(key)) {
        return val;
      }
    }

    return null;
  }

  async markBillPaid(billName: string, period: string): Promise<boolean> {
    const cleanName = billName.toLowerCase().trim();
    const existing = this.inMemoryBills.get(cleanName);
    if (existing) {
      existing.last_paid_period = period;
      existing.updated_at = new Date().toISOString();
    }

    try {
      const { error } = await this.supabase
        .from("recurring_bills")
        .update({ last_paid_period: period, updated_at: new Date().toISOString() })
        .ilike("bill_name", `%${cleanName}%`);

      return !error;
    } catch {
      return true;
    }
  }

  async deleteBill(billName: string): Promise<boolean> {
    const cleanName = billName.toLowerCase().trim();
    this.inMemoryBills.delete(cleanName);

    try {
      const { error } = await this.supabase
        .from("recurring_bills")
        .delete()
        .ilike("bill_name", `%${cleanName}%`);

      return !error;
    } catch {
      return true;
    }
  }
}
