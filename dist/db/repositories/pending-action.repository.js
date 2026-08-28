import { logger } from "../../utils/logger.js";
export class PendingActionRepository {
    supabase;
    // In-memory fallback map in case Supabase table is not yet migrated or has transient connection lag
    memoryDrafts = new Map();
    constructor(supabase) {
        this.supabase = supabase;
    }
    async createPendingAction(userPhone, userName, actionType, payload, mediaUrl) {
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const tempId = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const draftRecord = {
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
                return data;
            }
            else if (error) {
                logger.warn({ error, userPhone }, "Could not insert pending action into Supabase table, using memory cache fallback");
            }
        }
        catch (err) {
            logger.warn({ err, userPhone }, "Exception inserting pending action to Supabase, using memory cache fallback");
        }
        return draftRecord;
    }
    async getPendingByUser(userPhone) {
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
                return data;
            }
        }
        catch (err) {
            logger.debug({ err, userPhone }, "Supabase getPendingByUser fallback to memory cache");
        }
        // 2. Memory cache check
        const cached = this.memoryDrafts.get(userPhone);
        if (cached && cached.status === "PENDING") {
            const isExpired = cached.expires_at ? new Date(cached.expires_at).getTime() < Date.now() : false;
            if (!isExpired) {
                return cached;
            }
            else {
                cached.status = "EXPIRED";
                this.memoryDrafts.delete(userPhone);
            }
        }
        return null;
    }
    async confirmAction(id, userPhone) {
        const resolvedAt = new Date().toISOString();
        if (userPhone && this.memoryDrafts.has(userPhone)) {
            const cached = this.memoryDrafts.get(userPhone);
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
        }
        catch (err) {
            logger.warn({ err, id }, "Exception updating pending action in Supabase");
            return true;
        }
    }
    async cancelAction(id, userPhone) {
        const resolvedAt = new Date().toISOString();
        if (userPhone && this.memoryDrafts.has(userPhone)) {
            const cached = this.memoryDrafts.get(userPhone);
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
        }
        catch (err) {
            logger.warn({ err, id }, "Exception updating pending action in Supabase");
            return true;
        }
    }
    async updatePayload(id, newPayload, userPhone) {
        if (userPhone && this.memoryDrafts.has(userPhone)) {
            const cached = this.memoryDrafts.get(userPhone);
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
        }
        catch (err) {
            logger.warn({ err, id }, "Exception updating pending action payload in Supabase");
            return true;
        }
    }
}
//# sourceMappingURL=pending-action.repository.js.map