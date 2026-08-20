import * as Baileys from "@whiskeysockets/baileys";
const { downloadMediaMessage } = Baileys;
import { CommandHandler } from "./command.handler.js";
import { parseTransactionText } from "../../ai/parsers/text.parser.js";
import { parseReceiptVision } from "../../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../../ai/parsers/audio.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { formatTransactionSuccess, formatPendingApprovalNotification, } from "../formatters/reply.formatter.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/env.js";
export class MessageHandler {
    userRepo;
    trxRepo;
    chatRepo;
    commandHandler;
    constructor(userRepo, trxRepo, chatRepo) {
        this.userRepo = userRepo;
        this.trxRepo = trxRepo;
        this.chatRepo = chatRepo;
        this.commandHandler = new CommandHandler(userRepo, trxRepo);
    }
    cleanPhone(from) {
        return from.replace(/@s\.whatsapp\.net|@c\.us|@g\.us/g, "").replace(/[^0-9]/g, "");
    }
    async processIncomingMessage(sock, msg) {
        if (!msg.message || msg.key.fromMe)
            return;
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.includes("status@broadcast"))
            return;
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
        logger.info({ senderPhone, pushName, hasMedia, isImage, isAudio }, "Processing incoming Baileys message");
        // 1. Log chat
        await this.chatRepo.logMessage({
            user_phone: senderPhone,
            user_name: pushName,
            message_type: isImage ? "image" : isAudio ? "audio" : isDocument ? "document" : "text",
            direction: "inbound",
            content: body,
        });
        // 2. Super Admin & Command Check
        if (body.startsWith("/")) {
            const { handled, responseMessage } = await this.commandHandler.handleCommand(senderPhone, body);
            if (handled) {
                await sock.sendMessage(remoteJid, { text: responseMessage }, { quoted: msg });
                return;
            }
        }
        // 3. Whitelist / Access Control Check
        const isAllowed = await this.userRepo.isWhitelisted(senderPhone);
        if (!isAllowed) {
            const superAdminPhone = config.SUPER_ADMIN_PHONE;
            logger.warn({ senderPhone }, "Unauthorized user attempted to message bot");
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
        // Get User Profile from DB (or auto-register Super Admin)
        let user = await this.userRepo.getUser(senderPhone);
        if (!user && this.userRepo.isSuperAdmin(senderPhone)) {
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
            // CASE A: Image / Receipt / Nota
            if (isImage) {
                await sock.sendMessage(remoteJid, { text: "⏳ *Sedang membaca struk belanja dengan AI...*" }, { quoted: msg });
                const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}));
                const mimeType = messageContent.imageMessage?.mimetype || "image/jpeg";
                const parsed = await parseReceiptVision(mediaBuffer, mimeType);
                if (!parsed || parsed.total_amount <= 0) {
                    await sock.sendMessage(remoteJid, { text: "⚠️ AI tidak dapat mendeteksi total belanja dari foto struk ini. Pastikan foto jelas dan tidak buram." }, { quoted: msg });
                    return;
                }
                const trxId = this.trxRepo.generateTransactionId();
                // Upload to Google Drive (Compressed WebP) with Supabase Storage fallback
                let gdriveLink = "";
                let gdriveFileId = "";
                try {
                    const uploadRes = await googleDriveService.uploadReceipt(mediaBuffer, trxId + "_" + parsed.merchant.replace(/[^a-zA-Z0-9]/g, "_"), userName);
                    gdriveLink = uploadRes.webViewLink;
                    gdriveFileId = uploadRes.fileId;
                }
                catch (driveErr) {
                    logger.error({ driveErr }, "Failed to upload receipt image");
                }
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
                // Reply Success
                const replyText = formatTransactionSuccess(transactionRecord, parsed.items);
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                return;
            }
            // CASE B: Audio / Voice Note
            if (isAudio) {
                await sock.sendMessage(remoteJid, { text: "🎧 *Mendengarkan rekaman suara & memproses transaksi...*" }, { quoted: msg });
                const mediaBuffer = (await downloadMediaMessage(msg, "buffer", {}));
                const mimeType = messageContent.audioMessage?.mimetype || "audio/ogg";
                const { transcription, transaction } = await parseAudioVoiceNote(mediaBuffer, mimeType);
                if (!transaction || transaction.total_amount <= 0) {
                    await sock.sendMessage(remoteJid, {
                        text: "🗣️ *Transkrip Suara:* \"" + (transcription || "(Suara tidak jelas)") + "\"\n\n⚠️ Tidak ditemukan nominal pengeluaran dalam suara Anda.",
                    }, { quoted: msg });
                    return;
                }
                const trxId = this.trxRepo.generateTransactionId();
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
                let replyText = "🗣️ *Transkrip:* \"" + transcription + "\"\n\n";
                replyText += formatTransactionSuccess(transactionRecord, transaction.items);
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                return;
            }
        }
        // 5. Handle Text Messages
        if (body.trim().length > 0) {
            const history = await this.chatRepo.getRecentChatHistory(senderPhone, 3);
            const historyStrings = history.map((h) => (h.direction === "inbound" ? "User: " : "Bot: ") + h.content);
            let parsed = null;
            try {
                parsed = await parseTransactionText(body, historyStrings);
            }
            catch (aiErr) {
                logger.error({ aiErr }, "AI text parsing error");
                await sock.sendMessage(remoteJid, { text: "⚠️ Sistem AI sedang sibuk sementara. Silakan coba kirim ulang dalam beberapa detik." }, { quoted: msg });
                return;
            }
            if (!parsed || parsed.total_amount <= 0) {
                await sock.sendMessage(remoteJid, {
                    text: "💬 Pesan Anda diterima! Ketik pengeluaran (contoh: *Beli makan 25rb*) atau kirim foto struk/voice note untuk dicatat otomatis.\n\nKetik */help* untuk bantuan.",
                }, { quoted: msg });
                return;
            }
            const trxId = this.trxRepo.generateTransactionId();
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
            const replyText = formatTransactionSuccess(transactionRecord, parsed.items);
            await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
        }
    }
}
//# sourceMappingURL=message.handler.js.map