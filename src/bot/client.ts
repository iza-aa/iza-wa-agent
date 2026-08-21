import * as Baileys from "@whiskeysockets/baileys";

const makeWASocket =
  typeof (Baileys as any).default === "function"
    ? (Baileys as any).default
    : (Baileys as any).default?.default ||
      (Baileys as any).default?.makeWASocket ||
      (Baileys as any).makeWASocket;

const useMultiFileAuthState =
  (Baileys as any).useMultiFileAuthState ||
  (Baileys as any).default?.useMultiFileAuthState;

const DisconnectReason =
  (Baileys as any).DisconnectReason ||
  (Baileys as any).default?.DisconnectReason;

const fetchLatestBaileysVersion =
  (Baileys as any).fetchLatestBaileysVersion ||
  (Baileys as any).default?.fetchLatestBaileysVersion;

import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { BudgetRepository } from "../db/repositories/budget.repository.js";
import { BillRepository } from "../db/repositories/bill.repository.js";
import { MessageHandler } from "./handlers/message.handler.js";
import { getSupabaseClient } from "../db/supabase.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { setGlobalSocket } from "./socket-holder.js";

export function createWhatsAppBot(): { start: () => Promise<void> } {
  const start = async () => {
    logger.info("Initializing Baileys WhatsApp Socket Client...");

    const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version, isLatest }, "Using Baileys WA Version");

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }) as any,
      browser: ["IZA WA Agent", "Chrome", "1.0.0"],
      generateHighQualityLinkPreview: true,
    });

    setGlobalSocket(sock);

    const supabase = getSupabaseClient();
    const userRepo = new UserRepository(supabase, config.SUPER_ADMIN_PHONE);
    await userRepo.syncSuperAdminsFromDB();
    const trxRepo = new TransactionRepository(supabase);
    const chatRepo = new ChatRepository(supabase);
    const budgetRepo = new BudgetRepository(supabase);
    const billRepo = new BillRepository(supabase);
    const messageHandler = new MessageHandler(userRepo, trxRepo, chatRepo, budgetRepo, billRepo);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info("QR Code received. Please scan with WhatsApp on your phone:");
        qrcode.generate(qr, { small: true });
        console.log("\n=======================================================");
        console.log("📲 SILAKAN SCAN QR CODE DI ATAS DENGAN WHATSAPP ANDA");
        console.log("Nomor Bot: 0881082854818");
        console.log("=======================================================\n");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.warn({ statusCode, shouldReconnect }, "WhatsApp Connection closed");

        if (shouldReconnect) {
          logger.info("Reconnecting to WhatsApp in 3 seconds...");
          setTimeout(start, 3000);
        } else {
          logger.error("Logged out from WhatsApp. Delete baileys_auth_info to scan again.");
        }
      } else if (connection === "open") {
        logger.info("Baileys WhatsApp Client is READY and CONNECTED!");
        console.log("✅ BAILEYS WHATSAPP BOT BERHASIL TERSAMBUNG DAN SIAP DIGUNAKAN!");

        // Ensure Super Admin identifiers exist in DB if not already present
        for (const phone of config.SUPER_ADMIN_PHONE) {
          try {
            const existing = await userRepo.getUser(phone);
            if (!existing) {
              await userRepo.upsertUser({
                phone_number: phone,
                name: "Super Admin",
                role: "super_admin",
                status: "active",
              });
              logger.info({ phone }, "Super Admin identifier registered in database");
            }
          } catch (err) {
            logger.error({ err, phone }, "Could not verify Super Admin in DB");
          }
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }: any) => {
      for (const msg of messages) {
        // Skip outgoing messages from bot itself
        if (msg.key?.fromMe) continue;

        // Skip messages older than 15 minutes to avoid processing ancient history on sync
        const msgTimestamp = msg.messageTimestamp;
        if (msgTimestamp) {
          const msgTime = typeof msgTimestamp === "number" ? msgTimestamp * 1000 : Number(msgTimestamp) * 1000;
          const ageMs = Date.now() - msgTime;
          if (ageMs > 15 * 60 * 1000) {
            continue;
          }
        }

        try {
          await messageHandler.processIncomingMessage(sock, msg);
        } catch (error) {
          logger.error({ error, msgKey: msg.key }, "Error processing Baileys incoming message");
        }
      }
    });
  };

  return { start };
}
