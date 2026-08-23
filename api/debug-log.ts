import { googleSheetsService } from "../src/google/sheets.service.js";
import { logger } from "../src/utils/logger.js";
import { config } from "../src/config/env.js";

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    try {
      const testMsg = `debug-test-${Date.now()}`;
      
      // Log which GOOGLE_SHEET_ID we're using
      const sheetId = config.GOOGLE_SHEET_ID;
      
      // Attempt appendMessageLog
      await googleSheetsService.appendMessageLog(
        "0000000000",
        "debug-bot",
        testMsg,
        "debug"
      );

      return res.status(200).json({
        status: "ok",
        sheetId: sheetId,
        message: testMsg,
        result: "appendMessageLog completed without throwing",
        gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      });
    } catch (err: any) {
      return res.status(500).json({
        status: "error",
        error: err?.message || String(err),
        stack: err?.stack?.split("\n").slice(0, 5),
        sheetId: config.GOOGLE_SHEET_ID,
        gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
