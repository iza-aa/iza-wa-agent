import { z } from "zod";
export const ExtractedItemSchema = z.object({
    item_name: z.string().describe("Nama barang atau jasa"),
    qty: z.number().default(1).describe("Jumlah unit barang"),
    unit: z.string().nullable().optional().transform((val) => val || "unit").describe("Satuan barang (contoh: ikat, dos, botol, karton, liter, pax, kg, kali)"),
    price: z.number().describe("Harga per unit barang dalam Rupiah"),
    total_price: z.number().describe("Total harga untuk item ini (qty * price)"),
    department: z.enum(["Dapur", "Barista", "Waiters", "Kasir", "Kafe"]).nullable().optional().transform((val) => val || "Kafe").describe("Pos divisi keperluan: Dapur (makanan/masakan), Barista (minuman/kopi/sirup), Waiters (kebersihan/service), Kasir (struk/plastik), Kafe (utilitas/listrik/operasional umum)"),
    category: z.string().nullable().optional().transform((val) => val || undefined).describe("Kategori spesifik item jika relevan"),
    notes: z.string().nullable().optional().transform((val) => val || "").describe("Keterangan tambahan atau nomor meteran"),
});
export const ExtractedTransactionSchema = z.object({
    merchant: z.string().describe("Nama toko, merchant, penyedia jasa, atau penerima pembayaran"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Tanggal transaksi format YYYY-MM-DD"),
    category: z.string().default("Lain-lain").describe("Kategori utama pengeluaran / pemasukan"),
    subtotal: z.number().default(0).describe("Subtotal sebelum pajak/diskon"),
    tax: z.number().default(0).describe("Pajak / PPN / Service charge"),
    discount: z.number().default(0).describe("Diskon / Potongan harga"),
    total_amount: z.number().describe("Total akhir yang dibayarkan dalam Rupiah"),
    payment_method: z.string().default("Cash").describe("Metode pembayaran (Cash, QRIS, BCA, Mandiri, Gopay, OVO, dll.)"),
    items: z.array(ExtractedItemSchema).default([]).describe("Daftar rincian item jika ada"),
    confidence_score: z.number().min(0).max(1).default(1).describe("Tingkat keyakinan ekstraksi AI (0.0 - 1.0)"),
    notes: z.string().optional().describe("Catatan tambahan relevan dari transaksi"),
});
//# sourceMappingURL=transaction.schema.js.map