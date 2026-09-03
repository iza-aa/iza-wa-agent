import { execFile, exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { geminiKeyManager } from "../ai/gemini-client.js";
import { AgentDecisionResponse } from "./agent-persona.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export class AgyConnector {
  private agyCliPath: string;
  private userConversations: Map<string, string> = new Map(); // phone -> conversationId

  constructor(cliPath: string = process.env.AGY_CLI_PATH || "agy") {
    this.agyCliPath = this.resolveAgyBinary(cliPath);
  }

  /**
   * Resolves actual full path of agy binary
   */
  private resolveAgyBinary(defaultPath: string): string {
    if (defaultPath !== "agy" && fs.existsSync(defaultPath)) {
      return defaultPath;
    }

    const homeDir = process.env.HOME || "/home/heizaaa";
    const candidatePaths = [
      defaultPath,
      "/usr/local/bin/agy",
      "/usr/bin/agy",
      path.join(homeDir, ".local", "bin", "agy"),
      path.join(homeDir, ".gemini", "antigravity", "bin", "agy"),
      path.join(homeDir, ".cargo", "bin", "agy"),
      path.join(homeDir, ".npm-global", "bin", "agy"),
    ];

    for (const p of candidatePaths) {
      if (p !== "agy" && fs.existsSync(p)) {
        logger.info({ foundPath: p }, "Resolved agy CLI binary path");
        return p;
      }
    }

    return defaultPath;
  }

  /**
   * Cleans JSON output from LLM (extracts JSON object { ... })
   */
  private cleanJsonResponse(rawText: string): string {
    let clean = rawText.trim();

    // 1. Remove markdown code blocks if wrapped
    if (clean.startsWith("```json")) {
      clean = clean.slice(7);
    } else if (clean.startsWith("```")) {
      clean = clean.slice(3);
    }
    if (clean.endsWith("```")) {
      clean = clean.slice(0, -3);
    }
    clean = clean.trim();

    // 2. Extract outermost matching braces
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return clean.slice(firstBrace, lastBrace + 1);
    }

    return clean;
  }

  /**
   * Safely parses JSON even when raw unescaped newlines/tabs are present inside JSON strings
   * or falls back to robust regex extraction if syntax was cut off by LLM
   */
  private safeParseJson(rawText: string): any {
    const clean = this.cleanJsonResponse(rawText);

    // 1. Try standard JSON.parse first
    try {
      return JSON.parse(clean);
    } catch {
      // 2. Try sanitizing unescaped control characters (newlines/tabs)
      try {
        const sanitized = clean.replace(/[\u0000-\u001F]+/g, (match: string) => {
          if (match === "\n") return "\\n";
          if (match === "\r") return "\\r";
          if (match === "\t") return "\\t";
          return "";
        });
        return JSON.parse(sanitized);
      } catch {
        // 3. Robust Regex Fallback: Extract fields directly even if JSON syntax is damaged or trailing brackets missing
        const extractedReply = this.extractFieldWithRegex(clean, ["reply_text", "replytext", "replyText", "message"]);
        const extractedType = this.extractFieldWithRegex(clean, ["response_type", "responsetype", "responseType"]) || "ANSWER_QUERY";

        if (extractedReply) {
          return {
            response_type: extractedType,
            reply_text: extractedReply,
          };
        }

        // If regex also cannot find reply_text, throw to outer fallback
        throw new Error("Could not parse or extract fields from LLM response");
      }
    }
  }

  /**
   * Extracts specific string value from raw LLM output using boundary-safe regex
   */
  private extractFieldWithRegex(text: string, keys: string[]): string | null {
    for (const key of keys) {
      // Matches "key": "value" up to next field key or ending brace
      const regex = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"|}\\s*$)`, "i");
      const match = text.match(regex);
      if (match && match[1]) {
        return match[1]
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .trim();
      }
    }
    return null;
  }

  /**
   * Normalizes keys in case model returned snake_case / camelCase variations (e.g. response_type, responsetype)
   */
  private normalizeResponsePayload(parsed: any): AgentDecisionResponse {
    if (!parsed || typeof parsed !== "object") {
      return {
        response_type: "GENERAL_CHAT",
        reply_text: String(parsed || "Halo! Ada yang bisa saya bantu terkait kas hari ini?"),
      };
    }

    const responseType = parsed.response_type || parsed.responsetype || parsed.responseType || "GENERAL_CHAT";
    const replyText = parsed.reply_text || parsed.replytext || parsed.replyText || parsed.message || "";
    const suggestedButtons = parsed.suggested_buttons || parsed.suggestedbuttons || parsed.suggestedButtons;
    const exportYearMonth = parsed.export_year_month || parsed.exportyearmonth || parsed.exportYearMonth;

    return {
      ...parsed,
      response_type: responseType,
      reply_text: replyText,
      suggested_buttons: Array.isArray(suggestedButtons) ? suggestedButtons : undefined,
      export_year_month: exportYearMonth,
    };
  }

  /**
   * Executes AI reasoning via agy CLI subprocess
   */
  async executeViaAgy(systemPrompt: string, userMessage: string, userPhone?: string): Promise<AgentDecisionResponse | null> {
    const fullPrompt = `${systemPrompt}\n\n=======================================================\nPESAN PENGGUNA TERBARU:\n"${userMessage}"\n=======================================================\n\nIngat: Kembalikan HANYA format JSON valid sesuai skema yang diminta.`;

    // Dynamic Model Selection:
    // Use high thinking for deep audit/reconciliation/financial analysis/investigation/anomalies, low thinking for everyday chat & transactions
    const cleanLower = userMessage.toLowerCase();
    const isDeepAudit =
      cleanLower.includes("audit") ||
      cleanLower.includes("selisih") ||
      cleanLower.includes("rekonsiliasi") ||
      cleanLower.includes("analisis") ||
      cleanLower.includes("bandingkan") ||
      cleanLower.includes("curiga") ||
      cleanLower.includes("mencurigakan") ||
      cleanLower.includes("janggal") ||
      cleanLower.includes("aneh") ||
      cleanLower.includes("tidak wajar") ||
      cleanLower.includes("investigasi") ||
      cleanLower.includes("evaluasi") ||
      cleanLower.includes("anomali") ||
      cleanLower.includes("periksa");

    const targetModel = isDeepAudit
      ? process.env.AGY_MODEL_HIGH || "gemini-3.7-flash-high"
      : process.env.AGY_MODEL_LOW || "gemini-3.7-flash-low";

    try {
      logger.info({ cli: this.agyCliPath, userPhone, targetModel, isDeepAudit }, "Invoking agy CLI for AI reasoning...");

      const homeDir = process.env.HOME || "/home/heizaaa";
      const extendedPath = `${process.env.PATH || ""}:/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin:${homeDir}/.gemini/antigravity/bin:${homeDir}/.cargo/bin:${homeDir}/.npm-global/bin`;

      // Pass target model if configured, with fast failover timeout
      const args = ["-p", fullPrompt];
      if (targetModel) {
        args.push("--model", targetModel);
      }

      const { stdout, stderr } = await execFileAsync(
        this.agyCliPath,
        args,
        {
          timeout: isDeepAudit ? 60000 : 30000,
          env: {
            ...process.env,
            PATH: extendedPath,
          },
        }
      );

      if (stderr) {
        logger.debug({ stderr }, "agy CLI stderr output note");
      }

      const parsed = this.safeParseJson(stdout);
      const normalized = this.normalizeResponsePayload(parsed);
      logger.info({ responseType: normalized.response_type, targetModel }, "Successfully processed response via agy CLI");
      return normalized;
    } catch (err: any) {
      logger.warn({ err: err?.message || err, targetModel }, "agy CLI execution failed or timed out, will fallback to Gemini API");
      return null;
    }
  }

  /**
   * Fallback to Google Generative AI SDK using Gemini Flash
   */
  async executeViaGeminiSdk(systemPrompt: string, userMessage: string): Promise<AgentDecisionResponse> {
    return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const prompt = `Pesan Pengguna:\n"${userMessage}"\n\nAnalisis pesan di atas dan kembalikan JSON sesuai format yang ditentukan.`;
      const result = await model.generateContent(prompt);
      const rawText = result.response.text();

      try {
        const parsed = this.safeParseJson(rawText);
        return this.normalizeResponsePayload(parsed);
      } catch (parseErr) {
        logger.error({ parseErr, rawText }, "Failed to parse JSON response from Gemini SDK fallback");
        // Final ultimate safety: if rawText contains markdown or any words, extract text cleanly without JSON brackets
        const cleanFallback = this.extractFieldWithRegex(rawText, ["reply_text", "replytext", "message"]) ||
          rawText.replace(/\{[\s\S]*?"reply_?text"\s*:\s*"/i, "").replace(/"[\s\S]*\}$/i, "").trim();

        return {
          response_type: "GENERAL_CHAT",
          reply_text: cleanFallback || "Halo! Ada yang bisa saya bantu terkait pencatatan kas hari ini?",
        };
      }
    });
  }

  /**
   * Main chat invocation using agy CLI exclusively
   */
  async chat(systemPrompt: string, userMessage: string, userPhone?: string): Promise<AgentDecisionResponse> {
    // 1. Refresh binary path resolution in case environment changed
    this.agyCliPath = this.resolveAgyBinary(this.agyCliPath);

    // 2. Execute via agy CLI (Antigravity CLI)
    const agyResult = await this.executeViaAgy(systemPrompt, userMessage, userPhone);
    if (agyResult && agyResult.response_type && agyResult.reply_text) {
      return agyResult;
    }

    // 3. Fallback to Gemini SDK automatically with key rotation
    logger.info("Executing AI reasoning via Gemini SDK fallback...");
    try {
      return await this.executeViaGeminiSdk(systemPrompt, userMessage);
    } catch (sdkErr: any) {
      logger.error({ sdkErr: sdkErr?.message || sdkErr }, "Both agy CLI and Gemini SDK failed");
      return {
        response_type: "GENERAL_CHAT",
        reply_text: "⚠️ Mohon maaf, terjadi kendala teknis saat memproses pesan Anda. Silakan coba sesaat lagi.",
      };
    }
  }
}

export const agyConnector = new AgyConnector();
