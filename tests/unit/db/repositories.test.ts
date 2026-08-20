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
    it("should generate a valid short transaction ID", () => {
      const trxRepo = new TransactionRepository(mockSupabase);
      const trxId = trxRepo.generateTransactionId();
      expect(trxId).toMatch(/^TRX-\d{8}-[A-Z0-9]{4}$/);
    });
  });
});
