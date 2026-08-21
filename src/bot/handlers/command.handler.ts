import { UserRepository } from "../../db/repositories/user.repository.js";
import { TransactionRepository, TransactionRecord, isIncome } from "../../db/repositories/transaction.repository.js";
import { BudgetRepository } from "../../db/repositories/budget.repository.js";
import { BillRepository } from "../../db/repositories/bill.repository.js";
import { pdfReportService } from "../../services/pdf-report.service.js";
import { getGlobalSocket } from "../socket-holder.js";
import {
  formatUserList,
  formatHelpMessage,
  formatRupiah,
  formatMonthlyReport,
  formatDeletedTransaction,
  formatTransactionDetail,
  formatTransactionUpdated,
  formatTransactionSuccess,
  formatWalletBalance,
  formatMultiPocketBalance,
  formatDailyRecap,
  formatTransferSuccess,
  formatBudgetList,
  formatBudgetSetSuccess,
  formatBillList,
  formatBillCreatedSuccess,
  formatBillPaidSuccess,
} from "../formatters/reply.formatter.js";
import { parseTransactionEdit } from "../../ai/parsers/edit.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export class CommandHandler {
  constructor(
    private userRepo: UserRepository,
    private trxRepo: TransactionRepository,
    private budgetRepo?: BudgetRepository,
    private billRepo?: BillRepository
  ) {}

  async handleCommand(
    senderPhone: string,
    text: string
  ): Promise<{ handled: boolean; responseMessage: string }> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) {
      return { handled: false, responseMessage: "" };
    }

    const parts = trimmed.split(" ");
    const command = parts[0].toLowerCase();
    const isSuperAdmin = await this.userRepo.isSuperAdminAsync(senderPhone);

    if (command === "/help" || command === "/bantuan" || command === "/menu" || command === "/panduan") {
      return { handled: true, responseMessage: formatHelpMessage(isSuperAdmin) };
    }

    if (command === "/saldo" || command === "/dompet" || command === "/kas" || command === "/balance") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah `/saldo` hanya dapat diakses oleh Super Admin untuk menjaga privasi data keuangan.",
        };
      }

      const subArg = parts[1]?.trim().toLowerCase();
      if (subArg) {
        const multi = await this.trxRepo.getMultiPocketBalances();
        if (subArg === "detail" || subArg === "rincian" || subArg === "semua" || subArg === "all") {
          return { handled: true, responseMessage: formatMultiPocketBalance(multi) };
        }
        return { handled: true, responseMessage: formatMultiPocketBalance(multi, parts[1]) };
      }

      const wallet = await this.trxRepo.getWalletBalance();
      return { handled: true, responseMessage: formatWalletBalance(wallet) };
    }

    if (command === "/transfer" || command === "/mutasi" || command === "/tariktunai") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah `/transfer` hanya dapat diakses oleh Super Admin.",
        };
      }

      // Format: /transfer <dari> <ke> <nominal> [keterangan]
      // Contoh: /transfer bca cash 500000 Tarik tunai ATM
      const fromPocket = parts[1]?.trim();
      const toPocket = parts[2]?.trim();
      const nominal = parseHumanNominal(parts[3] || "");
      const notes = parts.slice(4).join(" ").trim() || "Mutasi Kas";

      if (!fromPocket || !toPocket || !nominal || isNaN(nominal) || nominal <= 0) {
        return {
          handled: true,
          responseMessage:
            "❌ Format salah. Gunakan:\n`/transfer <dari_kantong> <ke_kantong> <nominal> [keterangan]`\n\n*Contoh Penggunaan:*\n• `/transfer bca cash 500000 Tarik tunai ATM`\n• `/transfer cash mandiri 1jt Setor tunai penjualan`\n• `/transfer mandiri bca 250rb Pindah saldo antar bank`",
        };
      }

      const user = await this.userRepo.getUser(senderPhone);
      const userName = user?.name || "Super Admin";
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());

      // 1. Catat Pengeluaran dari Kantong Asal (Mutasi Keluar)
      const outTrxId = await this.trxRepo.generateTransactionId(today);
      await this.trxRepo.createTransaction({
        id: outTrxId,
        user_phone: senderPhone,
        user_name: userName,
        date: today,
        merchant: `Mutasi Keluar -> ${toPocket.toUpperCase()}`,
        category: "Mutasi Kas: Keluar",
        subtotal: nominal,
        tax: 0,
        discount: 0,
        total_amount: nominal,
        payment_method: fromPocket.toUpperCase(),
        raw_text: trimmed,
        status: "expense",
      });

      // 2. Catat Pemasukan ke Kantong Tujuan (Mutasi Masuk)
      // Slight delay to ensure sequential ID
      const inTrxId = await this.trxRepo.generateTransactionId(today);
      await this.trxRepo.createTransaction({
        id: inTrxId,
        user_phone: senderPhone,
        user_name: userName,
        date: today,
        merchant: `Mutasi Masuk <- ${fromPocket.toUpperCase()}`,
        category: "Pemasukan: Mutasi Kas",
        subtotal: nominal,
        tax: 0,
        discount: 0,
        total_amount: nominal,
        payment_method: toPocket.toUpperCase(),
        raw_text: trimmed,
        status: "income",
      });

      // 3. Append both to Google Sheets
      try {
        await googleSheetsService.appendTransaction({
          id: outTrxId,
          user_phone: senderPhone,
          user_name: userName,
          date: today,
          merchant: `Mutasi Keluar -> ${toPocket.toUpperCase()} (${notes})`,
          category: "Mutasi Kas: Keluar",
          subtotal: nominal,
          tax: 0,
          discount: 0,
          total_amount: nominal,
          payment_method: fromPocket.toUpperCase(),
          status: "expense",
          raw_text: trimmed,
        });

        await googleSheetsService.appendTransaction({
          id: inTrxId,
          user_phone: senderPhone,
          user_name: userName,
          date: today,
          merchant: `Mutasi Masuk <- ${fromPocket.toUpperCase()} (${notes})`,
          category: "Pemasukan: Mutasi Kas",
          subtotal: nominal,
          tax: 0,
          discount: 0,
          total_amount: nominal,
          payment_method: toPocket.toUpperCase(),
          status: "income",
          raw_text: trimmed,
        });
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to append transfer transaction to Google Sheet");
      }

      const wallet = await this.trxRepo.getWalletBalance();
      return {
        handled: true,
        responseMessage: formatTransferSuccess(
          fromPocket.toUpperCase(),
          toPocket.toUpperCase(),
          nominal,
          notes,
          wallet.balance
        ),
      };
    }

    if (command === "/rekapmalam" || command === "/kirimrekap" || command === "/rekapmanual") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah ini hanya dapat diakses oleh Super Admin.",
        };
      }
      const targetDate = parts[1] || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
      const dailySummary = await this.trxRepo.getDailyTransactionsSummary(targetDate);
      const wallet = await this.trxRepo.getWalletBalance();
      return {
        handled: true,
        responseMessage: formatDailyRecap(dailySummary, wallet),
      };
    }

    if (command === "/pemasukan" || command === "/masuk" || command === "/income" || command === "/tambahsaldo") {
      const rawNominal = parts[1] || "";
      const nominal = parseHumanNominal(rawNominal);
      const keterangan = parts.slice(2).join(" ").trim() || "Pemasukan Kas";

      if (!nominal || isNaN(nominal) || nominal <= 0) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/pemasukan <nominal> [keterangan] [metode]`\n\n*Contoh Penggunaan:*\n• `/pemasukan 5jt Gaji Bulanan Mandiri`\n• `/pemasukan 500rb Transfer Masuk BCA`\n• `/pemasukan 250000 Penjualan Cash`",
        };
      }

      // Detect payment method from the full remaining text
      const lowerText = keterangan.toLowerCase();
      const methodKeywords: { [key: string]: string } = {
        cash: "Cash", tunai: "Cash", kas: "Cash",
        mandiri: "Mandiri", bca: "BCA", bri: "BRI", bni: "BNI", bsi: "BSI",
        qris: "QRIS", gopay: "GoPay", ovo: "OVO", dana: "DANA",
        shopeepay: "ShopeePay", "shopee pay": "ShopeePay",
        transfer: "Transfer Bank", tf: "Transfer Bank",
        debit: "Debit", kredit: "Kredit",
      };

      let detectedMethod: string | null = null;
      for (const [keyword, method] of Object.entries(methodKeywords)) {
        if (lowerText.includes(keyword)) {
          detectedMethod = method;
          break;
        }
      }

      // If no payment method detected, ask the user
      if (!detectedMethod) {
        const formatRp = new Intl.NumberFormat("id-ID").format(nominal);
        return {
          handled: true,
          responseMessage: "✅ Pemasukan *Rp" + formatRp + "* untuk *" + keterangan + "* dicatat sementara.\n\nMohon info, pemasukan ini melalui metode apa ya?\n_(Contoh: Cash, Transfer BCA, Mandiri, BRI, atau QRIS)_\n\n💡 Atau ketik langsung:\n`/pemasukan " + nominal + " " + keterangan + " Cash`",
        };
      }

      // Remove the method keyword from keterangan for cleaner display
      let cleanKeterangan = keterangan;
      for (const keyword of Object.keys(methodKeywords)) {
        cleanKeterangan = cleanKeterangan.replace(new RegExp("\\b" + keyword + "\\b", "gi"), "").trim();
      }
      cleanKeterangan = cleanKeterangan || "Pemasukan Kas";

      const user = await this.userRepo.getUser(senderPhone);
      const userName = user?.name || (isSuperAdmin ? "Super Admin" : "Anggota");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
      const trxId = await this.trxRepo.generateTransactionId(today);

      let category = "Pemasukan: Lain-lain";
      const lowerKet = cleanKeterangan.toLowerCase();
      if (lowerKet.includes("gaji")) category = "Pemasukan: Gaji";
      else if (lowerKet.includes("transfer") || lowerKet.includes("tf")) category = "Pemasukan: Transfer Masuk";
      else if (lowerKet.includes("jual") || lowerKet.includes("proyek") || lowerKet.includes("order")) category = "Pemasukan: Penjualan";
      else if (lowerKet.includes("top up") || lowerKet.includes("kas")) category = "Pemasukan: Top Up Kas";

      const transactionRecord = await this.trxRepo.createTransaction({
        id: trxId,
        user_phone: senderPhone,
        user_name: userName,
        date: today,
        merchant: cleanKeterangan,
        category: category,
        subtotal: nominal,
        tax: 0,
        discount: 0,
        total_amount: nominal,
        payment_method: detectedMethod,
        raw_text: trimmed,
        status: "income",
        confidence_score: 1.0,
      });

      try {
        const sheetRes = await googleSheetsService.appendTransaction(transactionRecord, []);
        await this.trxRepo.updateGSheetRow(trxId, sheetRes.rowIndex);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to append income row to Google Sheet");
      }

      const wallet = await this.trxRepo.getWalletBalance();
      const reply = formatTransactionSuccess(transactionRecord, [], isSuperAdmin, wallet.balance);
      return { handled: true, responseMessage: reply };
    }

    if (command === "/link" || command === "/sheet" || command === "/drive" || command === "/spreadsheet" || command === "/dasbor") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah ini hanya dapat diakses oleh Super Admin.",
        };
      }
      let msg = "🔗 *LINK SISTEM PENCATATAN KEUANGAN*\n\n";
      msg += "📊 *Google Sheets (Data Transaksi & Dasbor):*\n";
      msg += "https://docs.google.com/spreadsheets/d/" + config.GOOGLE_SHEET_ID + "/edit\n\n";
      msg += "📁 *Google Drive (Folder Arsip Struk):*\n";
      msg += "https://drive.google.com/drive/folders/" + config.GOOGLE_DRIVE_FOLDER_ID + "\n\n";
      msg += "💡 _Semua transaksi dan foto yang dikirimkan otomatis tersimpan secara real-time di link di atas._";
      return { handled: true, responseMessage: msg };
    }

    if (command === "/detail" || command === "/rincian" || command === "/lihat") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah `/detail` hanya dapat diakses oleh Super Admin.",
        };
      }
      const targetId = parts[1]?.trim();
      if (!targetId) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/detail <ID_TRANSAKSI>`\nContoh: `/detail TRX-20260820-LX8Y`",
        };
      }

      const data = await this.trxRepo.getTransactionWithItems(targetId);
      if (!data) {
        return {
          handled: true,
          responseMessage: "⚠️ Transaksi dengan ID `" + targetId + "` tidak ditemukan di database.",
        };
      }

      return {
        handled: true,
        responseMessage: formatTransactionDetail(data.trx, data.items),
      };
    }

    if (command === "/nama" || command === "/setnama" || command === "/gantinama") {
      const arg1 = parts[1];
      if (!arg1) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/nama Nama Baru Anda`\nContoh: `/nama Budi` atau `/nama Rezky Haikal`",
        };
      }

      // Check if Super Admin is changing another user: /nama 628123456789 Budi
      const isTargetingOther = isSuperAdmin && /^[0-9+]{8,16}$/.test(arg1.replace(/[^0-9]/g, "")) && parts.length > 2;
      const targetPhone = isTargetingOther ? arg1.replace(/[^0-9]/g, "") : senderPhone;
      const newName = isTargetingOther ? parts.slice(2).join(" ") : parts.slice(1).join(" ");

      const user = await this.userRepo.getUser(targetPhone);
      const oldName = user?.name;

      await this.userRepo.upsertUser({
        phone_number: targetPhone,
        name: newName,
        role: user?.role || (this.userRepo.isSuperAdmin(targetPhone) ? "super_admin" : "member"),
        status: user?.status || "active",
      });

      // Auto-rename existing Google Drive folders if any
      if (oldName && oldName !== newName) {
        try {
          await googleDriveService.renameUserFolders(oldName, newName);
        } catch (renameErr) {
          logger.warn({ renameErr }, "Could not auto-rename Drive folders");
        }
      }

      return {
        handled: true,
        responseMessage: isTargetingOther
          ? "✅ Nama untuk nomor `" + targetPhone + "` berhasil diubah menjadi: *" + newName + "*."
          : "✅ Nama Anda berhasil diubah menjadi: *" + newName + "*\nSemua transaksi Anda selanjutnya akan dicatat atas nama ini di Google Sheets & Google Drive.",
      };
    }

    if (!isSuperAdmin) {
      return {
        handled: true,
        responseMessage: "⚠️ Perintah `" + command + "` hanya dapat dijalankan oleh Super Admin.",
      };
    }

    if (command === "/edit" || command === "/ubah" || command === "/koreksi") {
      const targetId = parts[1]?.trim();
      const editInstruction = parts.slice(2).join(" ").trim();

      if (!targetId || !editInstruction) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/edit <ID_TRX> <koreksi>`\n\n*Contoh Penggunaan:*\n• `/edit TRX-20260820-LX8Y 50000` (ubah total)\n• `/edit TRX-20260820-LX8Y toko: Indomaret, total: 45000`\n• `/edit TRX-20260820-LX8Y ganti tanggal 2026-08-19 dan kategori Makanan`",
        };
      }

      const existing = await this.trxRepo.getTransactionWithItems(targetId);
      if (!existing) {
        return {
          handled: true,
          responseMessage: "⚠️ Transaksi dengan ID `" + targetId + "` tidak ditemukan di database.",
        };
      }

      const parsedEdit = await parseTransactionEdit(existing.trx, editInstruction);
      const changedFields: string[] = [];

      const updates: Partial<TransactionRecord> = {};
      if (parsedEdit.merchant && parsedEdit.merchant !== existing.trx.merchant) {
        updates.merchant = parsedEdit.merchant;
        changedFields.push("Merchant (" + parsedEdit.merchant + ")");
      }
      if (parsedEdit.category && parsedEdit.category !== existing.trx.category) {
        updates.category = parsedEdit.category;
        changedFields.push("Kategori (" + parsedEdit.category + ")");
      }
      if (parsedEdit.total_amount && parsedEdit.total_amount !== existing.trx.total_amount) {
        updates.total_amount = parsedEdit.total_amount;
        changedFields.push("Total (" + formatRupiah(parsedEdit.total_amount) + ")");
      }
      if (parsedEdit.subtotal && parsedEdit.subtotal !== existing.trx.subtotal) {
        updates.subtotal = parsedEdit.subtotal;
        changedFields.push("Subtotal");
      }
      if (parsedEdit.tax !== undefined && parsedEdit.tax !== existing.trx.tax) {
        updates.tax = parsedEdit.tax;
        changedFields.push("Pajak");
      }
      if (parsedEdit.discount !== undefined && parsedEdit.discount !== existing.trx.discount) {
        updates.discount = parsedEdit.discount;
        changedFields.push("Diskon");
      }
      if (parsedEdit.date && parsedEdit.date !== existing.trx.date) {
        updates.date = parsedEdit.date;
        changedFields.push("Tanggal (" + parsedEdit.date + ")");
      }
      if (parsedEdit.payment_method && parsedEdit.payment_method !== existing.trx.payment_method) {
        updates.payment_method = parsedEdit.payment_method;
        changedFields.push("Metode Bayar (" + parsedEdit.payment_method + ")");
      }
      if (parsedEdit.raw_text && parsedEdit.raw_text !== existing.trx.raw_text) {
        updates.raw_text = parsedEdit.raw_text;
        changedFields.push("Catatan");
      }

      if (changedFields.length === 0) {
        // Ensure Google Sheets is also up-to-date with current DB state
        try {
          await googleSheetsService.updateTransactionRow(existing.trx, existing.items);
        } catch (sheetErr) {
          logger.error({ sheetErr }, "Failed to sync row in Google Sheets");
        }

        let sameInfo = "";
        if (parsedEdit.payment_method && parsedEdit.payment_method === existing.trx.payment_method) {
          sameInfo += `\n• Metode Pembayaran: *${existing.trx.payment_method}*`;
        }
        if (parsedEdit.merchant && parsedEdit.merchant === existing.trx.merchant) {
          sameInfo += `\n• Toko/Sumber: *${existing.trx.merchant}*`;
        }
        if (parsedEdit.category && parsedEdit.category === existing.trx.category) {
          sameInfo += `\n• Kategori: *${existing.trx.category}*`;
        }
        if (parsedEdit.total_amount && parsedEdit.total_amount === existing.trx.total_amount) {
          sameInfo += `\n• Nominal: *${formatRupiah(existing.trx.total_amount)}*`;
        }

        return {
          handled: true,
          responseMessage:
            "ℹ️ *Tidak Ada Perubahan:*" +
            (sameInfo
              ? sameInfo + "\n\n_Semua data di database & spreadsheet sudah sesuai dengan yang Anda instruksikan._"
              : `\nTidak ada kolom yang berbeda dari instruksi: "${editInstruction}".`),
        };
      }

      const updatedTrx = await this.trxRepo.updateTransaction(targetId, updates);
      if (!updatedTrx) {
        return {
          handled: true,
          responseMessage: "❌ Gagal memperbarui transaksi di database.",
        };
      }

      try {
        await googleSheetsService.updateTransactionRow(updatedTrx, existing.items);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to update Google Sheet row");
      }

      return {
        handled: true,
        responseMessage: formatTransactionUpdated(updatedTrx, changedFields),
      };
    }

    if (command === "/pengguna" || command === "/anggota" || command === "/daftar" || command === "/users" || command === "/user") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah `/pengguna` hanya dapat diakses oleh Super Admin.",
        };
      }
      const users = await this.userRepo.listActiveUsers();
      return { handled: true, responseMessage: formatUserList(users) };
    }

    if (command === "/tambah" || command === "/izinkan" || command === "/setujui" || command === "/approve") {
      const remaining = trimmed.substring(command.length).trim();
      const match = remaining.match(/^([+0-9\s\-()]{7,25})(.*)$/);
      let targetPhone = "";
      let userName = "Anggota";

      if (match) {
        targetPhone = match[1].replace(/[^0-9]/g, "");
        if (targetPhone.startsWith("0")) targetPhone = "62" + targetPhone.slice(1);
        userName = match[2].trim() || "Anggota";
      } else {
        targetPhone = (parts[1] || "").replace(/[^0-9]/g, "");
        if (targetPhone.startsWith("0")) targetPhone = "62" + targetPhone.slice(1);
        userName = parts.slice(2).join(" ") || "Anggota";
      }

      if (!targetPhone || targetPhone.length < 8) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/tambah <nomor_hp> [NamaUser] [super_admin|anggota]`\nContoh: `/tambah 08123456789 Budi super_admin` atau `/tambah +628123456789 Budi`",
        };
      }

      let role: "super_admin" | "member" = "member";
      const lowerRemaining = remaining.toLowerCase();
      if (lowerRemaining.includes("super_admin") || lowerRemaining.includes("superadmin") || lowerRemaining.includes("super admin")) {
        role = "super_admin";
        userName = userName.replace(/super_admin|superadmin|super admin/gi, "").trim() || "Super Admin";
      } else if (lowerRemaining.includes("admin")) {
        role = "super_admin";
        userName = userName.replace(/admin/gi, "").trim() || "Admin";
      }

      await this.userRepo.upsertUser({
        phone_number: targetPhone,
        name: userName,
        role: role,
        status: "active",
      });

      const roleLabel = role === "super_admin" ? "Super Admin" : "Anggota";
      return {
        handled: true,
        responseMessage: "✅ Nomor `+" + targetPhone + "` (" + userName + ") berhasil didaftarkan & diaktifkan sebagai *" + roleLabel + "*!",
      };
    }

    if (command === "/blokir" || command === "/block") {
      const target = trimmed.substring(command.length).trim();

      if (!target || target.length < 2) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/blokir <nomor_hp_atau_nama>`\nContoh:\n• `/blokir 083801408811`\n• `/blokir alfi`\n• `/blokir ikhwan`",
        };
      }

      const res = await this.userRepo.setUserStatus(target, "blocked");
      const affectedNames = res.affectedUsers.map((u) => `• *${u.name}* (\`+${u.phone_number}\`)`).join("\n");

      return {
        handled: true,
        responseMessage: `🚫 *PEMBLOKIRAN BERHASIL!*\n\n${res.affectedUsers.length} pengguna telah dinonaktifkan dari sistem:\n${affectedNames || `• Target: ${target}`}\n\nPengguna di atas tidak lagi dapat mengirim atau mencatat transaksi ke bot.`,
      };
    }

    if (command === "/peran" || command === "/role" || command === "/ubahperan" || command === "/setrole") {
      const remaining = trimmed.substring(command.length).trim();
      const match = remaining.match(/^([+0-9\s\-()]{7,25})(.*)$/);
      let targetPhone = "";
      let rawRole = "";

      if (match) {
        targetPhone = match[1].replace(/[^0-9]/g, "");
        if (targetPhone.startsWith("0")) targetPhone = "62" + targetPhone.slice(1);
        rawRole = match[2].trim().toLowerCase();
      } else {
        targetPhone = (parts[1] || "").replace(/[^0-9]/g, "");
        if (targetPhone.startsWith("0")) targetPhone = "62" + targetPhone.slice(1);
        rawRole = (parts[2] || "").toLowerCase();
      }

      let mappedRole: "super_admin" | "member" | null = null;
      if (rawRole.includes("super") || rawRole.includes("admin")) {
        mappedRole = "super_admin";
      } else if (rawRole.includes("member") || rawRole.includes("anggota") || rawRole.includes("user")) {
        mappedRole = "member";
      }

      if (!targetPhone || targetPhone.length < 8 || !mappedRole) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/peran <nomor_hp> <super_admin|anggota>`\n\nContoh:\n• `/peran 0811422404 super_admin`\n• `/peran 0811422404 anggota`",
        };
      }

      const updated = await this.userRepo.setUserRole(targetPhone, mappedRole);
      if (!updated) {
        return {
          handled: true,
          responseMessage: "⚠️ Pengguna dengan nomor `+" + targetPhone + "` tidak ditemukan di database. Pastikan nomor sudah pernah didaftarkan terlebih dahulu.",
        };
      }

      const roleLabel = mappedRole === "super_admin" ? "SUPER_ADMIN" : "ANGGOTA";
      return {
        handled: true,
        responseMessage: "✅ Hak akses / peran untuk *" + (updated.name || targetPhone) + "* (`+" + targetPhone + "`) berhasil diubah menjadi: *" + roleLabel + "*!",
      };
    }

    if (command === "/batal" || command === "/batalkan" || command === "/cancel") {
      const latest = await this.trxRepo.getLatestTransaction();
      if (!latest) {
        return { handled: true, responseMessage: "ℹ️ Tidak ada transaksi terakhir yang dapat dibatalkan." };
      }

      await this.trxRepo.deleteTransaction(latest.id);
      try {
        await googleSheetsService.deleteTransactionRow(latest.id);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to delete row from Google Sheet");
      }

      return {
        handled: true,
        responseMessage: formatDeletedTransaction(latest),
      };
    }

    if (command === "/sync" || command === "/sinkron" || command === "/tariksheet") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah `/sync` hanya dapat diakses oleh Super Admin.",
        };
      }
      try {
        const syncResult = await googleSheetsService.syncFromSheetToDatabase(this.trxRepo);
        const wallet = await this.trxRepo.getWalletBalance();
        return {
          handled: true,
          responseMessage: `🔄 *SINKRONISASI SELESAI!*\n\n📊 Total *${syncResult.syncedCount}* baris transaksi dari Google Sheets berhasil diselaraskan ke database.\n\n💵 *Saldo Kas Dompet Terkini:* *${formatRupiah(wallet.balance)}*`,
        };
      } catch (syncErr: any) {
        logger.error({ syncErr }, "Manual /sync failed");
        return {
          handled: true,
          responseMessage: "❌ Gagal menyinkronkan data dari Google Sheets: " + (syncErr?.message || "Terjadi kesalahan"),
        };
      }
    }

    if (command === "/hapus" || command === "/delete") {
      const targetId = parts[1];
      if (!targetId) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/hapus <ID_TRX>`\nContoh: `/hapus H001` atau `/hapus 1`\n\nAtau cukup ketik `/batal` untuk membatalkan transaksi paling akhir.",
        };
      }

      const deleted = await this.trxRepo.deleteTransaction(targetId.trim());
      if (!deleted) {
        return {
          handled: true,
          responseMessage: "⚠️ Transaksi `" + targetId + "` tidak ditemukan di database.",
        };
      }

      try {
        await googleSheetsService.deleteTransactionRow(deleted.id);
      } catch (sheetErr) {
        logger.error({ sheetErr }, "Failed to delete row from Google Sheet");
      }

      return {
        handled: true,
        responseMessage: formatDeletedTransaction(deleted),
      };
    }

    if (command === "/laporan" || command === "/bulanini" || command === "/report") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Perintah `/laporan` hanya dapat diakses oleh Super Admin untuk menjaga privasi data keuangan.",
        };
      }
      const now = new Date();
      let targetMonth = parts[1] || `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;

      if (/^\d{1,2}$/.test(targetMonth)) {
        targetMonth = `${now.getFullYear()}-${targetMonth.padStart(2, "0")}`;
      }

      const summary = await this.trxRepo.getMonthlySummary(targetMonth);
      return {
        handled: true,
        responseMessage: formatMonthlyReport(summary, targetMonth),
      };
    }

    if (
      command === "/rekap" ||
      command === "/riwayat" ||
      command === "/summary" ||
      command === "/terakhir" ||
      command === "/pengeluaranterakhir" ||
      command === "/pemasukanterakhir"
    ) {
      let limit = 10;
      if (parts[1] && /^\d+$/.test(parts[1])) {
        limit = Math.min(Math.max(parseInt(parts[1], 10), 1), 50);
      }

      let filterType: "income" | "expense" | undefined = undefined;
      if (command === "/pengeluaranterakhir" || parts.some((p) => p.toLowerCase() === "keluar" || p.toLowerCase() === "pengeluaran")) {
        filterType = "expense";
      } else if (command === "/pemasukanterakhir" || parts.some((p) => p.toLowerCase() === "masuk" || p.toLowerCase() === "pemasukan")) {
        filterType = "income";
      }

      const fetchLimit = filterType ? 50 : limit;
      let recent = isSuperAdmin
        ? await this.trxRepo.getAllRecentTransactions(fetchLimit)
        : await this.trxRepo.getRecentTransactions(senderPhone, fetchLimit);

      if (filterType) {
        recent = recent.filter((t) => (filterType === "income" ? isIncome(t) : !isIncome(t)));
      }

      recent = recent.slice(0, limit);

      if (recent.length === 0) {
        return { handled: true, responseMessage: "ℹ️ Belum ada data transaksi yang sesuai." };
      }

      const typeTitle = filterType === "income" ? "PEMASUKAN" : filterType === "expense" ? "PENGELUARAN" : "TRANSAKSI";
      let summary = "📊 *REKAP " + recent.length + " " + typeTitle + " TERAKHIR*\n\n";
      let totalExpense = 0;
      let totalIncome = 0;
      recent.forEach((t, i) => {
        const isInc = isIncome(t);
        const sign = isInc ? "🟢 [+]" : "🔴 [-]";
        if (isInc) totalIncome += Number(t.total_amount);
        else totalExpense += Number(t.total_amount);

        summary += (i + 1) + ". " + sign + " 🧾 `" + t.id + "`\n";
        summary += "   📅 " + t.date + " | *" + t.merchant + "* (" + t.category + ")\n";
        summary += "   💰 *" + (isInc ? "+" : "-") + formatRupiah(t.total_amount) + "* | 👤 " + t.user_name + "\n\n";
      });
      summary += "────────────────────────\n";
      summary += "🟢 *Total Pemasukan:* *" + formatRupiah(totalIncome) + "*\n";
      summary += "🔴 *Total Pengeluaran:* *" + formatRupiah(totalExpense) + "*\n\n";
      if (isSuperAdmin) {
        summary += "💡 *Tips:* Ketik `/detail [ID]` untuk rincian, atau `/saldo` untuk status kas dompet.";
      } else {
        summary += "💡 *Tips:* Ketik `/rekap 20` untuk melihat 20 transaksi terakhir Anda.";
      }
      return { handled: true, responseMessage: summary };
    }

    if (command === "/export" || command === "/unduh" || command === "/pdf" || command === "/laporanpdf") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Fitur download laporan PDF hanya dapat diakses oleh Super Admin.",
        };
      }

      const now = new Date();
      let targetMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;

      // Handle format: /export pdf 2026-08 or /export 2026-08 or /export pdf
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i].trim();
        if (/^\d{4}-\d{2}$/.test(p)) {
          targetMonth = p;
        } else if (/^\d{1,2}$/.test(p)) {
          targetMonth = `${now.getFullYear()}-${p.padStart(2, "0")}`;
        }
      }

      try {
        const summary = await this.trxRepo.getMonthlySummary(targetMonth);
        const [year, month] = targetMonth.split("-");
        const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
        const transactions = await this.trxRepo.getTransactionsByDateRange(
          `${targetMonth}-01`,
          `${targetMonth}-${lastDay.toString().padStart(2, "0")}`
        );

        const pdfBuffer = await pdfReportService.generateMonthlyReportPdf({
          targetMonth,
          totalIncome: summary.totalIncome || 0,
          totalExpense: summary.totalExpense !== undefined ? summary.totalExpense : summary.total,
          netCashflow: summary.netCashflow !== undefined ? summary.netCashflow : (summary.totalIncome || 0) - (summary.totalExpense || summary.total),
          count: summary.count,
          byCategory: summary.byCategory || {},
          transactions,
        });

        const sock = getGlobalSocket();
        if (sock) {
          const jid = senderPhone.includes("@") ? senderPhone : `${senderPhone}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            document: pdfBuffer,
            mimetype: "application/pdf",
            fileName: `Laporan_Kas_${targetMonth}.pdf`,
            caption: `📄 *Laporan Arus Kas Bulanan (${targetMonth})*\n\nBerikut file dokumen PDF resmi arus kas Anda.`,
          });
          return {
            handled: true,
            responseMessage: `📄 *Dokumen PDF Laporan Keuangan (${targetMonth}) berhasil dibuat dan sedang dikirimkan ke chat Anda...*`,
          };
        }

        return {
          handled: true,
          responseMessage: `✅ Laporan PDF (${targetMonth}) selesai dibuat.`,
        };
      } catch (pdfErr) {
        logger.error({ pdfErr }, "Failed to generate PDF report");
        return {
          handled: true,
          responseMessage: "⚠️ Gagal membuat file dokumen PDF laporan keuangan.",
        };
      }
    }

    if (command === "/budget" || command === "/anggaran" || command === "/limit") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Pengaturan batas anggaran hanya dapat diakses oleh Super Admin.",
        };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
      const sub = parts[1]?.trim().toLowerCase();

      // Case A: /budget or /budget cek
      if (!sub || sub === "cek" || sub === "status" || sub === "daftar" || sub === "list") {
        if (!this.budgetRepo) {
          return { handled: true, responseMessage: "ℹ️ Modul anggaran belum terpasang." };
        }
        const budgets = await this.budgetRepo.getBudgetsForMonth(currentMonth);
        const monthlySummary = await this.trxRepo.getMonthlySummary(currentMonth);
        return {
          handled: true,
          responseMessage: formatBudgetList(budgets, monthlySummary.byCategory || {}, currentMonth),
        };
      }

      // Case B: /budget hapus <kategori>
      if (sub === "hapus" || sub === "delete" || sub === "reset") {
        const catToDelete = parts.slice(2).join(" ").trim();
        if (!catToDelete) {
          return {
            handled: true,
            responseMessage: "❌ Format salah. Gunakan: `/budget hapus <kategori>`\nContoh: `/budget hapus Operasional`",
          };
        }
        if (this.budgetRepo) {
          await this.budgetRepo.deleteBudget(catToDelete, currentMonth);
        }
        return {
          handled: true,
          responseMessage: `🗑️ Batas anggaran untuk kategori *${catToDelete}* (${currentMonth}) berhasil dihapus.`,
        };
      }

      // Case C: /budget <kategori> <nominal> (e.g. /budget Operasional 4000000 or /budget Makan 3jt)
      let category = "";
      let rawNominal = "";

      // Find nominal at the end of args
      const lastArg = parts[parts.length - 1];
      const parsedAmount = parseHumanNominal(lastArg);

      if (parsedAmount > 0) {
        rawNominal = lastArg;
        category = parts.slice(1, parts.length - 1).join(" ").trim();
      }

      if (!category || parsedAmount <= 0) {
        return {
          handled: true,
          responseMessage: "❌ Format salah. Gunakan: `/budget <kategori> <nominal>`\n\nContoh:\n• `/budget Operasional 4000000`\n• `/budget Makanan 3jt`\n• `/budget cek`",
        };
      }

      if (this.budgetRepo) {
        await this.budgetRepo.upsertBudget(category, currentMonth, parsedAmount);
      }

      const monthlySummary = await this.trxRepo.getMonthlySummary(currentMonth);
      const matchedKey = Object.keys(monthlySummary.byCategory || {}).find(
        (k) => k.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes(k.toLowerCase())
      );
      const spent = matchedKey ? monthlySummary.byCategory[matchedKey] : 0;

      return {
        handled: true,
        responseMessage: formatBudgetSetSuccess(category, parsedAmount, spent),
      };
    }

    if (command === "/tagihan" || command === "/bill" || command === "/bills") {
      if (!isSuperAdmin) {
        return {
          handled: true,
          responseMessage: "⚠️ Menu tagihan rutin bulanan hanya dapat diakses oleh Super Admin.",
        };
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
      const sub = parts[1]?.trim().toLowerCase();

      // Case A: /tagihan or /tagihan daftar
      if (!sub || sub === "daftar" || sub === "list" || sub === "cek" || sub === "status") {
        if (!this.billRepo) {
          return { handled: true, responseMessage: "ℹ️ Modul tagihan rutin belum aktif." };
        }
        const bills = await this.billRepo.listActiveBills();
        return {
          handled: true,
          responseMessage: formatBillList(bills, currentMonth),
        };
      }

      // Case B: /tagihan tambah <Nama> <Nominal> [tgl <1-31>]
      // e.g. /tagihan tambah Listrik Toko 750000 tgl 20
      if (sub === "tambah" || sub === "add" || sub === "buat") {
        const remaining = parts.slice(2).join(" ").trim();
        // Regex to extract due day
        const dueMatch = remaining.match(/(?:tgl|tanggal|\btgl\b|\bday\b)\s*(\d{1,2})/i);
        let dueDay = dueMatch ? parseInt(dueMatch[1], 10) : 20;

        // Clean due string
        const withoutDue = remaining.replace(/(?:tgl|tanggal|\btgl\b|\bday\b)\s*\d{1,2}/gi, "").trim();
        const subParts = withoutDue.split(" ");
        const lastPart = subParts[subParts.length - 1];
        const nominal = parseHumanNominal(lastPart);
        const billName = subParts.slice(0, subParts.length - 1).join(" ").trim();

        if (!billName || nominal <= 0 || dueDay < 1 || dueDay > 31) {
          return {
            handled: true,
            responseMessage: "❌ Format salah. Gunakan: `/tagihan tambah <Nama_Tagihan> <Nominal> tgl <1-31>`\n\nContoh:\n• `/tagihan tambah Listrik Toko 750000 tgl 20`\n• `/tagihan tambah Wifi Indihome 350000 tgl 15`",
          };
        }

        const created = this.billRepo
          ? await this.billRepo.createBill({ bill_name: billName, amount: nominal, due_day: dueDay })
          : { bill_name: billName, amount: nominal, due_day: dueDay };

        return {
          handled: true,
          responseMessage: formatBillCreatedSuccess(created),
        };
      }

      // Case C: /tagihan bayar <Nama_Tagihan>
      if (sub === "bayar" || sub === "pay" || sub === "lunas") {
        const billNameToPay = parts.slice(2).join(" ").trim();
        if (!billNameToPay) {
          return {
            handled: true,
            responseMessage: "❌ Format salah. Gunakan: `/tagihan bayar <Nama_Tagihan>`\nContoh: `/tagihan bayar Listrik Toko`",
          };
        }

        const bill = this.billRepo ? await this.billRepo.getBillByName(billNameToPay) : null;
        if (!bill) {
          return {
            handled: true,
            responseMessage: `⚠️ Tagihan dengan nama *${billNameToPay}* tidak ditemukan di daftar.`,
          };
        }

        if (this.billRepo) {
          await this.billRepo.markBillPaid(bill.bill_name, currentMonth);
        }

        // Record expense transaction
        const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
        const trxId = await this.trxRepo.generateTransactionId(todayStr);
        const trx = await this.trxRepo.createTransaction({
          id: trxId,
          user_phone: senderPhone,
          user_name: "Super Admin",
          date: todayStr,
          merchant: bill.bill_name,
          category: bill.category || "Tagihan & Utilitas",
          subtotal: bill.amount,
          tax: 0,
          discount: 0,
          total_amount: bill.amount,
          payment_method: bill.payment_method || "Cash",
          confidence_score: 1.0,
          raw_text: `Bayar tagihan bulanan: ${bill.bill_name}`,
        });

        try {
          await googleSheetsService.appendTransaction(trx, []);
        } catch (sheetErr) {
          logger.error({ sheetErr }, "Failed to append bill transaction to sheets");
        }

        return {
          handled: true,
          responseMessage: formatBillPaidSuccess(bill.bill_name, bill.amount, currentMonth),
        };
      }

      // Case D: /tagihan hapus <Nama_Tagihan>
      if (sub === "hapus" || sub === "delete") {
        const billNameToDelete = parts.slice(2).join(" ").trim();
        if (!billNameToDelete) {
          return {
            handled: true,
            responseMessage: "❌ Format salah. Gunakan: `/tagihan hapus <Nama_Tagihan>`\nContoh: `/tagihan hapus Wifi`",
          };
        }
        if (this.billRepo) {
          await this.billRepo.deleteBill(billNameToDelete);
        }
        return {
          handled: true,
          responseMessage: `🗑️ Tagihan *${billNameToDelete}* berhasil dihapus dari daftar pengingat rutin.`,
        };
      }
    }

    return {
      handled: true,
      responseMessage: "❓ Perintah tidak dikenal. Ketik `/menu` untuk melihat daftar panduan & perintah.",
    };
  }
}

export function parseHumanNominal(raw: string): number {
  if (!raw) return 0;
  let clean = raw.toLowerCase().trim().replace(/^rp\.?\s*/i, "");

  let multiplier = 1;
  const hasMultiplier = /jt|juta|rb|ribu|k|milyar/i.test(clean) || (clean.endsWith("m") && !clean.includes("makan"));

  if (clean.includes("jt") || clean.includes("juta")) {
    multiplier = 1000000;
    clean = clean.replace(/jt|juta/g, "").trim();
  } else if (clean.includes("rb") || clean.includes("ribu") || clean.includes("k")) {
    multiplier = 1000;
    clean = clean.replace(/rb|ribu|k/g, "").trim();
  } else if (clean.includes("milyar")) {
    multiplier = 1000000000;
    clean = clean.replace(/milyar/g, "").trim();
  }

  if (hasMultiplier) {
    clean = clean.replace(/,/g, ".");
    const num = parseFloat(clean.replace(/[^0-9.]/g, ""));
    return Math.round((isNaN(num) ? 0 : num) * multiplier);
  } else {
    const cleanDigits = clean.replace(/[^0-9]/g, "");
    const num = parseInt(cleanDigits, 10);
    return isNaN(num) ? 0 : num;
  }
}

