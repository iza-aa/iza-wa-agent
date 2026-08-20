import { logger } from "../../utils/logger.js";
export class ChatRepository {
    supabase;
    constructor(supabase) {
        this.supabase = supabase;
    }
    async logMessage(log) {
        const { error } = await this.supabase
            .from("chat_logs")
            .insert({
            ...log,
            created_at: new Date().toISOString(),
        });
        if (error) {
            logger.warn({ error, log }, "Failed to save chat log to Supabase");
        }
    }
    async getRecentChatHistory(phone, limit = 5) {
        const { data, error } = await this.supabase
            .from("chat_logs")
            .select("*")
            .eq("user_phone", phone)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) {
            logger.error({ error, phone }, "Failed to fetch chat history");
            return [];
        }
        return (data || []).reverse();
    }
}
//# sourceMappingURL=chat.repository.js.map