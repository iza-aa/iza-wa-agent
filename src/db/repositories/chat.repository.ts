import { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../utils/logger.js";

export interface ChatLogRecord {
  user_phone: string;
  user_name?: string;
  message_type: "text" | "image" | "audio" | "document";
  direction: "inbound" | "outbound";
  content?: string;
  metadata?: Record<string, any>;
}

export class ChatRepository {
  constructor(private supabase: SupabaseClient) {}

  async logMessage(log: ChatLogRecord): Promise<void> {
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

  async getRecentChatHistory(phone: string, limit = 5): Promise<ChatLogRecord[]> {
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
    return (data || []).reverse() as ChatLogRecord[];
  }
}
