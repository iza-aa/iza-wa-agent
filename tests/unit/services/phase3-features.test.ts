import { describe, it, expect, vi, beforeEach } from "vitest";
import { BudgetRepository } from "../../../src/db/repositories/budget.repository.js";
import { BillRepository } from "../../../src/db/repositories/bill.repository.js";
import { PdfReportService } from "../../../src/services/pdf-report.service.js";
import { SchedulerService } from "../../../src/services/scheduler.service.js";
import { CommandHandler } from "../../../src/bot/handlers/command.handler.js";
import { googleSheetsService } from "../../../src/google/sheets.service.js";
import * as socketHolder from "../../../src/bot/socket-holder.js";

describe("Phase 3 Features Tests", () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(googleSheetsService, "appendTransaction").mockResolvedValue({ rowIndex: 10, spreadsheetId: "mock" } as any);
    mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };
  });

  describe("1. PDF Report Generator Service", () => {
    it("should generate a valid PDF buffer from monthly transactions", async () => {
      const pdfService = new PdfReportService();
      const mockPdfData = {
        targetMonth: "2026-08",
        totalIncome: 15000000,
        totalExpense: 5000000,
        netCashflow: 10000000,
        count: 2,
        byCategory: {
          "Operasional Kantor": 3000000,
          "Makanan & Minuman": 2000000,
        },
        transactions: [
          {
            id: "T026-H001",
            user_phone: "6281346367235",
            user_name: "Ayah",
            date: "2026-08-10",
            merchant: "Mitra10",
            category: "Operasional Kantor",
            subtotal: 3000000,
            tax: 0,
            discount: 0,
            total_amount: 3000000,
            payment_method: "Mandiri",
            confidence_score: 1.0,
          },
          {
            id: "T026-H002",
            user_phone: "6281346367235",
            user_name: "Ayah",
            date: "2026-08-14",
            merchant: "Kafe Mammi",
            category: "Makanan & Minuman",
            subtotal: 2000000,
            tax: 0,
            discount: 0,
            total_amount: 2000000,
            payment_method: "Cash",
            confidence_score: 1.0,
          },
        ],
      };

      const buffer = await pdfService.generateMonthlyReportPdf(mockPdfData);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(500); // PDF document has size
      expect(buffer.slice(0, 4).toString()).toBe("%PDF"); // PDF header magic bytes
    });
  });

  describe("2. Budget Repository & Budget Guard", () => {
    it("should upsert budget and track percentage and alert levels", async () => {
      const budgetRepo = new BudgetRepository(mockSupabase);

      // Set budget 4 million for Operasional
      const record = await budgetRepo.upsertBudget("Operasional Kantor", "2026-08", 4000000);
      expect(record.category).toBe("Operasional Kantor");
      expect(record.limit_amount).toBe(4000000);

      // Retrieve
      const found = await budgetRepo.getBudgetByCategory("Operasional", "2026-08");
      expect(found).not.toBeNull();
      expect(found?.limit_amount).toBe(4000000);

      // Update to 5 million
      const updated = await budgetRepo.upsertBudget("Operasional Kantor", "2026-08", 5000000);
      expect(updated.limit_amount).toBe(5000000);

      const foundAfterUpdate = await budgetRepo.getBudgetByCategory("Operasional", "2026-08");
      expect(foundAfterUpdate?.limit_amount).toBe(5000000);
    });
  });

  describe("3. Recurring Bills Repository & Scheduler Reminders", () => {
    it("should register bills and send reminders on reminder window", async () => {
      const billRepo = new BillRepository(mockSupabase);

      const created = await billRepo.createBill({
        bill_name: "Listrik Toko",
        amount: 750000,
        due_day: 20,
        reminder_days_before: 3,
      });

      expect(created.bill_name).toBe("Listrik Toko");
      expect(created.due_day).toBe(20);

      const activeBills = await billRepo.listActiveBills();
      expect(activeBills.length).toBe(1);

      // Test Scheduler morning reminder check for date 2026-08-18 (H-2 before tgl 20)
      const mockTrxRepo: any = {};
      const mockUserRepo: any = {
        listActiveUsers: vi.fn().mockResolvedValue([
          { phone_number: "6281346367235", role: "super_admin", status: "active" },
        ]),
      };

      const mockSocket: any = {
        sendMessage: vi.fn().mockResolvedValue({}),
      };
      vi.spyOn(socketHolder, "getGlobalSocket").mockReturnValue(mockSocket);

      const scheduler = new SchedulerService(mockTrxRepo, mockUserRepo, billRepo);
      const res = await scheduler.sendMorningBillReminders("2026-08-18");

      expect(res.success).toBe(true);
      expect(res.reminderCount).toBe(1);
      expect(mockSocket.sendMessage).toHaveBeenCalled();
    });

    it("should mark bill paid and skip subsequent reminders for that month", async () => {
      const billRepo = new BillRepository(mockSupabase);
      await billRepo.createBill({
        bill_name: "Wifi Indihome",
        amount: 350000,
        due_day: 25,
      });

      await billRepo.markBillPaid("Wifi Indihome", "2026-08");

      const bill = await billRepo.getBillByName("Wifi");
      expect(bill?.last_paid_period).toBe("2026-08");

      const mockTrxRepo: any = {};
      const mockUserRepo: any = {
        listActiveUsers: vi.fn().mockResolvedValue([
          { phone_number: "6281346367235", role: "super_admin", status: "active" },
        ]),
      };
      const mockSocket: any = { sendMessage: vi.fn() };
      vi.spyOn(socketHolder, "getGlobalSocket").mockReturnValue(mockSocket);

      const scheduler = new SchedulerService(mockTrxRepo, mockUserRepo, billRepo);
      const res = await scheduler.sendMorningBillReminders("2026-08-23"); // H-2

      // Should be 0 since it is already paid for 2026-08
      expect(res.reminderCount).toBe(0);
    });
  });

  describe("4. Command Handler Phase 3 Commands", () => {
    it("should handle /budget commands for Super Admin", async () => {
      const mockUserRepo: any = {
        isSuperAdminAsync: vi.fn().mockResolvedValue(true),
      };
      const mockTrxRepo: any = {
        getMonthlySummary: vi.fn().mockResolvedValue({
          totalIncome: 10000000,
          totalExpense: 3000000,
          total: 3000000,
          count: 5,
          byCategory: { "Operasional Kantor": 1500000 },
        }),
      };
      const budgetRepo = new BudgetRepository(mockSupabase);
      const billRepo = new BillRepository(mockSupabase);

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo, budgetRepo, billRepo);

      // 1. Set budget
      const setRes = await handler.handleCommand("6281346367235", "/budget Operasional 4000000");
      expect(setRes.handled).toBe(true);
      expect(setRes.responseMessage).toContain("Batas Anggaran Berhasil Disetel");
      expect(setRes.responseMessage).toContain("4.000.000");

      // 2. Check budget list
      const checkRes = await handler.handleCommand("6281346367235", "/budget");
      expect(checkRes.handled).toBe(true);
      expect(checkRes.responseMessage).toContain("STATUS BATAS ANGGARAN");
      expect(checkRes.responseMessage).toContain("Operasional");
    });

    it("should handle /tagihan commands for Super Admin", async () => {
      const mockUserRepo: any = {
        isSuperAdminAsync: vi.fn().mockResolvedValue(true),
      };
      const mockTrxRepo: any = {
        generateTransactionId: vi.fn().mockResolvedValue("T026-H099"),
        createTransaction: vi.fn().mockResolvedValue({
          id: "T026-H099",
          total_amount: 750000,
        }),
      };
      const budgetRepo = new BudgetRepository(mockSupabase);
      const billRepo = new BillRepository(mockSupabase);

      const handler = new CommandHandler(mockUserRepo, mockTrxRepo, budgetRepo, billRepo);

      // 1. Add bill
      const addRes = await handler.handleCommand("6281346367235", "/tagihan tambah Listrik Toko 750000 tgl 20");
      expect(addRes.handled).toBe(true);
      expect(addRes.responseMessage).toContain("Tagihan Rutin Berhasil Didaftarkan");
      expect(addRes.responseMessage).toContain("Listrik Toko");

      // 2. List bills
      const listRes = await handler.handleCommand("6281346367235", "/tagihan");
      expect(listRes.handled).toBe(true);
      expect(listRes.responseMessage).toContain("DAFTAR TAGIHAN RUTIN");
      expect(listRes.responseMessage).toContain("Listrik Toko");

      // 3. Mark paid
      const payRes = await handler.handleCommand("6281346367235", "/tagihan bayar Listrik Toko");
      expect(payRes.handled).toBe(true);
      expect(payRes.responseMessage).toContain("Telah Ditandai LUNAS");
    });
  });
});
