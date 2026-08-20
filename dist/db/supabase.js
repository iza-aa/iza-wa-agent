import { createClient } from "@supabase/supabase-js";
// @ts-ignore
import WebSocket from "ws";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
// Polyfill WebSocket for Node.js environments
if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = WebSocket;
}
let clientInstance = null;
export function getSupabaseClient() {
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
//# sourceMappingURL=supabase.js.map