import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRepository } from "../../../src/db/repositories/user.repository.js";
import { TransactionRepository } from "../../../src/db/repositories/transaction.repository.js";

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

    it("should find transaction by short code H001 or 1", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "T026-H001", merchant: "Kopi", total_amount: 25000 },
              error: null,
            }),
          }),
        }),
      });

      const trxRepo = new TransactionRepository(mockSupabase);
      const res1 = await trxRepo.findTransactionByIdOrShortCode("H001");
      expect(res1?.id).toBe("T026-H001");

      const res2 = await trxRepo.findTransactionByIdOrShortCode("1");
      expect(res2?.id).toBe("T026-H001");
    });
  });
});
