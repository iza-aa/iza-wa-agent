import { logger } from "../../utils/logger.js";
export class BillRepository {
    supabase;
    inMemoryBills = new Map();
    constructor(supabase) {
        this.supabase = supabase;
    }
    async createBill(bill) {
        const cleanName = bill.bill_name.trim();
        const record = {
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
                return data;
            }
        }
        catch (err) {
            logger.warn({ err }, "Database table recurring_bills not reachable, using in-memory");
        }
        return record;
    }
    async listActiveBills() {
        try {
            const { data, error } = await this.supabase
                .from("recurring_bills")
                .select("*")
                .eq("status", "active")
                .order("due_day", { ascending: true });
            if (!error && data && data.length > 0) {
                return data;
            }
        }
        catch (err) {
            logger.debug({ err }, "Fallback to in-memory bills");
        }
        return Array.from(this.inMemoryBills.values()).filter((b) => b.status === "active");
    }
    async getBillByName(name) {
        const cleanName = name.toLowerCase().trim();
        try {
            const { data, error } = await this.supabase
                .from("recurring_bills")
                .select("*")
                .ilike("bill_name", `%${cleanName}%`)
                .maybeSingle();
            if (!error && data)
                return data;
        }
        catch (err) {
            logger.debug({ err }, "Fallback to in-memory bill lookup");
        }
        for (const [key, val] of this.inMemoryBills.entries()) {
            if (key.includes(cleanName) || cleanName.includes(key)) {
                return val;
            }
        }
        return null;
    }
    async markBillPaid(billName, period) {
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
        }
        catch {
            return true;
        }
    }
    async deleteBill(billName) {
        const cleanName = billName.toLowerCase().trim();
        this.inMemoryBills.delete(cleanName);
        try {
            const { error } = await this.supabase
                .from("recurring_bills")
                .delete()
                .ilike("bill_name", `%${cleanName}%`);
            return !error;
        }
        catch {
            return true;
        }
    }
}
//# sourceMappingURL=bill.repository.js.map