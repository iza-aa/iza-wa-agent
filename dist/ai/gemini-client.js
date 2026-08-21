import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
export const AVAILABLE_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-1.5-pro",
    "gemini-3.7-flash"
];
export class GeminiKeyManager {
    keys;
    currentIndex = 0;
    failedKeys = new Map();
    constructor(keys) {
        this.keys = keys;
        if (!keys || keys.length === 0) {
            throw new Error("No Gemini API keys provided in configuration");
        }
    }
    getActiveKey() {
        return this.keys[this.currentIndex];
    }
    markKeyFailed(key, reason) {
        logger.warn({ key: key.slice(0, 8) + "...", reason }, "Gemini API key marked failed, rotating to next key");
        this.failedKeys.set(key, Date.now());
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return this.getActiveKey();
    }
    async executeWithFallback(fn) {
        const models = AVAILABLE_MODELS;
        let lastError = null;
        for (const modelName of models) {
            for (let keyAttempt = 0; keyAttempt < this.keys.length; keyAttempt++) {
                const activeKey = this.getActiveKey();
                try {
                    const genAI = new GoogleGenerativeAI(activeKey);
                    return await fn(genAI, modelName);
                }
                catch (error) {
                    lastError = error;
                    const errorMsg = error?.message || String(error);
                    logger.warn({ modelName, key: activeKey.slice(0, 8) + "...", error: errorMsg }, "Gemini request failed, trying next key or fallback model");
                    this.markKeyFailed(activeKey, errorMsg);
                }
            }
        }
        logger.error({ lastError }, "All Gemini models and API keys in the pool failed");
        throw lastError || new Error("All Gemini models and API keys failed");
    }
}
export const geminiKeyManager = new GeminiKeyManager(config.GEMINI_API_KEYS);
//# sourceMappingURL=gemini-client.js.map