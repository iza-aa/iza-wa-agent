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

    it("should allow Super Admin to add a new user with /tambah and formatted phone", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "tambah +62 811-422-404 Ayah");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("berhasil didaftarkan & diaktifkan");
      expect(mockUserRepo.upsertUser).toHaveBeenCalledWith({
        phone_number: "62811422404",
        name: "Ayah",
        role: "member",
        status: "active",
      });
    });

    it("should allow Super Admin to list users with /pengguna or /anggota", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pengguna");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("DAFTAR PENGGUNA TERDAFTAR");
    });

    it("should allow Super Admin to cancel latest transaction with /batal", async () => {
      mockTrxRepo.getLatestTransaction = vi.fn().mockResolvedValue({
        id: "TRX-TEST-999",
        date: "2026-08-20",
        merchant: "Pertamina",
        total_amount: 50000,
        user_name: "Ayah",
      });
      mockTrxRepo.deleteTransaction = vi.fn().mockResolvedValue({
        id: "TRX-TEST-999",
        date: "2026-08-20",
        merchant: "Pertamina",
        total_amount: 50000,
        user_name: "Ayah",
      });

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/batal");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("TRANSAKSI BERHASIL DIHAPUS / DIBATALKAN");
      expect(res.responseMessage).toContain("TRX-TEST-999");
      expect(mockTrxRepo.deleteTransaction).toHaveBeenCalledWith("TRX-TEST-999");
    });

    it("should allow Super Admin to generate monthly report with /laporan", async () => {
      mockTrxRepo.getMonthlySummary = vi.fn().mockResolvedValue({
        total: 1500000,
        count: 5,
        byCategory: { "Makanan & Minuman": 1000000, "Transportasi & Bensin": 500000 },
        byUser: { "Ayah": 1500000 },
        topTransactions: [{ id: "TRX-1", merchant: "Resto", date: "2026-08-10", total_amount: 1000000 }],
      });

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/laporan 2026-08");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("LAPORAN KEUANGAN");
      expect(res.responseMessage).toContain("Makanan & Minuman");
      expect(mockTrxRepo.getMonthlySummary).toHaveBeenCalledWith("2026-08");
    });

    it("should block non-admin from executing /batal or /laporan", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281111111111", "/batal");
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
