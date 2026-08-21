import { logger } from "../../utils/logger.js";
export class BudgetRepository {
    supabase;
    inMemoryBudgets = new Map();
    constructor(supabase) {
        this.supabase = supabase;
    }
    getMapKey(category, month) {
        return `${category.toLowerCase().trim()}_${month}`;
    }
    async upsertBudget(category, month, limitAmount) {
        const cleanCategory = category.trim();
        const mapKey = this.getMapKey(cleanCategory, month);
        const record = {
            category: cleanCategory,
            month,
            limit_amount: limitAmount,
            alert_threshold_percent: 80,
            is_alerted_80: false,
            is_alerted_100: false,
            updated_at: new Date().toISOString(),
        };
        // Save in-memory
        this.inMemoryBudgets.set(mapKey, record);
        try {
            const { data, error } = await this.supabase
                .from("budgets")
                .upsert({
                category: cleanCategory,
                month,
                limit_amount: limitAmount,
                updated_at: new Date().toISOString(),
            }, { onConflict: "category,month" })
                .select()
                .maybeSingle();
            if (error) {
                logger.warn({ error, category: cleanCategory, month }, "Could not upsert budget to Supabase, used in-memory");
            }
            else if (data) {
                return data;
            }
        }
        catch (err) {
            logger.warn({ err }, "Database table budgets not reachable, using in-memory");
        }
        return record;
    }
    async getBudgetsForMonth(month) {
        try {
            const { data, error } = await this.supabase
                .from("budgets")
                .select("*")
                .eq("month", month);
            if (!error && data && data.length > 0) {
                return data;
            }
        }
        catch (err) {
            logger.debug({ err }, "Fallback to in-memory budgets");
        }
        const results = [];
        for (const [key, val] of this.inMemoryBudgets.entries()) {
            if (val.month === month) {
                results.push(val);
            }
        }
        return results;
    }
    async getBudgetByCategory(category, month) {
        const cleanCat = category.toLowerCase().trim();
        try {
            const { data, error } = await this.supabase
                .from("budgets")
                .select("*")
                .eq("month", month);
            if (!error && data) {
                const found = data.find((b) => b.category.toLowerCase().includes(cleanCat) || cleanCat.includes(b.category.toLowerCase()));
                if (found)
                    return found;
            }
        }
        catch (err) {
            logger.debug({ err }, "Fallback to in-memory budget search");
        }
        for (const [key, val] of this.inMemoryBudgets.entries()) {
            if (val.month === month && (val.category.toLowerCase().includes(cleanCat) || cleanCat.includes(val.category.toLowerCase()))) {
                return val;
            }
        }
        return null;
    }
    async deleteBudget(category, month) {
        const cleanCat = category.trim();
        const mapKey = this.getMapKey(cleanCat, month);
        this.inMemoryBudgets.delete(mapKey);
        try {
            const { error } = await this.supabase
                .from("budgets")
                .delete()
                .eq("month", month)
                .ilike("category", `%${cleanCat}%`);
            return !error;
        }
        catch {
            return true;
        }
    }
    async markAlerted(category, month, level) {
        const mapKey = this.getMapKey(category, month);
        const existing = this.inMemoryBudgets.get(mapKey);
        if (existing) {
            if (level === 80)
                existing.is_alerted_80 = true;
            if (level === 100)
                existing.is_alerted_100 = true;
        }
        try {
            const updates = level === 80 ? { is_alerted_80: true } : { is_alerted_100: true };
            await this.supabase
                .from("budgets")
                .update(updates)
                .eq("month", month)
                .ilike("category", `%${category.trim()}%`);
        }
        catch (err) {
            logger.debug({ err }, "Could not update is_alerted flag in DB");
        }
    }
}
//# sourceMappingURL=budget.repository.js.map