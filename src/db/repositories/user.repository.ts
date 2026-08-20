import { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../utils/logger.js";

export interface UserRecord {
  phone_number: string;
  name: string;
  role: "super_admin" | "admin" | "member";
  status: "active" | "pending" | "blocked";
  target_sheet_id?: string;
  created_at?: string;
  updated_at?: string;
}

export class UserRepository {
  private superAdminList: string[];

  constructor(
    private supabase: SupabaseClient,
    superAdminPhones: string | string[]
  ) {
    if (Array.isArray(superAdminPhones)) {
      this.superAdminList = superAdminPhones.map((p) => this.cleanIdentifier(p));
    } else {
      this.superAdminList = (superAdminPhones || "").split(",").map((p) => this.cleanIdentifier(p)).filter(Boolean);
    }
  }

  cleanIdentifier(id: string): string {
    return id.replace(/@s\.whatsapp\.net|@c\.us|@lid|@g\.us/g, "").replace(/[^0-9]/g, "");
  }

  async syncSuperAdminsFromDB(): Promise<void> {
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
    } catch (err) {
      logger.warn({ err }, "Could not sync super admins from database");
    }
  }

  isSuperAdmin(identifier: string): boolean {
    const cleaned = this.cleanIdentifier(identifier);
    return this.superAdminList.includes(cleaned);
  }

  addSuperAdminIdentifier(identifier: string): void {
    const cleaned = this.cleanIdentifier(identifier);
    if (cleaned && !this.superAdminList.includes(cleaned)) {
      this.superAdminList.push(cleaned);
      logger.info({ identifier: cleaned }, "Added Super Admin identifier to active whitelist");
    }
  }

  async getUser(identifier: string): Promise<UserRecord | null> {
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

    if (data && data.role === "super_admin") {
      this.addSuperAdminIdentifier(cleaned);
    }

    return data as UserRecord | null;
  }

  async isWhitelisted(identifier: string): Promise<boolean> {
    const cleaned = this.cleanIdentifier(identifier);
    if (this.isSuperAdmin(cleaned)) {
      return true;
    }

    const user = await this.getUser(cleaned);
    if (user && user.role === "super_admin") {
      this.addSuperAdminIdentifier(cleaned);
      return true;
    }
    return !!(user && user.status === "active");
  }

  async upsertUser(user: Partial<UserRecord> & { phone_number: string; name: string }): Promise<UserRecord | null> {
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
    return data as UserRecord;
  }

  async listActiveUsers(): Promise<UserRecord[]> {
    const { data, error } = await this.supabase
      .from("users")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) {
      logger.error({ error }, "Failed to list users");
      return [];
    }
    return (data || []) as UserRecord[];
  }

  removeSuperAdminIdentifier(identifier: string): void {
    const cleaned = this.cleanIdentifier(identifier);
    this.superAdminList = this.superAdminList.filter((id) => id !== cleaned);
  }

  async setUserRole(phone: string, role: "super_admin" | "admin" | "member"): Promise<UserRecord | null> {
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
    } else {
      this.removeSuperAdminIdentifier(cleaned);
    }

    return data as UserRecord | null;
  }

  async setUserStatus(phone: string, status: "active" | "blocked" | "pending", name?: string): Promise<boolean> {
    const cleaned = this.cleanIdentifier(phone);
    const updateData: any = { status, updated_at: new Date().toISOString() };
    if (name) updateData.name = name;

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
