import * as Baileys from "@whiskeysockets/baileys";
const { downloadMediaMessage } = Baileys as any;
type WAMessage = any;
type WASocket = any;
import { UserRepository } from "../../db/repositories/user.repository.js";
import { TransactionRepository } from "../../db/repositories/transaction.repository.js";
import { ChatRepository } from "../../db/repositories/chat.repository.js";
import { BudgetRepository } from "../../db/repositories/budget.repository.js";
import { BillRepository } from "../../db/repositories/bill.repository.js";
import { PendingActionRepository } from "../../db/repositories/pending-action.repository.js";
import { ConfirmationFlow } from "../../meta-agent/confirmation-flow.js";
import { TransactionDraft } from "../../meta-agent/agent-persona.js";
import { extractDeterministicEdits } from "../../ai/parsers/edit.parser.js";
import { getSupabaseClient } from "../../db/supabase.js";
import { CommandHandler } from "./command.handler.js";
import { parseTransactionText } from "../../ai/parsers/text.parser.js";
import { parseReceiptVision } from "../../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../../ai/parsers/audio.parser.js";
import { executeNaturalQuerySearch } from "../../ai/parsers/search.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import {
  formatTransactionSuccess,
  formatPendingApprovalNotification,
  formatDuplicateWarning,
  formatBudgetWarning,
} from "../formatters/reply.formatter.js";
import { DuplicateDetectorService } from "../../services/duplicate-detector.service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/env.js";
import { normalizePhoneNumber } from "../../utils/phone.utils.js";

export class MessageHandler {
  private commandHandler: CommandHandler;
  private duplicateDetector: DuplicateDetectorService;
  private pendingRepo: PendingActionRepository;
  private confirmationFlow: ConfirmationFlow;
  private processedMessageIds: Set<string> = new Set();

  constructor(
    private userRepo: UserRepository,
    private trxRepo: TransactionRepository,
    private chatRepo: ChatRepository,
    private budgetRepo?: BudgetRepository,
    private billRepo?: BillRepository,
    pendingRepo?: PendingActionRepository
  ) {
    this.commandHandler = new CommandHandler(userRepo, trxRepo, budgetRepo, billRepo);
    this.duplicateDetector = new DuplicateDetectorService(trxRepo);
    this.pendingRepo = pendingRepo || new PendingActionRepository(getSupabaseClient());
    this.confirmationFlow = new ConfirmationFlow(this.pendingRepo, trxRepo, userRepo, budgetRepo, billRepo);
  }

  private async checkBudgetAlert(category: string, dateStr: string): Promise<string | null> {
    if (!this.budgetRepo || category.startsWith("Pemasukan")) return null;
    const monthStr = dateStr.slice(0, 7);
    const budget = await this.budgetRepo.getBudgetByCategory(category, monthStr);
    if (!budget || budget.limit_amount <= 0) return null;

    const monthly = await this.trxRepo.getMonthlySummary(monthStr);
    const matchedKey = Object.keys(monthly.byCategory || {}).find(
      (k) => k.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes(k.toLowerCase())
    );
    const spent = matchedKey ? monthly.byCategory[matchedKey] : 0;
    const percent = (spent / budget.limit_amount) * 100;

    if (percent >= 100 && !budget.is_alerted_100) {
      await this.budgetRepo.markAlerted(category, monthStr, 100);
      return formatBudgetWarning(category, spent, budget.limit_amount, percent);
    } else if (percent >= 80 && percent < 100 && !budget.is_alerted_80) {
      await this.budgetRepo.markAlerted(category, monthStr, 80);
      return formatBudgetWarning(category, spent, budget.limit_amount, percent);
    }

    return null;
  }

  cleanPhone(from: string): string {
    return normalizePhoneNumber(from);
  }

  async processIncomingMessage(sock: WASocket, msg: WAMessage): Promise<void> {
    if (!msg.message || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    // Strictly Private Chat Only: drop status broadcast and any WhatsApp group messages (@g.us)
    if (!remoteJid || remoteJid.includes("status@broadcast") || remoteJid.endsWith("@g.us")) return;

    // Deduplication: prevent Baileys multi-device from processing the same message twice
    const msgId = msg.key.id;
    if (msgId) {
      if (this.processedMessageIds.has(msgId)) {
        return; // Already processed, skip
      }
      this.processedMessageIds.add(msgId);
      // Auto-cleanup after 60 seconds to prevent memory leak
      setTimeout(() => this.processedMessageIds.delete(msgId), 60_000);
    }

    const senderPhone = this.cleanPhone(remoteJid);
    const pushName = msg.pushName || "User";

    // Extract text body
    const messageContent = msg.message;
    const body =
      messageContent.conversation ||
      messageContent.extendedTextMessage?.text ||
      messageContent.imageMessage?.caption ||
      messageContent.videoMessage?.caption ||
      messageContent.documentMessage?.caption ||
      "";

    const isImage = !!messageContent.imageMessage;
    const isAudio = !!messageContent.audioMessage;
    const isDocument = !!messageContent.documentMessage;
    const hasMedia = isImage || isAudio || isDocument;

    logger.info({ senderPhone, pushName, hasMedia, isImage, isAudio }, "Processing incoming Baileys private message");

    // Send Read Receipt (Centang Biru) & Typing Indicator ("Sedang mengetik...")
    try {
      await sock.readMessages([msg.key]);
      await sock.sendPresenceUpdate("composing", remoteJid);
    } catch (presenceErr) {
      logger.debug({ presenceErr }, "Presence / Read receipt update non-critical error");
    }

    try {
      // 1. User Access & Status Check
      let user = await this.userRepo.getUser(senderPhone, pushName);
      if (user && user.status === "blocked") {
        await sock.sendMessage(
          remoteJid,
          { text: "⛔ Akses nomor Anda telah dinonaktifkan. Silakan hubungi Super Admin untuk mengaktifkan kembali." },
          { quoted: msg }
        );
        return;
      }
      if (!user || user.status !== "active") {
        // One-Time Phone Verification Handshake: Check if user sent a phone number
        const digitsOnly = body.replace(/[^0-9]/g, "");
        const isPhoneNumberInput =
          (digitsOnly.startsWith("08") || digitsOnly.startsWith("628") || digitsOnly.startsWith("8")) &&
          digitsOnly.length >= 9 &&
          digitsOnly.length <= 15;

        if (isPhoneNumberInput) {
          const targetPhone = normalizePhoneNumber(digitsOnly);
          const linkedUser = await this.userRepo.linkLidByPhoneNumber(targetPhone, senderPhone);

          if (linkedUser) {
            logger.info(
              { senderLid: senderPhone, phone: targetPhone, name: linkedUser.name },
              "Successfully completed One-Time Phone Verification Handshake"
            );
            await sock.sendMessage(
              remoteJid,
              {
                text: `🎉 *VERIFIKASI BERHASIL!*\n\nHalo *${linkedUser.name}*, akun WhatsApp Anda telah resmi terhubung dengan nomor \`+${targetPhone}\`.\n\nSekarang Anda dapat langsung mencatat transaksi, kirim foto nota/struk, atau ketik \`/menu\` untuk melihat panduan.`,
              },
              { quoted: msg }
            );
            return;
          } else {
            await sock.sendMessage(
              remoteJid,
              {
                text: `⚠️ Nomor \`+${targetPhone}\` belum terdaftar di sistem.\n\nPastikan Super Admin telah mendaftarkan nomor Anda terlebih dahulu via \`/tambah ${targetPhone} [NamaAnda]\`.`,
              },
              { quoted: msg }
            );
            return;
          }
        }

        logger.warn({ senderPhone, pushName }, "Unregistered user prompted for one-time phone verification handshake");
        await sock.sendMessage(
          remoteJid,
          {
            text: `👋 *HALO! SELAMAT DATANG DI IZA BOT*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\nAkun WhatsApp Anda belum terhubung dengan nomor anggota di sistem.\n\n👉 *Silakan balas pesan ini dengan mengetik NOMOR HP Anda yang telah didaftarkan:*\nContoh: \`08123456789\`\n\n_Setelah terhubung, Anda dapat langsung mencatat transaksi & melihat laporan kas._`,
          },
          { quoted: msg }
        );
        return;
      }

      const displayName = user.name || pushName;

      // Guard: If an active user types their own phone number, acknowledge friendly
      const digitsOnly = body.replace(/[^0-9]/g, "");
      if (
        digitsOnly.length >= 9 &&
        digitsOnly.length <= 15 &&
        (normalizePhoneNumber(digitsOnly) === user.phone_number || digitsOnly === senderPhone)
      ) {
        await sock.sendMessage(
          remoteJid,
          {
            text: `✅ Halo *${displayName}*! Akun WhatsApp Anda sudah aktif dan terdaftar dengan nomor \`+${user.phone_number}\`.\n\nAda yang bisa saya bantu? Ketik \`/menu\` untuk panduan pencatatan transaksi kas.`,
          },
          { quoted: msg }
        );
        return;
      }

      // 2. Log chat to Supabase chat_logs and Google Sheets Log_Pesan
      const msgType = isImage ? "image" : isAudio ? "audio" : isDocument ? "document" : "text";
      await this.chatRepo.logMessage({
        user_phone: user.phone_number,
        user_name: displayName,
        message_type: msgType,
        direction: "inbound",
        content: body,
      });

      try {
        await googleSheetsService.appendMessageLog(user.phone_number, displayName, body, msgType);
      } catch (sheetErr) {
        logger.warn({ sheetErr }, "Failed to append to Google Sheets Log_Pesan");
      }

      // 3. Command Check (Super Admin vs Member commands)
      if (body.startsWith("/")) {
        if (body.toLowerCase() === "/batal" || body.toLowerCase() === "/cancel") {
          const activeDraft = await this.confirmationFlow.getActiveDraft(user.phone_number);
          if (activeDraft) {
            const cancelReply = await this.confirmationFlow.cancelActiveDraft(activeDraft);
            await sock.sendMessage(remoteJid, { text: cancelReply }, { quoted: msg });
            return;
          }
        }
        const { handled, responseMessage } = await this.commandHandler.handleCommand(user.phone_number, body);
        if (handled) {
          await sock.sendMessage(remoteJid, { text: responseMessage }, { quoted: msg });
          return;
        } else {
          // Safety guard to prevent unhandled slash messages from falling through to AI
          await sock.sendMessage(
            remoteJid,
            { text: "❓ Perintah tidak dikenal. Ketik `/menu` untuk melihat daftar panduan & perintah." },
            { quoted: msg }
          );
          return;
        }
      }

      const userName = user.name || pushName;

      // 4. Check if there is an active pending draft for this user (Interactive Decision Handling)
      const activeDraft = await this.confirmationFlow.getActiveDraft(user.phone_number);
      if (activeDraft && !hasMedia) {
        const decision = this.confirmationFlow.classifyUserDecision(body);

        // Case A: Confirm draft -> save officially
        if (decision.type === "CONFIRM") {
          const result = await this.confirmationFlow.executeConfirmedDraft(activeDraft);
          await sock.sendMessage(remoteJid, { text: result.replyText }, { quoted: msg });
          await this.chatRepo.logMessage({
            user_phone: user.phone_number,
            user_name: "Bot",
            message_type: "text",
            direction: "outbound",
            content: result.replyText,
          });
          return;
        }

        // Case B: Cancel draft
        if (decision.type === "CANCEL") {
          const cancelReply = await this.confirmationFlow.cancelActiveDraft(activeDraft);
          await sock.sendMessage(remoteJid, { text: cancelReply }, { quoted: msg });
          await this.chatRepo.logMessage({
            user_phone: user.phone_number,
            user_name: "Bot",
            message_type: "text",
            direction: "outbound",
            content: cancelReply,
          });
          return;
        }

        // Case C: Modify / Clarify draft
        if (decision.type === "MODIFY") {
          const clean = body.trim().toLowerCase();
          const currentPayload: TransactionDraft = { ...(activeDraft.payload as TransactionDraft) };

          if (clean === "pemasukan" || clean === "1" || clean === "income" || clean === "masuk" || clean === "penjualan" || clean === "uang masuk") {
            currentPayload.type = "income";
            if (!currentPayload.category || !currentPayload.category.toLowerCase().startsWith("pemasukan")) {
              currentPayload.category = "Pemasukan: Penjualan";
            }
            await this.pendingRepo.updatePayload(activeDraft.id, currentPayload, user.phone_number);
            const preview = this.confirmationFlow.formatDraftPreview(currentPayload);
            const reply = `✅ Draf diubah menjadi *Pemasukan*:\n\n${preview}`;
            await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
            return;
          }

          if (clean === "pengeluaran" || clean === "2" || clean === "expense" || clean === "keluar" || clean === "belanja" || clean === "uang keluar") {
            currentPayload.type = "expense";
            if (currentPayload.category && currentPayload.category.toLowerCase().startsWith("pemasukan")) {
              currentPayload.category = "Makanan & Minuman";
            }
            await this.pendingRepo.updatePayload(activeDraft.id, currentPayload, user.phone_number);
            const preview = this.confirmationFlow.formatDraftPreview(currentPayload);
            const reply = `✅ Draf diubah menjadi *Pengeluaran*:\n\n${preview}`;
            await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
            return;
          }

          // Field edits (e.g. "ubah metode ke Cash", "nominal 150rb", "toko Alfamart")
          const edits = extractDeterministicEdits(body);
          if (Object.keys(edits).length > 0) {
            Object.assign(currentPayload, edits);
            if (edits.total_amount) currentPayload.subtotal = edits.total_amount;
            await this.pendingRepo.updatePayload(activeDraft.id, currentPayload, user.phone_number);
            const preview = this.confirmationFlow.formatDraftPreview(currentPayload);
            const reply = `✏️ *Draf Transaksi Berhasil Diperbarui:*\n\n${preview}`;
            await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
            return;
          }
        }
      }

      // 5. Handle Media Messages (Receipt Photos & Voice Notes)
      if (hasMedia) {
        // CASE A: Image / Receipt / Nota / PDF Invoice / Uncompressed Image Document
        if (isImage || isDocument) {
          const docMime = messageContent.documentMessage?.mimetype || "";
          const docFileName = messageContent.documentMessage?.fileName || "";
          const isPdf = isDocument && (docMime.includes("pdf") || docFileName.endsWith(".pdf"));
          const isDocImage = isDocument && (docMime.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(docFileName));

          await sock.sendMessage(
            remoteJid,
            { text: isPdf ? "⏳ *Sedang membaca dokumen invoice / struk PDF dengan AI...*" : "⏳ *Sedang membaca struk belanja dengan AI...*" },
            { quoted: msg }
          );

          const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}, { reuploadRequest: sock.updateMediaMessage })) as Buffer;
          const mimeType = isPdf
            ? "application/pdf"
            : isDocImage
            ? (docMime || "image/jpeg")
            : (messageContent.imageMessage?.mimetype || "image/jpeg");

          const parsed = await parseReceiptVision(mediaBuffer, mimeType, body);
          if (!parsed || parsed.total_amount <= 0) {
            await sock.sendMessage(
              remoteJid,
              { text: isPdf ? "⚠️ AI tidak dapat mendeteksi transaksi dari dokumen PDF ini." : "⚠️ AI tidak dapat mendeteksi total belanja dari foto struk ini. Pastikan foto jelas dan tidak buram." },
              { quoted: msg }
            );
            return;
          }

          // Upload to Google Drive (Compressed WebP / PDF) with Supabase Storage fallback
          let gdriveLink = "";
          let gdriveFileId = "";
          try {
            const uploadRes = await googleDriveService.uploadReceipt(
              mediaBuffer,
              `DRAFT_${Date.now()}_${parsed.merchant.replace(/[^a-zA-Z0-9]/g, "_")}`,
              userName,
              isPdf
            );
            gdriveLink = uploadRes.webViewLink;
            gdriveFileId = uploadRes.fileId;
          } catch (driveErr) {
            logger.error({ driveErr }, "Failed to upload receipt file to Drive");
          }

          // Check for potential duplicate within last 10 minutes
          const potentialDuplicate = await this.duplicateDetector.detectDuplicate(
            parsed.total_amount,
            parsed.merchant,
            10
          );

          const draft: TransactionDraft = {
            type: parsed.type,
            merchant: parsed.merchant,
            date: parsed.date,
            category: parsed.category,
            subtotal: parsed.subtotal,
            tax: parsed.tax,
            discount: parsed.discount,
            total_amount: parsed.total_amount,
            payment_method: parsed.payment_method,
            raw_text: body || "-",
            items: parsed.items,
            gdrive_file_id: gdriveFileId,
            gdrive_web_view_link: gdriveLink,
          };

          await this.confirmationFlow.createDraft(user.phone_number, userName, "CREATE_TRANSACTION", draft, gdriveLink);
          let preview = this.confirmationFlow.formatDraftPreview(draft);
          if (potentialDuplicate) {
            preview = formatDuplicateWarning(potentialDuplicate, parsed.total_amount, parsed.merchant) + "\n\n────────────────────────\n\n" + preview;
          }

          await sock.sendMessage(remoteJid, { text: preview }, { quoted: msg });
          await this.chatRepo.logMessage({
            user_phone: user.phone_number,
            user_name: "Bot",
            message_type: "text",
            direction: "outbound",
            content: preview,
          });
          return;
        }

        // CASE B: Audio / Voice Note
        if (isAudio) {
          await sock.sendMessage(remoteJid, { text: "🎧 *Mendengarkan rekaman suara...*" }, { quoted: msg });

          const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}, { reuploadRequest: sock.updateMediaMessage })) as Buffer;
          const mimeType = messageContent.audioMessage?.mimetype || "audio/ogg";

          const audioResult = await parseAudioVoiceNote(mediaBuffer, mimeType);
          const { transcription, is_question, is_complete, clarification_question, transaction } = audioResult;

          // Sub-case 1: Voice Q&A / Tanya Saldo / Cari Riwayat via Voice Note
          if (is_question) {
            const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);
            const queryRes = await executeNaturalQuerySearch(
              audioResult.question_text || transcription,
              this.trxRepo,
              isSuperAdmin,
              senderPhone
            );
            const reply = `🗣️ *Transkrip Suara:* "${transcription}"\n\n${queryRes.replyText || "Pertanyaan tidak dapat diproses."}`;
            await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
            await this.chatRepo.logMessage({
              user_phone: senderPhone,
              user_name: "Bot",
              message_type: "text",
              direction: "outbound",
              content: reply,
            });
            return;
          }

          if (!is_complete || !transaction || transaction.total_amount <= 0) {
            const reply =
              clarification_question ||
              ("🗣️ *Transkrip Suara:* \"" + (transcription || "(Suara tidak jelas)") + "\"\n\n⚠️ Mohon lengkapi nama barang/sumber, nominal harga, dan metode pembayaran.");
            await sock.sendMessage(
              remoteJid,
              { text: reply },
              { quoted: msg }
            );
            await this.chatRepo.logMessage({
              user_phone: senderPhone,
              user_name: "Bot",
              message_type: "text",
              direction: "outbound",
              content: reply,
            });
            return;
          }

          const potentialDuplicate = await this.duplicateDetector.detectDuplicate(
            transaction.total_amount,
            transaction.merchant,
            10
          );

          const draft: TransactionDraft = {
            type: transaction.type,
            merchant: transaction.merchant,
            date: transaction.date,
            category: transaction.category,
            subtotal: transaction.subtotal,
            tax: transaction.tax,
            discount: transaction.discount,
            total_amount: transaction.total_amount,
            payment_method: transaction.payment_method,
            raw_text: transcription,
            items: transaction.items,
          };

          await this.confirmationFlow.createDraft(user.phone_number, userName, "CREATE_TRANSACTION", draft);
          let preview = this.confirmationFlow.formatDraftPreview(draft);
          if (potentialDuplicate) {
            preview = formatDuplicateWarning(potentialDuplicate, transaction.total_amount, transaction.merchant) + "\n\n────────────────────────\n\n" + preview;
          }

          const replyText = `🗣️ *Transkrip Suara:* "${transcription}"\n\n${preview}`;
          await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
          await this.chatRepo.logMessage({
            user_phone: senderPhone,
            user_name: "Bot",
            message_type: "text",
            direction: "outbound",
            content: replyText,
          });
          return;
        }
      }

      // 6. Handle Text Messages
      if (body.trim().length > 0) {
        const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);

        // Check if message is a natural query or question (e.g. "Berapa saldo kas?", "Cari nota bensin")
        try {
          const queryCheck = await executeNaturalQuerySearch(body, this.trxRepo, isSuperAdmin, senderPhone);
          if (queryCheck.isQuery) {
            await sock.sendMessage(remoteJid, { text: queryCheck.replyText }, { quoted: msg });
            await this.chatRepo.logMessage({
              user_phone: senderPhone,
              user_name: "Bot",
              message_type: "text",
              direction: "outbound",
              content: queryCheck.replyText,
            });
            return;
          }
        } catch (searchErr) {
          logger.debug({ searchErr }, "Query search check bypass to standard text parser");
        }

        const history = await this.chatRepo.getRecentChatHistory(senderPhone, 3);
        const historyStrings = history.map((h) => (h.direction === "inbound" ? "User: " : "Bot: ") + h.content);

        let textResult = null;
        try {
          textResult = await parseTransactionText(body, historyStrings);
        } catch (aiErr) {
          logger.error({ aiErr }, "AI text parsing error");
          await sock.sendMessage(remoteJid, { text: "⚠️ Sistem AI sedang sibuk sementara. Silakan coba kirim ulang dalam beberapa detik." }, { quoted: msg });
          return;
        }

        if (!textResult.is_complete || !textResult.transaction || textResult.transaction.total_amount <= 0) {
          const reply = textResult.reply_message || "💬 Pesan Anda diterima! Ketik transaksi (contoh: *Beli makan 25rb cash* atau *Pemasukan 5jt mandiri*) atau kirim foto struk/voice note untuk dicatat otomatis.";
          await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
          await this.chatRepo.logMessage({
            user_phone: senderPhone,
            user_name: "Bot",
            message_type: "text",
            direction: "outbound",
            content: reply,
          });
          return;
        }

        const parsed = textResult.transaction;
        const potentialDuplicate = await this.duplicateDetector.detectDuplicate(
          parsed.total_amount,
          parsed.merchant,
          10
        );

        const draft: TransactionDraft = {
          type: parsed.type,
          merchant: parsed.merchant,
          date: parsed.date,
          category: parsed.category,
          subtotal: parsed.subtotal,
          tax: parsed.tax,
          discount: parsed.discount,
          total_amount: parsed.total_amount,
          payment_method: parsed.payment_method,
          raw_text: body,
          items: parsed.items,
        };

        await this.confirmationFlow.createDraft(user.phone_number, userName, "CREATE_TRANSACTION", draft);
        let preview = this.confirmationFlow.formatDraftPreview(draft);
        if (potentialDuplicate) {
          preview = formatDuplicateWarning(potentialDuplicate, parsed.total_amount, parsed.merchant) + "\n\n────────────────────────\n\n" + preview;
        }

        await sock.sendMessage(remoteJid, { text: preview }, { quoted: msg });
        await this.chatRepo.logMessage({
          user_phone: senderPhone,
          user_name: "Bot",
          message_type: "text",
          direction: "outbound",
          content: preview,
        });
      }
  } catch (fatalErr: any) {
    logger.error({ fatalErr, senderPhone, remoteJid }, "Unhandled error during processIncomingMessage");
    try {
      await sock.sendMessage(
        remoteJid,
        { text: "⚠️ Terjadi kendala teknis sementara saat memproses pesan Anda. Silakan coba kirim ulang." },
        { quoted: msg }
      );
    } catch (replyErr) {
      logger.error({ replyErr }, "Failed to send error fallback message");
    }
  }
}
}
