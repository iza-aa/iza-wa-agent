import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();
const envSchema = z.object({
    GEMINI_API_KEYS: z.string().min(1).transform((val) => val.split(",").map((k) => k.trim()).filter(Boolean)),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPER_ADMIN_PHONE: z.string().min(5).transform((val) => val.split(",").map((p) => p.replace(/[^0-9]/g, "")).filter(Boolean)),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
    GOOGLE_PRIVATE_KEY: z.string().min(1).transform((val) => val.replace(/\\n/g, "\n")),
    GOOGLE_SHEET_ID: z.string().min(1),
    GOOGLE_DRIVE_FOLDER_ID: z.string().min(1),
    GOOGLE_APPS_SCRIPT_URL: z.string().url().optional().or(z.literal("")),
    PORT: z.string().optional().default("3000"),
    NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
});
export function parseEnv(rawEnv = process.env) {
    const result = envSchema.safeParse(rawEnv);
    if (!result.success) {
        const errorMsg = result.error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join(", ");
        throw new Error(`Environment configuration validation error: ${errorMsg}`);
    }
    return result.data;
}
export const config = parseEnv(process.env);
//# sourceMappingURL=env.js.map