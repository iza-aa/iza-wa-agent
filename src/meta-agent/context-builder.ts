import { SupabaseClient } from "@supabase/supabase-js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { logger } from "../utils/logger.js";

export class ContextBuilder {
  constructor(
    private supabase: SupabaseClient,
    private trxRepo: TransactionRepository,
    private chatRepo: ChatRepository,
    private userRepo: UserRepository
  ) {}

  /**
   * Performs an instant real-time audit between transactions and receipt items
   */
  private async getAuditData(): Promise<{
    totalTrxExpense: number;
    totalItemsExpense: number;
    difference: number;
    unitemized: Array<{ id: string; merchant: string; date: string; amount: number; category: string }>;
    mismatched: Array<{ id: string; merchant: string; date: string; trxAmount: number; itemsTotal: number; diff: number }>;
  }> {
    try {
      const { data: trxs } = await this.supabase
        .from("transactions")
        .select("id, merchant, total_amount, date, category")
        .order("date", { ascending: false });

      const { data: items } = await this.supabase
        .from("receipt_items")
        .select("transaction_id, total_price");

      const itemSums: Record<string, number> = {};
      for (const it of items || []) {
        if (it.transaction_id) {
          itemSums[it.transaction_id] = (itemSums[it.transaction_id] || 0) + Number(it.total_price);
        }
      }

      let totalTrxExpense = 0;
      let totalItemsExpense = 0;
      const unitemized: any[] = [];
      const mismatched: any[] = [];

      for (const t of trxs || []) {
        const isInc = t.category?.startsWith("Pemasukan");
        if (!isInc) {
          const trxAmount = Number(t.total_amount) || 0;
          totalTrxExpense += trxAmount;
          const itemsTotal = itemSums[t.id] || 0;
          totalItemsExpense += itemsTotal;

          if (!itemSums[t.id] || itemsTotal === 0) {
            unitemized.push({
              id: t.id,
              merchant: t.merchant,
              date: t.date,
              amount: trxAmount,
              category: t.category,
            });
          } else if (Math.abs(itemsTotal - trxAmount) > 1) {
            mismatched.push({
              id: t.id,
              merchant: t.merchant,
              date: t.date,
              trxAmount,
              itemsTotal,
              diff: trxAmount - itemsTotal,
            });
          }
        }
      }

      return {
        totalTrxExpense,
        totalItemsExpense,
        difference: totalTrxExpense - totalItemsExpense,
        unitemized,
        mismatched,
      };
    } catch (err) {
      logger.error({ err }, "Failed to compute audit data");
      return {
        totalTrxExpense: 0,
        totalItemsExpense: 0,
        difference: 0,
        unitemized: [],
        mismatched: [],
      };
    }
  }

  /**
   * Fetches live database records & history to construct the context for AI reasoning
   */
  async buildContext(userPhone: string, userName: string, currentMessage: string): Promise<string> {
    try {
      const isSuperAdmin = await this.userRepo.isSuperAdminAsync(userPhone);

      // 1. Fetch live multi-pocket balances
      let totalBalance = 0;
      const pocketBalances: Record<string, number> = {};
      try {
        const multiWallet = await this.trxRepo.getMultiPocketBalances();
        totalBalance = multiWallet.totalBalance || 0;
        const pockets = multiWallet.pockets || {};
        for (const [pocketName, data] of Object.entries(pockets)) {
          pocketBalances[pocketName] = (data as any).balance || 0;
        }
      } catch (balErr) {
        logger.warn({ balErr }, "Failed to fetch live balance for context");
      }

      // 2. Fetch real-time Audit Data (Transactions vs Receipt Items)
      const audit = await this.getAuditData();

      // 3. Fetch recent chat history (last 5 messages)
      const chatLogs = await this.chatRepo.getRecentChatHistory(userPhone, 5);
      const recentChatStrings = chatLogs.map(
        (log) => `${log.direction === "inbound" ? "User" : "Asisten AI"}: ${log.content || ""}`
      );

      // 4. Inspect if a specific transaction ID was mentioned (e.g. H120, H123, T026-H120)
      const idMatch = currentMessage.match(/T0\d{2}-[A-L]\d{3}|[A-L]\d{3}|\b\d{3}\b/i);
      let targetedTrxDetail = "";
      if (idMatch) {
        try {
          const rawMatch = idMatch[0].toUpperCase();
          const target = await this.trxRepo.getTransactionWithItems(rawMatch);
          if (target && target.trx) {
            const targetTrx = target.trx;
            const targetItems = target.items || [];
            targetedTrxDetail = `\n--- DETAIL TRANSAKSI YANG DITANYAKAN (${targetTrx.id}) ---\n` +
              `• Merchant: ${targetTrx.merchant} | Tanggal: ${targetTrx.date} | Total: ${formatRupiah(targetTrx.total_amount)} | Metode: ${targetTrx.payment_method} | Kategori: ${targetTrx.category}\n` +
              `• Rincian Item (${targetItems.length} item):\n` +
              (targetItems.length > 0
                ? targetItems.map((it: any) => `  - ${it.item_name} (${it.qty} ${it.unit || "unit"}) = ${formatRupiah(it.total_price)} [${it.department || "Kafe"}]`).join("\n")
                : "  (Belum ada rincian item barang)");
          }
        } catch (findErr) {
          logger.debug({ findErr }, "Targeted transaction lookup note");
        }
      }

      // 5. Fetch sample recent transactions
      let sampleTrxList: any[] = [];
      try {
        const cleanWords = currentMessage
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !["beli", "buat", "tadi", "tolong", "mau", "saya", "uang", "audit", "cek", "selisih"].includes(w));

        const searchKeyword = cleanWords.length > 0 ? cleanWords[0] : "";
        if (searchKeyword) {
          sampleTrxList = await this.trxRepo.searchTransactions({
            keyword: searchKeyword,
            limit: 5,
          });
        }

        if (sampleTrxList.length < 5) {
          const recentTrx = await this.trxRepo.getAllRecentTransactions(8);
          const existingIds = new Set(sampleTrxList.map((t) => t.id));
          for (const r of recentTrx) {
            if (!existingIds.has(r.id)) {
              sampleTrxList.push(r);
            }
          }
        }
      } catch (trxErr) {
        logger.warn({ trxErr }, "Failed to fetch sample historical transactions");
      }

      const trxExamples = sampleTrxList.slice(0, 8).map((t) => {
        const typeSign = t.category?.startsWith("Pemasukan") ? "+" : "-";
        return `• [ID: ${t.id}] Toko/Sumber: "${t.merchant}" | Nominal: ${typeSign}${formatRupiah(t.total_amount)} | Kategori: "${t.category}" | Metode: "${t.payment_method || "Cash"}" | Teks Asli: "${t.raw_text || "-"}"`;
      });

      // 6. Format everything into a clean prompt context block
      let balanceSummary = `Total Saldo Kas: ${formatRupiah(totalBalance)}\n`;
      if (Object.keys(pocketBalances).length > 0) {
        balanceSummary += "Rincian per Rekening/Kantong:\n";
        for (const [pocket, bal] of Object.entries(pocketBalances)) {
          balanceSummary += `  - ${pocket}: ${formatRupiah(bal)}\n`;
        }
      }

      // Format audit summary
      let auditSummary = `Total Pengeluaran di Tabset Transaksi: ${formatRupiah(audit.totalTrxExpense)}\n` +
        `Total Pengeluaran di Tabset Rincian Belanja: ${formatRupiah(audit.totalItemsExpense)}\n` +
        `Selisih: ${formatRupiah(audit.difference)}\n\n`;

      if (audit.unitemized.length > 0) {
        auditSummary += `👉 Transaksi Pengeluaran yang BELUM DIRINCI (${audit.unitemized.length} transaksi):\n`;
        audit.unitemized.slice(0, 10).forEach((u) => {
          auditSummary += `  • [${u.id}] ${u.date} - ${u.merchant}: ${formatRupiah(u.amount)} (Kategori: ${u.category})\n`;
        });
      } else {
        auditSummary += `👉 Tidak ada transaksi pengeluaran yang belum dirinci.\n`;
      }

      if (audit.mismatched.length > 0) {
        auditSummary += `\n👉 Transaksi dengan TOTAL RINCIAN BERBEDA dari Total Transaksi (${audit.mismatched.length} transaksi):\n`;
        audit.mismatched.slice(0, 10).forEach((m) => {
          auditSummary += `  • [${m.id}] ${m.date} - ${m.merchant}: Total Trx ${formatRupiah(m.trxAmount)} vs Total Rincian ${formatRupiah(m.itemsTotal)} (Selisih: ${formatRupiah(m.diff)})\n`;
        });
      }

      const contextText = `
--- DATA USER & HAK AKSES ---
- Nama Pengguna: ${userName}
- Nomor WhatsApp: ${userPhone}
- Hak Akses: ${isSuperAdmin ? "SUPER ADMIN / OWNER" : "ANGGOTA OPERASIONAL"}

--- SALDO KAS REAL-TIME (SUMBER DATA SUPABASE) ---
${balanceSummary.trim()}

--- DATA AUDIT & REKONSILIASI REAL-TIME (SUPABASE & SPREADSHEET) ---
${auditSummary.trim()}
${targetedTrxDetail}

--- CONTOH TRANSAKSI NYATA TERBARU (SOURCE OF TRUTH) ---
${trxExamples.length > 0 ? trxExamples.join("\n") : "(Belum ada transaksi historis)"}

--- RIWAYAT PERCAKAPAN TERAKHIR DENGAN USER INI ---
${recentChatStrings.length > 0 ? recentChatStrings.join("\n") : "(Belum ada riwayat percakapan baru)"}
`.trim();

      return contextText;
    } catch (err) {
      logger.error({ err, userPhone }, "Exception constructing AI context");
      return `User: ${userName} (${userPhone})\nSaldo Kas: Rp 0`;
    }
  }
}
