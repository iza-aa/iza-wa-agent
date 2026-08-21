import * as Baileys from "@whiskeysockets/baileys";
const { downloadMediaMessage } = Baileys;
import { CommandHandler } from "./command.handler.js";
import { parseTransactionText } from "../../ai/parsers/text.parser.js";
import { parseReceiptVision } from "../../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../../ai/parsers/audio.parser.js";
import { executeNaturalQuerySearch } from "../../ai/parsers/search.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { formatTransactionSuccess, formatPendingApprovalNotification, formatDuplicateWarning, } from "../formatters/reply.formatter.js";
import { DuplicateDetectorService } from "../../services/duplicate-detector.service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/env.js";
export class MessageHandler {
    userRepo;
    trxRepo;
    chatRepo;
    commandHandler;
    duplicateDetector;
    processedMessageIds = new Set();
    constructor(userRepo, trxRepo, chatRepo) {
        this.userRepo = userRepo;
        this.trxRepo = trxRepo;
        this.chatRepo = chatRepo;
        this.commandHandler = new CommandHandler(userRepo, trxRepo);
        this.duplicateDetector = new DuplicateDetectorService(trxRepo);
    }
    cleanPhone(from) {
        const digits = from.replace(/@s\.whatsapp\.net|@c\.us|@lid|@g\.us/g, "").replace(/[^0-9]/g, "");
        // Known WhatsApp multi-device LID mappings
        if (digits === "232130131046571")
            return "6281346367235";
        if (digits === "168096866255025")
            return "62811422404";
        if (digits === "113404400390171")
            return "6282147440520";
        return digits;
    }
    async processIncomingMessage(sock, msg) {
        if (!msg.message || msg.key.fromMe)
            return;
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.includes("status@broadcast"))
            return;
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
        const isGroup = remoteJid.endsWith("@g.us");
        const rawParticipant = msg.key.participant || msg.participant;
        const senderPhone = isGroup && rawParticipant ? this.cleanPhone(rawParticipant) : this.cleanPhone(remoteJid);
        const pushName = msg.pushName || "User";
        // Extract text body
        const messageContent = msg.message;
        const body = messageContent.conversation ||
            messageContent.extendedTextMessage?.text ||
            messageContent.imageMessage?.caption ||
            messageContent.videoMessage?.caption ||
            messageContent.documentMessage?.caption ||
            "";
        const isImage = !!messageContent.imageMessage;
        const isAudio = !!messageContent.audioMessage;
        const isDocument = !!messageContent.documentMessage;
        const hasMedia = isImage || isAudio || isDocument;
        // Group anti-spam filter: In groups, only respond if message is media, command, mentions bot, or transaction keywords
        if (isGroup && !hasMedia) {
            const lowerBody = body.toLowerCase().trim();
            const isCommand = lowerBody.startsWith("/");
            const mentionsBot = lowerBody.includes("bot") || lowerBody.includes("agent") || (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []).some((j) => j.includes("62881082854818"));
            const isTrxKeyword = /^(beli|bayar|pengeluaran|pemasukan|belanja|kasbon|gaji|bensin|makan|saldo|rekap|laporan)\b/i.test(lowerBody);
            if (!isCommand && !mentionsBot && !isTrxKeyword) {
                // Silently skip general group chatter
                return;
            }
        }
        logger.info({ senderPhone, pushName, isGroup, hasMedia, isImage, isAudio }, "Processing incoming Baileys message");
        // Send Read Receipt (Centang Biru) & Typing Indicator ("Sedang mengetik...")
        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);
        }
        catch (presenceErr) {
            logger.debug({ presenceErr }, "Presence / Read receipt update non-critical error");
        }
        // 1. Log chat
        await this.chatRepo.logMessage({
            user_phone: senderPhone,
            user_name: pushName,
            message_type: isImage ? "image" : isAudio ? "audio" : isDocument ? "document" : "text",
            direction: "inbound",
            content: body,
        });
        // 2. Whitelist / Access Control Check (Must be BEFORE any command or message processing)
        const isAllowed = await this.userRepo.isWhitelisted(senderPhone, pushName);
        let user = await this.userRepo.getUser(senderPhone, pushName);
        if (!isAllowed) {
            if (user && user.status === "blocked") {
                logger.warn({ senderPhone, pushName }, "Blocked user attempted to message bot");
                await sock.sendMessage(remoteJid, {
                    text: "🚫 Nomor Anda telah diblokir dari sistem ini.",
                }, { quoted: msg });
                return;
            }
            const superAdminPhone = config.SUPER_ADMIN_PHONE;
            logger.warn({ senderPhone, pushName }, "Unauthorized user attempted to message bot");
            await sock.sendMessage(remoteJid, {
                text: "👋 Halo! Nomor Anda belum terdaftar di sistem.\nPermintaan akses telah dikirimkan ke Super Admin untuk persetujuan.",
            }, { quoted: msg });
            // Notify Super Admin
            try {
                const superAdminJid = superAdminPhone + "@s.whatsapp.net";
                await sock.sendMessage(superAdminJid, {
                    text: formatPendingApprovalNotification(senderPhone, pushName),
                });
            }
            catch (adminNotifyErr) {
                logger.error({ adminNotifyErr }, "Failed to notify Super Admin of new user");
            }
            return;
        }
        // 3. Super Admin & Command Check (Only for authorized users)
        if (body.startsWith("/")) {
            const { handled, responseMessage } = await this.commandHandler.handleCommand(senderPhone, body);
            if (handled) {
                await sock.sendMessage(remoteJid, { text: responseMessage }, { quoted: msg });
                return;
            }
        }
        const isSuperAdminUser = await this.userRepo.isSuperAdminAsync(senderPhone);
        if (!user && isSuperAdminUser) {
            user = await this.userRepo.upsertUser({
                phone_number: senderPhone,
                name: "Super Admin (" + pushName + ")",
                role: "super_admin",
                status: "active",
            });
        }
        const userName = user?.name || pushName;
        // 4. Handle Media Messages (Receipt Photos & Voice Notes)
        if (hasMedia) {
            // CASE A: Image / Receipt / Nota / PDF Invoice
            if (isImage || isDocument) {
                const isPdf = isDocument && (messageContent.documentMessage?.mimetype?.includes("pdf") || (messageContent.documentMessage?.fileName || "").endsWith(".pdf"));
                await sock.sendMessage(remoteJid, { text: isPdf ? "⏳ *Sedang membaca dokumen invoice / struk PDF dengan AI...*" : "⏳ *Sedang membaca struk belanja dengan AI...*" }, { quoted: msg });
                const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}, { reuploadRequest: sock.updateMediaMessage }));
                const mimeType = isPdf ? "application/pdf" : (messageContent.imageMessage?.mimetype || "image/jpeg");
                const parsed = await parseReceiptVision(mediaBuffer, mimeType, body);
                if (!parsed || parsed.total_amount <= 0) {
                    await sock.sendMessage(remoteJid, { text: isPdf ? "⚠️ AI tidak dapat mendeteksi transaksi dari dokumen PDF ini." : "⚠️ AI tidak dapat mendeteksi total belanja dari foto struk ini. Pastikan foto jelas dan tidak buram." }, { quoted: msg });
                    return;
                }
                const trxId = await this.trxRepo.generateTransactionId(parsed.date);
                // Upload to Google Drive (Compressed WebP / PDF) with Supabase Storage fallback
                let gdriveLink = "";
                let gdriveFileId = "";
                try {
                    const uploadRes = await googleDriveService.uploadReceipt(mediaBuffer, trxId + "_" + parsed.merchant.replace(/[^a-zA-Z0-9]/g, "_"), userName, isPdf);
                    gdriveLink = uploadRes.webViewLink;
                    gdriveFileId = uploadRes.fileId;
                }
                catch (driveErr) {
                    logger.error({ driveErr }, "Failed to upload receipt file");
                }
                // Check for potential duplicate within last 10 minutes
                const potentialDuplicate = await this.duplicateDetector.detectDuplicate(parsed.total_amount, parsed.merchant, 10);
                // Save to Supabase
                const transactionRecord = await this.trxRepo.createTransaction({
                    id: trxId,
                    user_phone: senderPhone,
                    user_name: userName,
                    date: parsed.date,
                    merchant: parsed.merchant,
                    category: parsed.category,
                    subtotal: parsed.subtotal,
                    tax: parsed.tax,
                    discount: parsed.discount,
                    total_amount: parsed.total_amount,
                    payment_method: parsed.payment_method,
                    gdrive_file_id: gdriveFileId,
                    gdrive_web_view_link: gdriveLink,
                    raw_text: body,
                    confidence_score: parsed.confidence_score,
                }, parsed.items.map((i) => ({
                    item_name: i.item_name,
                    qty: i.qty,
                    price: i.price,
                    total_price: i.total_price,
                    category: i.category,
                })));
                // Sync to Google Sheet
                try {
                    const sheetRes = await googleSheetsService.appendTransaction(transactionRecord, parsed.items);
                    await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
                }
                catch (sheetErr) {
                    logger.error({ sheetErr }, "Failed to append row to Google Sheet");
                }
                // Reply Success (with duplicate warning if detected)
                const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);
                const wallet = await this.trxRepo.getWalletBalance();
                let replyText = formatTransactionSuccess(transactionRecord, parsed.items, isSuperAdmin, wallet.balance);
                if (potentialDuplicate) {
                    replyText = formatDuplicateWarning(potentialDuplicate, parsed.total_amount, parsed.merchant) + "\n\n────────────────────────\n\n" + replyText;
                }
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                return;
            }
            // CASE B: Audio / Voice Note
            if (isAudio) {
                await sock.sendMessage(remoteJid, { text: "🎧 *Mendengarkan rekaman suara...*" }, { quoted: msg });
                const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}, { reuploadRequest: sock.updateMediaMessage }));
                const mimeType = messageContent.audioMessage?.mimetype || "audio/ogg";
                const audioResult = await parseAudioVoiceNote(mediaBuffer, mimeType);
                const { transcription, is_question, is_complete, clarification_question, transaction } = audioResult;
                // Sub-case 1: Voice Q&A / Tanya Saldo / Cari Riwayat via Voice Note
                if (is_question) {
                    const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);
                    const queryRes = await executeNaturalQuerySearch(audioResult.question_text || transcription, this.trxRepo, isSuperAdmin, senderPhone);
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
                    const reply = clarification_question ||
                        ("🗣️ *Transkrip Suara:* \"" + (transcription || "(Suara tidak jelas)") + "\"\n\n⚠️ Mohon lengkapi nama barang/sumber, nominal harga, dan metode pembayaran.");
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
                const trxId = await this.trxRepo.generateTransactionId(transaction.date);
                // Check for potential duplicate within last 10 minutes
                const potentialDuplicate = await this.duplicateDetector.detectDuplicate(transaction.total_amount, transaction.merchant, 10);
                const transactionRecord = await this.trxRepo.createTransaction({
                    id: trxId,
                    user_phone: senderPhone,
                    user_name: userName,
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
                }, transaction.items);
                try {
                    const sheetRes = await googleSheetsService.appendTransaction(transactionRecord, transaction.items);
                    await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
                }
                catch (sheetErr) {
                    logger.error({ sheetErr }, "Failed to append row to Google Sheet");
                }
                const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);
                const wallet = await this.trxRepo.getWalletBalance();
                let replyText = "🗣️ *Transkrip:* \"" + transcription + "\"\n\n";
                replyText += formatTransactionSuccess(transactionRecord, transaction.items, isSuperAdmin, wallet.balance);
                if (potentialDuplicate) {
                    replyText = formatDuplicateWarning(potentialDuplicate, transaction.total_amount, transaction.merchant) + "\n\n────────────────────────\n\n" + replyText;
                }
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                return;
            }
        }
        // 5. Handle Text Messages
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
            }
            catch (searchErr) {
                logger.debug({ searchErr }, "Query search check bypass to standard text parser");
            }
            const history = await this.chatRepo.getRecentChatHistory(senderPhone, 3);
            const historyStrings = history.map((h) => (h.direction === "inbound" ? "User: " : "Bot: ") + h.content);
            let textResult = null;
            try {
                textResult = await parseTransactionText(body, historyStrings);
            }
            catch (aiErr) {
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
            const trxId = await this.trxRepo.generateTransactionId(parsed.date);
            // Check for potential duplicate within last 10 minutes
            const potentialDuplicate = await this.duplicateDetector.detectDuplicate(parsed.total_amount, parsed.merchant, 10);
            const transactionRecord = await this.trxRepo.createTransaction({
                id: trxId,
                user_phone: senderPhone,
                user_name: userName,
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
            }, parsed.items);
            try {
                const sheetRes = await googleSheetsService.appendTransaction(transactionRecord, parsed.items);
                await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
            }
            catch (sheetErr) {
                logger.error({ sheetErr }, "Failed to append row to Google Sheet");
            }
            const wallet = await this.trxRepo.getWalletBalance();
            let replyText = formatTransactionSuccess(transactionRecord, parsed.items, isSuperAdmin, wallet.balance);
            if (potentialDuplicate) {
                replyText = formatDuplicateWarning(potentialDuplicate, parsed.total_amount, parsed.merchant) + "\n\n────────────────────────\n\n" + replyText;
            }
            await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            await this.chatRepo.logMessage({
                user_phone: senderPhone,
                user_name: "Bot",
                message_type: "text",
                direction: "outbound",
                content: replyText,
            });
        }
    }
}
//# sourceMappingURL=message.handler.js.map