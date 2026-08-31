import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { AgentEngine } from "./agent-engine.js";
import { evolutionApiClient } from "./evolution-api.client.js";
import { config } from "../config/env.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";
import { logger } from "../utils/logger.js";

export class EvolutionWebhookHandler {
  private userRepo: UserRepository;
  private trxRepo: TransactionRepository;
  private chatRepo: ChatRepository;
  private pendingRepo: PendingActionRepository;
  private agentEngine: AgentEngine;

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
   * Main entry point for Evolution API v2 Webhook (POST /api/evolution-webhook)
   */
  async handleIncomingWebhook(body: any): Promise<void> {
    if (!body) return;

    // Filter event: we only process messages.upsert
    const event = body.event || body.type;
    if (event && event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
      return;
    }

    // Extract payload data (support object or array)
    const rawData = Array.isArray(body.data) ? body.data[0] : (body.data || body);
    if (!rawData || !rawData.key) {
      return;
    }

    const key = rawData.key;
    // Ignore outbound messages sent by the bot
    if (key.fromMe) {
      return;
    }

    const remoteJid = key.remoteJid || "";
    // Ignore group chats or broadcast status
    if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast") || !remoteJid.includes("@")) {
      return;
    }

    const senderPhone = normalizePhoneNumber(remoteJid);
    const msgId = key.id;
    const rawSenderName = rawData.pushName || "User";

    // Mark message as read immediately
    if (msgId) {
      evolutionApiClient.markAsRead(remoteJid, msgId).catch(() => {});
    }

    logger.info({ senderPhone, rawSenderName, msgId }, "EvolutionWebhookHandler: Received message");

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

    // 2. Extract Message Content & Buttons
    const msgContent = rawData.message || {};
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
      interactiveButtonId = msgContent.listResponseMessage.singleSelectReply?.selectedRowId;
      messageText = msgContent.listResponseMessage.title || msgContent.listResponseMessage.singleSelectReply?.selectedRowId || "";
    } else if (msgContent.templateButtonReplyMessage) {
      interactiveButtonId = msgContent.templateButtonReplyMessage.selectedId;
      messageText = msgContent.templateButtonReplyMessage.selectedDisplayText || interactiveButtonId || "";
    } else if (msgContent.interactiveResponseMessage) {
      try {
        const nativeParams = msgContent.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson;
        if (nativeParams) {
          const parsed = JSON.parse(nativeParams);
          interactiveButtonId = parsed.id;
          messageText = parsed.title || parsed.id || "";
        }
      } catch {
        messageText = msgContent.interactiveResponseMessage.body?.text || "";
      }
    } else if (msgContent.pollUpdateMessage || rawData.pollUpdateMessage) {
      const poll = msgContent.pollUpdateMessage || rawData.pollUpdateMessage;
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

    // Handshake verification for unlinked/unregistered users
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
          await evolutionApiClient.sendTextMessage(
            senderPhone,
            `🎉 *VERIFIKASI BERHASIL!*\n\nHalo *${linkedUser.name}*, akun WhatsApp Anda telah resmi terhubung dengan nomor \`+${targetPhone}\`.\n\nSekarang Anda dapat langsung mengobrol dengan Asisten AI, mencatat transaksi, kirim foto nota/struk, atau tanya laporan kas.`
          );
          return;
        } else {
          await evolutionApiClient.sendTextMessage(
            senderPhone,
            `⚠️ Nomor \`+${targetPhone}\` belum terdaftar di sistem.\n\nPastikan Super Admin telah mendaftarkan nomor Anda terlebih dahulu via \`/tambah ${targetPhone} [NamaAnda]\`.`
          );
          return;
        }
      }

      await evolutionApiClient.sendTextMessage(
        senderPhone,
        `👋 *HALO! SELAMAT DATANG DI IZA ASSISTANT*\n\nAkun WhatsApp Anda belum terhubung dengan nomor staf terdaftar.\n\nSilakan ketik nomor HP Anda yang terdaftar (contoh: \`08123456789\`) untuk verifikasi identitas.`
      );
      return;
    }

    // If user clicked interactive button, prioritize that text
    const effectiveText = interactiveButtonId ? (messageText || interactiveButtonId) : messageText;

    // 3. Download Media if present (Image/Receipt, Audio/Voice Note, Document)
    let mediaBuffer: Buffer | undefined;
    let mediaMimeType: string | undefined;

    const hasImage = !!msgContent.imageMessage;
    const hasAudio = !!msgContent.audioMessage;
    const hasDoc = !!msgContent.documentMessage;

    if (hasImage || hasAudio || hasDoc) {
      // Check if Evolution API passed base64 directly in payload
      const directBase64 = rawData.base64 || msgContent.base64;
      if (directBase64) {
        mediaBuffer = Buffer.from(directBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
        mediaMimeType = msgContent.imageMessage?.mimetype || msgContent.audioMessage?.mimetype || msgContent.documentMessage?.mimetype || "application/octet-stream";
      } else if (msgId) {
        const downloaded = await evolutionApiClient.downloadMediaBase64(msgId);
        if (downloaded) {
          mediaBuffer = downloaded.buffer;
          mediaMimeType = downloaded.mimeType;
        }
      }
    }

    // 4. Send "typing..." presence indicator while AI processes
    evolutionApiClient.sendPresence(senderPhone, "composing").catch(() => {});

    // 5. Delegate to AgentEngine for Full AI Processing
    try {
      const result = await this.agentEngine.processIncomingMessage({
        userPhone: senderPhone,
        userName: displayName,
        messageText: effectiveText,
        mediaBuffer,
        mediaMimeType,
      });

      // Stop composing presence
      evolutionApiClient.sendPresence(senderPhone, "paused").catch(() => {});

      if (!result.reply) {
        return;
      }

      // 6. Send Response: Interactive Buttons if provided, otherwise standard text
      if (result.buttons && result.buttons.length > 0) {
        await evolutionApiClient.sendInteractiveButtons(
          senderPhone,
          result.reply,
          result.buttons
        );
      } else {
        await evolutionApiClient.sendTextMessage(senderPhone, result.reply);
      }
    } catch (err) {
      logger.error({ err, senderPhone }, "EvolutionWebhookHandler: Error processing message through AgentEngine");
      await evolutionApiClient.sendTextMessage(
        senderPhone,
        "⚠️ Mohon maaf, terjadi kendala teknis saat memproses pesan Anda. Silakan coba sesaat lagi."
      );
    }
  }
}

export const evolutionWebhookHandler = new EvolutionWebhookHandler();
