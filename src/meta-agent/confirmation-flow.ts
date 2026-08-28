import { PendingActionRepository, PendingActionRecord } from "../db/repositories/pending-action.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { googleSheetsService } from "../google/sheets.service.js";
import { googleDriveService } from "../google/drive.service.js";
import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { TransactionDraft, DeleteDraft, EditDraft } from "./agent-persona.js";
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
    private userRepo: UserRepository
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
      "enggak jadi", "jangan", "salah", "bukan", "no", "cancel_action", "hapus draf", "buang"
    ];

    if (cancelKeywords.includes(clean) || clean === "cancel_action" || clean.startsWith("❌")) {
      return { type: "CANCEL" };
    }

    // Check if user is asking to modify specific attributes (e.g. "ganti jadi BCA", "harganya 40rb bukan 50rb")
    if (
      clean.includes("ganti") ||
      clean.includes("ubah") ||
      clean.includes("bukan") ||
      clean.includes("tapi") ||
      clean.includes("pake") ||
      clean.includes("pakai") ||
      clean.includes("revisi")
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
    actionType: "CREATE_TRANSACTION" | "DELETE_TRANSACTION" | "EDIT_TRANSACTION",
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
   * Executes confirmed draft: writes/updates/deletes in Supabase, Google Drive (if media exists), and Google Sheets
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

        // Delete from Supabase
        const deleted = await this.trxRepo.deleteTransaction(targetId);
        // Delete from Google Sheet
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

        // Update in Supabase
        const updated = await this.trxRepo.updateTransaction(targetId, changes);
        // Update in Google Sheets
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

      // 3. CREATE TRANSACTION (Default)
      const draft = draftRecord.payload as TransactionDraft;

      // Generate unique Transaction ID (e.g. T026-H001)
      const trxId = await this.trxRepo.generateTransactionId(draft.date);

      // Upload media to Google Drive if present
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

      // Normalize items
      const items = (draft.items || []).map((it) => ({
        item_name: it.item_name,
        qty: it.qty || 1,
        unit: it.unit || "unit",
        price: it.price || 0,
        total_price: it.total_price || (it.qty || 1) * (it.price || 0),
        department: it.department || "Kafe",
        notes: it.notes || "",
      }));

      // Save to Supabase
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

      // Append to Google Sheets
      try {
        const sheetRes = await googleSheetsService.appendTransaction(transactionRecord, items);
        await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to append confirmed transaction to Google Sheet");
      }

      // Mark pending action as CONFIRMED
      await this.pendingRepo.confirmAction(draftRecord.id, userPhone);

      // Get live updated balance
      const isSuperAdmin = await this.userRepo.isSuperAdminAsync(userPhone);
      const wallet = await this.trxRepo.getWalletBalance();

      // Construct warm natural confirmation message
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

      reply += `\n💡 _Ketik \`/batal\` jika sewaktu-waktu ingin membatalkan transaksi ini._`;

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
    let preview = `📝 *DRAF PENCATATAN KAS*\n`;
    preview += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
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
    preview += `👉 *Apakah data di atas sudah benar untuk dicatat ke pembukuan?*\n`;
    preview += `_(Ketik **Ya** untuk simpan, **Batal** untuk menghapus, atau sebutkan bagian yang ingin diubah)_`;

    return preview;
  }
}
