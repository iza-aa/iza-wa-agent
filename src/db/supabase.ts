import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    logger.info({ url: config.SUPABASE_URL }, "Initializing Supabase Client");
    clientInstance = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return clientInstance;
}
