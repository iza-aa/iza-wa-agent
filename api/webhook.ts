import { webhookProcessor } from "../src/webhook/webhook.processor.js";
import { logger } from "../src/utils/logger.js";

async function sendFonnteReply(target: string, message: string, token?: string) {
  const authToken = token || process.env.FONNTE_TOKEN;
  if (!authToken) {
    logger.warn({ target }, "No Fonnte authorization token found in headers, body, or FONNTE_TOKEN env");
    return;
  }

  try {
    const response = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: target,
        message: message,
      }),
    });
    const result = await response.json();
    logger.info({ result, target }, "Fonnte reply API response");
  } catch (err) {
    logger.error({ err, target }, "Error sending reply to Fonnte API");
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const challenge = req.query?.["hub.challenge"];

    if (mode === "subscribe") {
      return res.status(200).send(challenge);
    }

    return res.status(200).json({
      status: "online",
      service: "IZA WA-Agent Serverless Webhook",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const authToken = req.headers?.authorization || body.token || process.env.FONNTE_TOKEN;

      const sender =
        body.sender ||
        body.from ||
        body.phone ||
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

      const message =
        body.message ||
        body.text ||
        body.body ||
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;

      const name =
        body.name ||
        body.pushName ||
        body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;

      const mediaUrl = body.url || body.mediaUrl || body.file;
      const mediaType = body.mediaType || body.type;

      if (!sender) {
        return res.status(400).json({ error: "Missing sender in request payload" });
      }

      const result = await webhookProcessor.process({
        sender,
        message,
        name,
        mediaUrl,
        mediaType,
      });

      // Send outbound message back to WhatsApp via Fonnte API
      if (result.reply) {
        await sendFonnteReply(sender, result.reply, authToken);
      }

      return res.status(200).json({
        reply: result.reply,
        success: result.success,
      });
    } catch (error: any) {
      logger.error({ error }, "Error handling webhook POST");
      return res.status(500).json({ error: error?.message || "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
