import { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../utils/logger.js";

export interface PendingActionRecord {
  id: string;
  user_phone: string;
  user_name?: string;
  action_type: "CREATE_TRANSACTION" | "DELETE_TRANSACTION" | "UPDATE_BUDGET" | "MANAGE_USER" | string;
  payload: Record<string, any>;
  media_url?: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
  created_at?: string;
  expires_at?: string;
  resolved_at?: string;
}

export class PendingActionRepository {
  // In-memory fallback map in case Supabase table is not yet migrated or has transient connection lag
  private memoryDrafts: Map<string, PendingActionRecord> = new Map();

  constructor(private supabase: SupabaseClient) {}

  async createPendingAction(
    userPhone: string,
    userName: string,
    actionType: string,
    payload: Record<string, any>,
    mediaUrl?: string
  ): Promise<PendingActionRecord> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const tempId = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const draftRecord: PendingActionRecord = {
      id: tempId,
      user_phone: userPhone,
      user_name: userName,
      action_type: actionType,
      payload,
      media_url: mediaUrl,
      status: "PENDING",
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };

    // Store in memory cache
    this.memoryDrafts.set(userPhone, draftRecord);

    try {
      const { data, error } = await this.supabase
        .from("pending_agent_actions")
        .insert({
          user_phone: userPhone,
          user_name: userName,
          action_type: actionType,
          payload,
          media_url: mediaUrl,
          status: "PENDING",
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (!error && data) {
        draftRecord.id = data.id;
        this.memoryDrafts.set(userPhone, draftRecord);
        logger.info({ userPhone, draftId: data.id, actionType }, "Created pending agent action in Supabase");
        return data as PendingActionRecord;
      } else if (error) {
        logger.warn({ error, userPhone }, "Could not insert pending action into Supabase table, using memory cache fallback");
      }
    } catch (err) {
      logger.warn({ err, userPhone }, "Exception inserting pending action to Supabase, using memory cache fallback");
    }

    return draftRecord;
  }

  async getPendingByUser(userPhone: string): Promise<PendingActionRecord | null> {
    // 1. Try fetching from Supabase
    try {
      const { data, error } = await this.supabase
        .from("pending_agent_actions")
        .select("*")
        .eq("user_phone", userPhone)
        .eq("status", "PENDING")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        return data as PendingActionRecord;
      }
    } catch (err) {
      logger.debug({ err, userPhone }, "Supabase getPendingByUser fallback to memory cache");
    }

    // 2. Memory cache check
    const cached = this.memoryDrafts.get(userPhone);
    if (cached && cached.status === "PENDING") {
      const isExpired = cached.expires_at ? new Date(cached.expires_at).getTime() < Date.now() : false;
      if (!isExpired) {
        return cached;
      } else {
        cached.status = "EXPIRED";
        this.memoryDrafts.delete(userPhone);
      }
    }

    return null;
  }

  async confirmAction(id: string, userPhone?: string): Promise<boolean> {
    const resolvedAt = new Date().toISOString();

    if (userPhone && this.memoryDrafts.has(userPhone)) {
      const cached = this.memoryDrafts.get(userPhone)!;
      cached.status = "CONFIRMED";
      cached.resolved_at = resolvedAt;
      this.memoryDrafts.delete(userPhone);
    }

    try {
      const { error } = await this.supabase
        .from("pending_agent_actions")
        .update({ status: "CONFIRMED", resolved_at: resolvedAt })
        .eq("id", id);

      if (error) {
        logger.warn({ error, id }, "Failed to update pending action status to CONFIRMED in Supabase");
      }
      return true;
    } catch (err) {
      logger.warn({ err, id }, "Exception updating pending action in Supabase");
      return true;
    }
  }

  async cancelAction(id: string, userPhone?: string): Promise<boolean> {
    const resolvedAt = new Date().toISOString();

    if (userPhone && this.memoryDrafts.has(userPhone)) {
      const cached = this.memoryDrafts.get(userPhone)!;
      cached.status = "CANCELLED";
      cached.resolved_at = resolvedAt;
      this.memoryDrafts.delete(userPhone);
    }

    try {
      const { error } = await this.supabase
        .from("pending_agent_actions")
        .update({ status: "CANCELLED", resolved_at: resolvedAt })
        .eq("id", id);

      if (error) {
        logger.warn({ error, id }, "Failed to update pending action status to CANCELLED in Supabase");
      }
      return true;
    } catch (err) {
      logger.warn({ err, id }, "Exception updating pending action in Supabase");
      return true;
    }
  }

  async updatePayload(id: string, newPayload: Record<string, any>, userPhone?: string): Promise<boolean> {
    if (userPhone && this.memoryDrafts.has(userPhone)) {
      const cached = this.memoryDrafts.get(userPhone)!;
      cached.payload = { ...cached.payload, ...newPayload };
      cached.expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // refresh TTL
    }

    try {
      const { error } = await this.supabase
        .from("pending_agent_actions")
        .update({
          payload: newPayload,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .eq("id", id);

      if (error) {
        logger.warn({ error, id }, "Failed to update pending action payload in Supabase");
      }
      return true;
    } catch (err) {
      logger.warn({ err, id }, "Exception updating pending action payload in Supabase");
      return true;
    }
  }
}
