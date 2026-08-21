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
        const user = await this.getUser(cleaned);
        if (user) {
            if (user.status === "blocked") {
                this.removeSuperAdminIdentifier(cleaned);
                return false;
            }
            if (user.role === "super_admin" && user.status === "active") {
                this.addSuperAdminIdentifier(cleaned);
                return true;
            }
            this.removeSuperAdminIdentifier(cleaned);
            return false;
        }
        return this.superAdminList.includes(cleaned);
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
                this.removeSuperAdminIdentifier(cleaned);
                return data;
            }
            if (data.role === "super_admin") {
                this.addSuperAdminIdentifier(cleaned);
            }
            return data;
        }
        // If identifier is an unmapped WhatsApp LID (14-16 digits) and pushName is provided:
        // Search for a matching active user by comparing individual words of pushName against DB user names
        if (cleaned.length >= 14 && pushName && pushName.trim().length >= 2) {
            // Fetch all users with normal phone numbers (< 15 digits)
            const { data: dbUsers } = await this.supabase
                .from("users")
                .select("*")
                .lt("phone_number", "100000000000000");
            if (dbUsers && dbUsers.length > 0) {
                const pushNameLower = pushName.trim().toLowerCase();
                const pushNameWords = pushNameLower.split(/\s+/).filter((w) => w.length >= 2);
                const match = dbUsers.find((u) => {
                    const dbNameLower = u.name.toLowerCase().trim();
                    const dbNameWords = dbNameLower.split(/\s+/).filter((w) => w.length >= 2);
                    return (pushNameLower.includes(dbNameLower) ||
                        dbNameLower.includes(pushNameLower) ||
                        dbNameWords.some((dbWord) => pushNameWords.includes(dbWord)));
                });
                if (match) {
                    logger.info({ lid: cleaned, pushName, matchedUser: match.name, matchedPhone: match.phone_number, status: match.status, role: match.role }, "Auto-linking WhatsApp LID to registered user by name match");
                    const linkedUser = await this.upsertUser({
                        phone_number: cleaned,
                        name: match.name,
                        role: match.role,
                        status: match.status,
                    });
                    return linkedUser;
                }
            }
        }
        return null;
    }
    async getOrCreateUser(identifier, pushName) {
        const cleaned = this.cleanIdentifier(identifier);
        let user = await this.getUser(cleaned, pushName);
        if (!user) {
            const isSuper = this.isSuperAdmin(cleaned);
            const displayName = pushName && pushName.trim().length > 1 && pushName !== "." && pushName !== "User"
                ? pushName.trim()
                : isSuper
                    ? "Super Admin"
                    : "Member";
            user = await this.upsertUser({
                phone_number: cleaned,
                name: displayName,
                role: isSuper ? "super_admin" : "member",
                status: "active",
            });
        }
        return user;
    }
    async isWhitelisted(identifier, pushName) {
        const cleaned = this.cleanIdentifier(identifier);
        const user = await this.getUser(cleaned, pushName);
        if (user) {
            if (user.status === "blocked") {
                this.removeSuperAdminIdentifier(cleaned);
                return false;
            }
            return true;
        }
        return true; // Allow new members to record transactions, while admin commands remain locked
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
        if (payload.status === "blocked") {
            this.removeSuperAdminIdentifier(cleaned);
        }
        else if (payload.role === "super_admin") {
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
        if (status === "blocked") {
            this.removeSuperAdminIdentifier(cleaned);
        }
        const { data: targetUser } = await this.supabase
            .from("users")
            .select("*")
            .eq("phone_number", cleaned)
            .maybeSingle();
        if (targetUser && status === "blocked") {
            await this.supabase
                .from("users")
                .update(updateData)
                .or(`phone_number.eq.${cleaned},name.eq."${targetUser.name}"`);
        }
        else {
            await this.supabase
                .from("users")
                .update(updateData)
                .eq("phone_number", cleaned);
        }
        return true;
    }
}
//# sourceMappingURL=user.repository.js.map