import { execFile, exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { geminiKeyManager } from "../ai/gemini-client.js";
import { logger } from "../utils/logger.js";
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
export class AgyConnector {
    agyCliPath;
    userConversations = new Map(); // phone -> conversationId
    constructor(cliPath = process.env.AGY_CLI_PATH || "agy") {
        this.agyCliPath = this.resolveAgyBinary(cliPath);
    }
    /**
     * Resolves actual full path of agy binary
     */
    resolveAgyBinary(defaultPath) {
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
    cleanJsonResponse(rawText) {
        let clean = rawText.trim();
        const firstBrace = clean.indexOf("{");
        const lastBrace = clean.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            return clean.slice(firstBrace, lastBrace + 1);
        }
        if (clean.startsWith("```json")) {
            clean = clean.slice(7);
        }
        else if (clean.startsWith("```")) {
            clean = clean.slice(3);
        }
        if (clean.endsWith("```")) {
            clean = clean.slice(0, -3);
        }
        return clean.trim();
    }
    /**
     * Executes AI reasoning via agy CLI subprocess
     */
    async executeViaAgy(systemPrompt, userMessage, userPhone) {
        const fullPrompt = `${systemPrompt}\n\n=======================================================\nPESAN PENGGUNA TERBARU:\n"${userMessage}"\n=======================================================\n\nIngat: Kembalikan HANYA format JSON valid sesuai skema yang diminta.`;
        // Dynamic Model Selection:
        // Use high thinking for deep audit/reconciliation/financial analysis/investigation/anomalies, low thinking for everyday chat & transactions
        const cleanLower = userMessage.toLowerCase();
        const isDeepAudit = cleanLower.includes("audit") ||
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
            const { stdout, stderr } = await execFileAsync(this.agyCliPath, args, {
                timeout: isDeepAudit ? 60000 : 30000,
                env: {
                    ...process.env,
                    PATH: extendedPath,
                },
            });
            if (stderr) {
                logger.debug({ stderr }, "agy CLI stderr output note");
            }
            const cleanJson = this.cleanJsonResponse(stdout);
            const parsed = JSON.parse(cleanJson);
            logger.info({ responseType: parsed.response_type, targetModel }, "Successfully processed response via agy CLI");
            return parsed;
        }
        catch (err) {
            logger.warn({ err: err?.message || err, targetModel }, "agy CLI execution failed or timed out, will fallback to Gemini API");
            return null;
        }
    }
    /**
     * Fallback to Google Generative AI SDK using Gemini Flash
     */
    async executeViaGeminiSdk(systemPrompt, userMessage) {
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
            const cleanJson = this.cleanJsonResponse(rawText);
            try {
                const parsed = JSON.parse(cleanJson);
                return parsed;
            }
            catch (parseErr) {
                logger.error({ parseErr, rawText }, "Failed to parse JSON response from Gemini SDK fallback");
                return {
                    response_type: "GENERAL_CHAT",
                    reply_text: rawText || "Halo! Ada yang bisa saya bantu terkait pencatatan kas hari ini?",
                };
            }
        });
    }
    /**
     * Main chat invocation using agy CLI exclusively
     */
    async chat(systemPrompt, userMessage, userPhone) {
        // 1. Refresh binary path resolution in case environment changed
        this.agyCliPath = this.resolveAgyBinary(this.agyCliPath);
        // 2. Execute via agy CLI (Antigravity CLI)
        const agyResult = await this.executeViaAgy(systemPrompt, userMessage, userPhone);
        if (agyResult && agyResult.response_type && agyResult.reply_text) {
            return agyResult;
        }
        // 3. If explicit fallback is enabled in env, try Gemini SDK, otherwise return polite error
        if (process.env.ENABLE_GEMINI_FALLBACK === "true") {
            logger.info("Executing AI reasoning via Gemini SDK fallback (explicitly enabled)");
            return await this.executeViaGeminiSdk(systemPrompt, userMessage);
        }
        logger.warn({ cli: this.agyCliPath }, "agy CLI returned empty or failed, Gemini Studio fallback is disabled");
        return {
            response_type: "GENERAL_CHAT",
            reply_text: "⚠️ Maaf, terjadi kendala saat memproses penalaran di agy CLI. Mohon pastikan binary `agy` berjalan normal di server.",
        };
    }
}
export const agyConnector = new AgyConnector();
//# sourceMappingURL=agy-connector.js.map