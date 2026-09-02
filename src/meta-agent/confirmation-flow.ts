import { PendingActionRepository, PendingActionRecord } from "../db/repositories/pending-action.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { BudgetRepository } from "../db/repositories/budget.repository.js";
import { BillRepository } from "../db/repositories/bill.repository.js";
import { googleSheetsService } from "../google/sheets.service.js";
import { googleDriveService } from "../google/drive.service.js";
import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import {
  TransactionDraft,
  DeleteDraft,
  EditDraft,
  TransferDraft,
  UserActionDraft,
  BudgetActionDraft,
  BillActionDraft,
} from "./agent-persona.js";
import { logger } from "../utils/logger.js";

export type ConfirmationDecision =
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "MODIFY"; modificationText: string }
  | { type: "NOT_A_DECISION" };

export class ConfirmationFlow {
  constructor(
    private pendingRepo: PendingActionRepository,
    private trxRepo: TransactionRepository,
    private userRepo: UserRepository,
    private budgetRepo?: BudgetRepository,
    private billRepo?: BillRepository
  ) {}

  /**
   * Classifies user input into confirm, cancel, or modify when a draft is awaiting confirmation
   */
  classifyUserDecision(userText: string): ConfirmationDecision {
    const clean = userText.trim().toLowerCase();

    // Confirm keywords
    const confirmKeywords = [
      "ya", "iya", "oke", "ok", "yes", "gas", "simpan", "benar", "betul", "lanjut", "setuju", "acc",
      "catat", "yup", "yoi", "sip", "mantap", "confirm", "sesuai", "bungkus", "sudah benar", "save", "hapus"
    ];

    if (confirmKeywords.includes(clean) || clean === "confirm_action" || clean.startsWith("✅")) {
      return { type: "CONFIRM" };
    }

    // Cancel keywords
    const cancelKeywords = [
      "batal", "batalkan", "cancel", "tidak", "gak", "nggak", "ga jadi", "gak jadi", "nggak jadi", "ngga jadi",
      "enggak jadi", "jangan", "cancel_action", "hapus draf", "buang"
    ];

    if (cancelKeywords.includes(clean) || clean === "cancel_action" || clean.startsWith("❌")) {
      return { type: "CANCEL" };
    }

    // Direct income / expense switch or clarification keywords
    if (
      clean === "pemasukan" ||
      clean === "1" ||
      clean === "income" ||
      clean === "masuk" ||
      clean === "uang masuk" ||
      clean === "penjualan"
    ) {
      return { type: "MODIFY", modificationText: "pemasukan" };
    }

    if (
      clean === "pengeluaran" ||
      clean === "2" ||
      clean === "expense" ||
      clean === "keluar" ||
      clean === "uang keluar" ||
      clean === "belanja"
    ) {
      return { type: "MODIFY", modificationText: "pengeluaran" };
    }

    // Check if user is asking to modify specific attributes
    if (
      clean.includes("ganti") ||
      clean.includes("ubah") ||
      clean.includes("bukan") ||
      clean.includes("tapi") ||
      clean.includes("pake") ||
      clean.includes("pakai") ||
      clean.includes("revisi") ||
      clean.includes("metode") ||
      clean.includes("nominal") ||
      clean.includes("kategori")
    ) {
      return { type: "MODIFY", modificationText: userText };
    }

    return { type: "NOT_A_DECISION" };
  }

  /**
   * Creates a new pending draft in database/memory
   */
  async createDraft(
    userPhone: string,
    userName: string,
    actionType: string,
    payload: Record<string, any>,
    mediaUrl?: string
  ): Promise<PendingActionRecord> {
    return await this.pendingRepo.createPendingAction(
      userPhone,
      userName,
      actionType,
      payload,
      mediaUrl
    );
  }

  /**
   * Gets any active pending draft for the user
   */
  async getActiveDraft(userPhone: string): Promise<PendingActionRecord | null> {
    return await this.pendingRepo.getPendingByUser(userPhone);
  }

  /**
   * Executes confirmed draft across all action types
   */
  async executeConfirmedDraft(
    draftRecord: PendingActionRecord,
    mediaBuffer?: Buffer,
    mediaMimeType?: string
  ): Promise<{ success: boolean; replyText: string }> {
    const actionType = draftRecord.action_type;
    const userPhone = draftRecord.user_phone;
    const userName = draftRecord.user_name || "User";

    try {
      // 1. DELETE ACTION
      if (actionType === "DELETE_TRANSACTION") {
        const delDraft = draftRecord.payload as DeleteDraft;
        const targetId = delDraft.transaction_id;

        const deleted = await this.trxRepo.deleteTransaction(targetId);
        try {
          await googleSheetsService.deleteTransactionRow(targetId);
        } catch (sheetErr) {
          logger.warn({ sheetErr, targetId }, "Failed to delete row from Google Sheet");
        }

        await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
        const wallet = await this.trxRepo.getWalletBalance();

        return {
          success: true,
          replyText: `🗑️ *Transaksi Berhasil Dihapus!*\n\n• ID: \`${targetId}\`\n• Keterangan: ${delDraft.merchant || deleted?.merchant || "-"}\n• Nominal: ${formatRupiah(delDraft.total_amount || deleted?.total_amount || 0)}\n\n💵 *Saldo Kas Terkini:* *${formatRupiah(wallet.balance)}*`,
        };
      }

      // 2. EDIT ACTION
      if (actionType === "EDIT_TRANSACTION") {
        const editDraft = draftRecord.payload as EditDraft;
        const targetId = editDraft.transaction_id;
        const changes = editDraft.changes;

        const updated = await this.trxRepo.updateTransaction(targetId, changes);
        if (updated) {
          try {
            const withItems = await this.trxRepo.getTransactionWithItems(targetId);
            const items = withItems?.items || [];
            await googleSheetsService.updateTransactionRow(updated, items);
          } catch (sheetErr) {
            logger.warn({ sheetErr, targetId }, "Failed to update row in Google Sheet");
          }
        }

        await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
        const wallet = await this.trxRepo.getWalletBalance();

        return {
          success: true,
          replyText: `✏️ *Transaksi Berhasil Diperbarui!*\n\n• ID: \`${targetId}\`\n• Perubahan: ${editDraft.summary || JSON.stringify(changes)}\n\n💵 *Saldo Kas Terkini:* *${formatRupiah(wallet.balance)}*`,
        };
      }

      // 3. TRANSFER / MUTASI ANTAR REKENING ACTION
      if (actionType === "TRANSFER_BALANCE") {
        const tDraft = draftRecord.payload as TransferDraft;
        const fromPocket = tDraft.source_pocket;
        const toPocket = tDraft.target_pocket;
        const nominal = Number(tDraft.amount) || 0;
        const notes = tDraft.notes || "Mutasi Kas Antar Rekening";
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());

        const outTrxId = await this.trxRepo.generateTransactionId(today);
        await this.trxRepo.createTransaction({
          id: outTrxId,
          user_phone: userPhone,
          user_name: userName,
          date: today,
          merchant: `Mutasi Keluar -> ${toPocket}`,
          category: "Mutasi Kas: Keluar",
          subtotal: nominal,
          tax: 0,
          discount: 0,
          total_amount: nominal,
          payment_method: fromPocket,
          raw_text: notes,
          status: "expense",
        });

        const inTrxId = await this.trxRepo.generateTransactionId(today);
        await this.trxRepo.createTransaction({
          id: inTrxId,
          user_phone: userPhone,
          user_name: userName,
          date: today,
          merchant: `Mutasi Masuk <- ${fromPocket}`,
          category: "Pemasukan: Mutasi Kas",
          subtotal: nominal,
          tax: 0,
          discount: 0,
          total_amount: nominal,
          payment_method: toPocket,
          raw_text: notes,
          status: "income",
        });

        try {
          await googleSheetsService.appendTransaction({
            id: outTrxId,
            user_phone: userPhone,
            user_name: userName,
            date: today,
            merchant: `Mutasi Keluar -> ${toPocket} (${notes})`,
            category: "Mutasi Kas: Keluar",
            subtotal: nominal,
            tax: 0,
            discount: 0,
            total_amount: nominal,
            payment_method: fromPocket,
            status: "expense",
            raw_text: notes,
          });

          await googleSheetsService.appendTransaction({
            id: inTrxId,
            user_phone: userPhone,
            user_name: userName,
            date: today,
            merchant: `Mutasi Masuk <- ${fromPocket} (${notes})`,
            category: "Pemasukan: Mutasi Kas",
            subtotal: nominal,
            tax: 0,
            discount: 0,
            total_amount: nominal,
            payment_method: toPocket,
            status: "income",
            raw_text: notes,
          });
        } catch (sheetErr) {
          logger.error({ sheetErr }, "Failed to append transfer to Google Sheets");
        }

        await this.pendingRepo.confirmAction(draftRecord.id, userPhone);

        return {
          success: true,
          replyText: `🔄 *Mutasi Saldo Berhasil Dicatat!*\n\n• Dari Kantong: *${fromPocket}* (Keluar: -${formatRupiah(nominal)})\n• Ke Kantong: *${toPocket}* (Masuk: +${formatRupiah(nominal)})\n• Keterangan: ${notes}\n• ID Transaksi: \`${outTrxId}\` & \`${inTrxId}\``,
        };
      }

      // 4. USER MANAGEMENT ACTION
      if (actionType === "MANAGE_USER") {
        const uDraft = draftRecord.payload as UserActionDraft;
        const targetPhone = uDraft.target_phone.replace(/[^0-9]/g, "");

        if (uDraft.action === "ADD") {
          await this.userRepo.upsertUser({
            phone_number: targetPhone,
            name: uDraft.target_name || "Anggota Baru",
            role: uDraft.role || "member",
            status: "active",
          });
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `✅ *Anggota Berhasil Didaftarkan!*\n\n• Nama: *${uDraft.target_name}*\n• Nomor WhatsApp: +${targetPhone}\n• Hak Akses: *${uDraft.role === "super_admin" ? "Super Admin" : "Member"}*`,
          };
        } else if (uDraft.action === "BLOCK") {
          await this.userRepo.setUserStatus(targetPhone, "blocked");
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `🚫 *Pengguna Berhasil Dinonaktifkan/Diblokir!*\n\nNomor +${targetPhone} telah diblokir dari akses bot.`,
          };
        } else if (uDraft.action === "UNBLOCK") {
          await this.userRepo.setUserStatus(targetPhone, "active");
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `✅ *Pengguna Berhasil Diaktifkan Kembali!*\n\nNomor +${targetPhone} kini dapat menggunakan bot kembali.`,
          };
        } else if (uDraft.action === "CHANGE_ROLE") {
          await this.userRepo.setUserRole(targetPhone, uDraft.role || "member");
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `👑 *Peran Pengguna Berhasil Diperbarui!*\n\nNomor +${targetPhone} sekarang memiliki hak akses: *${uDraft.role === "super_admin" ? "Super Admin" : "Member"}*.`,
          };
        }
      }

      // 5. BUDGET MANAGEMENT ACTION
      if (actionType === "MANAGE_BUDGET" && this.budgetRepo) {
        const bDraft = draftRecord.payload as BudgetActionDraft;
        if (bDraft.action === "SET") {
          await this.budgetRepo.upsertBudget(bDraft.category, bDraft.month, bDraft.limit_amount);
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `🎯 *Batas Anggaran Berhasil Disimpan!*\n\n• Kategori: *${bDraft.category}*\n• Periode: *${bDraft.month}*\n• Batas Maksimal: *${formatRupiah(bDraft.limit_amount)}*\n\nSistem akan mengirim peringatan jika pengeluaran kategori ini mendekati 80% dan 100%.`,
          };
        } else if (bDraft.action === "DELETE") {
          await this.budgetRepo.deleteBudget(bDraft.category, bDraft.month);
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `🗑️ *Anggaran Dihapus!*\n\nBatas anggaran untuk kategori *${bDraft.category}* (${bDraft.month}) telah dinonaktifkan.`,
          };
        }
      }

      // 6. BILL MANAGEMENT ACTION
      if (actionType === "MANAGE_BILL" && this.billRepo) {
        const biDraft = draftRecord.payload as BillActionDraft;
        if (biDraft.action === "ADD") {
          await this.billRepo.createBill({
            bill_name: biDraft.bill_name,
            amount: biDraft.amount,
            due_day: biDraft.due_day,
          });
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `📅 *Tagihan Rutin Berhasil Didaftarkan!*\n\n• Nama Tagihan: *${biDraft.bill_name}*\n• Nominal: *${formatRupiah(biDraft.amount)}*\n• Tanggal Jatuh Tempo: *Tiap tanggal ${biDraft.due_day}*\n\nSistem otomatis mengirim pengingat sebelum jatuh tempo.`,
          };
        } else if (biDraft.action === "DELETE") {
          await this.billRepo.deleteBill(biDraft.bill_name);
          await this.pendingRepo.confirmAction(draftRecord.id, userPhone);
          return {
            success: true,
            replyText: `🗑️ *Tagihan Rutin Dihapus!*\n\nTagihan *${biDraft.bill_name}* telah dihapus dari daftar pengingat.`,
          };
        }
      }

      // 7. CREATE TRANSACTION (Default)
      const draft = draftRecord.payload as TransactionDraft;
      const trxId = await this.trxRepo.generateTransactionId(draft.date);

      let driveLink = "";
      let driveFileId = "";
      if (mediaBuffer) {
        try {
          const isPdf = mediaMimeType?.includes("pdf") || false;
          const uploadRes = await googleDriveService.uploadReceipt(
            mediaBuffer,
            `${trxId}_${draft.merchant.replace(/[^a-zA-Z0-9]/g, "_")}`,
            userName,
            isPdf
          );
          driveLink = uploadRes.webViewLink;
          driveFileId = uploadRes.fileId;
        } catch (driveErr) {
          logger.warn({ driveErr }, "Non-fatal error uploading receipt proof to Drive");
        }
      }

      const items = (draft.items || []).map((it) => ({
        item_name: it.item_name,
        qty: it.qty || 1,
        unit: it.unit || "unit",
        price: it.price || 0,
        total_price: it.total_price || (it.qty || 1) * (it.price || 0),
        department: it.department || "Kafe",
        notes: it.notes || "",
      }));

      const isInc = draft.type === "income" || draft.category?.toLowerCase().startsWith("pemasukan");
      const transactionRecord = await this.trxRepo.createTransaction(
        {
          id: trxId,
          user_phone: userPhone,
          user_name: userName,
          date: draft.date,
          merchant: draft.merchant,
          category: draft.category,
          subtotal: draft.subtotal || draft.total_amount,
          tax: draft.tax || 0,
          discount: draft.discount || 0,
          total_amount: draft.total_amount,
          payment_method: draft.payment_method || "Cash",
          raw_text: draft.raw_text || "",
          gdrive_file_id: driveFileId,
          gdrive_web_view_link: driveLink,
          confidence_score: 1.0,
        },
        items
      );

      try {
        const sheetRes = await googleSheetsService.appendTransaction(transactionRecord, items);
        await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to append confirmed transaction to Google Sheet");
      }

      await this.pendingRepo.confirmAction(draftRecord.id, userPhone);

      const isSuperAdmin = await this.userRepo.isSuperAdminAsync(userPhone);
      const wallet = await this.trxRepo.getWalletBalance();

      let reply = `🎉 *Catatan Berhasil Disimpan!*\n\n`;
      reply += `🧾 *ID:* \`${trxId}\`\n`;
      reply += (isInc ? `💵 *Sumber:* ` : `🏪 *Tempat / Toko:* `) + `*${draft.merchant}*\n`;
      reply += `💰 *Nominal:* *${isInc ? "+" : "-"}${formatRupiah(draft.total_amount)}*\n`;
      reply += `🏷️ *Kategori:* ${draft.category}\n`;
      reply += `💳 *Metode:* ${draft.payment_method}\n`;
      reply += `📅 *Tanggal:* ${draft.date}\n`;

      if (items.length > 0) {
        reply += `\n📋 *Rincian Barang:*\n`;
        items.forEach((it) => {
          const qtyText = it.unit && it.unit !== "unit" ? ` (${it.qty} ${it.unit})` : (it.qty > 1 ? ` (${it.qty}x)` : "");
          reply += ` • ${it.item_name}${qtyText} ➔ *${formatRupiah(it.total_price)}* _[${it.department}]_\n`;
        });
      }

      if (isSuperAdmin) {
        reply += `\n💵 *Sisa Saldo Kas Dompet:* *${formatRupiah(wallet.balance)}*\n`;
        if (driveLink) {
          reply += `\n🔗 *Bukti Nota:* ${driveLink}\n`;
        }
      }

      return { success: true, replyText: reply };
    } catch (err: any) {
      logger.error({ err, draftRecord }, "Failed to execute confirmed draft");
      return {
        success: false,
        replyText: `⚠️ Terjadi kendala saat memproses aksi: ${err?.message || "Kesalahan database"}. Silakan coba lagi.`,
      };
    }
  }

  /**
   * Cancels an active draft
   */
  async cancelActiveDraft(draftRecord: PendingActionRecord): Promise<string> {
    await this.pendingRepo.cancelAction(draftRecord.id, draftRecord.user_phone);
    return `👌 *Draf dibatalkan.* Aksi tadi tidak dijalankan. Ada hal lain yang ingin saya bantu?`;
  }

  /**
   * Formats a draft preview for user confirmation
   */
  formatDraftPreview(draft: TransactionDraft): string {
    const isInc = draft.type === "income" || draft.category?.toLowerCase().startsWith("pemasukan");
    let preview = `📝 *DRAF TRANSAKSI BARU*\n`;
    preview += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    preview += `📌 *Jenis:* ${isInc ? "🟢 *Pemasukan*" : "🔴 *Pengeluaran*"}\n`;
    preview += (isInc ? `💵 *Sumber / Penerimaan:* ` : `🏪 *Tempat / Toko:* `) + `*${draft.merchant}*\n`;
    preview += `💰 *Nominal Total:* *${isInc ? "+" : "-"}${formatRupiah(draft.total_amount)}*\n`;
    preview += `🏷️ *Kategori:* ${draft.category}\n`;
    preview += `💳 *Metode Bayar:* *${draft.payment_method}*\n`;
    preview += `📅 *Tanggal:* ${draft.date}\n`;

    if (draft.items && draft.items.length > 0) {
      preview += `\n📋 *Rincian Butir Belanja:*\n`;
      draft.items.forEach((it) => {
        const qtyText = it.unit && it.unit !== "unit" ? ` (${it.qty} ${it.unit})` : (it.qty > 1 ? ` (${it.qty}x)` : "");
        preview += ` • ${it.item_name}${qtyText} ➔ *${formatRupiah(it.total_price)}* _[${it.department}]_\n`;
      });
    }

    preview += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    preview += `❓ *Apakah data di atas sudah benar untuk dicatat?*\n\n`;
    preview += `• Ketik *Ya* / *Simpan* untuk mencatat ke pembukuan.\n`;
    preview += `• Ketik *Pemasukan* / *Pengeluaran* jika ingin mengubah jenis transaksi.\n`;
    preview += `• Ketik revisi (contoh: _"ubah ke cash"_ atau _"nominal 200rb"_).\n`;
    preview += `• Ketik *Batal* untuk membatalkan draf.`;

    return preview;
  }
}
