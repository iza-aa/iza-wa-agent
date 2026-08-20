import http from "http";
import { createWhatsAppBot } from "./bot/client.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { googleSheetsService } from "./google/sheets.service.js";
import { googleDriveService } from "./google/drive.service.js";
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
    }, "App configuration validated");
    // 1. Start Mini HTTP Server for Cloud Health Checks (Render / Koyeb / UptimeRobot)
    const port = process.env.PORT || config.PORT || 3000;
    const server = http.createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "online", service: "iza-wa-agent", timestamp: new Date().toISOString() }));
        }
        else {
            res.writeHead(404);
            res.end();
        }
    });
    server.listen(port, () => {
        logger.info({ port }, "HTTP Health Check server is listening for keep-alive pings");
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
}
bootstrap().catch((err) => {
    logger.fatal({ err }, "Fatal error during bot startup");
    process.exit(1);
});
//# sourceMappingURL=index.js.map