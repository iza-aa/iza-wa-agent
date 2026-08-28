import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface InteractiveButton {
  id: string;
  title: string; // Max 20 chars per Meta WhatsApp API spec
}

export class MetaApiClient {
  private get token(): string {
    return config.META_ACCESS_TOKEN || "";
  }

  private get phoneId(): string {
    return config.META_PHONE_NUMBER_ID || "1293341430536275";
  }

  /**
   * Validates Meta Webhook Verification Request (GET)
   */
  verifyWebhook(query: URLSearchParams): string | null {
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");

    const expectedToken = config.META_VERIFY_TOKEN || "iza_wa_bot_secret_2026";

    if (mode === "subscribe" && token === expectedToken && challenge) {
      logger.info("Meta Webhook verified successfully with challenge");
      return challenge;
    }

    logger.warn({ mode, token, expectedToken }, "Meta Webhook verification failed");
    return null;
  }

  /**
   * Sends a standard text message to a WhatsApp user via Meta Graph API
   */
  async sendTextMessage(to: string, messageText: string): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("Meta Access Token or Phone Number ID is missing");
      return false;
    }

    const cleanTo = to.replace(/[^0-9]/g, "");
    const url = `https://graph.facebook.com/v21.0/${this.phoneId}/messages`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanTo,
          type: "text",
          text: {
            preview_url: true,
            body: messageText,
          },
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        logger.error({ resData, status: response.status }, "Failed to send text message via Meta Graph API");
        return false;
      }

      logger.info({ to: cleanTo, messageId: (resData as any)?.messages?.[0]?.id }, "Sent text message via Meta API");
      return true;
    } catch (err) {
      logger.error({ err, to: cleanTo }, "Network error sending text message via Meta API");
      return false;
    }
  }

  /**
   * Sends an interactive button message to WhatsApp user via Meta Graph API
   * Useful for 1-click confirmation: [ ✅ Simpan Sekarang ] [ ❌ Batalkan ]
   */
  async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: InteractiveButton[],
    headerText?: string,
    footerText?: string
  ): Promise<boolean> {
    if (!this.token || !this.phoneId) {
      logger.error("Meta Access Token or Phone Number ID is missing");
      return false;
    }

    const cleanTo = to.replace(/[^0-9]/g, "");
    const url = `https://graph.facebook.com/v21.0/${this.phoneId}/messages`;

    const formattedButtons = buttons.slice(0, 3).map((btn) => ({
      type: "reply",
      reply: {
        id: btn.id,
        title: btn.title.slice(0, 20), // Meta limit is 20 chars
      },
    }));

    const interactivePayload: any = {
      type: "button",
      body: {
        text: bodyText,
      },
      action: {
        buttons: formattedButtons,
      },
    };

    if (headerText) {
      interactivePayload.header = {
        type: "text",
        text: headerText.slice(0, 60),
      };
    }

    if (footerText) {
      interactivePayload.footer = {
        text: footerText.slice(0, 60),
      };
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanTo,
          type: "interactive",
          interactive: interactivePayload,
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        logger.warn(
          { resData, status: response.status },
          "Failed to send interactive button message, falling back to plain text"
        );
        // Fallback to plain text if interactive buttons fail (e.g. 24-hr session limitations)
        let fallbackText = bodyText;
        if (buttons.length > 0) {
          fallbackText += "\n\n" + buttons.map((b) => `👉 *${b.title}* (Ketik: \`${b.title}\`)`).join("\n");
        }
        return await this.sendTextMessage(cleanTo, fallbackText);
      }

      logger.info({ to: cleanTo, messageId: (resData as any)?.messages?.[0]?.id }, "Sent interactive button message via Meta API");
      return true;
    } catch (err) {
      logger.error({ err, to: cleanTo }, "Network error sending interactive buttons via Meta API");
      return await this.sendTextMessage(cleanTo, bodyText);
    }
  }

  /**
   * Downloads a media file (image/audio/document) from Meta Graph API using mediaId
   */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string; fileName?: string } | null> {
    if (!this.token || !mediaId) return null;

    try {
      // 1. Get media URL from Meta Graph API
      const metadataUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
      const metaRes = await fetch(metadataUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!metaRes.ok) {
        logger.error({ status: metaRes.status, mediaId }, "Failed to fetch media metadata from Meta API");
        return null;
      }

      const metaData: any = await metaRes.json();
      const downloadUrl = metaData.url;
      const mimeType = metaData.mime_type || "application/octet-stream";

      if (!downloadUrl) {
        logger.error({ metaData }, "No download URL returned for media ID");
        return null;
      }

      // 2. Download the binary payload using the access token
      const fileRes = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!fileRes.ok) {
        logger.error({ status: fileRes.status, downloadUrl }, "Failed to download media binary from Meta URL");
        return null;
      }

      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return {
        buffer,
        mimeType,
      };
    } catch (err) {
      logger.error({ err, mediaId }, "Exception downloading media from Meta API");
      return null;
    }
  }

  /**
   * Marks incoming user message as read (turns checkmarks blue)
   */
  async markAsRead(messageId: string): Promise<boolean> {
    if (!this.token || !this.phoneId || !messageId) return false;

    const url = `https://graph.facebook.com/v21.0/${this.phoneId}/messages`;

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const metaApiClient = new MetaApiClient();
