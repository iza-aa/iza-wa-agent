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
const downloadMediaMessage = Baileys.downloadMediaMessage ||
    Baileys.default?.downloadMediaMessage;
export class ExecutiveBaileysHandler {
    userRepo;
    trxRepo;
    chatRepo;
    pendingRepo;
    agentEngine;
    processedMessageIds = new Set();
    constructor() {
        const supabase = getSupabaseClient();
        this.userRepo = new UserRepository(supabase, config.SUPER_ADMIN_PHONE);
        this.trxRepo = new TransactionRepository(supabase);
        this.chatRepo = new ChatRepository(supabase);
        this.pendingRepo = new PendingActionRepository(supabase);
        this.agentEngine = new AgentEngine(supabase, this.trxRepo, this.userRepo, this.chatRepo, this.pendingRepo);
    }
    /**
     * Main entry point for messages received directly on Executive Baileys Socket
     */
    async handleBaileysMessage(sock, rawMsg) {
        if (!rawMsg || !rawMsg.key)
            return;
        // Ignore outbound messages sent by the bot
        if (rawMsg.key.fromMe)
            return;
        const remoteJid = rawMsg.key.remoteJid || "";
        // Ignore group chats, broadcast status, or invalid JIDs
        if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast") || !remoteJid.includes("@")) {
            return;
        }
        const msgId = rawMsg.key.id;
        if (msgId && this.processedMessageIds.has(msgId)) {
            return;
        }
        const senderPhone = normalizePhoneNumber(remoteJid);
        const rawSenderName = rawMsg.pushName || "User";
        // Mark message as read immediately (blue tick)
        if (msgId) {
            baileysInteractiveClient.markAsRead(remoteJid, msgId).catch(() => { });
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
        // 2. Extract Message Content & Interactive Buttons (Unwrap all nested wrappers)
        let msgContent = rawMsg.message || {};
        for (let depth = 0; depth < 5; depth++) {
            if (msgContent?.ephemeralMessage?.message)
                msgContent = msgContent.ephemeralMessage.message;
            else if (msgContent?.viewOnceMessage?.message)
                msgContent = msgContent.viewOnceMessage.message;
            else if (msgContent?.viewOnceMessageV2?.message)
                msgContent = msgContent.viewOnceMessageV2.message;
            else if (msgContent?.documentWithCaptionMessage?.message)
                msgContent = msgContent.documentWithCaptionMessage.message;
            else if (msgContent?.protocolMessage?.editedMessage)
                msgContent = msgContent.protocolMessage.editedMessage;
            else if (msgContent?.templateMessage?.hydratedTemplate)
                msgContent = msgContent.templateMessage.hydratedTemplate;
            else if (msgContent?.templateMessage?.fourRowTemplate)
                msgContent = msgContent.templateMessage.fourRowTemplate;
            else if (msgContent?.templateMessage?.hydratedFourRowTemplate)
                msgContent = msgContent.templateMessage.hydratedFourRowTemplate;
            else
                break;
        }
        let messageText = "";
        let interactiveButtonId;
        const candidateSources = [msgContent, rawMsg.message].filter(Boolean);
        for (const src of candidateSources) {
            if (messageText)
                break;
            if (typeof src === "string") {
                messageText = src;
            }
            else if (src.conversation) {
                messageText = src.conversation;
            }
            else if (src.extendedTextMessage?.text) {
                messageText = src.extendedTextMessage.text;
            }
            // Interactive / NativeFlow response
            if (src.interactiveResponseMessage) {
                const ir = src.interactiveResponseMessage;
                const nativeParams = ir.nativeFlowResponseMessage?.paramsJson || ir.paramsJson;
                if (nativeParams) {
                    try {
                        const parsed = typeof nativeParams === "string" ? JSON.parse(nativeParams) : nativeParams;
                        interactiveButtonId = parsed.id || parsed.selectedId || parsed.rowId || parsed.buttonId;
                        messageText = parsed.display_text || parsed.title || parsed.text || parsed.name || interactiveButtonId || "";
                    }
                    catch {
                        messageText = String(nativeParams);
                    }
                }
                if (!messageText && ir.body?.text) {
                    messageText = ir.body.text;
                }
                if (!messageText && ir.title) {
                    messageText = ir.title;
                }
            }
            // Direct nativeFlowResponseMessage
            if (src.nativeFlowResponseMessage?.paramsJson) {
                try {
                    const parsed = JSON.parse(src.nativeFlowResponseMessage.paramsJson);
                    interactiveButtonId = parsed.id || parsed.selectedId || parsed.rowId;
                    messageText = parsed.display_text || parsed.title || parsed.text || parsed.name || interactiveButtonId || "";
                }
                catch { }
            }
            // Buttons / Templates / Lists
            if (src.buttonsResponseMessage) {
                interactiveButtonId = src.buttonsResponseMessage.selectedButtonId;
                messageText = src.buttonsResponseMessage.selectedDisplayText || interactiveButtonId || "";
            }
            else if (src.listResponseMessage) {
                interactiveButtonId = src.listResponseMessage.singleSelectReply?.selectedRowId || src.listResponseMessage.selectedRowId;
                messageText = src.listResponseMessage.title || src.listResponseMessage.description || interactiveButtonId || "";
            }
            else if (src.templateButtonReplyMessage) {
                interactiveButtonId = src.templateButtonReplyMessage.selectedId;
                messageText = src.templateButtonReplyMessage.selectedDisplayText || interactiveButtonId || "";
            }
            else if (src.pollUpdateMessage) {
                const poll = src.pollUpdateMessage;
                const selected = poll.vote?.selectedOptions || poll.selectedOptions || poll.pollUpdates?.[0]?.vote?.selectedOptions;
                if (Array.isArray(selected) && selected.length > 0) {
                    messageText = typeof selected[0] === "string" ? selected[0] : (selected[0].name || selected[0].optionName || "");
                }
                else if (typeof selected === "string") {
                    messageText = selected;
                }
            }
            else if (src.imageMessage?.caption) {
                messageText = src.imageMessage.caption;
            }
            else if (src.documentMessage?.caption) {
                messageText = src.documentMessage.caption;
            }
        }
        logger.info({
            senderPhone,
            rawSenderName,
            msgId,
            extractedText: messageText,
            extractedButtonId: interactiveButtonId,
            rawKeys: Object.keys(rawMsg.message || {}),
        }, "ExecutiveBaileysHandler: Message extraction result");
        // 3. Handshake verification for unlinked/unregistered users
        if (!isAllowed) {
            const digitsOnly = messageText.replace(/[^0-9]/g, "");
            const isPhoneNumberInput = (digitsOnly.startsWith("08") || digitsOnly.startsWith("628") || digitsOnly.startsWith("8")) &&
                digitsOnly.length >= 9 &&
                digitsOnly.length <= 15;
            if (isPhoneNumberInput) {
                const targetPhone = normalizePhoneNumber(digitsOnly);
                const linkedUser = await this.userRepo.linkLidByPhoneNumber(targetPhone, senderPhone);
                if (linkedUser) {
                    await baileysInteractiveClient.sendTextMessage(senderPhone, `🎉 *VERIFIKASI BERHASIL!*\n\nHalo *${linkedUser.name}*, akun WhatsApp Anda telah resmi terhubung dengan nomor \`+${targetPhone}\`.\n\nSekarang Anda dapat langsung mengobrol dengan Asisten AI, mencatat transaksi, kirim foto nota/struk, atau tanya laporan kas.`);
                    return;
                }
                else {
                    await baileysInteractiveClient.sendTextMessage(senderPhone, `⚠️ Nomor \`+${targetPhone}\` belum terdaftar di sistem.\n\nPastikan Super Admin telah mendaftarkan nomor Anda terlebih dahulu via \`/tambah ${targetPhone} [NamaAnda]\`.`);
                    return;
                }
            }
            await baileysInteractiveClient.sendTextMessage(senderPhone, `👋 *HALO! SELAMAT DATANG DI IZA ASSISTANT*\n\nAkun WhatsApp Anda belum terhubung dengan nomor staf terdaftar.\n\nSilakan ketik nomor HP Anda yang terdaftar (contoh: \`08123456789\`) untuk verifikasi identitas.`);
            return;
        }
        // If user clicked interactive button or sent quick phrase, map to clear natural question
        const BUTTON_ID_MAP = {
            CHECK_BALANCE: "Berapa total saldo kas dan rekening kita saat ini?",
            REKAP_KAS: "Tampilkan rekap kondisi keuangan kas terbaru bulan ini",
            AUDIT_KAS: "Audit pengeluaran yang belum dirinci dan periksa selisih di pembukuan kas",
            AUDIT_RINCIAN: "Audit pengeluaran yang belum dirinci",
            AUDIT_SELISIH: "Cek apakah ada selisih di pembukuan kas",
            SPREADSHEET: "Minta link Google Spreadsheet kas",
            GOOGLE_DRIVE: "Minta link Google Drive folder nota",
            CONFIRM_ACTION: "Ya, simpan sekarang",
            CANCEL_ACTION: "Batal",
            GENERATE_PDF: "Buat dokumen PDF laporan keuangan bulan ini",
            DEPT_DAPUR: "Alokasikan untuk divisi Dapur",
            DEPT_BARISTA: "Alokasikan untuk divisi Barista",
            DEPT_WAITERS: "Alokasikan untuk divisi Waiters",
            DEPT_KASIR: "Alokasikan untuk divisi Kasir",
            DEPT_KAFE: "Alokasikan untuk divisi Kafe",
            DUPLICATE_SAVE: "Ya, tetap simpan transaksi ini",
            DUPLICATE_DROP: "Batal dan buang draf ini",
            FILTER_THIS_WEEK: "Tampilkan ringkasan transaksi minggu ini",
            FILTER_THIS_MONTH: "Tampilkan ringkasan transaksi bulan ini",
            FILTER_LAST_MONTH: "Tampilkan ringkasan transaksi bulan lalu",
        };
        let effectiveText = messageText.trim();
        const cleanLower = effectiveText.toLowerCase();
        if (interactiveButtonId && BUTTON_ID_MAP[interactiveButtonId]) {
            effectiveText = BUTTON_ID_MAP[interactiveButtonId];
        }
        else if (cleanLower === "1" || cleanLower.includes("cek saldo") || cleanLower.includes("saldo kas") || cleanLower === "saldo" || cleanLower.includes("cek uang")) {
            effectiveText = "Berapa total saldo kas dan rekening kita saat ini?";
        }
        else if (cleanLower === "2" || cleanLower.includes("rekap kas") || cleanLower.includes("rekap divisi") || cleanLower.includes("rekap keuangan")) {
            effectiveText = "Tampilkan rekap kondisi keuangan kas terbaru bulan ini";
        }
        else if (cleanLower === "3" || cleanLower.includes("audit rincian") || cleanLower.includes("audit kas") || cleanLower.includes("audit selisih") || cleanLower.includes("cek selisih")) {
            effectiveText = "Audit pengeluaran yang belum dirinci dan periksa selisih di pembukuan kas";
        }
        else if (cleanLower.includes("spreadsheet") || cleanLower.includes("sheet") || cleanLower.includes("excel")) {
            effectiveText = "Minta link Google Spreadsheet kas";
        }
        else if (cleanLower.includes("google drive") || cleanLower.includes("gdrive") || cleanLower.includes("folder nota")) {
            effectiveText = "Minta link Google Drive folder nota";
        }
        // 4. Download Media if present (Image/Receipt, Audio/Voice Note, Document)
        let mediaBuffer;
        let mediaMimeType;
        const hasImage = !!msgContent.imageMessage;
        const hasAudio = !!msgContent.audioMessage;
        const hasDoc = !!msgContent.documentMessage;
        // If message is empty (e.g. undecrypted packet, status stub, reaction), ignore it
        if (!effectiveText && !hasImage && !hasAudio && !hasDoc) {
            logger.warn({ senderPhone, msgId, rawKeys: Object.keys(rawMsg.message || {}) }, "ExecutiveBaileysHandler: Ignoring empty or undecrypted message packet");
            return;
        }
        // Message is valid and decrypted - mark as processed to avoid double processing
        if (msgId) {
            this.processedMessageIds.add(msgId);
            if (this.processedMessageIds.size > 2000) {
                const first = this.processedMessageIds.values().next().value;
                if (first)
                    this.processedMessageIds.delete(first);
            }
        }
        if (hasImage || hasAudio || hasDoc) {
            try {
                if (typeof downloadMediaMessage === "function") {
                    mediaBuffer = await downloadMediaMessage(rawMsg, "buffer", {}, {
                        logger: logger,
                        reuploadRequest: sock?.updateMediaMessage,
                    });
                    mediaMimeType =
                        msgContent.imageMessage?.mimetype ||
                            msgContent.audioMessage?.mimetype ||
                            msgContent.documentMessage?.mimetype ||
                            "application/octet-stream";
                }
            }
            catch (mediaErr) {
                logger.error({ mediaErr, msgId }, "ExecutiveBaileysHandler: Failed to download media attachment");
            }
        }
        // 5. Send "typing..." presence indicator while AI processes
        baileysInteractiveClient.sendPresence(senderPhone, "composing").catch(() => { });
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
            baileysInteractiveClient.sendPresence(senderPhone, "paused").catch(() => { });
            if (!result.reply) {
                return;
            }
            // 7. Send Response: Real Interactive Buttons (NativeFlowMessage) if buttons provided
            if (result.buttons && result.buttons.length > 0) {
                await baileysInteractiveClient.sendInteractiveButtons(senderPhone, result.reply, result.buttons);
            }
            else {
                await baileysInteractiveClient.sendTextMessage(senderPhone, result.reply);
            }
        }
        catch (err) {
            logger.error({ err, senderPhone }, "ExecutiveBaileysHandler: Error processing message through AgentEngine");
            await baileysInteractiveClient.sendTextMessage(senderPhone, "⚠️ Mohon maaf, terjadi kendala teknis saat memproses pesan Anda. Silakan coba sesaat lagi.");
        }
    }
}
export const executiveBaileysHandler = new ExecutiveBaileysHandler();
//# sourceMappingURL=executive-baileys.handler.js.map