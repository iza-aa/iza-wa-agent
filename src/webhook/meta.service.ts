import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { WebhookProcessor, WebhookIncomingPayload } from "./webhook.processor.js";

export class MetaWhatsAppService {
  private webhookProcessor: WebhookProcessor;

  constructor() {
    this.webhookProcessor = new WebhookProcessor();
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
   * Sends a text message back to WhatsApp user via Meta Graph API
   */
  async sendTextMessage(to: string, messageText: string): Promise<boolean> {
    const token = config.META_ACCESS_TOKEN;
    const phoneId = config.META_PHONE_NUMBER_ID || "1293341430536275";

    if (!token || !phoneId) {
      logger.error("Meta Access Token or Phone Number ID is missing");
      return false;
    }

    const cleanTo = to.replace(/[^0-9]/g, "");
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
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
        logger.error({ resData, status: response.status }, "Failed to send message via Meta Graph API");
        return false;
      }

      logger.info({ to: cleanTo, messageId: (resData as any)?.messages?.[0]?.id }, "Sent message successfully via Meta API");
      return true;
    } catch (err) {
      logger.error({ err, to: cleanTo }, "Network error sending message via Meta API");
      return false;
    }
  }

  /**
   * Handles incoming Meta Webhook notification (POST)
   */
  async handleIncomingWebhook(body: any): Promise<void> {
    if (!body || body.object !== "whatsapp_business_account") {
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value || changes.field !== "messages") {
      return;
    }

    const messages = value.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      // Could be a status update (delivered, read, sent), ignore safely
      return;
    }

    const contact = value.contacts?.[0];
    const senderName = contact?.profile?.name || "User";

    for (const msg of messages) {
      const senderPhone = msg.from;
      const msgType = msg.type;

      logger.info({ senderPhone, senderName, msgType }, "Received incoming message from Meta Webhook");

      const payload: WebhookIncomingPayload = {
        sender: senderPhone,
        name: senderName,
        mediaType: "text",
      };

      if (msgType === "text") {
        payload.message = msg.text?.body || "";
      } else if (msgType === "image") {
        payload.mediaType = "image";
        payload.message = msg.image?.caption || "";
      } else if (msgType === "audio" || msgType === "voice") {
        payload.mediaType = "audio";
      } else if (msgType === "document") {
        payload.mediaType = "document";
        payload.message = msg.document?.caption || "";
      }

      try {
        const result = await this.webhookProcessor.process(payload);
        if (result && result.reply) {
          await this.sendTextMessage(senderPhone, result.reply);
        }
      } catch (err) {
        logger.error({ err, senderPhone }, "Error processing message via WebhookProcessor");
      }
    }
  }
}

export const metaWhatsAppService = new MetaWhatsAppService();
