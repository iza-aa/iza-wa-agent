import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

// @ts-ignore
import WebSocket from "ws";
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

import http from "http";
import { createWhatsAppBot } from "./bot/client.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { googleSheetsService } from "./google/sheets.service.js";
import { googleDriveService } from "./google/drive.service.js";
import { metaApiClient } from "./meta-agent/meta-api.client.js";
import { metaWebhookHandler } from "./meta-agent/meta-webhook.handler.js";
import { evolutionApiClient } from "./meta-agent/evolution-api.client.js";
import { evolutionWebhookHandler } from "./meta-agent/evolution-webhook.handler.js";

async function bootstrap() {
  console.log("=================================================");
  console.log("🚀 STARTING IZA-WA-AGENT (SUPERCHARGED AI ASSISTANT)");
  console.log("=================================================");
  logger.info(
    {
      superAdmin: config.SUPER_ADMIN_PHONE,
      geminiKeysCount: config.GEMINI_API_KEYS.length,
      supabaseUrl: config.SUPABASE_URL,
      googleSheetId: config.GOOGLE_SHEET_ID,
      googleDriveFolderId: config.GOOGLE_DRIVE_FOLDER_ID,
      metaPhoneId: config.META_PHONE_NUMBER_ID || undefined,
    },
    "App configuration validated"
  );

  // 1. Start Mini HTTP Server for Cloud Health Checks, Sheets Webhooks & Meta Webhook
  const port = process.env.PORT || config.PORT || 3000;
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://localhost:${port}`);

    if (parsedUrl.pathname === "/health" || parsedUrl.pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "online", service: "iza-wa-agent", timestamp: new Date().toISOString() }));
    } else if (parsedUrl.pathname === "/api/meta-webhook" && req.method === "GET") {
      const challenge = metaApiClient.verifyWebhook(parsedUrl.searchParams);
      if (challenge) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(challenge);
      } else {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
      }
    } else if (parsedUrl.pathname === "/api/meta-webhook" && req.method === "POST") {
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
        } catch (err: any) {
          logger.error({ err }, "Error processing incoming Meta webhook body");
          if (!res.headersSent) {
            res.writeHead(400);
            res.end();
          }
        }
      });
    } else if (parsedUrl.pathname === "/api/evolution-webhook" && req.method === "POST") {
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
        } catch (err: any) {
          logger.error({ err }, "Error processing incoming Evolution webhook body");
          if (!res.headersSent) {
            res.writeHead(400);
            res.end();
          }
        }
      });
    } else if (parsedUrl.pathname === "/api/sheets-webhook" && (req.method === "POST" || req.method === "GET")) {
      logger.info("Received realtime webhook trigger from Google Sheets");
      try {
        const { getSupabaseClient } = await import("./db/supabase.js");
        const { TransactionRepository } = await import("./db/repositories/transaction.repository.js");
        const supabase = getSupabaseClient();
        const trxRepo = new TransactionRepository(supabase);
        const result = await googleSheetsService.syncFromSheetToDatabase(trxRepo);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, synced: result.syncedCount, timestamp: new Date().toISOString() }));
      } catch (err: any) {
        logger.error({ err }, "Error processing sheets webhook");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err?.message || "Sync failed" }));
      }
    } else if ((parsedUrl.pathname === "/qr" || parsedUrl.pathname === "/qr-executive") && req.method === "GET") {
      try {
        const qrData = await evolutionApiClient.getConnectQrCode();
        if (!qrData) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:50px;">
            <h2>❌ Gagal memuat status Evolution API</h2>
            <p>Pastikan container Evolution API berjalan di port 8080.</p>
          </body></html>`);
          return;
        }

        if (qrData.status === "open") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html>
          <html>
            <head>
              <title>WhatsApp Business - Terhubung</title>
              <meta http-equiv="refresh" content="10">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;padding:40px 16px;background:#f0f2f5;">
              <div style="background:#fff;max-width:440px;margin:auto;padding:32px 24px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                <div style="font-size:48px;margin-bottom:12px;">✅</div>
                <h2 style="color:#0f5132;margin:0 0 10px;">WhatsApp Terhubung!</h2>
                <p style="color:#4b5563;font-size:14px;line-height:1.5;">Nomor <b>${config.EVOLUTION_AGENT_PHONE || "087864550486"}</b> (Instance: <code>${config.EVOLUTION_INSTANCE_NAME}</code>) aktif dan siap melayani percakapan.</p>
                <div style="margin-top:20px;padding:12px;background:#d1e7dd;border-radius:8px;color:#0f5132;font-size:14px;font-weight:600;">Status: ONLINE</div>
              </div>
            </body>
          </html>`);
          return;
        }

        const base64Img = qrData.base64 || "";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
        <html>
          <head>
            <title>Scan QR WhatsApp Business - IZA Agent</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;padding:30px 16px;background:#f0f2f5;color:#1c1e21;">
            <div style="background:#fff;max-width:440px;margin:auto;padding:28px 20px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
              <h2 style="margin:0 0 6px;color:#111827;font-size:20px;">Scan QR WhatsApp Business</h2>
              <p style="color:#6b7280;font-size:13px;margin:0 0 18px;">Instance: <b>${config.EVOLUTION_INSTANCE_NAME}</b> | Auto-refresh setiap 5 detik</p>
              
              ${base64Img ? `<img src="${base64Img}" alt="QR Code" style="width:280px;height:280px;border-radius:12px;border:1px solid #e5e7eb;box-shadow:0 2px 12px rgba(0,0,0,0.06);display:block;margin:auto;" />` : `<div style="padding:60px 20px;background:#f9fafb;border-radius:12px;color:#6b7280;">⏳ Menghasilkan QR Code baru...</div>`}
              
              <div style="text-align:left;background:#f9fafb;padding:16px;border-radius:10px;margin-top:20px;font-size:13px;color:#374151;line-height:1.6;border:1px solid #e5e7eb;">
                <b style="color:#111827;">Petunjuk Tautkan:</b><br/>
                1. Buka <b>WhatsApp Business</b> di HP (${config.EVOLUTION_AGENT_PHONE || "087864550486"})<br/>
                2. Buka <b>Pengaturan / Settings</b> &rarr; <b>Perangkat Tertaut (Linked Devices)</b><br/>
                3. Ketuk <b>Tautkan Perangkat</b> lalu arahkan kamera ke QR Code di atas.
              </div>
            </div>
          </body>
        </html>`);
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error: " + err?.message);
      }
    } else {
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
  } catch (bucketErr) {
    logger.warn({ bucketErr }, "Could not auto-verify Supabase Storage Bucket");
  }

  // 3. Initialize Google Sheet headers if not present
  try {
    logger.info("Verifying Google Sheet initialization...");
    await googleSheetsService.ensureSheetInitialized();
    logger.info("Google Sheet verified successfully");
  } catch (sheetErr) {
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
      } catch (autoSyncErr) {
        logger.warn({ autoSyncErr }, "Periodic auto-sync encountered an issue");
      }
    }, 3 * 60 * 1000);
  } catch (schedErr) {
    logger.error({ schedErr }, "Could not start Background Scheduler Service");
  }
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Fatal error during bot startup");
  process.exit(1);
});
