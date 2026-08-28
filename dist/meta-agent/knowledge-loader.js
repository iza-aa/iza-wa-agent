import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
export class KnowledgeLoader {
    knowledgeDir;
    cachedKnowledge = "";
    lastLoadedAt = 0;
    constructor(knowledgeDir = path.resolve(process.cwd(), "src", "knowledge")) {
        this.knowledgeDir = knowledgeDir;
    }
    /**
     * Loads and concatenates all markdown documents from src/knowledge/
     */
    async loadAllKnowledge(forceReload = false) {
        const now = Date.now();
        // Cache for 5 minutes unless forced
        if (this.cachedKnowledge && !forceReload && now - this.lastLoadedAt < 5 * 60 * 1000) {
            return this.cachedKnowledge;
        }
        try {
            if (!fs.existsSync(this.knowledgeDir)) {
                logger.warn({ dir: this.knowledgeDir }, "Knowledge directory does not exist, creating it");
                fs.mkdirSync(this.knowledgeDir, { recursive: true });
                return "";
            }
            const files = fs.readdirSync(this.knowledgeDir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
            const contents = [];
            for (const file of files) {
                const fullPath = path.join(this.knowledgeDir, file);
                try {
                    const content = fs.readFileSync(fullPath, "utf-8");
                    contents.push(`=== DOKUMEN: ${file} ===\n${content.trim()}\n`);
                }
                catch (readErr) {
                    logger.error({ readErr, file }, "Failed to read knowledge file");
                }
            }
            this.cachedKnowledge = contents.join("\n\n");
            this.lastLoadedAt = now;
            logger.info({ filesCount: files.length }, "Successfully loaded knowledge base documents");
            return this.cachedKnowledge;
        }
        catch (err) {
            logger.error({ err }, "Exception loading knowledge base");
            return this.cachedKnowledge || "";
        }
    }
    getKnowledgeText() {
        return this.cachedKnowledge;
    }
}
export const knowledgeLoader = new KnowledgeLoader();
//# sourceMappingURL=knowledge-loader.js.map