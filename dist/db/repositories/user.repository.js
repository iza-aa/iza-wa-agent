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
    getRawIdentifier(id) {
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
        // 1. Check by direct phone_number
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
            if (data.role === "super_admin" && data.status === "active") {
                this.addSuperAdminIdentifier(cleaned);
            }
            return data;
        }
        // 2. Check if this identifier is an attached LID (stored in target_sheet_id column)
        const { data: lidUser } = await this.supabase
            .from("users")
            .select("*")
            .eq("target_sheet_id", cleaned)
            .maybeSingle();
        if (lidUser) {
            return lidUser;
        }
        // 3. If identifier is an unmapped WhatsApp LID (14-16 digits) and pushName is provided:
        // Dynamically match against registered users and ATTACH LID to that 1 user row
        if (cleaned.length >= 14 && pushName && pushName.trim().length >= 2) {
            const { data: dbUsers } = await this.supabase
                .from("users")
                .select("*")
                .eq("status", "active");
            const normalUsers = (dbUsers || []).filter((u) => u.phone_number.length <= 13);
            if (normalUsers.length > 0) {
                const pushNameLower = pushName.trim().toLowerCase();
                const pushNameWords = pushNameLower.split(/\s+/).filter((w) => w.length >= 2);
                // Helper to extract phonetic consonant skeleton (e.g. jeki -> zk, zaky -> zk, c -> k)
                const consonantSkeleton = (str) => str
                    .toLowerCase()
                    .replace(/j/g, "z")
                    .replace(/c/g, "k")
                    .replace(/q/g, "k")
                    .replace(/x/g, "s")
                    .replace(/[aeiou]/g, "")
                    .replace(/[^a-z0-9]/g, "");
                const pushSkeletons = pushNameWords.map(consonantSkeleton).filter(Boolean);
                const match = normalUsers.find((u) => {
                    const dbNameLower = u.name.toLowerCase().trim();
                    const dbNameWords = dbNameLower.split(/\s+/).filter((w) => w.length >= 2);
                    const dbSkeletons = dbNameWords.map(consonantSkeleton).filter(Boolean);
                    // Direct substring match
                    const directMatch = pushNameLower.includes(dbNameLower) ||
                        dbNameLower.includes(pushNameLower) ||
                        dbNameWords.some((dbWord) => pushNameWords.includes(dbWord));
                    // Phonetic consonant skeleton match (e.g. jeki [zk] == zaky [zk])
                    const skeletonMatch = dbSkeletons.some((ds) => pushSkeletons.some((ps) => ds === ps || (ds.length >= 2 && ps.includes(ds)) || (ps.length >= 2 && ds.includes(ps))));
                    // If this user has no LID yet and only 1 unlinked user exists in DB
                    const unlinkedUsers = normalUsers.filter((du) => !du.target_sheet_id);
                    const isSingleUnlinked = unlinkedUsers.length === 1 && unlinkedUsers[0].phone_number === u.phone_number;
                    return directMatch || skeletonMatch || isSingleUnlinked;
                });
                if (match) {
                    logger.info({ lid: cleaned, pushName, matchedUser: match.name, matchedPhone: match.phone_number }, "Dynamically linking incoming WhatsApp LID to registered user record");
                    // Store the LID into the user's single row (target_sheet_id)
                    await this.supabase
                        .from("users")
                        .update({ target_sheet_id: cleaned, updated_at: new Date().toISOString() })
                        .eq("phone_number", match.phone_number);
                    match.target_sheet_id = cleaned;
                    return match;
                }
            }
        }
        return null;
    }
    async getOrCreateUser(identifier, pushName) {
        const cleaned = this.cleanIdentifier(identifier);
        let user = await this.getUser(cleaned, pushName);
        if (!user && this.isSuperAdmin(cleaned)) {
            user = await this.upsertUser({
                phone_number: cleaned,
                name: "Super Admin",
                role: "super_admin",
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
            return user.status === "active";
        }
        // Unregistered numbers are not allowed
        return false;
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
    async setUserStatus(target, status, name) {
        const rawTarget = target.trim();
        let cleanedPhone = this.cleanIdentifier(rawTarget);
        if (cleanedPhone.startsWith("0"))
            cleanedPhone = "62" + cleanedPhone.slice(1);
        const updateData = { status, updated_at: new Date().toISOString() };
        if (name)
            updateData.name = name;
        if (status === "blocked" && cleanedPhone) {
            this.removeSuperAdminIdentifier(cleanedPhone);
        }
        // Fetch all users to match against phone or name or linked LID
        const { data: allUsers } = await this.supabase.from("users").select("*");
        const matched = (allUsers || []).filter((u) => {
            const matchPhone = cleanedPhone && cleanedPhone.length >= 4 && (u.phone_number === cleanedPhone || u.phone_number.includes(cleanedPhone));
            const matchName = rawTarget.length >= 2 && u.name.toLowerCase().includes(rawTarget.toLowerCase());
            const matchLid = u.target_sheet_id === cleanedPhone;
            return matchPhone || matchName || matchLid;
        });
        const affected = [];
        for (const u of matched) {
            if (status === "blocked") {
                // User requested: Yang diblokir langsung HAPUS dari tabel users!
                await this.supabase.from("users").delete().eq("phone_number", u.phone_number);
                this.removeSuperAdminIdentifier(u.phone_number);
            }
            else {
                await this.supabase.from("users").update(updateData).eq("phone_number", u.phone_number);
            }
            affected.push({ ...u, ...updateData });
        }
        return { success: affected.length > 0, affectedUsers: affected };
    }
}
//# sourceMappingURL=user.repository.js.map