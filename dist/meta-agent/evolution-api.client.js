import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
export class EvolutionApiClient {
    get apiUrl() {
        return (config.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/+$/, "");
    }
    get apiKey() {
        return config.EVOLUTION_API_KEY || "iza_evolution_secret_key_2026";
    }
    get instance() {
        return config.EVOLUTION_INSTANCE_NAME || "iza-executive";
    }
    get headers() {
        return {
            apikey: this.apiKey,
            "Content-Type": "application/json",
        };
    }
    /**
     * Sends standard text message to WhatsApp user via Evolution API v2
     */
    async sendTextMessage(to, messageText) {
        const cleanTo = to.replace(/[^0-9]/g, "");
        const url = `${this.apiUrl}/message/sendText/${this.instance}`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    text: messageText,
                }),
            });
            const resData = await response.json().catch(() => ({}));
            if (!response.ok) {
                logger.error({ resData, status: response.status, to: cleanTo }, "Failed to send text message via Evolution API");
                return false;
            }
            logger.info({ to: cleanTo }, "Sent text message via Evolution API");
            return true;
        }
        catch (err) {
            logger.error({ err, to: cleanTo }, "Network error sending text message via Evolution API");
            return false;
        }
    }
    /**
     * Sends native 1-tap WhatsApp Poll via Evolution API v2
     * 100% natively supported across iOS, Android, Web & Desktop without view-once restrictions
     */
    async sendPoll(to, pollName, values, selectableCount = 1) {
        const cleanTo = to.replace(/[^0-9]/g, "");
        const url = `${this.apiUrl}/message/sendPoll/${this.instance}`;
        if (values.length < 2) {
            return false;
        }
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    name: pollName.slice(0, 255),
                    selectableCount: selectableCount,
                    values: values.slice(0, 12),
                    pollMessage: {
                        name: pollName.slice(0, 255),
                        selectableCount: selectableCount,
                        values: values.slice(0, 12),
                    },
                }),
            });
            const resData = await response.json().catch(() => ({}));
            if (!response.ok) {
                logger.warn({ resData, status: response.status, to: cleanTo }, "Failed to send poll via Evolution API");
                return false;
            }
            logger.info({ to: cleanTo, pollName, count: values.length }, "Sent native 1-tap poll via Evolution API");
            return true;
        }
        catch (err) {
            logger.error({ err, to: cleanTo }, "Network error sending poll via Evolution API");
            return false;
        }
    }
    /**
     * Sends WhatsApp Native Interactive List Menu via Evolution API v2
     * Renders as a single button (e.g. "[ 📋 Buka Menu Pilihan ]") opening a bottom-sheet menu
     */
    async sendList(to, title, description, buttonText, sections, footerText = "IZA Executive Assistant") {
        const cleanTo = to.replace(/[^0-9]/g, "");
        const url = `${this.apiUrl}/message/sendList/${this.instance}`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    title: title.slice(0, 60),
                    description: description,
                    buttonText: buttonText.slice(0, 20),
                    footerText: footerText.slice(0, 60),
                    sections: sections,
                }),
            });
            const resData = await response.json().catch(() => ({}));
            if (!response.ok) {
                logger.warn({ resData, status: response.status, to: cleanTo }, "Failed to send list menu via Evolution API");
                return false;
            }
            logger.info({ to: cleanTo, title }, "Sent native List Menu via Evolution API");
            return true;
        }
        catch (err) {
            logger.error({ err, to: cleanTo }, "Network error sending list menu via Evolution API");
            return false;
        }
    }
    /**
     * Generates helpful short descriptions for list menu rows
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
     * Sends interactive message to WhatsApp user via Evolution API:
     * Uses WhatsApp Native List Menu for elegant 1-tap navigation (not polling)
     */
    async sendInteractiveButtons(to, bodyText, buttons, headerText, footerText = "IZA Executive Assistant") {
        if (buttons.length >= 2) {
            const title = headerText || "📋 Menu Pilihan";
            const buttonText = "📋 Buka Menu";
            const sections = [
                {
                    title: "Pilihan Aksi",
                    rows: buttons.map((b, idx) => ({
                        rowId: b.id || `ROW_${idx}`,
                        title: b.title.slice(0, 24),
                        description: this.getButtonDescription(b.id, b.title),
                    })),
                },
            ];
            const listSent = await this.sendList(to, title, bodyText, buttonText, sections, footerText);
            if (listSent) {
                return true;
            }
            logger.warn({ to }, "List menu dispatch failed, falling back to clean text dispatch");
        }
        // Fallback to standard text message if list menu failed or single button
        let message = bodyText;
        if (headerText && !bodyText.startsWith(headerText)) {
            message = `*${headerText}*\n\n${bodyText}`;
        }
        if (footerText) {
            message += `\n\n_${footerText}_`;
        }
        return await this.sendTextMessage(to, message);
    }
    /**
     * Sends media / document / PDF to WhatsApp user via Evolution API v2
     */
    async sendMedia(to, buffer, fileName, caption = "", mimeType = "application/pdf") {
        const cleanTo = to.replace(/[^0-9]/g, "");
        const url = `${this.apiUrl}/message/sendMedia/${this.instance}`;
        const mediaType = mimeType.startsWith("image/")
            ? "image"
            : mimeType.startsWith("audio/")
                ? "audio"
                : "document";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    mediaMessage: {
                        mediatype: mediaType,
                        caption: caption,
                        media: buffer.toString("base64"),
                        fileName: fileName,
                    },
                }),
            });
            const resData = await response.json().catch(() => ({}));
            if (!response.ok) {
                logger.error({ resData, status: response.status }, "Failed to send media via Evolution API");
                return false;
            }
            logger.info({ to: cleanTo, fileName }, "Sent media via Evolution API");
            return true;
        }
        catch (err) {
            logger.error({ err, to: cleanTo, fileName }, "Network error sending media via Evolution API");
            return false;
        }
    }
    /**
     * Emits presence typing state ("composing" = sedang mengetik...)
     */
    async sendPresence(to, presence = "composing") {
        const cleanTo = to.replace(/[^0-9]/g, "");
        const url = `${this.apiUrl}/chat/sendPresence/${this.instance}`;
        try {
            await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    presence: presence,
                }),
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Marks a message as read (blue checkmarks)
     */
    async markAsRead(remoteJid, messageId) {
        const url = `${this.apiUrl}/chat/markMessageAsRead/${this.instance}`;
        try {
            await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    readMessages: [
                        {
                            remoteJid: remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`,
                            fromMe: false,
                            id: messageId,
                        },
                    ],
                }),
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Downloads media (image or audio) as base64 and converts to Buffer
     */
    async downloadMediaBase64(messageKeyId) {
        const url = `${this.apiUrl}/chat/findMediaBase64/${this.instance}`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    message: {
                        key: {
                            id: messageKeyId,
                        },
                    },
                }),
            });
            if (!response.ok) {
                logger.error({ status: response.status, messageKeyId }, "Failed to fetch media base64 from Evolution API");
                return null;
            }
            const data = (await response.json());
            const base64Str = data?.base64 || data?.data?.base64;
            const mimeType = data?.mimeType || data?.data?.mimeType || "application/octet-stream";
            if (!base64Str) {
                logger.warn({ messageKeyId }, "Evolution API returned empty base64 for media");
                return null;
            }
            const buffer = Buffer.from(base64Str.replace(/^data:[^;]+;base64,/, ""), "base64");
            return { buffer, mimeType };
        }
        catch (err) {
            logger.error({ err, messageKeyId }, "Error downloading media from Evolution API");
            return null;
        }
    }
    /**
     * Retrieves current connection status and QR code base64
     */
    async getConnectQrCode() {
        const url = `${this.apiUrl}/instance/connect/${this.instance}`;
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: this.headers,
            });
            const data = (await response.json().catch(() => ({})));
            const base64 = data?.base64 || data?.qrcode?.base64;
            const status = data?.instance?.status || data?.status || (base64 ? "connecting" : "unknown");
            return {
                status,
                base64,
                pairingCode: data?.pairingCode,
            };
        }
        catch (err) {
            logger.error({ err }, "Failed to get QR code from Evolution API");
            return null;
        }
    }
}
export const evolutionApiClient = new EvolutionApiClient();
//# sourceMappingURL=evolution-api.client.js.map