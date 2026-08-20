import { logger } from "../../utils/logger.js";
export class UserRepository {
    supabase;
    superAdminList;
    constructor(supabase, superAdminPhones) {
        this.supabase = supabase;
        if (Array.isArray(superAdminPhones)) {
            this.superAdminList = superAdminPhones.map((p) => this.cleanIdentifier(p));
        }
        else {
            this.superAdminList = (superAdminPhones || "").split(",").map((p) => this.cleanIdentifier(p)).filter(Boolean);
        }
    }
    cleanIdentifier(id) {
        return id.replace(/@s\.whatsapp\.net|@c\.us|@lid|@g\.us/g, "").replace(/[^0-9]/g, "");
    }
    async syncSuperAdminsFromDB() {
        try {
            const { data, error } = await this.supabase
                .from("users")
                .select("phone_number")
                .eq("role", "super_admin")
                .eq("status", "active");
            if (!error && data) {
                data.forEach((u) => {
                    this.addSuperAdminIdentifier(u.phone_number);
                });
                logger.info({ count: data.length, admins: this.superAdminList }, "Synced Super Admins from database");
            }
        }
        catch (err) {
            logger.warn({ err }, "Could not sync super admins from database");
        }
    }
    isSuperAdmin(identifier) {
        const cleaned = this.cleanIdentifier(identifier);
        return this.superAdminList.includes(cleaned);
    }
    async isSuperAdminAsync(identifier) {
        const cleaned = this.cleanIdentifier(identifier);
        if (this.superAdminList.includes(cleaned)) {
            return true;
        }
        const user = await this.getUser(cleaned);
        if (user && user.role === "super_admin") {
            this.addSuperAdminIdentifier(cleaned);
            return true;
        }
        return false;
    }
    addSuperAdminIdentifier(identifier) {
        const cleaned = this.cleanIdentifier(identifier);
        if (cleaned && !this.superAdminList.includes(cleaned)) {
            this.superAdminList.push(cleaned);
            logger.info({ identifier: cleaned }, "Added Super Admin identifier to active whitelist");
        }
    }
    async getUser(identifier, pushName) {
        const cleaned = this.cleanIdentifier(identifier);
        const { data, error } = await this.supabase
            .from("users")
            .select("*")
            .eq("phone_number", cleaned)
            .maybeSingle();
        if (error) {
            logger.error({ error, id: cleaned }, "Error fetching user from Supabase");
            return null;
        }
        if (data) {
            if (data.status === "blocked") {
                return data;
            }
            if (data.role === "super_admin") {
                this.addSuperAdminIdentifier(cleaned);
            }
            return data;
        }
        // If identifier is an unmapped WhatsApp LID (14-16 digits) and pushName is provided:
        // Check if there is an active user registered with matching name
        if (cleaned.length >= 14 && pushName && pushName.trim().length >= 2) {
            const cleanName = pushName.trim();
            const { data: nameMatch } = await this.supabase
                .from("users")
                .select("*")
                .eq("status", "active")
                .ilike("name", `%${cleanName}%`)
                .maybeSingle();
            if (nameMatch) {
                logger.info({ lid: cleaned, matchedUser: nameMatch.name, role: nameMatch.role }, "Auto-linking WhatsApp LID to registered user by name");
                const linkedUser = await this.upsertUser({
                    phone_number: cleaned,
                    name: nameMatch.name,
                    role: nameMatch.role,
                    status: "active",
                });
                return linkedUser;
            }
        }
        return null;
    }
    async isWhitelisted(identifier, pushName) {
        const cleaned = this.cleanIdentifier(identifier);
        if (this.isSuperAdmin(cleaned)) {
            return true;
        }
        const user = await this.getUser(cleaned, pushName);
        if (!user)
            return false;
        if (user.status === "blocked")
            return false;
        if (user.role === "super_admin") {
            this.addSuperAdminIdentifier(cleaned);
            return true;
        }
        return user.status === "active";
    }
    async upsertUser(user) {
        const cleaned = this.cleanIdentifier(user.phone_number);
        const payload = {
            ...user,
            phone_number: cleaned,
            role: user.role || (this.isSuperAdmin(cleaned) ? "super_admin" : "member"),
            status: user.status || "active",
            updated_at: new Date().toISOString(),
        };
        const { data, error } = await this.supabase
            .from("users")
            .upsert(payload, { onConflict: "phone_number" })
            .select()
            .single();
        if (error) {
            logger.error({ error, payload }, "Failed to upsert user");
            throw error;
        }
        if (payload.role === "super_admin") {
            this.addSuperAdminIdentifier(cleaned);
        }
        else {
            this.removeSuperAdminIdentifier(cleaned);
        }
        return data;
    }
    async listActiveUsers() {
        const { data, error } = await this.supabase
            .from("users")
            .select("*")
            .eq("status", "active")
            .order("created_at", { ascending: true });
        if (error) {
            logger.error({ error }, "Failed to list users");
            return [];
        }
        return (data || []);
    }
    removeSuperAdminIdentifier(identifier) {
        const cleaned = this.cleanIdentifier(identifier);
        this.superAdminList = this.superAdminList.filter((id) => id !== cleaned);
    }
    async setUserRole(phone, role) {
        const cleaned = this.cleanIdentifier(phone);
        const { data, error } = await this.supabase
            .from("users")
            .update({ role, updated_at: new Date().toISOString() })
            .eq("phone_number", cleaned)
            .select()
            .maybeSingle();
        if (error) {
            logger.error({ error, phone: cleaned, role }, "Failed to update user role");
            return null;
        }
        if (role === "super_admin") {
            this.addSuperAdminIdentifier(cleaned);
        }
        else {
            this.removeSuperAdminIdentifier(cleaned);
        }
        return data;
    }
    async setUserStatus(phone, status, name) {
        const cleaned = this.cleanIdentifier(phone);
        const updateData = { status, updated_at: new Date().toISOString() };
        if (name)
            updateData.name = name;
        const { error } = await this.supabase
            .from("users")
            .update(updateData)
            .eq("phone_number", cleaned);
        if (error) {
            logger.error({ error, phone: cleaned }, "Failed to set user status");
            return false;
        }
        return true;
    }
}
//# sourceMappingURL=user.repository.js.map