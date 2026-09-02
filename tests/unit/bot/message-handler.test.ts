import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandHandler } from "../../../src/bot/handlers/command.handler.js";
import { formatRupiah } from "../../../src/bot/formatters/reply.formatter.js";

vi.mock("../../../src/google/sheets.service.js", () => ({
  googleSheetsService: {
    appendTransaction: vi.fn().mockResolvedValue({ updatedRange: "Transaksi!A2:L2", rowIndex: 2 }),
    deleteTransactionRow: vi.fn().mockResolvedValue(true),
    ensureSheetInitialized: vi.fn().mockResolvedValue(undefined),
    setupDashboardTab: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("WhatsApp Bot Handlers", () => {
  let mockUserRepo: any;
  let mockTrxRepo: any;

  beforeEach(() => {
    mockUserRepo = {
      isSuperAdmin: vi.fn().mockImplementation((p: string) => p === "6281346367235"),
      isSuperAdminAsync: vi.fn().mockImplementation(async (p: string) => p === "6281346367235"),
      getUser: vi.fn().mockResolvedValue({ phone_number: "6281346367235", name: "Ayah", role: "super_admin", status: "active" }),
      listActiveUsers: vi.fn().mockResolvedValue([
        { phone_number: "6281346367235", name: "Ayah", role: "super_admin", status: "active" },
      ]),
      upsertUser: vi.fn().mockResolvedValue({}),
      setUserStatus: vi.fn().mockResolvedValue(true),
    };
    mockTrxRepo = {
      getRecentTransactions: vi.fn().mockResolvedValue([]),
      generateTransactionId: vi.fn().mockReturnValue("TRX-TEST-001"),
      updateGSheetRow: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("CommandHandler", () => {
    it("should handle /help command", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/help");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("PANDUAN PENGGUNAAN BOT KEUANGAN");
    });

    it("should provide spreadsheet and drive links with /link for Super Admin only", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/link");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Google Sheets");
      expect(res.responseMessage).toContain("Google Drive");

      // Block regular member
      const memberRes = await handler.handleCommand("6281299998888", "/link");
      expect(memberRes.handled).toBe(true);
      expect(memberRes.responseMessage).toContain("hanya dapat diakses oleh Super Admin");
    });

    it("should allow Super Admin to add a new user with /tambah and formatted phone", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/tambah +62 811-422-404 Ayah super_admin");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("berhasil didaftarkan & diaktifkan sebagai *Super Admin*");
      expect(mockUserRepo.upsertUser).toHaveBeenCalledWith({
        phone_number: "62811422404",
        name: "Ayah",
        role: "super_admin",
        status: "active",
      });
    });

    it("should allow Super Admin to list users with /pengguna or /anggota", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pengguna");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("DAFTAR PENGGUNA TERDAFTAR");
    });

    it("should display transaction detail with /detail", async () => {
      mockTrxRepo.getTransactionWithItems = vi.fn().mockResolvedValue({
        trx: {
          id: "TRX-TEST-001",
          date: "2026-08-20",
          merchant: "Alfamart",
          category: "Belanja Bulanan",
          total_amount: 50000,
          user_name: "Ayah",
          user_phone: "6281346367235",
          payment_method: "Cash",
        },
        items: [{ item_name: "Susu", qty: 2, price: 25000 }],
      });
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/detail TRX-TEST-001");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("DETAIL PENGELUARAN");
      expect(res.responseMessage).toContain("Alfamart");
      expect(res.responseMessage).toContain("Susu");
    });

    it("should display wallet balance with /saldo", async () => {
      mockTrxRepo.getWalletBalance = vi.fn().mockResolvedValue({
        totalIncome: 10000000,
        totalExpense: 2500000,
        balance: 7500000,
        monthIncome: 5000000,
        monthExpense: 1000000,
        monthBalance: 4000000,
        currentMonth: "2026-08",
      });

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/saldo");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("STATUS DOMPET & SALDO KAS");
      expect(res.responseMessage).toContain("SISA SALDO KAS SAAT INI");
    });

    it("should allow recording income with /pemasukan", async () => {
      mockTrxRepo.generateTransactionId = vi.fn().mockReturnValue("TRX-INC-001");
      mockTrxRepo.createTransaction = vi.fn().mockResolvedValue({
        id: "TRX-INC-001",
        date: "2026-08-20",
        merchant: "Gaji Bulanan",
        category: "Pemasukan: Gaji",
        total_amount: 5000000,
        user_name: "Ayah",
        user_phone: "6281346367235",
        status: "income",
      });
      mockTrxRepo.getWalletBalance = vi.fn().mockResolvedValue({
        totalIncome: 5000000,
        totalExpense: 0,
        balance: 5000000,
        monthIncome: 5000000,
        monthExpense: 0,
        monthBalance: 5000000,
        currentMonth: "2026-08",
      });

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pemasukan 5000000 Gaji Bulanan Mandiri");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Pemasukan Berhasil Dicatat");
      expect(res.responseMessage).toContain("Gaji Bulanan");
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
        totalExpense: 1500000,
        totalIncome: 5000000,
        netCashflow: 3500000,
        count: 5,
        byCategory: { "Makanan & Minuman": 1000000, "Transportasi & Bensin": 500000 },
        byUser: { "Ayah": 1500000 },
        topTransactions: [{ id: "TRX-1", merchant: "Resto", date: "2026-08-10", total_amount: 1000000 }],
      });

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/laporan 2026-08");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("LAPORAN ARUS KAS DOMPET");
      expect(res.responseMessage).toContain("Makanan & Minuman");
      expect(mockTrxRepo.getMonthlySummary).toHaveBeenCalledWith("2026-08");
    });

    it("should allow /rekap with custom limit and display transaction IDs", async () => {
      mockTrxRepo.getAllRecentTransactions = vi.fn().mockResolvedValue([
        {
          id: "TRX-20260820-001",
          date: "2026-08-20",
          merchant: "Alfamart",
          category: "Belanja Bulanan",
          total_amount: 50000,
          user_name: "Ayah",
        },
      ]);

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/rekap 5");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("REKAP 1 TRANSAKSI TERAKHIR");
      expect(res.responseMessage).toContain("TRX-20260820-001");
      expect(mockTrxRepo.getAllRecentTransactions).toHaveBeenCalledWith(5);
    });

    it("should block non-admin from executing /laporan", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281111111111", "/laporan");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("hanya dapat dijalankan oleh Super Admin");
    });
  });

  describe("Reply Formatter", () => {
    it("should format rupiah amounts accurately", () => {
      expect(formatRupiah(50000)).toMatch(/Rp\s*50\.000/);
    });
  });

  describe("Interactive Confirmation & Draft Flow", () => {
    it("should format interactive draft preview with clear action instructions", async () => {
      const { ConfirmationFlow } = await import("../../../src/meta-agent/confirmation-flow.js");
      const { PendingActionRepository } = await import("../../../src/db/repositories/pending-action.repository.js");

      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ gt: vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }) }) }) }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }),
      };

      const pendingRepo = new PendingActionRepository(mockSupabase);
      const confirmationFlow = new ConfirmationFlow(pendingRepo, mockTrxRepo, mockUserRepo);

      const preview = confirmationFlow.formatDraftPreview({
        type: "income",
        merchant: "Mammi Cafe",
        date: "2026-09-01",
        category: "Pemasukan: Penjualan",
        total_amount: 234300,
        payment_method: "QRIS BRI",
      });

      expect(preview).toContain("DRAF TRANSAKSI BARU");
      expect(preview).toContain("🟢 *Pemasukan*");
      expect(preview).toContain("Mammi Cafe");
      expect(preview).toContain("234.300");
      expect(preview).toContain("QRIS BRI");
      expect(preview).toContain("Ketik *Ya* / *Simpan*");
      expect(preview).toContain("Ketik *Pemasukan* / *Pengeluaran*");
    });

    it("should classify user decisions accurately (Confirm, Cancel, Modify)", async () => {
      const { ConfirmationFlow } = await import("../../../src/meta-agent/confirmation-flow.js");
      const confirmationFlow = new ConfirmationFlow({} as any, mockTrxRepo, mockUserRepo);

      expect(confirmationFlow.classifyUserDecision("ya")).toEqual({ type: "CONFIRM" });
      expect(confirmationFlow.classifyUserDecision("simpan")).toEqual({ type: "CONFIRM" });
      expect(confirmationFlow.classifyUserDecision("ok")).toEqual({ type: "CONFIRM" });
      expect(confirmationFlow.classifyUserDecision("batal")).toEqual({ type: "CANCEL" });
      expect(confirmationFlow.classifyUserDecision("pemasukan")).toEqual({ type: "MODIFY", modificationText: "pemasukan" });
      expect(confirmationFlow.classifyUserDecision("pengeluaran")).toEqual({ type: "MODIFY", modificationText: "pengeluaran" });
    });
  });
});
