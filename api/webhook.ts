import { webhookProcessor } from "../src/webhook/webhook.processor.js";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

      return res.status(200).json({
        reply: result.reply,
        success: result.success,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
