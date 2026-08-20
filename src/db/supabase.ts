import { createClient, SupabaseClient } from "@supabase/supabase-js";
// @ts-ignore
import WebSocket from "ws";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

// Polyfill WebSocket for Node.js environments
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

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
