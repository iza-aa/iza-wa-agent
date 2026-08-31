import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
// @ts-ignore
import WebSocket from "ws";
if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = WebSocket;
}
import http from "http";
import { createWhatsAppBot } from "./bot/client.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { googleSheetsService } from "./google/sheets.service.js";
import { googleDriveService } from "./google/drive.service.js";
import { metaApiClient } from "./meta-agent/meta-api.client.js";
import { metaWebhookHandler } from "./meta-agent/meta-webhook.handler.js";
import { evolutionWebhookHandler } from "./meta-agent/evolution-webhook.handler.js";
async function bootstrap() {
    console.log("=================================================");
    console.log("🚀 STARTING IZA-WA-AGENT (SUPERCHARGED AI ASSISTANT)");
    console.log("=================================================");
    logger.info({
        superAdmin: config.SUPER_ADMIN_PHONE,
        geminiKeysCount: config.GEMINI_API_KEYS.length,
        supabaseUrl: config.SUPABASE_URL,
        googleSheetId: config.GOOGLE_SHEET_ID,
        googleDriveFolderId: config.GOOGLE_DRIVE_FOLDER_ID,
        metaPhoneId: config.META_PHONE_NUMBER_ID || undefined,
    }, "App configuration validated");
    // 1. Start Mini HTTP Server for Cloud Health Checks, Sheets Webhooks & Meta Webhook
    const port = process.env.PORT || config.PORT || 3000;
    const server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url || "/", `http://localhost:${port}`);
        if (parsedUrl.pathname === "/health" || parsedUrl.pathname === "/") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "online", service: "iza-wa-agent", timestamp: new Date().toISOString() }));
        }
        else if (parsedUrl.pathname === "/api/meta-webhook" && req.method === "GET") {
            const challenge = metaApiClient.verifyWebhook(parsedUrl.searchParams);
            if (challenge) {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end(challenge);
            }
            else {
                res.writeHead(403, { "Content-Type": "text/plain" });
                res.end("Forbidden");
            }
        }
        else if (parsedUrl.pathname === "/api/meta-webhook" && req.method === "POST") {
            let bodyStr = "";
            req.on("data", (chunk) => {
                bodyStr += chunk;
            });
            req.on("end", async () => {
                try {
                    const jsonBody = JSON.parse(bodyStr || "{}");
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "ok" }));
                    await metaWebhookHandler.handleIncomingWebhook(jsonBody);
                }
                catch (err) {
                    logger.error({ err }, "Error processing incoming Meta webhook body");
                    if (!res.headersSent) {
                        res.writeHead(400);
                        res.end();
                    }
                }
            });
        }
        else if (parsedUrl.pathname === "/api/evolution-webhook" && req.method === "POST") {
            let bodyStr = "";
            req.on("data", (chunk) => {
                bodyStr += chunk;
            });
            req.on("end", async () => {
                try {
                    const jsonBody = JSON.parse(bodyStr || "{}");
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "ok" }));
                    await evolutionWebhookHandler.handleIncomingWebhook(jsonBody);
                }
                catch (err) {
                    logger.error({ err }, "Error processing incoming Evolution webhook body");
                    if (!res.headersSent) {
                        res.writeHead(400);
                        res.end();
                    }
                }
            });
        }
        else if (parsedUrl.pathname === "/api/sheets-webhook" && (req.method === "POST" || req.method === "GET")) {
            logger.info("Received realtime webhook trigger from Google Sheets");
            try {
                const { getSupabaseClient } = await import("./db/supabase.js");
                const { TransactionRepository } = await import("./db/repositories/transaction.repository.js");
                const supabase = getSupabaseClient();
                const trxRepo = new TransactionRepository(supabase);
                const result = await googleSheetsService.syncFromSheetToDatabase(trxRepo);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, synced: result.syncedCount, timestamp: new Date().toISOString() }));
            }
            catch (err) {
                logger.error({ err }, "Error processing sheets webhook");
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, error: err?.message || "Sync failed" }));
            }
        }
        else {
            res.writeHead(404);
            res.end();
        }
    });
    server.listen(port, () => {
        logger.info({ port }, "HTTP Server is listening for health checks, sheets webhooks, and Meta webhooks");
    });
    // 2. Ensure Supabase Storage Bucket for Receipts
    try {
        logger.info("Verifying Supabase Storage Bucket for receipts...");
        await googleDriveService.ensureSupabaseBucket();
        logger.info("Supabase Storage Bucket verified successfully");
    }
    catch (bucketErr) {
        logger.warn({ bucketErr }, "Could not auto-verify Supabase Storage Bucket");
    }
    // 3. Initialize Google Sheet headers if not present
    try {
        logger.info("Verifying Google Sheet initialization...");
        await googleSheetsService.ensureSheetInitialized();
        logger.info("Google Sheet verified successfully");
    }
    catch (sheetErr) {
        logger.warn({ sheetErr }, "Warning: Could not initialize Google Sheet automatically. Verify Service Account permissions.");
    }
    // 4. Initialize WhatsApp Bot Client
    const bot = createWhatsAppBot();
    await bot.start();
    // 5. Initialize Background Scheduler Service (Nightly Recap & Reminders)
    try {
        const { getSupabaseClient } = await import("./db/supabase.js");
        const { TransactionRepository } = await import("./db/repositories/transaction.repository.js");
        const { UserRepository } = await import("./db/repositories/user.repository.js");
        const { BillRepository } = await import("./db/repositories/bill.repository.js");
        const { SchedulerService } = await import("./services/scheduler.service.js");
        const supabase = getSupabaseClient();
        const trxRepo = new TransactionRepository(supabase);
        const userRepo = new UserRepository(supabase, config.SUPER_ADMIN_PHONE);
        const billRepo = new BillRepository(supabase);
        await userRepo.syncSuperAdminsFromDB();
        const scheduler = new SchedulerService(trxRepo, userRepo, billRepo);
        scheduler.start();
        logger.info("Background Scheduler Service is active and monitoring daily schedule");
        // Periodic Background Auto-Sync Google Sheets -> Supabase every 3 minutes
        setInterval(async () => {
            try {
                await googleSheetsService.syncFromSheetToDatabase(trxRepo);
                logger.debug("Automatic periodic Google Sheets -> Supabase sync completed");
            }
            catch (autoSyncErr) {
                logger.warn({ autoSyncErr }, "Periodic auto-sync encountered an issue");
            }
        }, 3 * 60 * 1000);
    }
    catch (schedErr) {
        logger.error({ schedErr }, "Could not start Background Scheduler Service");
    }
}
bootstrap().catch((err) => {
    logger.fatal({ err }, "Fatal error during bot startup");
    process.exit(1);
});
//# sourceMappingURL=index.js.map