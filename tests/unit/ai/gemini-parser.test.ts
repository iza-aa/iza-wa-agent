import { describe, it, expect, vi } from "vitest";
import { GeminiKeyManager } from "../../../src/ai/gemini-client.js";
import { ExtractedTransactionSchema } from "../../../src/ai/schemas/transaction.schema.js";

describe("Gemini AI Pipeline", () => {
  describe("GeminiKeyManager (Multi-Key Rotation & Fallback)", () => {
    it("should rotate through keys sequentially and handle key rotation on failure", () => {
      const keys = ["key-alpha", "key-beta", "key-gamma"];
      const keyManager = new GeminiKeyManager(keys);

      expect(keyManager.getActiveKey()).toBe("key-alpha");
      keyManager.markKeyFailed("key-alpha", "Rate limit exceeded (429)");
      expect(keyManager.getActiveKey()).toBe("key-beta");
      keyManager.markKeyFailed("key-beta", "Quota exhausted");
      expect(keyManager.getActiveKey()).toBe("key-gamma");
    });
  });

  describe("Transaction Schema Validation", () => {
    it("should validate a structured transaction extraction JSON", () => {
      const sampleExtraction = {
        merchant: "Indomaret Point",
        date: "2026-08-20",
        category: "Makanan & Minuman",
        subtotal: 45000,
        tax: 0,
        discount: 5000,
        total_amount: 40000,
        payment_method: "QRIS",
        items: [
          { item_name: "Kopi Point Cafe", qty: 1, price: 25000, total_price: 25000 },
          { item_name: "Roti Coklat", qty: 1, price: 15000, total_price: 15000 },
        ],
        confidence_score: 0.98,
      };

      const parsed = ExtractedTransactionSchema.parse(sampleExtraction);
      expect(parsed.total_amount).toBe(40000);
      expect(parsed.items.length).toBe(2);
      expect(parsed.merchant).toBe("Indomaret Point");
    });
  });
});
