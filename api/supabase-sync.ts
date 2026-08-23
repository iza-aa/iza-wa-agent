import { googleSheetsService } from "../src/google/sheets.service.js";
import { getSupabaseClient } from "../src/db/supabase.js";
import { logger } from "../src/utils/logger.js";

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
      const supabase = getSupabaseClient();

      // Dynamically resolve user from database by phone or linked LID (target_sheet_id)
      let cleanPhone = rawPhone;
      let officialName = record.user_name || "User";

      const { data: matchedUser } = await supabase
        .from("users")
        .select("phone_number, name")
        .or(`phone_number.eq.${rawPhone},target_sheet_id.eq.${rawPhone}`)
        .maybeSingle();

      if (matchedUser) {
        cleanPhone = matchedUser.phone_number;
        officialName = matchedUser.name;
      }

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
