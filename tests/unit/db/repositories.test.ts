import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRepository } from "../../../src/db/repositories/user.repository.js";
import { TransactionRepository } from "../../../src/db/repositories/transaction.repository.js";
import { googleSheetsService } from "../../../src/google/sheets.service.js";

vi.mock("../../../src/google/sheets.service.js", () => ({
  googleSheetsService: {
    getHighestTransactionSequence: vi.fn().mockResolvedValue(5),
  },
}));

describe("Database Repositories", () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(),
    };
  });

  describe("UserRepository", () => {
    it("should identify super admin correctly based on configured phone", async () => {
      const userRepo = new UserRepository(mockSupabase, "6281346367235");
      expect(userRepo.isSuperAdmin("6281346367235")).toBe(true);
      expect(userRepo.isSuperAdmin("6289999999999")).toBe(false);
    });

    it("should return true when user is active in database", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { phone_number: "62812345678", role: "member", status: "active" },
              error: null,
            }),
          }),
        }),
      });

      const userRepo = new UserRepository(mockSupabase, "6281346367235");
      const isAllowed = await userRepo.isWhitelisted("62812345678");
      expect(isAllowed).toBe(true);
    });
  });

  describe("TransactionRepository", () => {
    it("should generate a valid T026-A001 format transaction ID", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          like: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: "T026-H005" }],
                error: null,
              }),
            }),
          }),
        }),
      });

      const trxRepo = new TransactionRepository(mockSupabase);
      const trxId = await trxRepo.generateTransactionId("2026-08-20");
      expect(trxId).toBe("T026-H006");
    });

    it("should find transaction by short code H001, 1, or H-118", async () => {
      const today = new Date();
      const currentYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(today).slice(0, 4);
      const currentYearPrefix = "T" + currentYear.slice(-3);
      const currentMonthIdx = parseInt(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(today).slice(5, 7), 10) - 1;
      const monthLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
      const currentMonthLetter = monthLetters[currentMonthIdx] || "H";
      const currentMonthTrxId = `${currentYearPrefix}-${currentMonthLetter}001`;

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col, val) => {
            if (val === "T026-H001" || val === currentMonthTrxId) {
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: val, merchant: "Kopi", total_amount: 25000 },
                  error: null,
                }),
              };
            }
            if (val === "T026-H118") {
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "T026-H118", merchant: "Pemasukan Kas", total_amount: 2253000 },
                  error: null,
                }),
              };
            }
            return {
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }),
        }),
      });

      const trxRepo = new TransactionRepository(mockSupabase);
      const res1 = await trxRepo.findTransactionByIdOrShortCode("H001");
      expect(res1?.id).toBe("T026-H001");

      const res2 = await trxRepo.findTransactionByIdOrShortCode("1");
      expect(res2?.id).toBe(currentMonthTrxId);

      const res3 = await trxRepo.findTransactionByIdOrShortCode("H-118");
      expect(res3?.id).toBe("T026-H118");

      const res4 = await trxRepo.findTransactionByIdOrShortCode("h-118");
      expect(res4?.id).toBe("T026-H118");
    });
  });
});
