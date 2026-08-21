import * as Baileys from "@whiskeysockets/baileys";
const { downloadMediaMessage } = Baileys;
import { CommandHandler } from "./command.handler.js";
import { parseTransactionText } from "../../ai/parsers/text.parser.js";
import { parseReceiptVision } from "../../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../../ai/parsers/audio.parser.js";
import { executeNaturalQuerySearch } from "../../ai/parsers/search.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { formatTransactionSuccess, formatDuplicateWarning, formatBudgetWarning, } from "../formatters/reply.formatter.js";
import { DuplicateDetectorService } from "../../services/duplicate-detector.service.js";
import { logger } from "../../utils/logger.js";
import { normalizePhoneNumber } from "../../utils/phone.utils.js";
export class MessageHandler {
    userRepo;
    trxRepo;
    chatRepo;
    budgetRepo;
    billRepo;
    commandHandler;
    duplicateDetector;
    processedMessageIds = new Set();
    constructor(userRepo, trxRepo, chatRepo, budgetRepo, billRepo) {
        this.userRepo = userRepo;
        this.trxRepo = trxRepo;
        this.chatRepo = chatRepo;
        this.budgetRepo = budgetRepo;
        this.billRepo = billRepo;
        this.commandHandler = new CommandHandler(userRepo, trxRepo, budgetRepo, billRepo);
        this.duplicateDetector = new DuplicateDetectorService(trxRepo);
    }
    async checkBudgetAlert(category, dateStr) {
        if (!this.budgetRepo || category.startsWith("Pemasukan"))
            return null;
        const monthStr = dateStr.slice(0, 7);
        const budget = await this.budgetRepo.getBudgetByCategory(category, monthStr);
        if (!budget || budget.limit_amount <= 0)
            return null;
        const monthly = await this.trxRepo.getMonthlySummary(monthStr);
        const matchedKey = Object.keys(monthly.byCategory || {}).find((k) => k.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes(k.toLowerCase()));
        const spent = matchedKey ? monthly.byCategory[matchedKey] : 0;
        const percent = (spent / budget.limit_amount) * 100;
        if (percent >= 100 && !budget.is_alerted_100) {
            await this.budgetRepo.markAlerted(category, monthStr, 100);
            return formatBudgetWarning(category, spent, budget.limit_amount, percent);
        }
        else if (percent >= 80 && percent < 100 && !budget.is_alerted_80) {
            await this.budgetRepo.markAlerted(category, monthStr, 80);
            return formatBudgetWarning(category, spent, budget.limit_amount, percent);
        }
        return null;
    }
    cleanPhone(from) {
        return normalizePhoneNumber(from);
    }
    async processIncomingMessage(sock, msg) {
        if (!msg.message || msg.key.fromMe)
            return;
        const remoteJid = msg.key.remoteJid;
        // Strictly Private Chat Only: drop status broadcast and any WhatsApp group messages (@g.us)
        if (!remoteJid || remoteJid.includes("status@broadcast") || remoteJid.endsWith("@g.us"))
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
        const senderPhone = this.cleanPhone(remoteJid);
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
        logger.info({ senderPhone, pushName, hasMedia, isImage, isAudio }, "Processing incoming Baileys private message");
        // Send Read Receipt (Centang Biru) & Typing Indicator ("Sedang mengetik...")
        try {
            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate("composing", remoteJid);
        }
        catch (presenceErr) {
            logger.debug({ presenceErr }, "Presence / Read receipt update non-critical error");
        }
        try {
            // 1. Log chat
            await this.chatRepo.logMessage({
                user_phone: senderPhone,
                user_name: pushName,
                message_type: isImage ? "image" : isAudio ? "audio" : isDocument ? "document" : "text",
                direction: "inbound",
                content: body,
            });
            // 2. User Access & Status Check
            const user = await this.userRepo.getOrCreateUser(senderPhone, pushName);
            if (user.status === "blocked") {
                logger.warn({ senderPhone, pushName }, "Blocked user attempted to message bot");
                await sock.sendMessage(remoteJid, {
                    text: "🚫 Akses nomor Anda telah dinonaktifkan oleh Super Admin.",
                }, { quoted: msg });
                return;
            }
            // 3. Command Check (Super Admin vs Member commands)
            if (body.startsWith("/")) {
                const { handled, responseMessage } = await this.commandHandler.handleCommand(senderPhone, body);
                if (handled) {
                    await sock.sendMessage(remoteJid, { text: responseMessage }, { quoted: msg });
                    return;
                }
                else {
                    // Gap 2: Safety guard to prevent unhandled slash messages from falling through to AI
                    await sock.sendMessage(remoteJid, { text: "❓ Perintah tidak dikenal. Ketik `/menu` untuk melihat daftar panduan & perintah." }, { quoted: msg });
                    return;
                }
            }
            const userName = user.name || pushName;
            // 4. Handle Media Messages (Receipt Photos & Voice Notes)
            if (hasMedia) {
                // CASE A: Image / Receipt / Nota / PDF Invoice / Uncompressed Image Document (Gap 32)
                if (isImage || isDocument) {
                    const docMime = messageContent.documentMessage?.mimetype || "";
                    const docFileName = messageContent.documentMessage?.fileName || "";
                    const isPdf = isDocument && (docMime.includes("pdf") || docFileName.endsWith(".pdf"));
                    const isDocImage = isDocument && (docMime.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(docFileName));
                    await sock.sendMessage(remoteJid, { text: isPdf ? "⏳ *Sedang membaca dokumen invoice / struk PDF dengan AI...*" : "⏳ *Sedang membaca struk belanja dengan AI...*" }, { quoted: msg });
                    const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}, { reuploadRequest: sock.updateMediaMessage }));
                    const mimeType = isPdf
                        ? "application/pdf"
                        : isDocImage
                            ? (docMime || "image/jpeg")
                            : (messageContent.imageMessage?.mimetype || "image/jpeg");
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
                    // Reply Success (with duplicate warning or budget warning if detected)
                    const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);
                    const wallet = await this.trxRepo.getWalletBalance();
                    const budgetNotice = await this.checkBudgetAlert(parsed.category, parsed.date);
                    let replyText = formatTransactionSuccess(transactionRecord, parsed.items, isSuperAdmin, wallet.balance);
                    if (potentialDuplicate) {
                        replyText = formatDuplicateWarning(potentialDuplicate, parsed.total_amount, parsed.merchant) + "\n\n────────────────────────\n\n" + replyText;
                    }
                    if (budgetNotice) {
                        replyText += "\n\n────────────────────────\n\n" + budgetNotice;
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
                    const budgetNotice = await this.checkBudgetAlert(transaction.category, transaction.date);
                    let replyText = "🗣️ *Transkrip:* \"" + transcription + "\"\n\n";
                    replyText += formatTransactionSuccess(transactionRecord, transaction.items, isSuperAdmin, wallet.balance);
                    if (potentialDuplicate) {
                        replyText = formatDuplicateWarning(potentialDuplicate, transaction.total_amount, transaction.merchant) + "\n\n────────────────────────\n\n" + replyText;
                    }
                    if (budgetNotice) {
                        replyText += "\n\n────────────────────────\n\n" + budgetNotice;
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
                const budgetNotice = await this.checkBudgetAlert(parsed.category, parsed.date);
                let replyText = formatTransactionSuccess(transactionRecord, parsed.items, isSuperAdmin, wallet.balance);
                if (potentialDuplicate) {
                    replyText = formatDuplicateWarning(potentialDuplicate, parsed.total_amount, parsed.merchant) + "\n\n────────────────────────\n\n" + replyText;
                }
                if (budgetNotice) {
                    replyText += "\n\n────────────────────────\n\n" + budgetNotice;
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
        catch (fatalErr) {
            logger.error({ fatalErr, senderPhone, remoteJid }, "Unhandled error during processIncomingMessage");
            try {
                await sock.sendMessage(remoteJid, { text: "⚠️ Terjadi kendala teknis sementara saat memproses pesan Anda. Silakan coba kirim ulang." }, { quoted: msg });
            }
            catch (replyErr) {
                logger.error({ replyErr }, "Failed to send error fallback message");
            }
        }
    }
}
//# sourceMappingURL=message.handler.js.map