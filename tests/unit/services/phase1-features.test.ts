import { describe, it, expect, vi } from "vitest";
import { DuplicateDetectorService } from "../../../src/services/duplicate-detector.service.js";
import {
  formatMultiPocketBalance,
  formatDailyRecap,
  formatTransferSuccess,
  formatDuplicateWarning,
  formatRupiah,
} from "../../../src/bot/formatters/reply.formatter.js";

describe("Phase 1 Features Tests", () => {
  describe("DuplicateDetectorService", () => {
    it("should detect potential duplicate if repository returns match", async () => {
      const mockTrxRepo: any = {
        findRecentSimilarTransaction: vi.fn().mockResolvedValue({
          id: "T026-H001",
          merchant: "Pertamina",
          total_amount: 50000,
          date: "2026-08-21",
          user_name: "Ayah",
        }),
      };

      const detector = new DuplicateDetectorService(mockTrxRepo);
      const res = await detector.detectDuplicate(50000, "Pertamina", 10);

      expect(res).not.toBeNull();
      expect(res?.id).toBe("T026-H001");
      expect(mockTrxRepo.findRecentSimilarTransaction).toHaveBeenCalledWith(50000, "Pertamina", 10);
    });

    it("should return null if no duplicate is found", async () => {
      const mockTrxRepo: any = {
        findRecentSimilarTransaction: vi.fn().mockResolvedValue(null),
      };

      const detector = new DuplicateDetectorService(mockTrxRepo);
      const res = await detector.detectDuplicate(25000, "Warteg", 10);

      expect(res).toBeNull();
    });
  });

  describe("Formatters for Phase 1", () => {
    it("should format multi-pocket balance correctly", () => {
      const multi = {
        totalBalance: 3500000,
        totalIncome: 5000000,
        totalExpense: 1500000,
        pockets: {
          Cash: { income: 2000000, expense: 500000, balance: 1500000 },
          Mandiri: { income: 3000000, expense: 1000000, balance: 2000000 },
        },
      };

      const formatted = formatMultiPocketBalance(multi);
      expect(formatted).toContain("RINCIAN SALDO PER KAS & BANK");
      expect(formatted).toContain("Cash");
      expect(formatted).toContain("Mandiri");
      expect(formatted).toContain(formatRupiah(3500000));
    });

    it("should format single specific pocket correctly", () => {
      const multi = {
        totalBalance: 3500000,
        totalIncome: 5000000,
        totalExpense: 1500000,
        pockets: {
          Cash: { income: 2000000, expense: 500000, balance: 1500000 },
          Mandiri: { income: 3000000, expense: 1000000, balance: 2000000 },
        },
      };

      const formatted = formatMultiPocketBalance(multi, "mandiri");
      expect(formatted).toContain("STATUS SALDO: MANDIRI");
      expect(formatted).toContain(formatRupiah(2000000));
    });

    it("should format daily recap correctly", () => {
      const summary = {
        date: "2026-08-21",
        count: 2,
        totalIncome: 500000,
        totalExpense: 150000,
        netCashflow: 350000,
        transactions: [
          {
            id: "T026-H001",
            merchant: "Penjualan Toko",
            total_amount: 500000,
            date: "2026-08-21",
            payment_method: "Cash",
            user_name: "Ayah",
            category: "Pemasukan: Penjualan",
            user_phone: "62811422404",
            subtotal: 500000,
            tax: 0,
            discount: 0,
          },
          {
            id: "T026-H002",
            merchant: "Beli Galon",
            total_amount: 150000,
            date: "2026-08-21",
            payment_method: "Cash",
            user_name: "Ayah",
            category: "Operasional",
            user_phone: "62811422404",
            subtotal: 150000,
            tax: 0,
            discount: 0,
          },
        ],
      };

      const recap = formatDailyRecap(summary, { balance: 2500000 });
      expect(recap).toContain("REKAP KAS MALAM INI");
      expect(recap).toContain("Pemasukan Hari Ini");
      expect(recap).toContain(formatRupiah(500000));
      expect(recap).toContain(formatRupiah(150000));
      expect(recap).toContain("SISA SALDO KAS DOMPET");
    });

    it("should format duplicate warning message correctly", () => {
      const duplicate = {
        id: "T026-H005",
        merchant: "Pertamina",
        total_amount: 50000,
        date: "2026-08-21",
        user_name: "Budi",
        user_phone: "628123456789",
        category: "Bahan Bakar",
        subtotal: 50000,
        tax: 0,
        discount: 0,
      };

      const warning = formatDuplicateWarning(duplicate, 50000, "Pertamina");
      expect(warning).toContain("PERINGATAN TRANSAKSI KEMBAR");
      expect(warning).toContain("T026-H005");
      expect(warning).toContain(formatRupiah(50000));
      expect(warning).toContain("Pertamina");
    });

    it("should format transfer mutasi success message correctly", () => {
      const transferMsg = formatTransferSuccess("BCA", "CASH", 500000, "Tarik Tunai", 3500000);
      expect(transferMsg).toContain("MUTASI KAS BERHASIL DICATAT");
      expect(transferMsg).toContain("BCA");
      expect(transferMsg).toContain("CASH");
      expect(transferMsg).toContain(formatRupiah(500000));
    });
  });
});
