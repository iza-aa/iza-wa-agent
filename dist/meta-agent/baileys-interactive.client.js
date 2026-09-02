import * as Baileys from "@whiskeysockets/baileys";
import { getExecutiveSocket } from "./executive-socket-holder.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";
const proto = Baileys.proto || Baileys.default?.proto;
const generateWAMessageFromContent = Baileys.generateWAMessageFromContent ||
    Baileys.default?.generateWAMessageFromContent;
const jidNormalizedUser = Baileys.jidNormalizedUser ||
    Baileys.default?.jidNormalizedUser ||
    ((jid) => jid ? jid.split(":")[0].split("@")[0] + "@s.whatsapp.net" : jid);
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
     * Sends real interactive buttons via NativeFlowMessage
     * Rendered natively as clickable buttons on WhatsApp
     */
    async sendInteractiveButtons(to, bodyText, buttons, headerText, footerText) {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock) {
            logger.error({ to, jid }, "BaileysInteractiveClient: Socket not available for interactive buttons");
            return false;
        }
        if (!buttons || buttons.length === 0) {
            return this.sendTextMessage(jid, bodyText);
        }
        try {
            const formattedButtons = buttons.slice(0, 3).map((btn) => ({
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: btn.title.slice(0, 25),
                    id: btn.id,
                }),
            }));
            const interactiveMessagePayload = {
                body: proto?.Message?.InteractiveMessage?.Body?.create
                    ? proto.Message.InteractiveMessage.Body.create({ text: bodyText })
                    : { text: bodyText },
                nativeFlowMessage: proto?.Message?.InteractiveMessage?.NativeFlowMessage?.create
                    ? proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: formattedButtons,
                    })
                    : {
                        buttons: formattedButtons,
                    },
            };
            if (footerText) {
                interactiveMessagePayload.footer = proto?.Message?.InteractiveMessage?.Footer?.create
                    ? proto.Message.InteractiveMessage.Footer.create({ text: footerText })
                    : { text: footerText };
            }
            if (headerText) {
                interactiveMessagePayload.header = proto?.Message?.InteractiveMessage?.Header?.create
                    ? proto.Message.InteractiveMessage.Header.create({
                        title: headerText,
                        hasMediaAttachment: false,
                    })
                    : {
                        title: headerText,
                        hasMediaAttachment: false,
                    };
            }
            // Direct template buttons message format: standard native buttons on all WhatsApp clients
            const templateButtons = buttons.slice(0, 3).map((btn, index) => ({
                index: index + 1,
                quickReplyButton: {
                    displayText: btn.title.slice(0, 25),
                    id: btn.id,
                },
            }));
            const templateMessagePayload = {
                hydratedTemplate: {
                    hydratedContentText: bodyText,
                    hydratedButtons: templateButtons,
                    hydratedFooterText: footerText || undefined,
                },
            };
            const fullMessage = {
                viewOnceMessage: {
                    message: {
                        templateMessage: proto?.Message?.TemplateMessage?.create
                            ? proto.Message.TemplateMessage.create(templateMessagePayload)
                            : templateMessagePayload,
                    },
                },
            };
            const rawUserJid = sock.authState?.creds?.me?.id || sock.user?.id;
            const userJid = jidNormalizedUser(rawUserJid);
            if (typeof generateWAMessageFromContent === "function" && typeof sock.relayMessage === "function") {
                const msg = generateWAMessageFromContent(jid, fullMessage, { userJid });
                logger.info({ jid, fullMessage: JSON.stringify(fullMessage), userJid, msgKeyId: msg?.key?.id }, "DEBUG: Attempting relayMessage for buttons");
                const responseId = await sock.relayMessage(jid, msg.message, {
                    messageId: msg.key.id,
                });
                logger.info({ jid, responseId, buttonCount: buttons.length }, "BaileysInteractiveClient: Relayed Hydrated Template buttons message");
                return true;
            }
        }
        catch (err) {
            logger.error({ err, jid }, "BaileysInteractiveClient: Error sending interactive buttons, fallback to text");
            return this.sendTextMessage(jid, bodyText);
        }
        return this.sendTextMessage(jid, bodyText);
    }
    /**
     * Sends interactive List (single_select) bottom-sheet menu via NativeFlowMessage
     */
    async sendInteractiveList(to, title, description, buttonText, sections, footerText) {
        const jid = this.formatJid(to);
        const sock = this.getSocket();
        if (!sock) {
            logger.error({ to, jid }, "BaileysInteractiveClient: Socket not available for list message");
            return false;
        }
        try {
            const listParams = {
                title: buttonText.slice(0, 20),
                sections: sections.map((sec) => ({
                    title: sec.title,
                    highlight_label: sec.highlight_label,
                    rows: sec.rows.map((row) => ({
                        header: row.header,
                        title: row.title.slice(0, 24),
                        description: row.description || this.getButtonDescription(row.id, row.title),
                        id: row.id,
                    })),
                })),
            };
            const interactiveMessagePayload = {
                body: proto?.Message?.InteractiveMessage?.Body?.create
                    ? proto.Message.InteractiveMessage.Body.create({ text: description })
                    : { text: description },
                nativeFlowMessage: proto?.Message?.InteractiveMessage?.NativeFlowMessage?.create
                    ? proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: [
                            {
                                name: "single_select",
                                buttonParamsJson: JSON.stringify(listParams),
                            },
                        ],
                    })
                    : {
                        buttons: [
                            {
                                name: "single_select",
                                buttonParamsJson: JSON.stringify(listParams),
                            },
                        ],
                    },
            };
            if (footerText) {
                interactiveMessagePayload.footer = proto?.Message?.InteractiveMessage?.Footer?.create
                    ? proto.Message.InteractiveMessage.Footer.create({ text: footerText })
                    : { text: footerText };
            }
            if (title) {
                interactiveMessagePayload.header = proto?.Message?.InteractiveMessage?.Header?.create
                    ? proto.Message.InteractiveMessage.Header.create({
                        title: title,
                        hasMediaAttachment: false,
                    })
                    : {
                        title: title,
                        hasMediaAttachment: false,
                    };
            }
            const fullMessage = {
                interactiveMessage: proto?.Message?.InteractiveMessage?.create
                    ? proto.Message.InteractiveMessage.create(interactiveMessagePayload)
                    : interactiveMessagePayload,
            };
            const userJid = sock.authState?.creds?.me?.id || sock.user?.id;
            const additionalNodes = [
                {
                    tag: "biz",
                    attrs: {},
                    content: [
                        {
                            tag: "interactive",
                            attrs: { type: "native_flow", v: "1" },
                            content: [
                                {
                                    tag: "native_flow",
                                    attrs: { v: "2", name: "single_select" },
                                },
                            ],
                        },
                    ],
                },
            ];
            if (typeof generateWAMessageFromContent === "function" && typeof sock.relayMessage === "function") {
                const msg = generateWAMessageFromContent(jid, fullMessage, { userJid });
                await sock.relayMessage(jid, msg.message, {
                    messageId: msg.key.id,
                    additionalNodes,
                });
                logger.info({ jid, title }, "BaileysInteractiveClient: Relayed NativeFlow List message");
                return true;
            }
        }
        catch (err) {
            logger.error({ err, jid }, "BaileysInteractiveClient: Error sending interactive list");
        }
        return this.sendTextMessage(jid, description);
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