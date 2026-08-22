import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandHandler, parseHumanNominal, parseIndonesianMonth } from "../../src/bot/handlers/command.handler.js";
import { extractDeterministicEdits } from "../../src/ai/parsers/edit.parser.js";
import { getCanonicalPaymentMethod } from "../../src/utils/payment-methods.js";
import { normalizePhoneNumber } from "../../src/utils/phone.utils.js";
import { formatBillReminder, formatTransactionSuccess, formatDailyRecap, formatMonthlyReport } from "../../src/bot/formatters/reply.formatter.js";

vi.mock("../../src/google/sheets.service.js", () => ({
  googleSheetsService: {
    appendTransaction: vi.fn().mockResolvedValue({ updatedRange: "Transaksi!A2:L2", rowIndex: 2 }),
    deleteTransactionRow: vi.fn().mockResolvedValue(true),
    updateTransactionRow: vi.fn().mockResolvedValue(true),
    ensureSheetInitialized: vi.fn().mockResolvedValue(undefined),
    setupDashboardTab: vi.fn().mockResolvedValue(undefined),
    syncFromSheetToDatabase: vi.fn().mockResolvedValue({ syncedCount: 5 }),
  },
}));

vi.mock("../../src/services/pdf-report.service.js", () => ({
  pdfReportService: {
    generateMonthlyReportPdf: vi.fn().mockResolvedValue(Buffer.from("dummy-pdf")),
  },
}));

describe("Comprehensive 43-Gap Resolution Test Suite", () => {
  let mockUserRepo: any;
  let mockTrxRepo: any;
  let mockBudgetRepo: any;
  let mockBillRepo: any;

  beforeEach(() => {
    mockUserRepo = {
      isSuperAdmin: vi.fn().mockImplementation((p: string) => p === "6281346367235"),
      isSuperAdminAsync: vi.fn().mockImplementation(async (p: string) => p === "6281346367235"),
      getUser: vi.fn().mockImplementation(async (p: string) => ({
        phone_number: p,
        name: p === "6281346367235" ? "Ayah" : "Budi Staf",
        role: p === "6281346367235" ? "super_admin" : "member",
        status: "active",
      })),
      getOrCreateUser: vi.fn().mockImplementation(async (p: string, pushName: string) => ({
        phone_number: p,
        name: p === "6281346367235" ? "Ayah" : (pushName || "Budi Staf"),
        role: p === "6281346367235" ? "super_admin" : "member",
        status: "active",
      })),
      listActiveUsers: vi.fn().mockResolvedValue([
        { phone_number: "6281346367235", name: "Ayah", role: "super_admin", status: "active" },
        { phone_number: "6281299998888", name: "Budi Staf", role: "member", status: "active" },
      ]),
      upsertUser: vi.fn().mockResolvedValue({}),
      setUserStatus: vi.fn().mockImplementation(async (target: string, status: string) => ({
        affectedUsers: [{ phone_number: "628123456789", name: target }],
      })),
      setUserRole: vi.fn().mockResolvedValue({ phone_number: "628123456789", name: "Budi", role: "super_admin" }),
    };

    mockTrxRepo = {
      getRecentTransactions: vi.fn().mockResolvedValue([]),
      getAllRecentTransactions: vi.fn().mockResolvedValue([]),
      generateTransactionId: vi.fn().mockReturnValue("T026-H054"),
      updateGSheetRow: vi.fn().mockResolvedValue(undefined),
      createTransaction: vi.fn().mockImplementation(async (trx: any) => ({ ...trx, id: trx.id || "T026-H054" })),
      getWalletBalance: vi.fn().mockResolvedValue({ balance: 5000000, totalIncome: 10000000, totalExpense: 5000000 }),
      getMultiPocketBalances: vi.fn().mockResolvedValue({
        totalBalance: 5500000,
        totalIncome: 7000000,
        totalExpense: 1500000,
        pockets: {
          Cash: { balance: 1000000, income: 1000000, expense: 0 },
          Mandiri: { balance: 3000000, income: 3000000, expense: 0 },
          BCA: { balance: 1000000, income: 1000000, expense: 0 },
          ShopeePay: { balance: 500000, income: 500000, expense: 0 },
        },
      }),
      searchTransactions: vi.fn().mockImplementation(async (filters: any) => {
        if (filters.keyword?.toLowerCase() === "bensin") {
          return [
            {
              id: "T026-H054",
              merchant: "Pertamina Bensin",
              category: "Transportasi & Bensin",
              total_amount: 50000,
              date: "2026-08-21",
              user_name: "Ayah",
              payment_method: "Cash",
              status: "expense",
            },
          ];
        }
        return [];
      }),
      getTransactionWithItems: vi.fn().mockImplementation(async (id: string) => {
        if (id === "H054" || id === "T026-H054") {
          return {
            trx: {
              id: "T026-H054",
              user_phone: "6281346367235",
              user_name: "Ayah",
              merchant: "Indomaret",
              category: "Makanan & Minuman",
              total_amount: 45000,
              date: "2026-08-21",
              payment_method: "Cash",
              status: "expense",
            },
            items: [],
          };
        }
        if (id === "H001") {
          return {
            trx: {
              id: "T026-H001",
              user_phone: "6281299998888", // belongs to Budi Staf
              user_name: "Budi Staf",
              merchant: "Alfamart",
              category: "Belanja Bulanan",
              total_amount: 25000,
              date: "2026-08-20",
              payment_method: "Cash",
              status: "expense",
            },
            items: [],
          };
        }
        return null;
      }),
      getLatestTransaction: vi.fn().mockImplementation(async (userPhone?: string) => {
        if (userPhone === "6281299998888") {
          return {
            id: "T026-H001",
            user_phone: "6281299998888",
            user_name: "Budi Staf",
            merchant: "Alfamart",
            total_amount: 25000,
            date: "2026-08-21",
          };
        }
        return {
          id: "T026-H054",
          user_phone: "6281346367235",
          user_name: "Ayah",
          merchant: "Indomaret",
          total_amount: 45000,
          date: "2026-08-21",
        };
      }),
      deleteTransaction: vi.fn().mockImplementation(async (id: string) => ({
        id,
        user_name: "Ayah",
        merchant: "Indomaret",
        total_amount: 45000,
        date: "2026-08-21",
      })),
      updateTransaction: vi.fn().mockImplementation(async (id: string, updates: any) => ({
        id,
        user_name: "Ayah",
        merchant: updates.merchant || "Indomaret",
        category: updates.category || "Makanan & Minuman",
        total_amount: updates.total_amount || 45000,
        date: updates.date || "2026-08-21",
        payment_method: updates.payment_method || "Cash",
        ...updates,
      })),
      getMonthlySummary: vi.fn().mockResolvedValue({
        total: 1000000,
        totalExpense: 1000000,
        totalIncome: 2000000,
        netCashflow: 1000000,
        count: 5,
        byCategory: { "Makanan & Minuman": 600000, "Transportasi & Bensin": 400000 },
        byUser: { Ayah: 1000000 },
        topTransactions: [
          { id: "T026-H054", merchant: "Toko Berkah", total_amount: 300000, date: "2026-08-20" },
        ],
      }),
      getDailyTransactionsSummary: vi.fn().mockResolvedValue({
        date: "2026-08-21",
        count: 1,
        totalIncome: 500000,
        totalExpense: 100000,
        netCashflow: 400000,
        transactions: [
          { id: "T026-H054", merchant: "Bensin Pertamina", total_amount: 100000, payment_method: "Cash" },
        ],
      }),
      getTransactionsByDateRange: vi.fn().mockResolvedValue([]),
    };

    mockBudgetRepo = {
      getBudgetsForMonth: vi.fn().mockResolvedValue([]),
      upsertBudget: vi.fn().mockResolvedValue({}),
      deleteBudget: vi.fn().mockResolvedValue(true),
    };

    mockBillRepo = {
      listActiveBills: vi.fn().mockResolvedValue([]),
      getBillByName: vi.fn().mockResolvedValue({
        bill_name: "Listrik Toko",
        amount: 750000,
        due_day: 20,
        category: "Tagihan & Utilitas",
      }),
      createBill: vi.fn().mockImplementation(async (b: any) => b),
      markBillPaid: vi.fn().mockResolvedValue(true),
      deleteBill: vi.fn().mockResolvedValue(true),
    };
  });

  // ==========================================
  // GAP 1: /cari and /search
  // ==========================================
  describe("Gap 1: /cari & /search keyword lookup", () => {
    it("should return search results for keyword 'bensin'", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/cari bensin");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("HASIL PENCARIAN");
      expect(res.responseMessage).toContain("Pertamina Bensin");
      expect(res.responseMessage).toContain("• H054");
    });

    it("should support alias /search and /find", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res1 = await handler.handleCommand("6281346367235", "/search bensin");
      const res2 = await handler.handleCommand("6281346367235", "/find bensin");
      expect(res1.handled).toBe(true);
      expect(res2.handled).toBe(true);
    });

    it("should handle empty keyword with friendly guidance", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/cari");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Gunakan: `/cari <kata kunci>`");
    });
  });

  // ==========================================
  // GAP 2: Unknown command safety
  // ==========================================
  describe("Gap 2: Unknown command safety guard", () => {
    it("should respond with unknown command message for unregistered slash commands", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/batalan");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Perintah tidak dikenal");
    });

    it("should respond with unknown command for /xyz123", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/xyz123");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Perintah tidak dikenal");
    });
  });

  // ==========================================
  // GAP 3 & 29: /detail scoping & shortcode example
  // ==========================================
  describe("Gap 3 & 29: /detail permission scoping & short ID example", () => {
    it("should allow Super Admin to view any transaction detail", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/detail H001");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("DETAIL PENGELUARAN");
      expect(res.responseMessage).toContain("Alfamart");
    });

    it("should allow Member to view their own transaction detail", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281299998888", "/detail H001");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("DETAIL PENGELUARAN");
    });

    it("should block Member from viewing other member's transaction detail", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281299998888", "/detail H054");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Anda hanya dapat melihat rincian nota transaksi yang Anda input sendiri");
    });

    it("should display short ID format in error template for empty /detail", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/detail");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("/detail H054");
    });
  });

  // ==========================================
  // GAP 4: Scoped /batal
  // ==========================================
  describe("Gap 4: Scoped /batal by user phone", () => {
    it("should delete latest transaction of the specific member when called by member", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281299998888", "/batal");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.getLatestTransaction).toHaveBeenCalledWith("6281299998888");
      expect(res.responseMessage).toContain("TRANSAKSI BERHASIL DIHAPUS");
    });

    it("should delete latest global transaction when called by Super Admin", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/batal");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.getLatestTransaction).toHaveBeenCalledWith();
    });
  });

  // ==========================================
  // GAP 5, 6, 40: /pemasukan flexible nominal & canonical e-wallets
  // ==========================================
  describe("Gap 5, 6, 40: /pemasukan e-wallet recognition & flexible positioning", () => {
    it("should parse standard /pemasukan 5jt Gaji Bulanan Mandiri", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pemasukan 5jt Gaji Bulanan Mandiri");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          total_amount: 5000000,
          payment_method: "Mandiri",
          status: "income",
        })
      );
    });

    it("should parse flexible nominal in middle: /pemasukan Gaji Bulanan 5jt Mandiri", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pemasukan Gaji Bulanan 5jt Mandiri");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          total_amount: 5000000,
          payment_method: "Mandiri",
        })
      );
    });

    it("should recognize slang e-wallet 'spay' as 'ShopeePay'", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pemasukan 500rb Penjualan Kopi spay");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          total_amount: 500000,
          payment_method: "ShopeePay",
        })
      );
    });

    it("should recognize 'livin mandiri' as 'Mandiri'", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/pemasukan 1.5jt Transfer Proyek livin mandiri");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          total_amount: 1500000,
          payment_method: "Mandiri",
        })
      );
    });
  });

  // ==========================================
  // GAP 7 & 43: Deterministic /edit regex
  // ==========================================
  describe("Gap 7 & 43: Deterministic /edit parser for diskon, pajak, toko, and catatan", () => {
    it("should extract discount deterministically", () => {
      const edit = extractDeterministicEdits("diskon: 15rb");
      expect(edit.discount).toBe(15000);
    });

    it("should extract tax deterministically", () => {
      const edit = extractDeterministicEdits("pajak: 10000");
      expect(edit.tax).toBe(10000);
    });

    it("should extract toko and catatan deterministically", () => {
      const edit = extractDeterministicEdits("toko: Toko Berkah, catatan: nota basah");
      expect(edit.merchant).toBe("Toko Berkah");
      expect(edit.raw_text).toBe("nota basah");
    });

    it("should extract canonical payment method in edit", () => {
      const edit = extractDeterministicEdits("metode: spay");
      expect(edit.payment_method).toBe("ShopeePay");
    });
  });

  // ==========================================
  // GAP 8, 9, 41, 42: /transfer refactor & validation
  // ==========================================
  describe("Gap 8, 9, 41, 42: /transfer syntax flexibility & pocket validation", () => {
    it("should support /transfer dari bca ke cash 1.5jt Tarik ATM", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/transfer dari bca ke cash 1.5jt Tarik ATM");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("MUTASI KAS BERHASIL DICATAT");
      expect(res.responseMessage).toContain("BCA");
      expect(res.responseMessage).toContain("Cash");
    });

    it("should support nominal first: /transfer 500rb mandiri cash Pindah buku", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/transfer 500rb mandiri cash Pindah buku");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("MUTASI KAS BERHASIL DICATAT");
    });

    it("should REJECT same pocket transfer: /transfer tunai cash 500rb", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/transfer tunai cash 500rb");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Kantong asal dan tujuan tidak boleh sama");
    });

    it("should REJECT same pocket transfer for alias: /transfer spay shopeepay 100rb", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/transfer spay shopeepay 100rb");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Kantong asal dan tujuan tidak boleh sama");
    });
  });

  // ==========================================
  // GAP 10 & 11: Indonesian month names
  // ==========================================
  describe("Gap 10 & 11: parseIndonesianMonth", () => {
    it("should parse month names like 'agustus'", () => {
      const m = parseIndonesianMonth("agustus");
      expect(m).toMatch(/^\d{4}-08$/);
    });

    it("should parse 'juli'", () => {
      const m = parseIndonesianMonth("juli");
      expect(m).toMatch(/^\d{4}-07$/);
    });

    it("should parse single digit month '8'", () => {
      const m = parseIndonesianMonth("8");
      expect(m).toMatch(/^\d{4}-08$/);
    });

    it("should parse 'bulan lalu'", () => {
      const m = parseIndonesianMonth("bulan lalu");
      expect(m).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  // ==========================================
  // GAP 12: /riwayat limit parsing
  // ==========================================
  describe("Gap 12: /riwayat limit parsing flexibility", () => {
    it("should parse limit in /riwayat keluar 5", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/riwayat keluar 5");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.getAllRecentTransactions).toHaveBeenCalledWith(50);
    });

    it("should parse limit in /riwayat 5 keluar", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/riwayat 5 keluar");
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.getAllRecentTransactions).toHaveBeenCalledWith(50);
    });
  });

  // ==========================================
  // GAP 13 & 34: Aliases (/start, /info, /tim)
  // ==========================================
  describe("Gap 13 & 34: Aliases for menu and user list", () => {
    it("should handle /start and /info as menu", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res1 = await handler.handleCommand("6281346367235", "/start");
      const res2 = await handler.handleCommand("6281346367235", "/info");
      expect(res1.handled).toBe(true);
      expect(res1.responseMessage).toContain("PANDUAN PENGGUNAAN");
      expect(res2.handled).toBe(true);
      expect(res2.responseMessage).toContain("PANDUAN PENGGUNAAN");
    });

    it("should handle /tim and /listuser as /pengguna", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res1 = await handler.handleCommand("6281346367235", "/tim");
      const res2 = await handler.handleCommand("6281346367235", "/listuser");
      expect(res1.handled).toBe(true);
      expect(res1.responseMessage).toContain("DAFTAR PENGGUNA TERDAFTAR");
      expect(res2.handled).toBe(true);
      expect(res2.responseMessage).toContain("DAFTAR PENGGUNA TERDAFTAR");
    });
  });

  // ==========================================
  // GAP 14 & 38: Bill reminder format & overdue
  // ==========================================
  describe("Gap 14 & 38: formatBillReminder urgency", () => {
    const bill = { bill_name: "Listrik Toko", amount: 750000, due_day: 20 };

    it("should format future due reminder (daysLeft = 3)", () => {
      const text = formatBillReminder(bill, 3);
      expect(text).toContain("Jatuh tempo dalam 3 hari lagi!");
    });

    it("should format due today reminder (daysLeft = 0)", () => {
      const text = formatBillReminder(bill, 0);
      expect(text).toContain("HARI INI JATUH TEMPO!");
    });

    it("should format overdue reminder properly (daysLeft = -2)", () => {
      const text = formatBillReminder(bill, -2);
      expect(text).toContain("SUDAH MELEWATI JATUH TEMPO (2 HARI LALU)!");
    });
  });

  // ==========================================
  // GAP 19: /saldo pocket alias
  // ==========================================
  describe("Gap 19: /saldo pocket alias", () => {
    it("should match /saldo spay to ShopeePay", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/saldo spay");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("ShopeePay");
    });

    it("should match /saldo livin to Mandiri", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/saldo livin");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("Mandiri");
    });
  });

  // ==========================================
  // GAP 20, 22, 39: Phone normalization
  // ==========================================
  describe("Gap 20, 22, 39: normalizePhoneNumber", () => {
    it("should normalize 081346367235 to 6281346367235", () => {
      expect(normalizePhoneNumber("081346367235")).toBe("6281346367235");
    });

    it("should normalize +62 813-4636-7235 to 6281346367235", () => {
      expect(normalizePhoneNumber("+62 813-4636-7235")).toBe("6281346367235");
    });

    it("should normalize 81346367235 to 6281346367235", () => {
      expect(normalizePhoneNumber("81346367235")).toBe("6281346367235");
    });

    it("should resolve WhatsApp LID identifier", () => {
      expect(normalizePhoneNumber("232130131046571")).toBe("6281346367235");
    });
  });

  // ==========================================
  // GAP 31: /aktifkan & /unblock
  // ==========================================
  describe("Gap 31: /aktifkan & /unblock", () => {
    it("should unblock user with /aktifkan", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/aktifkan 08123456789");
      expect(res.handled).toBe(true);
      expect(mockUserRepo.setUserStatus).toHaveBeenCalledWith("08123456789", "active");
      expect(res.responseMessage).toContain("PEMBUKAAN BLOKIR BERHASIL");
    });

    it("should unblock user with /unblock", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/unblock budi");
      expect(res.handled).toBe(true);
      expect(mockUserRepo.setUserStatus).toHaveBeenCalledWith("budi", "active");
    });
  });

  // ==========================================
  // GAP 35: /saldo bulan lalu redirect
  // ==========================================
  describe("Gap 35: /saldo bulan lalu redirect to /laporan", () => {
    it("should redirect /saldo bulan lalu to /laporan", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/saldo bulan lalu");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("/laporan");
      expect(res.responseMessage).toContain("real-time");
    });

    it("should redirect /saldo juli to /laporan", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand("6281346367235", "/saldo juli");
      expect(res.handled).toBe(true);
      expect(res.responseMessage).toContain("/laporan");
    });
  });

  // ==========================================
  // POV 1: BLOCKED USER PERSPECTIVE
  // ==========================================
  describe("POV: Blocked User Perspective", () => {
    it("should reject any message or command from blocked users", async () => {
      const blockedUserRepo: any = {
        getOrCreateUser: vi.fn().mockResolvedValue({
          phone_number: "628999999999",
          name: "Blocked User",
          role: "member",
          status: "blocked",
        }),
      };
      const mockSock: any = {
        readMessages: vi.fn().mockResolvedValue(undefined),
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue({}),
      };
      const mockChatRepo: any = {
        logMessage: vi.fn().mockResolvedValue({}),
      };

      const { MessageHandler } = await import("../../src/bot/handlers/message.handler.js");
      const msgHandler = new MessageHandler(blockedUserRepo, mockTrxRepo, mockChatRepo);

      const incomingMsg: any = {
        key: { remoteJid: "628999999999@s.whatsapp.net", fromMe: false, id: "MSG_BLOCK_1" },
        message: { conversation: "Beli bensin 50rb" },
        pushName: "Blocked User",
      };

      await msgHandler.processIncomingMessage(mockSock, incomingMsg);

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        "628999999999@s.whatsapp.net",
        expect.objectContaining({
          text: expect.stringContaining("Akses nomor Anda telah dinonaktifkan"),
        }),
        expect.anything()
      );
      expect(mockTrxRepo.createTransaction).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // POV 2: WHATSAPP GROUP EXCLUSION (COMPLETE REMOVAL)
  // ==========================================
  describe("POV: WhatsApp Group Exclusion (Group Feature Removed)", () => {
    it("should silently ignore and drop any message from a WhatsApp group", async () => {
      const mockSock: any = {
        readMessages: vi.fn().mockResolvedValue(undefined),
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue({}),
      };
      const mockChatRepo: any = { logMessage: vi.fn().mockResolvedValue({}) };

      const { MessageHandler } = await import("../../src/bot/handlers/message.handler.js");
      const msgHandler = new MessageHandler(mockUserRepo, mockTrxRepo, mockChatRepo);

      const groupChatter: any = {
        key: { remoteJid: "1234567890-group@g.us", participant: "6281346367235@s.whatsapp.net", fromMe: false, id: "GRP_CHAT_1" },
        message: { conversation: "Besok meeting jam berapa ya teman-teman?" },
        pushName: "Ayah",
      };

      await msgHandler.processIncomingMessage(mockSock, groupChatter);
      expect(mockSock.sendMessage).not.toHaveBeenCalled();
      expect(mockChatRepo.logMessage).not.toHaveBeenCalled();
    });

    it("should strictly drop group commands without processing or responding in groups", async () => {
      const mockSock: any = {
        readMessages: vi.fn().mockResolvedValue(undefined),
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue({}),
      };
      const mockChatRepo: any = { logMessage: vi.fn().mockResolvedValue({}) };

      const { MessageHandler } = await import("../../src/bot/handlers/message.handler.js");
      const msgHandler = new MessageHandler(mockUserRepo, mockTrxRepo, mockChatRepo);

      const groupCommand: any = {
        key: { remoteJid: "1234567890-group@g.us", participant: "6281346367235@s.whatsapp.net", fromMe: false, id: "GRP_CMD_1" },
        message: { conversation: "/menu" },
        pushName: "Ayah",
      };

      await msgHandler.processIncomingMessage(mockSock, groupCommand);
      expect(mockSock.sendMessage).not.toHaveBeenCalled();
      expect(mockTrxRepo.createTransaction).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // POV 3: REVENUE & MULTI-POCKET WALLET INTEGRITY
  // ==========================================
  describe("POV: Multi-Pocket Accounting Integrity", () => {
    it("should calculate correct pocket balances and total across Cash, Mandiri, BCA, and ShopeePay", async () => {
      const { formatMultiPocketBalance } = await import("../../src/bot/formatters/reply.formatter.js");

      const wallet = {
        totalBalance: 5500000,
        totalIncome: 7000000,
        totalExpense: 1500000,
        pockets: {
          Cash: { balance: 1000000, income: 1500000, expense: 500000 },
          Mandiri: { balance: 3000000, income: 3500000, expense: 500000 },
          BCA: { balance: 1000000, income: 1500000, expense: 500000 },
          ShopeePay: { balance: 500000, income: 500000, expense: 0 },
        },
      };

      const formatted = formatMultiPocketBalance(wallet);
      expect(formatted).toContain("RINCIAN SALDO PER KAS & BANK");
      expect(formatted).toContain("Cash:");
      expect(formatted).toContain("Mandiri:");
      expect(formatted).toContain("BCA:");
      expect(formatted).toContain("ShopeePay:");
      expect(formatted).toContain("TOTAL SELURUH KAS:");
      expect(formatted).toContain("5.500.000");
    });
  });

  // ==========================================
  // NATURAL TRANSACTION VS QUERY SEARCH
  // ==========================================
  describe("Natural Transaction vs Query Search", () => {
    it("should NOT intercept transaction with nominal as query search", async () => {
      const { executeNaturalQuerySearch } = await import("../../src/ai/parsers/search.parser.js");
      const res = await executeNaturalQuerySearch(
        "Belanja Kasir 274000 Kafe Mammi tanggal 21 Agustus Cash",
        mockTrxRepo,
        true,
        "62811422404"
      );
      expect(res.isQuery).toBe(false);
    });

    it("should extract date and clean merchant in /pemasukan", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand(
        "62811422404",
        "/Pemasukan 1351000 Kafe Mammi tanggal 21 Agustus Mandiri"
      );
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          merchant: "Kafe Mammi",
          date: "2026-08-21",
          total_amount: 1351000,
          payment_method: "Mandiri",
          status: "income",
        })
      );
    });

    it("should support /pengeluaran with date and pocket", async () => {
      const handler = new CommandHandler(mockUserRepo, mockTrxRepo);
      const res = await handler.handleCommand(
        "62811422404",
        "/pengeluaran 274000 Belanja Kasir Kafe Mammi tanggal 21 Agustus Cash"
      );
      expect(res.handled).toBe(true);
      expect(mockTrxRepo.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          merchant: "Belanja Kasir Kafe Mammi",
          date: "2026-08-21",
          total_amount: 274000,
          payment_method: "Cash",
          status: "expense",
        })
      );
    });

    it("should return helpful how-to guide when user asks how to input expenses", async () => {
      const { executeNaturalQuerySearch } = await import("../../src/ai/parsers/search.parser.js");
      const res = await executeNaturalQuerySearch(
        "Bagaimana caranya menginput data pengeluaran",
        mockTrxRepo,
        true,
        "62811422404"
      );
      expect(res.isQuery).toBe(true);
      expect(res.replyText).toContain("CARA MENCATAT PENGELUARAN BELANJA");
      expect(res.replyText).toContain("Beli bensin 50rb");
    });

    it("should return helpful how-to guide when user asks how to input income", async () => {
      const { executeNaturalQuerySearch } = await import("../../src/ai/parsers/search.parser.js");
      const res = await executeNaturalQuerySearch(
        "Gimana cara catat pemasukan?",
        mockTrxRepo,
        true,
        "62811422404"
      );
      expect(res.isQuery).toBe(true);
      expect(res.replyText).toContain("CARA MENCATAT PEMASUKAN UANG");
      expect(res.replyText).toContain("/pemasukan");
    });
  });
});
