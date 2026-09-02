import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

export class KnowledgeLoader {
  private cachedKnowledge: string = "";
  private isPreloaded: boolean = false;

  constructor(private knowledgeDir: string = path.resolve(process.cwd(), "src", "knowledge")) {}

  /**
   * Preloads all markdown documents from src/knowledge/ into RAM at startup
   */
  async preload(): Promise<void> {
    try {
      if (!fs.existsSync(this.knowledgeDir)) {
        logger.warn({ dir: this.knowledgeDir }, "Knowledge directory does not exist, creating it");
        fs.mkdirSync(this.knowledgeDir, { recursive: true });
        this.cachedKnowledge = "";
        this.isPreloaded = true;
        return;
      }

      const files = fs.readdirSync(this.knowledgeDir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
      const contents: string[] = [];

      for (const file of files) {
        const fullPath = path.join(this.knowledgeDir, file);
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          contents.push(`=== DOKUMEN: ${file} ===\n${content.trim()}\n`);
        } catch (readErr) {
          logger.error({ readErr, file }, "Failed to read knowledge file during preload");
        }
      }

      this.cachedKnowledge = contents.join("\n\n");
      this.isPreloaded = true;
      logger.info({ filesCount: files.length, totalBytes: Buffer.byteLength(this.cachedKnowledge, "utf-8") }, "Knowledge base preloaded into RAM cache");
    } catch (err) {
      logger.error({ err }, "Exception preloading knowledge base into memory");
      this.cachedKnowledge = "";
      this.isPreloaded = true;
    }
  }

  /**
   * Instant retrieval of knowledge documents from RAM (0ms latency)
   */
  async loadAllKnowledge(forceReload = false): Promise<string> {
    if (this.isPreloaded && !forceReload) {
      return this.cachedKnowledge;
    }

    await this.preload();
    return this.cachedKnowledge;
  }

  getKnowledgeText(): string {
    return this.cachedKnowledge;
  }
}

export const knowledgeLoader = new KnowledgeLoader();
