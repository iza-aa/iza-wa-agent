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

    it("should correctly validate table items with single price column consumed as-is without auto-multiplication", () => {
      const rawTableItems = [
        { item_name: "Sayur 6 ikat", qty: 6, unit: "ikat", price: 1000, total_price: 6000, department: "Dapur" },
        { item_name: "Sirup", qty: 1, unit: "dos", price: 150000, total_price: 150000, department: "Barista" },
        { item_name: "Cairan pembersih", qty: 2, unit: "botol", price: 25000, total_price: 50000, department: "Waiters" },
        { item_name: "Air minum", qty: 3, unit: "karton", price: 40000, total_price: 120000, department: "Kasir" },
        { item_name: "Minyak Goreng", qty: 5, unit: "liter", price: 24000, total_price: 120000, department: "Dapur" },
        { item_name: "Ayam", qty: 1, unit: "pax", price: 150000, total_price: 150000, department: "Dapur" },
        { item_name: "Token Listrik", qty: 1, unit: "kali", price: 500000, total_price: 500000, department: "Kafe", notes: "ID. 3214567891" },
        { item_name: "Token Listrik", qty: 1, unit: "kali", price: 500000, total_price: 500000, department: "Kafe", notes: "ID. 1234567890" },
      ];

      const sumTotal = rawTableItems.reduce((acc, it) => acc + it.total_price, 0);
      expect(sumTotal).toBe(1596000); // 1.596.000, NOT 2.396.000

      const parsed = ExtractedTransactionSchema.parse({
        merchant: "Belanja Harian",
        date: "2026-08-01",
        category: "Operasional Kantor",
        subtotal: sumTotal,
        tax: 0,
        discount: 0,
        total_amount: sumTotal,
        payment_method: "Mandiri",
        items: rawTableItems,
      });

      expect(parsed.total_amount).toBe(1596000);
      expect(parsed.items.find(i => i.item_name === "Minyak Goreng")?.total_price).toBe(120000);
      expect(parsed.items.find(i => i.item_name === "Minyak Goreng")?.price).toBe(24000);
      expect(parsed.items.find(i => i.item_name === "Air minum")?.total_price).toBe(120000);
      expect(parsed.items.find(i => i.item_name === "Air minum")?.price).toBe(40000);
      expect(parsed.items.find(i => i.item_name === "Sayur 6 ikat")?.total_price).toBe(6000);
      expect(parsed.items.find(i => i.item_name === "Sayur 6 ikat")?.price).toBe(1000);
    });
  });
});
