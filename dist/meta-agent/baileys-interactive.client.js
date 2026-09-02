import * as Baileys from "@whiskeysockets/baileys";
import { getExecutiveSocket } from "./executive-socket-holder.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";
const proto = Baileys.proto || Baileys.default?.proto;
const generateWAMessageFromContent = Baileys.generateWAMessageFromContent ||
    Baileys.default?.generateWAMessageFromContent;
export class BaileysInteractiveClient {
    /**
     * Normalize any phone/JID into a valid WhatsApp JID (e.g. 628123456789@s.whatsapp.net)
     */
    formatJid(target) {
        if (target.includes("@s.whatsapp.net") || target.includes("@g.us")) {
            return target;
        }
        const cleanNumber = normalizePhoneNumber(target);
        return `${cleanNumber}@s.whatsapp.net`;
    }
    /**
     * Get active executive socket instance
     */
    getSocket() {
        return getExecutiveSocket();
    }
    /**
     * Generates descriptions for buttons when shown in list views
     */
    getButtonDescription(id, title) {
        const lower = (id + " " + title).toLowerCase();
        if (lower.includes("saldo") || lower.includes("balance"))
            return "Cek saldo kas tunai & rekening";
        if (lower.includes("rekap") || lower.includes("laporan"))
            return "Lihat rekapan transaksi kas";
        if (lower.includes("audit") || lower.includes("selisih"))
            return "Periksa transaksi belum dirinci";
        if (lower.includes("confirm") || lower.includes("simpan"))
            return "Konfirmasi & simpan transaksi";
        if (lower.includes("cancel") || lower.includes("batal"))
            return "Batalkan draf transaksi";
        if (lower.includes("drive") || lower.includes("gdrive"))
            return "Buka folder Google Drive nota";
        if (lower.includes("sheet") || lower.includes("spreadsheet"))
            return "Buka Google Spreadsheet kas";
        return "Pilih opsi ini";
    }
    /**
     * Sends standard text message to WhatsApp user via Baileys socket
     */
    async sendTextMessage(to, messageText) {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock) {
            logger.error({ to, jid }, "BaileysInteractiveClient: Executive socket not connected");
            return false;
        }
        try {
            await sock.sendMessage(jid, { text: messageText });
            logger.info({ jid }, "BaileysInteractiveClient: Sent text message");
            return true;
        }
        catch (err) {
            logger.error({ err, jid }, "BaileysInteractiveClient: Failed to send text message");
            return false;
        }
    }
    /**
     * Sends clean, beautifully formatted message with quick numbered options
     * (Avoids binary bot node ratchet corruption on WhatsApp Desktop / Web)
     */
    async sendInteractiveButtons(to, bodyText, buttons, headerText, footerText) {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock) {
            logger.error({ to, jid }, "BaileysInteractiveClient: Socket not available for interactive buttons");
            return false;
        }
        let message = bodyText;
        if (headerText && !message.startsWith(headerText)) {
            message = `*${headerText}*\n\n${message}`;
        }
        if (buttons && buttons.length > 0) {
            const buttonList = buttons
                .map((b, i) => `👉 *[${i + 1}]* ${b.title}`)
                .join("\n");
            message += `\n\n${buttonList}`;
        }
        if (footerText) {
            message += `\n\n_${footerText}_`;
        }
        return this.sendTextMessage(jid, message);
    }
    /**
     * Sends interactive List (single_select) bottom-sheet menu via NativeFlowMessage
     */
    /**
     * Sends interactive List formatted as clean text with numbered choices
     */
    async sendInteractiveList(to, title, description, buttonText, sections, footerText) {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock) {
            logger.error({ to, jid }, "BaileysInteractiveClient: Socket not available for list message");
            return false;
        }
        let message = "";
        if (title)
            message += `*${title}*\n\n`;
        message += description;
        let index = 1;
        for (const section of sections) {
            if (section.title) {
                message += `\n\n📌 *${section.title.toUpperCase()}*`;
            }
            for (const row of section.rows) {
                message += `\n👉 *[${index}]* ${row.title}`;
                if (row.description)
                    message += ` — _${row.description}_`;
                index++;
            }
        }
        if (footerText) {
            message += `\n\n_${footerText}_`;
        }
        return this.sendTextMessage(jid, message);
    }
    /**
     * Emits presence typing state ("composing" = sedang mengetik...)
     */
    async sendPresence(to, presence = "composing") {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock)
            return false;
        try {
            await sock.sendPresenceUpdate(presence, jid);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Marks a message as read (blue checkmarks)
     */
    async markAsRead(to, messageId) {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock)
            return false;
        try {
            await sock.readMessages([
                {
                    remoteJid: jid,
                    id: messageId,
                    fromMe: false,
                },
            ]);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Sends media / document / PDF / image to WhatsApp user
     */
    async sendMedia(to, buffer, fileName, caption = "", mimeType = "application/pdf") {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock) {
            logger.error({ jid, fileName }, "BaileysInteractiveClient: Socket not connected for media send");
            return false;
        }
        try {
            if (mimeType.startsWith("image/")) {
                await sock.sendMessage(jid, {
                    image: buffer,
                    caption: caption,
                });
            }
            else if (mimeType.startsWith("audio/")) {
                await sock.sendMessage(jid, {
                    audio: buffer,
                    mimetype: mimeType,
                    ptt: true,
                });
            }
            else {
                await sock.sendMessage(jid, {
                    document: buffer,
                    mimetype: mimeType,
                    fileName: fileName,
                    caption: caption,
                });
            }
            logger.info({ jid, fileName }, "BaileysInteractiveClient: Sent media successfully");
            return true;
        }
        catch (err) {
            logger.error({ err, jid, fileName }, "BaileysInteractiveClient: Error sending media");
            return false;
        }
    }
}
export const baileysInteractiveClient = new BaileysInteractiveClient();
//# sourceMappingURL=baileys-interactive.client.js.map