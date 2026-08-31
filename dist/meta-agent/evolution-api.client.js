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
     * Sends interactive button message to WhatsApp user via Evolution API v2
     * Uses Meta-compatible sendInteractive payload to produce native clickable buttons
     */
    async sendInteractiveButtons(to, bodyText, buttons, headerText, footerText = "IZA Executive Assistant") {
        const cleanTo = to.replace(/[^0-9]/g, "");
        // 1. Primary: POST /message/sendInteractive (Meta-parity nativeFlowMessage)
        const interactiveUrl = `${this.apiUrl}/message/sendInteractive/${this.instance}`;
        const formattedButtons = buttons.slice(0, 3).map((btn) => ({
            type: "reply",
            reply: {
                id: btn.id,
                title: btn.title.slice(0, 20),
            },
        }));
        try {
            const response = await fetch(interactiveUrl, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    interactive: {
                        type: "button",
                        header: headerText ? { type: "text", text: headerText } : undefined,
                        body: { text: bodyText },
                        footer: { text: footerText },
                        action: {
                            buttons: formattedButtons,
                        },
                    },
                }),
            });
            if (response.ok) {
                logger.info({ to: cleanTo, count: buttons.length }, "Sent native interactive buttons via Evolution API sendInteractive");
                return true;
            }
        }
        catch (err) {
            logger.warn({ err, to: cleanTo }, "sendInteractive network attempt failed, trying sendButtons fallback");
        }
        // 2. Secondary: POST /message/sendButtons fallback
        const buttonsUrl = `${this.apiUrl}/message/sendButtons/${this.instance}`;
        const simpleButtons = buttons.slice(0, 3).map((btn) => ({
            type: "reply",
            displayText: btn.title,
            id: btn.id,
        }));
        try {
            const response = await fetch(buttonsUrl, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    number: cleanTo,
                    title: headerText || "Pilihan Menu",
                    description: bodyText,
                    footer: footerText,
                    buttons: simpleButtons,
                }),
            });
            if (response.ok) {
                logger.info({ to: cleanTo, count: buttons.length }, "Sent native buttons via Evolution API sendButtons");
                return true;
            }
        }
        catch (err) {
            logger.warn({ err, to: cleanTo }, "sendButtons network attempt failed, falling back to text");
        }
        // 3. Fallback to clean formatted text if WhatsApp rejects both button nodes
        let fallbackText = bodyText;
        if (buttons.length > 0) {
            fallbackText += "\n\n" + buttons.map((b) => `👉 *${b.title}*`).join("\n");
        }
        return this.sendTextMessage(to, fallbackText);
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