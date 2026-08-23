import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtractedItemSchema } from "../../../src/ai/schemas/transaction.schema.js";
import { formatBreakdownSuccess, formatTransactionDetail } from "../../../src/bot/formatters/reply.formatter.js";
import { TransactionRecord, TransactionItem } from "../../../src/db/repositories/transaction.repository.js";

describe("Phase 4: Detailing Pengeluaran & Rincian Belanja", () => {
  it("should validate ExtractedItemSchema with unit, department, and notes", () => {
    const validItem = {
      item_name: "Sayur Bayam",
      qty: 6,
      unit: "ikat",
      price: 1000,
      total_price: 6000,
      department: "Dapur" as const,
      notes: "Pasar Pagi",
    };

    const parsed = ExtractedItemSchema.parse(validItem);
    expect(parsed.item_name).toBe("Sayur Bayam");
    expect(parsed.qty).toBe(6);
    expect(parsed.unit).toBe("ikat");
    expect(parsed.department).toBe("Dapur");
    expect(parsed.notes).toBe("Pasar Pagi");
  });

  it("should format transaction detail grouped by departments", () => {
    const mockTrx: TransactionRecord = {
      id: "T026-H070",
      user_phone: "6281346367235",
      user_name: "Ayah",
      date: "2026-08-01",
      merchant: "Belanja Harian Kafe",
      category: "Makanan & Minuman",
      subtotal: 1596000,
      tax: 0,
      discount: 0,
      total_amount: 1596000,
      payment_method: "Cash",
    };

    const mockItems: TransactionItem[] = [
      { item_name: "Sayur", qty: 6, unit: "Ikat", price: 1000, total_price: 6000, department: "Dapur" },
      { item_name: "Sirup", qty: 1, unit: "dos", price: 150000, total_price: 150000, department: "Barista" },
      { item_name: "Cairan pembersih", qty: 2, unit: "botol", price: 25000, total_price: 50000, department: "Waiters" },
      { item_name: "Token Listrik", qty: 1, unit: "kali", price: 500000, total_price: 500000, department: "Kafe", notes: "ID. 32145678912" },
    ];

    const formatted = formatTransactionDetail(mockTrx, mockItems);
    expect(formatted).toContain("T026-H070");
    expect(formatted).toContain("🍳 *DAPUR:*");
    expect(formatted).toContain("Sayur (6 Ikat)");
    expect(formatted).toContain("☕ *BARISTA:*");
    expect(formatted).toContain("Sirup (1 dos)");
    expect(formatted).toContain("🍽️ *WAITERS:*");
    expect(formatted).toContain("🏢 *KAFE:*");
    expect(formatted).toContain("Token Listrik (1 kali)");
    expect(formatted).toContain("[ID. 32145678912]");
  });

  it("should format breakdown success message correctly", () => {
    const mockTrx: TransactionRecord = {
      id: "T026-H070",
      user_phone: "6281346367235",
      user_name: "Ayah",
      date: "2026-08-01",
      merchant: "Belanja Harian Kafe",
      category: "Makanan & Minuman",
      subtotal: 1596000,
      tax: 0,
      discount: 0,
      total_amount: 1596000,
      payment_method: "Cash",
    };

    const mockItems: TransactionItem[] = [
      { item_name: "Ayam", qty: 1, unit: "pax", price: 150000, total_price: 150000, department: "Dapur" },
    ];

    const formatted = formatBreakdownSuccess(mockTrx, mockItems);
    expect(formatted).toContain("Rincian Belanja Berhasil Ditambahkan");
    expect(formatted).toContain("T026-H070");
    expect(formatted).toContain("🍳 *DAPUR:*");
    expect(formatted).toContain("Ayam (1 pax)");
    expect(formatted).toContain("Rincian Belanja");
  });
});
