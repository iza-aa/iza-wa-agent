import * as Baileys from "@whiskeysockets/baileys";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { AgentEngine } from "./agent-engine.js";
import { baileysInteractiveClient } from "./baileys-interactive.client.js";
import { config } from "../config/env.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";
import { logger } from "../utils/logger.js";

const downloadMediaMessage =
  (Baileys as any).downloadMediaMessage ||
  (Baileys as any).default?.downloadMediaMessage;

export class ExecutiveBaileysHandler {
  private userRepo: UserRepository;
  private trxRepo: TransactionRepository;
  private chatRepo: ChatRepository;
  private pendingRepo: PendingActionRepository;
  private agentEngine: AgentEngine;
  private processedMessageIds: Set<string> = new Set();

  constructor() {
    const supabase = getSupabaseClient();
    this.userRepo = new UserRepository(supabase, config.SUPER_ADMIN_PHONE);
    this.trxRepo = new TransactionRepository(supabase);
    this.chatRepo = new ChatRepository(supabase);
    this.pendingRepo = new PendingActionRepository(supabase);
    this.agentEngine = new AgentEngine(
      supabase,
      this.trxRepo,
      this.userRepo,
      this.chatRepo,
      this.pendingRepo
    );
  }

  /**
   * Main entry point for messages received directly on Executive Baileys Socket
   */
  async handleBaileysMessage(sock: any, rawMsg: any): Promise<void> {
    if (!rawMsg || !rawMsg.key) return;

    // Ignore outbound messages sent by the bot
    if (rawMsg.key.fromMe) return;

    const remoteJid = rawMsg.key.remoteJid || "";
    // Ignore group chats, broadcast status, or invalid JIDs
    if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast") || !remoteJid.includes("@")) {
      return;
    }

    const msgId = rawMsg.key.id;
    if (msgId) {
      if (this.processedMessageIds.has(msgId)) {
        return;
      }
      this.processedMessageIds.add(msgId);
      // Clean up set memory if too large
      if (this.processedMessageIds.size > 2000) {
        const first = this.processedMessageIds.values().next().value;
        if (first) this.processedMessageIds.delete(first);
      }
    }

    const senderPhone = normalizePhoneNumber(remoteJid);
    const rawSenderName = rawMsg.pushName || "User";

    // Mark message as read immediately (blue tick)
    if (msgId) {
      baileysInteractiveClient.markAsRead(remoteJid, msgId).catch(() => {});
    }

    logger.info({ senderPhone, rawSenderName, msgId }, "ExecutiveBaileysHandler: Received direct WhatsApp message");

    // 1. User Access & Status Resolution
    let user = await this.userRepo.getUser(senderPhone, rawSenderName);
    if (!user && this.userRepo.isSuperAdmin(senderPhone)) {
      user = await this.userRepo.upsertUser({
        phone_number: senderPhone,
        name: `Super Admin (${rawSenderName})`,
        role: "super_admin",
        status: "active",
      });
    }

    const displayName = user ? user.name : rawSenderName;
    const isAllowed = user && user.status === "active";

    // 2. Extract Message Content & Interactive Buttons
    const msgContent = rawMsg.message || {};
    let messageText = "";
    let interactiveButtonId: string | undefined;

    if (typeof msgContent === "string") {
      messageText = msgContent;
    } else if (msgContent.conversation) {
      messageText = msgContent.conversation;
    } else if (msgContent.extendedTextMessage?.text) {
      messageText = msgContent.extendedTextMessage.text;
    } else if (msgContent.buttonsResponseMessage) {
      interactiveButtonId = msgContent.buttonsResponseMessage.selectedButtonId;
      messageText = msgContent.buttonsResponseMessage.selectedDisplayText || interactiveButtonId || "";
    } else if (msgContent.listResponseMessage) {
      interactiveButtonId = msgContent.listResponseMessage.singleSelectReply?.selectedRowId || msgContent.listResponseMessage.selectedRowId;
      messageText = msgContent.listResponseMessage.title || interactiveButtonId || "";
    } else if (msgContent.templateButtonReplyMessage) {
      interactiveButtonId = msgContent.templateButtonReplyMessage.selectedId;
      messageText = msgContent.templateButtonReplyMessage.selectedDisplayText || interactiveButtonId || "";
    } else if (msgContent.interactiveResponseMessage) {
      try {
        const nativeParams = msgContent.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson;
        if (nativeParams) {
          const parsed = JSON.parse(nativeParams);
          interactiveButtonId = parsed.id;
          messageText = parsed.title || parsed.display_text || parsed.id || "";
        }
      } catch {
        messageText = msgContent.interactiveResponseMessage.body?.text || "";
      }
    } else if (msgContent.pollUpdateMessage) {
      const poll = msgContent.pollUpdateMessage;
      const selected = poll.vote?.selectedOptions || poll.selectedOptions || poll.pollUpdates?.[0]?.vote?.selectedOptions;
      if (Array.isArray(selected) && selected.length > 0) {
        messageText = typeof selected[0] === "string" ? selected[0] : (selected[0].name || selected[0].optionName || "");
      } else if (typeof selected === "string") {
        messageText = selected;
      }
    } else if (msgContent.imageMessage) {
      messageText = msgContent.imageMessage.caption || "";
    } else if (msgContent.documentMessage) {
      messageText = msgContent.documentMessage.caption || "";
    }

    // 3. Handshake verification for unlinked/unregistered users
    if (!isAllowed) {
      const digitsOnly = messageText.replace(/[^0-9]/g, "");
      const isPhoneNumberInput =
        (digitsOnly.startsWith("08") || digitsOnly.startsWith("628") || digitsOnly.startsWith("8")) &&
        digitsOnly.length >= 9 &&
        digitsOnly.length <= 15;

      if (isPhoneNumberInput) {
        const targetPhone = normalizePhoneNumber(digitsOnly);
        const linkedUser = await this.userRepo.linkLidByPhoneNumber(targetPhone, senderPhone);

        if (linkedUser) {
          await baileysInteractiveClient.sendTextMessage(
            senderPhone,
            `🎉 *VERIFIKASI BERHASIL!*\n\nHalo *${linkedUser.name}*, akun WhatsApp Anda telah resmi terhubung dengan nomor \`+${targetPhone}\`.\n\nSekarang Anda dapat langsung mengobrol dengan Asisten AI, mencatat transaksi, kirim foto nota/struk, atau tanya laporan kas.`
          );
          return;
        } else {
          await baileysInteractiveClient.sendTextMessage(
            senderPhone,
            `⚠️ Nomor \`+${targetPhone}\` belum terdaftar di sistem.\n\nPastikan Super Admin telah mendaftarkan nomor Anda terlebih dahulu via \`/tambah ${targetPhone} [NamaAnda]\`.`
          );
          return;
        }
      }

      await baileysInteractiveClient.sendTextMessage(
        senderPhone,
        `👋 *HALO! SELAMAT DATANG DI IZA ASSISTANT*\n\nAkun WhatsApp Anda belum terhubung dengan nomor staf terdaftar.\n\nSilakan ketik nomor HP Anda yang terdaftar (contoh: \`08123456789\`) untuk verifikasi identitas.`
      );
      return;
    }

    // If user clicked interactive button, map button ID to natural conversational text
    const BUTTON_ID_MAP: Record<string, string> = {
      CHECK_BALANCE: "Berapa total saldo kas dan rekening kita saat ini?",
      REKAP_KAS: "Tampilkan rekap kondisi keuangan kas terbaru",
      AUDIT_KAS: "Audit pengeluaran yang belum dirinci dan periksa selisih kas",
      AUDIT_RINCIAN: "Audit pengeluaran yang belum dirinci",
      AUDIT_SELISIH: "Cek apakah ada selisih di pembukuan kas",
      SPREADSHEET: "Minta link Google Spreadsheet kas",
      GOOGLE_DRIVE: "Minta link Google Drive folder nota",
      CONFIRM_ACTION: "Ya, simpan sekarang",
      CANCEL_ACTION: "Batal",
    };

    let effectiveText = messageText;
    if (interactiveButtonId && BUTTON_ID_MAP[interactiveButtonId]) {
      effectiveText = BUTTON_ID_MAP[interactiveButtonId];
    } else if (interactiveButtonId && (!effectiveText || effectiveText === interactiveButtonId)) {
      effectiveText = BUTTON_ID_MAP[interactiveButtonId] || interactiveButtonId;
    }

    // 4. Download Media if present (Image/Receipt, Audio/Voice Note, Document)
    let mediaBuffer: Buffer | undefined;
    let mediaMimeType: string | undefined;

    const hasImage = !!msgContent.imageMessage;
    const hasAudio = !!msgContent.audioMessage;
    const hasDoc = !!msgContent.documentMessage;

    if (hasImage || hasAudio || hasDoc) {
      try {
        if (typeof downloadMediaMessage === "function") {
          mediaBuffer = await downloadMediaMessage(
            rawMsg,
            "buffer",
            {},
            {
              logger: logger as any,
              reuploadRequest: sock?.updateMediaMessage,
            }
          );
          mediaMimeType =
            msgContent.imageMessage?.mimetype ||
            msgContent.audioMessage?.mimetype ||
            msgContent.documentMessage?.mimetype ||
            "application/octet-stream";
        }
      } catch (mediaErr) {
        logger.error({ mediaErr, msgId }, "ExecutiveBaileysHandler: Failed to download media attachment");
      }
    }

    // 5. Send "typing..." presence indicator while AI processes
    baileysInteractiveClient.sendPresence(senderPhone, "composing").catch(() => {});

    // 6. Delegate to AgentEngine for Full AI Processing
    try {
      const result = await this.agentEngine.processIncomingMessage({
        userPhone: senderPhone,
        userName: displayName,
        messageText: effectiveText,
        mediaBuffer,
        mediaMimeType,
      });

      // Stop composing presence
      baileysInteractiveClient.sendPresence(senderPhone, "paused").catch(() => {});

      if (!result.reply) {
        return;
      }

      // 7. Send Response: Real Interactive Buttons (NativeFlowMessage) if buttons provided
      if (result.buttons && result.buttons.length > 0) {
        await baileysInteractiveClient.sendInteractiveButtons(
          senderPhone,
          result.reply,
          result.buttons
        );
      } else {
        await baileysInteractiveClient.sendTextMessage(senderPhone, result.reply);
      }
    } catch (err) {
      logger.error({ err, senderPhone }, "ExecutiveBaileysHandler: Error processing message through AgentEngine");
      await baileysInteractiveClient.sendTextMessage(
        senderPhone,
        "⚠️ Mohon maaf, terjadi kendala teknis saat memproses pesan Anda. Silakan coba sesaat lagi."
      );
    }
  }
}

export const executiveBaileysHandler = new ExecutiveBaileysHandler();
