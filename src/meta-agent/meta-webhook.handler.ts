import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { AgentEngine } from "./agent-engine.js";
import { metaApiClient } from "./meta-api.client.js";
import { config } from "../config/env.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";
import { logger } from "../utils/logger.js";

export class MetaWebhookHandler {
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
   * Main entry point for Meta Cloud API Webhook (POST /api/meta-webhook)
   */
  async handleIncomingWebhook(body: any): Promise<void> {
    if (!body || body.object !== "whatsapp_business_account") {
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value || changes.field !== "messages") {
      return;
    }

    const messages = value.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      // Status update (sent, delivered, read), safe to ignore
      return;
    }

    const contact = value.contacts?.[0];
    const rawSenderName = contact?.profile?.name || "User";

    for (const msg of messages) {
      const senderPhone = normalizePhoneNumber(msg.from);
      const msgType = msg.type;
      const msgId = msg.id;

      // Mark message as read immediately (blue checkmarks on user's WhatsApp)
      if (msgId) {
        metaApiClient.markAsRead(msgId).catch(() => {});
      }

      logger.info({ senderPhone, rawSenderName, msgType, msgId }, "MetaWebhookHandler: Received message");

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

      // One-Time Phone Verification Handshake for unlinked/unregistered users
      const isAllowed = user && user.status === "active";
      let messageText = "";
      let interactiveButtonId: string | undefined;

      if (msgType === "text") {
        messageText = msg.text?.body || "";
      } else if (msgType === "interactive") {
        interactiveButtonId = msg.interactive?.button_reply?.id;
        messageText = msg.interactive?.button_reply?.title || "";
      } else if (msgType === "image") {
        messageText = msg.image?.caption || "";
      } else if (msgType === "document") {
        messageText = msg.document?.caption || "";
      }

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
            await metaApiClient.sendTextMessage(
              senderPhone,
              `🎉 *VERIFIKASI BERHASIL!*\n\nHalo *${linkedUser.name}*, akun WhatsApp Anda telah resmi terhubung dengan nomor \`+${targetPhone}\`.\n\nSekarang Anda dapat langsung mengobrol dengan Asisten AI, mencatat transaksi, kirim foto nota/struk, atau tanya laporan kas.`
            );
            return;
          } else {
            await metaApiClient.sendTextMessage(
              senderPhone,
              `⚠️ Nomor \`+${targetPhone}\` belum terdaftar di sistem.\n\nPastikan Super Admin telah mendaftarkan nomor Anda terlebih dahulu via \`/tambah ${targetPhone} [NamaAnda]\`.`
            );
            return;
          }
        }

        await metaApiClient.sendTextMessage(
          senderPhone,
          `👋 *HALO! SELAMAT DATANG DI IZA AI AGENT*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nAkun WhatsApp Anda belum terhubung dengan nomor anggota di sistem.\n\n👉 *Silakan balas pesan ini dengan mengetik NOMOR HP Anda yang telah didaftarkan:*\nContoh: \`08123456789\``
        );
        return;
      }

      // Log inbound message to Supabase chat_logs
      await this.chatRepo.logMessage({
        user_phone: senderPhone,
        user_name: displayName,
        message_type: msgType === "interactive" ? "text" : msgType,
        direction: "inbound",
        content: messageText,
      });

      // 2. Download media buffer if message has media
      let mediaBuffer: Buffer | undefined;
      let mediaMimeType: string | undefined;

      if (msgType === "image" && msg.image?.id) {
        const downloaded = await metaApiClient.downloadMedia(msg.image.id);
        if (downloaded) {
          mediaBuffer = downloaded.buffer;
          mediaMimeType = downloaded.mimeType;
        }
      } else if ((msgType === "audio" || msgType === "voice") && (msg.audio?.id || msg.voice?.id)) {
        const mediaId = msg.audio?.id || msg.voice?.id;
        const downloaded = await metaApiClient.downloadMedia(mediaId);
        if (downloaded) {
          mediaBuffer = downloaded.buffer;
          mediaMimeType = downloaded.mimeType;
        }
      } else if (msgType === "document" && msg.document?.id) {
        const downloaded = await metaApiClient.downloadMedia(msg.document.id);
        if (downloaded) {
          mediaBuffer = downloaded.buffer;
          mediaMimeType = downloaded.mimeType;
        }
      }

      // 3. Process message through True AI Agent Engine
      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: senderPhone,
          userName: displayName,
          messageText,
          mediaBuffer,
          mediaMimeType,
          interactiveButtonId,
        });

        // 4. Send response back to user
        if (result.buttons && result.buttons.length > 0) {
          await metaApiClient.sendInteractiveButtons(
            senderPhone,
            result.reply,
            result.buttons
          );
        } else if (result.reply) {
          await metaApiClient.sendTextMessage(senderPhone, result.reply);
        }

        // Log outbound message to Supabase chat_logs
        await this.chatRepo.logMessage({
          user_phone: senderPhone,
          user_name: "IZA AI Agent",
          message_type: "text",
          direction: "outbound",
          content: result.reply,
        });
      } catch (err: any) {
        logger.error({ err, senderPhone }, "Fatal error processing message in MetaWebhookHandler");
        await metaApiClient.sendTextMessage(
          senderPhone,
          "⚠️ Mohon maaf, terjadi kendala sementara saat memproses pesan Anda. Silakan coba kirim ulang."
        );
      }
    }
  }
}

export const metaWebhookHandler = new MetaWebhookHandler();
