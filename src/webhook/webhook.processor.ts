import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { BudgetRepository } from "../db/repositories/budget.repository.js";
import { BillRepository } from "../db/repositories/bill.repository.js";
import { CommandHandler } from "../bot/handlers/command.handler.js";
import { parseTransactionText } from "../ai/parsers/text.parser.js";
import { parseReceiptVision } from "../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../ai/parsers/audio.parser.js";
import { executeNaturalQuerySearch } from "../ai/parsers/search.parser.js";
import { googleDriveService } from "../google/drive.service.js";
import { googleSheetsService } from "../google/sheets.service.js";
import {
  formatTransactionSuccess,
  formatPendingApprovalNotification,
} from "../bot/formatters/reply.formatter.js";
import { getSupabaseClient } from "../db/supabase.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";

export interface WebhookIncomingPayload {
  sender: string; // e.g. "6281346367235"
  message?: string;
  name?: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "document" | "text";
}

export class WebhookProcessor {
  private userRepo: UserRepository;
  private trxRepo: TransactionRepository;
  private chatRepo: ChatRepository;
  private budgetRepo: BudgetRepository;
  private billRepo: BillRepository;
  private commandHandler: CommandHandler;

  constructor() {
    const supabase = getSupabaseClient();
    this.userRepo = new UserRepository(supabase, config.SUPER_ADMIN_PHONE);
    this.trxRepo = new TransactionRepository(supabase);
    this.chatRepo = new ChatRepository(supabase);
    this.budgetRepo = new BudgetRepository(supabase);
    this.billRepo = new BillRepository(supabase);
    this.commandHandler = new CommandHandler(this.userRepo, this.trxRepo, this.budgetRepo, this.billRepo);
  }

  async process(payload: WebhookIncomingPayload): Promise<{ reply: string; success: boolean }> {
    const senderPhone = normalizePhoneNumber(payload.sender);
    const userName = payload.name || "User";
    const body = (payload.message || "").trim();

    logger.info({ senderPhone, userName, hasMedia: !!payload.mediaUrl }, "Processing incoming Webhook");

    // 1. Resolve registered user for official display name
    let user = await this.userRepo.getUser(senderPhone, userName);
    if (!user && this.userRepo.isSuperAdmin(senderPhone)) {
      user = await this.userRepo.upsertUser({
        phone_number: senderPhone,
        name: "Super Admin (" + userName + ")",
        role: "super_admin",
        status: "active",
      });
    }

    const cleanPhone = user ? user.phone_number : senderPhone;
    const displayName = user ? user.name : (payload.name || userName);

    // 2. Strict Whitelist Check (Reject if not registered in users table)
    const isAllowed = user && user.status === "active";
    if (!isAllowed) {
      logger.warn({ senderPhone, cleanPhone, userName }, "Unauthorized user attempted webhook access");
      return {
        reply: "👋 Halo! Nomor Anda belum terdaftar di sistem.\nHubungi Super Admin untuk didaftarkan.",
        success: false,
      };
    }

    // 3. Command check
    if (body.startsWith("/")) {
      const { handled, responseMessage } = await this.commandHandler.handleCommand(cleanPhone, body);
      if (handled) {
        return { reply: responseMessage, success: true };
      }
    }

    // 4. Handle Media (Image / Receipt)
    if (payload.mediaUrl) {
      try {
        const response = await fetch(payload.mediaUrl);
        const arrayBuffer = await response.arrayBuffer();
        const mediaBuffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get("content-type") || "image/jpeg";

        if (contentType.startsWith("image/") || payload.mediaType === "image") {
          const parsed = await parseReceiptVision(mediaBuffer, contentType);
          if (!parsed || parsed.total_amount <= 0) {
            return {
              reply: "⚠️ AI tidak dapat mendeteksi total belanja dari foto struk ini. Pastikan foto jelas dan tidak buram.",
              success: false,
            };
          }

          const trxId = await this.trxRepo.generateTransactionId(parsed.date);

          // Upload to Storage (Google Drive / Supabase Storage)
          let storageLink = "";
          let fileId = "";
          try {
            const uploadRes = await googleDriveService.uploadReceipt(
              mediaBuffer,
              trxId + "_" + parsed.merchant.replace(/[^a-zA-Z0-9]/g, "_"),
              displayName
            );
            storageLink = uploadRes.webViewLink;
            fileId = uploadRes.fileId;
          } catch (uploadErr) {
            logger.warn({ uploadErr }, "Storage upload fallback note");
          }

          // Save to Supabase
          const transactionRecord = await this.trxRepo.createTransaction(
            {
              id: trxId,
              user_phone: senderPhone,
              user_name: displayName,
              date: parsed.date,
              merchant: parsed.merchant,
              category: parsed.category,
              subtotal: parsed.subtotal,
              tax: parsed.tax,
              discount: parsed.discount,
              total_amount: parsed.total_amount,
              payment_method: parsed.payment_method,
              gdrive_file_id: fileId,
              gdrive_web_view_link: storageLink,
              raw_text: body,
              confidence_score: parsed.confidence_score,
            },
            parsed.items.map((i) => ({
              item_name: i.item_name,
              qty: i.qty,
              price: i.price,
              total_price: i.total_price,
              category: i.category,
            }))
          );

          // Append to Google Sheet
          try {
            const sheetRes = await googleSheetsService.appendTransaction(
              transactionRecord,
              parsed.items
            );
            await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
          } catch (sheetErr) {
            logger.error({ sheetErr }, "Failed to append to Google Sheet in webhook");
          }

          const replyText = formatTransactionSuccess(transactionRecord, parsed.items);
          return { reply: replyText, success: true };
        }

        // Voice Note in Webhook
        if (contentType.startsWith("audio/") || payload.mediaType === "audio") {
          const { transcription, is_complete, clarification_question, transaction } = await parseAudioVoiceNote(mediaBuffer, contentType);
          if (!is_complete || !transaction || transaction.total_amount <= 0) {
            const question = clarification_question || "Berapa nominal atau rincian belanjanya ya?";
            return {
              reply: "🗣️ *Transkrip:* \"" + (transcription || "(Suara belum jelas)") + "\"\n\n❓ " + question,
              success: true,
            };
          }

          const trxId = await this.trxRepo.generateTransactionId(transaction.date);
          const transactionRecord = await this.trxRepo.createTransaction(
            {
              id: trxId,
              user_phone: senderPhone,
              user_name: displayName,
              date: transaction.date,
              merchant: transaction.merchant,
              category: transaction.category,
              subtotal: transaction.subtotal,
              tax: transaction.tax,
              discount: transaction.discount,
              total_amount: transaction.total_amount,
              payment_method: transaction.payment_method,
              raw_text: transcription,
              confidence_score: transaction.confidence_score,
            },
            transaction.items
          );

          try {
            const sheetRes = await googleSheetsService.appendTransaction(
              transactionRecord,
              transaction.items
            );
            await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
          } catch (sheetErr) {
            logger.error({ sheetErr }, "Failed to append row to Google Sheet");
          }

          let replyText = "🗣️ *Transkrip:* \"" + transcription + "\"\n\n";
          replyText += formatTransactionSuccess(transactionRecord, transaction.items);
          return { reply: replyText, success: true };
        }
      } catch (err: any) {
        logger.error({ err }, "Error processing media in webhook");
        return { reply: "❌ Gagal memproses media dari webhook.", success: false };
      }
    }

    // 5. Handle Text
    if (body.length > 0) {
      const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);

      // Check if message is a natural query or question (e.g. "Berapa saldo kas?", "Cari nota bensin")
      try {
        const queryCheck = await executeNaturalQuerySearch(body, this.trxRepo, isSuperAdmin, senderPhone);
        if (queryCheck.isQuery) {
          await this.chatRepo.logMessage({
            user_phone: senderPhone,
            user_name: "Bot",
            message_type: "text",
            direction: "outbound",
            content: queryCheck.replyText,
          });
          return { reply: queryCheck.replyText, success: true };
        }
      } catch (searchErr) {
        logger.debug({ searchErr }, "Webhook query search check bypass to standard text parser");
      }

      const history = await this.chatRepo.getRecentChatHistory(senderPhone, 3);
      const historyStrings = history.map((h) => (h.direction === "inbound" ? "User: " : "Bot: ") + h.content);

      let textResult = null;
      try {
        textResult = await parseTransactionText(body, historyStrings);
      } catch (aiErr) {
        logger.error({ aiErr }, "AI text parsing error in webhook");
        return { reply: "⚠️ Sistem AI sedang sibuk sementara. Silakan coba lagi.", success: false };
      }

      if (!textResult.is_complete || !textResult.transaction || textResult.transaction.total_amount <= 0) {
        return {
          reply:
            textResult.reply_message ||
            "💬 Pesan Anda diterima! Ketik pengeluaran (contoh: *Beli makan 25rb*) atau kirim foto struk/voice note untuk dicatat otomatis.",
          success: true,
        };
      }

      const parsed = textResult.transaction;
      const trxId = await this.trxRepo.generateTransactionId(parsed.date);
      const transactionRecord = await this.trxRepo.createTransaction(
        {
          id: trxId,
          user_phone: senderPhone,
          user_name: displayName,
          date: parsed.date,
          merchant: parsed.merchant,
          category: parsed.category,
          subtotal: parsed.subtotal,
          tax: parsed.tax,
          discount: parsed.discount,
          total_amount: parsed.total_amount,
          payment_method: parsed.payment_method,
          raw_text: body,
          confidence_score: parsed.confidence_score,
        },
        parsed.items
      );

      try {
        const sheetRes = await googleSheetsService.appendTransaction(
          transactionRecord,
          parsed.items
        );
        await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to append row to Google Sheet");
      }

      const replyText = formatTransactionSuccess(transactionRecord, parsed.items);
      return { reply: replyText, success: true };
    }

    return { reply: "Pesan tidak valid", success: false };
  }
}

export const webhookProcessor = new WebhookProcessor();
