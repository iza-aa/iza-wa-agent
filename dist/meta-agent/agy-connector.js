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
     * Cleans JSON output from LLM (removes markdown backticks if any)
     */
    cleanJsonResponse(rawText) {
        let clean = rawText.trim();
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
        try {
            logger.info({ cli: this.agyCliPath, userPhone }, "Invoking agy CLI for AI reasoning...");
            // Execute agy new-conversation with full environment PATH
            const homeDir = process.env.HOME || "/home/heizaaa";
            const extendedPath = `${process.env.PATH || ""}:/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin:${homeDir}/.gemini/antigravity/bin:${homeDir}/.cargo/bin:${homeDir}/.npm-global/bin`;
            const { stdout, stderr } = await execFileAsync(this.agyCliPath, ["new-conversation", "--model=flash", fullPrompt], {
                timeout: 35000,
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
            logger.info({ responseType: parsed.response_type }, "Successfully processed response via agy CLI");
            return parsed;
        }
        catch (err) {
            logger.warn({ err: err?.message || err }, "agy CLI execution failed or timed out, will fallback to Gemini API");
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
     * Main chat invocation with seamless fallback
     */
    async chat(systemPrompt, userMessage, userPhone) {
        // 1. Try agy CLI first
        const agyResult = await this.executeViaAgy(systemPrompt, userMessage, userPhone);
        if (agyResult && agyResult.response_type && agyResult.reply_text) {
            return agyResult;
        }
        // 2. Fallback to Gemini SDK
        logger.info("Executing AI reasoning via Gemini SDK fallback");
        return await this.executeViaGeminiSdk(systemPrompt, userMessage);
    }
}
export const agyConnector = new AgyConnector();
//# sourceMappingURL=agy-connector.js.map