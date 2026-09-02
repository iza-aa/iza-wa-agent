import * as Baileys from "@whiskeysockets/baileys";
const makeWASocket = typeof Baileys.default === "function"
    ? Baileys.default
    : Baileys.default?.default ||
        Baileys.default?.makeWASocket ||
        Baileys.makeWASocket;
const useMultiFileAuthState = Baileys.useMultiFileAuthState ||
    Baileys.default?.useMultiFileAuthState;
const DisconnectReason = Baileys.DisconnectReason ||
    Baileys.default?.DisconnectReason;
const fetchLatestBaileysVersion = Baileys.fetchLatestBaileysVersion ||
    Baileys.default?.fetchLatestBaileysVersion;
import qrcode from "qrcode-terminal";
import pino from "pino";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { setExecutiveSocket, setExecutiveQr, setExecutiveStatus, } from "./executive-socket-holder.js";
import { executiveBaileysHandler } from "./executive-baileys.handler.js";
export function createExecutiveBot() {
    const start = async () => {
        logger.info("Initializing Executive Baileys WhatsApp Socket Client (087864550486)...");
        setExecutiveStatus("connecting");
        const authFolder = "executive_auth_info";
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info({ version, isLatest, authFolder }, "Using Baileys WA Version for Executive Assistant");
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                return undefined;
            },
        });
        setExecutiveSocket(sock);
        sock.ev.on("creds.update", saveCreds);
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                setExecutiveQr(qr);
                setExecutiveStatus("connecting");
                logger.info("Executive Bot QR Code received. Please scan with WhatsApp on your phone:");
                qrcode.generate(qr, { small: true });
                console.log("\n=======================================================");
                console.log("📲 SCAN QR CODE DENGAN NOMOR EXECUTIVE (087864550486)");
                console.log("Buka Pengaturan > Perangkat Tertaut > Tautkan Perangkat");
                console.log("Web QR: http://localhost:" + (process.env.PORT || config.PORT || 3000) + "/qr-executive");
                console.log("=======================================================\n");
            }
            if (connection === "close") {
                setExecutiveStatus("close");
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                logger.warn({ statusCode, shouldReconnect }, "Executive WhatsApp Connection closed");
                if (shouldReconnect) {
                    logger.info("Reconnecting Executive WhatsApp in 3 seconds...");
                    setTimeout(start, 3000);
                }
                else {
                    setExecutiveQr(null);
                    logger.error("Executive Bot logged out from WhatsApp. Delete executive_auth_info to scan again.");
                }
            }
            else if (connection === "open") {
                setExecutiveStatus("open");
                setExecutiveQr(null);
                logger.info("Executive Baileys WhatsApp Client is READY and CONNECTED!");
                console.log("✅ EXECUTIVE BAILEYS ASSISTANT (087864550486) BERHASIL TERSAMBUNG!");
            }
        });
        sock.ev.on("messages.upsert", async ({ messages, type }) => {
            if (type !== "notify")
                return;
            for (const msg of messages) {
                // Skip outgoing messages from bot itself
                if (msg.key?.fromMe)
                    continue;
                // Skip messages older than 15 minutes to avoid processing ancient history on reconnect
                const msgTimestamp = msg.messageTimestamp;
                if (msgTimestamp) {
                    const msgTime = typeof msgTimestamp === "number" ? msgTimestamp * 1000 : Number(msgTimestamp) * 1000;
                    const ageMs = Date.now() - msgTime;
                    if (ageMs > 15 * 60 * 1000) {
                        continue;
                    }
                }
                try {
                    await executiveBaileysHandler.handleBaileysMessage(sock, msg);
                }
                catch (error) {
                    logger.error({ error, msgKey: msg.key }, "Error processing Executive Baileys incoming message");
                }
            }
        });
    };
    return { start };
}
//# sourceMappingURL=executive-baileys.client.js.map