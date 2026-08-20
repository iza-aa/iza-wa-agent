import { z } from "zod";

export const ExtractedItemSchema = z.object({
  item_name: z.string().describe("Nama barang atau jasa"),
  qty: z.number().default(1).describe("Jumlah unit barang"),
  price: z.number().describe("Harga per unit barang dalam Rupiah"),
  total_price: z.number().describe("Total harga untuk item ini (qty * price)"),
  category: z.string().optional().describe("Kategori spesifik item jika relevan"),
});

export const ExtractedTransactionSchema = z.object({
  merchant: z.string().describe("Nama toko, merchant, penyedia jasa, atau penerima pembayaran"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Tanggal transaksi format YYYY-MM-DD"),
  category: z.enum([
    "Makanan & Minuman",
    "Belanja Bulanan",
    "Transportasi & Bensin",
    "Tagihan & Utilitas",
    "Kesehatan & Obat",
    "Pendidikan",
    "Hiburan & Rekreasi",
    "Operasional Kantor",
    "Lain-lain",
  ]).default("Lain-lain").describe("Kategori utama pengeluaran"),
  subtotal: z.number().default(0).describe("Subtotal sebelum pajak/diskon"),
  tax: z.number().default(0).describe("Pajak / PPN / Service charge"),
  discount: z.number().default(0).describe("Diskon / Potongan harga"),
  total_amount: z.number().describe("Total akhir yang dibayarkan dalam Rupiah"),
  payment_method: z.string().default("Cash").describe("Metode pembayaran (Cash, QRIS, BCA, Mandiri, Gopay, OVO, dll.)"),
  items: z.array(ExtractedItemSchema).default([]).describe("Daftar rincian item jika ada"),
  confidence_score: z.number().min(0).max(1).default(1).describe("Tingkat keyakinan ekstraksi AI (0.0 - 1.0)"),
  notes: z.string().optional().describe("Catatan tambahan relevan dari transaksi"),
});

export type ExtractedTransaction = z.infer<typeof ExtractedTransactionSchema>;
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
