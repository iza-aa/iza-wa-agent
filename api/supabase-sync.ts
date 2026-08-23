import { googleSheetsService } from "../src/google/sheets.service.js";
import { logger } from "../src/utils/logger.js";

const KNOWN_LIDS: Record<string, { phone: string; name: string }> = {
  "216290358743279": { phone: "6281241933754", name: "Jeki (Zaky Irsyad Rais)" },
  "168096866255025": { phone: "62811422404", name: "Ayah" },
  "232130131046571": { phone: "6281346367235", name: "Rezki Haikal" },
  "160632196358183": { phone: "6281524121044", name: "Malla Naks Mammy" },
};

const OFFICIAL_NAMES: Record<string, string> = {
  "6281346367235": "Rezki Haikal",
  "62811422404": "Ayah",
  "6281524121044": "Malla Naks Mammy",
  "6281998976298": "Reny Au",
  "6285256985759": "Nurfadilla",
  "6281241933754": "Jeki",
};

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "online",
      service: "Supabase to Google Sheets Sync Webhook",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const record = body.record || body.new || body;

      if (!record || !record.content) {
        return res.status(200).json({ status: "ignored_empty_record" });
      }

      // Only sync inbound user messages
      if (record.direction && record.direction !== "inbound") {
        return res.status(200).json({ status: "ignored_outbound" });
      }

      const rawPhone = (record.user_phone || "").replace(/[^0-9]/g, "");
      const cleanPhone = KNOWN_LIDS[rawPhone] ? KNOWN_LIDS[rawPhone].phone : rawPhone;
      const officialName =
        KNOWN_LIDS[rawPhone]?.name ||
        OFFICIAL_NAMES[cleanPhone] ||
        record.user_name ||
        "User";
      const messageContent = record.content || "";
      const msgType = record.message_type || "text";

      logger.info(
        { rawPhone, cleanPhone, officialName, messageContent },
        "Supabase Webhook: Syncing chat to Google Sheets Log_Pesan"
      );

      await googleSheetsService.appendMessageLog(
        cleanPhone,
        officialName,
        messageContent,
        msgType
      );

      return res.status(200).json({
        status: "success",
        synced: {
          phone: cleanPhone,
          name: officialName,
          content: messageContent,
        },
      });
    } catch (error: any) {
      logger.error({ error }, "Error in supabase-sync webhook");
      return res.status(500).json({ error: error?.message || "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
