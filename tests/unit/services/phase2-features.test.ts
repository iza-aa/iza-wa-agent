import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeNaturalQuerySearch, parseQueryIntent } from "../../../src/ai/parsers/search.parser.js";
import { geminiKeyManager } from "../../../src/ai/gemini-client.js";

describe("Phase 2 Features Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Natural Query Search & Voice QA Assistant", () => {
    it("should handle wallet balance query for Super Admin", async () => {
      vi.spyOn(geminiKeyManager, "executeWithFallback").mockResolvedValue({
        intent_type: "wallet_balance",
      });

      const mockTrxRepo: any = {
        getWalletBalance: vi.fn().mockResolvedValue({
          totalIncome: 10000000,
          totalExpense: 3000000,
          balance: 7000000,
          monthIncome: 5000000,
          monthExpense: 2000000,
          monthBalance: 3000000,
          currentMonth: "2026-08",
        }),
      };

      const res = await executeNaturalQuerySearch(
        "Berapa sisa uang kas kita sekarang?",
        mockTrxRepo,
        true,
        "6281346367235"
      );

      expect(res.isQuery).toBe(true);
      expect(res.replyText).toContain("STATUS DOMPET & SALDO KAS");
      expect(mockTrxRepo.getWalletBalance).toHaveBeenCalled();
    });

    it("should block wallet balance query for non-admin", async () => {
      vi.spyOn(geminiKeyManager, "executeWithFallback").mockResolvedValue({
        intent_type: "wallet_balance",
      });

      const mockTrxRepo: any = {
        getWalletBalance: vi.fn(),
      };

      const res = await executeNaturalQuerySearch(
        "Berapa sisa uang kas kita sekarang?",
        mockTrxRepo,
        false,
        "6289999999"
      );

      expect(res.isQuery).toBe(true);
      expect(res.replyText).toContain("hanya dapat diakses oleh Super Admin");
      expect(mockTrxRepo.getWalletBalance).not.toHaveBeenCalled();
    });

    it("should search historical transactions correctly", async () => {
      vi.spyOn(geminiKeyManager, "executeWithFallback").mockResolvedValue({
        intent_type: "search_transactions",
        search_params: {
          keyword: "bensin",
          category: "Transportasi & Bensin",
        },
      });

      const mockTrxRepo: any = {
        searchTransactions: vi.fn().mockResolvedValue([
          {
            id: "T026-H001",
            merchant: "Pertamina",
            category: "Transportasi & Bensin",
            total_amount: 50000,
            date: "2026-08-20",
            payment_method: "Cash",
            user_name: "Ayah",
          },
        ]),
      };

      const res = await executeNaturalQuerySearch(
        "Berapa kali beli bensin bulan ini?",
        mockTrxRepo,
        true,
        "6281346367235"
      );

      expect(res.isQuery).toBe(true);
      expect(res.replyText).toContain("HASIL PENCARIAN TRANSAKSI");
      expect(res.replyText).toContain("Pertamina");
      expect(mockTrxRepo.searchTransactions).toHaveBeenCalled();
    });

    it("should return isQuery: false for regular transaction recording text", async () => {
      vi.spyOn(geminiKeyManager, "executeWithFallback").mockResolvedValue({
        intent_type: "not_a_query",
      });

      const mockTrxRepo: any = {};

      const res = await executeNaturalQuerySearch(
        "Beli kopi 25rb cash",
        mockTrxRepo,
        true,
        "6281346367235"
      );

      expect(res.isQuery).toBe(false);
      expect(res.replyText).toBe("");
    });
  });
});

