import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandHandler } from "../../../src/bot/handlers/command.handler.js";
import { formatRupiah } from "../../../src/bot/formatters/reply.formatter.js";

describe("WhatsApp Bot Handlers", () => {
  let mockUserRepo: any;
  let mockTrxRepo: any;

  beforeEach(() => {
    mockUserRepo = {
      isSuperAdmin: vi.fn().mockImplementation((p: string) => p === "6281346367235"),
      listActiveUsers: vi.fn().mockResolvedValue([
        { phone_number: "6281346367235", name: "Ayah", role: "super_admin", status: "active" },
      ]),
      upsertUser: vi.fn().mockResolvedValue({}),
      setUserStatus: vi.fn().mockResolvedValue(true),
    };
    mockTrxRepo = {
      getRecentTransactions: vi.fn().mockResolvedValue([]),
      generateTransactionId: vi.fn().mockReturnValue("TRX-TEST-001"),
    };
  });

  describe("CommandHandler", () => {
    it("should handle /help command", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/help");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("PANDUAN PENGGUNAAN BOT KEUANGAN");
    });

    it("should allow Super Admin to approve a new user", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/approve 628999888777 Budi");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("berhasil disetujui");
      expect(mockUserRepo.upsertUser).toHaveBeenCalledWith({
        phone_number: "628999888777",
        name: "Budi",
        role: "member",
        status: "active",
      });
    });

    it("should block non-admin from executing admin commands", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281111111111", "/approve 628999888777 Budi");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("hanya dapat dijalankan oleh Super Admin");
    });
  });

  describe("Reply Formatter", () => {
    it("should format rupiah amounts accurately", () => {
      expect(formatRupiah(50000)).toMatch(/Rp\s*50\.000/);
    });
  });
});
