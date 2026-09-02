import * as Baileys from "@whiskeysockets/baileys";
import { getExecutiveSocket } from "./executive-socket-holder.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";

const proto = (Baileys as any).proto || (Baileys as any).default?.proto;
const generateWAMessageFromContent =
  (Baileys as any).generateWAMessageFromContent ||
  (Baileys as any).default?.generateWAMessageFromContent;
const jidNormalizedUser =
  (Baileys as any).jidNormalizedUser ||
  (Baileys as any).default?.jidNormalizedUser ||
  ((jid: string) => jid ? jid.split(":")[0].split("@")[0] + "@s.whatsapp.net" : jid);

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
  header?: string;
}

export interface ListSection {
  title: string;
  highlight_label?: string;
  rows: ListRow[];
}

export class BaileysInteractiveClient {
  /**
   * Normalize any phone/JID into a valid WhatsApp JID (e.g. 628123456789@s.whatsapp.net)
   */
  private formatJid(target: string): string {
    if (target.includes("@s.whatsapp.net") || target.includes("@g.us") || target.includes("@lid")) {
      return target;
    }
    const cleanNumber = normalizePhoneNumber(target);
    return `${cleanNumber}@s.whatsapp.net`;
  }

  /**
   * Get active executive socket instance
   */
  private getSocket(): any {
    return getExecutiveSocket();
  }

  /**
   * Generates descriptions for buttons when shown in list views
   */
  private getButtonDescription(id: string, title: string): string {
    const lower = (id + " " + title).toLowerCase();
    if (lower.includes("saldo") || lower.includes("balance")) return "Cek saldo kas tunai & rekening";
    if (lower.includes("rekap") || lower.includes("laporan")) return "Lihat rekapan transaksi kas";
    if (lower.includes("audit") || lower.includes("selisih")) return "Periksa transaksi belum dirinci";
    if (lower.includes("confirm") || lower.includes("simpan")) return "Konfirmasi & simpan transaksi";
    if (lower.includes("cancel") || lower.includes("batal")) return "Batalkan draf transaksi";
    if (lower.includes("drive") || lower.includes("gdrive")) return "Buka folder Google Drive nota";
    if (lower.includes("sheet") || lower.includes("spreadsheet")) return "Buka Google Spreadsheet kas";
    return "Pilih opsi ini";
  }

  /**
   * Sends standard text message to WhatsApp user via Baileys socket
   */
  async sendTextMessage(to: string, messageText: string, quotedMsg?: any): Promise<boolean> {
    const jid = this.formatJid(to);
    const sock = this.getSocket();

    if (!sock) {
      logger.error({ to, jid }, "BaileysInteractiveClient: Executive socket not connected");
      return false;
    }

    try {
      const sendOptions: any = { text: messageText };
      const options = quotedMsg ? { quoted: quotedMsg } : undefined;
      const res = options
        ? await sock.sendMessage(jid, sendOptions, options)
        : await sock.sendMessage(jid, sendOptions);
      logger.info({ jid, msgId: res?.key?.id, status: res?.status }, "BaileysInteractiveClient: Sent text message successfully");
      return true;
    } catch (err) {
      logger.error({ err, jid }, "BaileysInteractiveClient: Failed to send text message");
      return false;
    }
  }

  /**
   * Sends clean, beautifully formatted interactive message with quick numbered options
   * (100% compatible across Android, iOS, and WhatsApp Desktop without triggering Error 463 NACK)
   */
  async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: InteractiveButton[],
    headerText?: string,
    footerText?: string,
    quotedMsg?: any
  ): Promise<boolean> {
    const jid = this.formatJid(to);
    const sock = this.getSocket();

    if (!sock) {
      logger.error({ to, jid }, "BaileysInteractiveClient: Socket not available for interactive buttons");
      return false;
    }

    if (!buttons || buttons.length === 0) {
      return this.sendTextMessage(jid, bodyText, quotedMsg);
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

    return this.sendTextMessage(jid, message, quotedMsg);
  }

  /**
   * Sends interactive List formatted as clean text with numbered choices
   */
  async sendInteractiveList(
    to: string,
    title: string,
    description: string,
    buttonText: string,
    sections: ListSection[],
    footerText?: string
  ): Promise<boolean> {
    const jid = this.formatJid(to);
    const sock = this.getSocket();

    if (!sock) {
      logger.error({ to, jid }, "BaileysInteractiveClient: Socket not available for list message");
      return false;
    }

    let message = "";
    if (title) message += `*${title}*\n\n`;
    message += description;

    let index = 1;
    for (const section of sections) {
      if (section.title) {
        message += `\n\n📌 *${section.title.toUpperCase()}*`;
      }
      for (const row of section.rows) {
        message += `\n👉 *[${index}]* ${row.title}`;
        if (row.description) message += ` — _${row.description}_`;
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
  async sendPresence(to: string, presence: "composing" | "paused" = "composing"): Promise<boolean> {
    const jid = this.formatJid(to);
    const sock = this.getSocket();
    if (!sock) return false;

    try {
      await sock.sendPresenceUpdate(presence, jid);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Marks a message as read (blue checkmarks)
   */
  async markAsRead(to: string, messageId: string): Promise<boolean> {
    const jid = this.formatJid(to);
    const sock = this.getSocket();
    if (!sock) return false;

    try {
      await sock.readMessages([
        {
          remoteJid: jid,
          id: messageId,
          fromMe: false,
        },
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sends media / document / PDF / image to WhatsApp user
   */
  async sendMedia(
    to: string,
    buffer: Buffer,
    fileName: string,
    caption: string = "",
    mimeType: string = "application/pdf"
  ): Promise<boolean> {
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
      } else if (mimeType.startsWith("audio/")) {
        await sock.sendMessage(jid, {
          audio: buffer,
          mimetype: mimeType,
          ptt: true,
        });
      } else {
        await sock.sendMessage(jid, {
          document: buffer,
          mimetype: mimeType,
          fileName: fileName,
          caption: caption,
        });
      }

      logger.info({ jid, fileName }, "BaileysInteractiveClient: Sent media successfully");
      return true;
    } catch (err) {
      logger.error({ err, jid, fileName }, "BaileysInteractiveClient: Error sending media");
      return false;
    }
  }
}

export const baileysInteractiveClient = new BaileysInteractiveClient();
