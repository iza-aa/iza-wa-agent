import { formatUserList, formatHelpMessage, formatRupiah, formatMonthlyReport, formatDeletedTransaction, formatTransactionDetail, formatTransactionUpdated, } from "../formatters/reply.formatter.js";
import { parseTransactionEdit } from "../../ai/parsers/edit.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { logger } from "../../utils/logger.js";
export class CommandHandler {
    userRepo;
    trxRepo;
    constructor(userRepo, trxRepo) {
        this.userRepo = userRepo;
        this.trxRepo = trxRepo;
    }
    async handleCommand(senderPhone, text) {
        const trimmed = text.trim();
        if (!trimmed.startsWith("/")) {
            return { handled: false, responseMessage: "" };
        }
        const parts = trimmed.split(" ");
        const command = parts[0].toLowerCase();
        const isSuperAdmin = this.userRepo.isSuperAdmin(senderPhone);
        if (command === "/help" || command === "/bantuan" || command === "/menu" || command === "/panduan") {
            return { handled: true, responseMessage: formatHelpMessage(isSuperAdmin) };
        }
        if (command === "/detail" || command === "/rincian" || command === "/lihat") {
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
                    responseMessage: "❌ Format salah. Gunakan: `/nama Nama Baru Anda`\nContoh: `/nama Ayah` atau `/nama Rezky Haikal`",
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
                }
                catch (renameErr) {
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
            const changedFields = [];
            const updates = {};
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
                return {
                    handled: true,
                    responseMessage: "ℹ️ Tidak ada perubahan yang terdeteksi dari instruksi: \"" + editInstruction + "\".",
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
            }
            catch (sheetErr) {
                logger.error({ sheetErr }, "Failed to update Google Sheet row");
            }
            return {
                handled: true,
                responseMessage: formatTransactionUpdated(updatedTrx, changedFields),
            };
        }
        if (command === "/pengguna" || command === "/anggota" || command === "/daftar" || command === "/users" || command === "/user") {
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
                if (targetPhone.startsWith("0"))
                    targetPhone = "62" + targetPhone.slice(1);
                userName = match[2].trim() || "Anggota";
            }
            else {
                targetPhone = (parts[1] || "").replace(/[^0-9]/g, "");
                if (targetPhone.startsWith("0"))
                    targetPhone = "62" + targetPhone.slice(1);
                userName = parts.slice(2).join(" ") || "Anggota";
            }
            if (!targetPhone || targetPhone.length < 8) {
                return {
                    handled: true,
                    responseMessage: "❌ Format salah. Gunakan: `/tambah <nomor_hp> [NamaUser]`\nContoh: `/tambah 0811422404 Ayah` atau `/tambah +62811422404 Ayah`",
                };
            }
            await this.userRepo.upsertUser({
                phone_number: targetPhone,
                name: userName,
                role: "member",
                status: "active",
            });
            return {
                handled: true,
                responseMessage: "✅ Nomor `+" + targetPhone + "` (" + userName + ") berhasil didaftarkan & diaktifkan sebagai Anggota!",
            };
        }
        if (command === "/blokir" || command === "/block") {
            const remaining = trimmed.substring(command.length).trim();
            let targetPhone = remaining.replace(/[^0-9]/g, "");
            if (targetPhone.startsWith("0"))
                targetPhone = "62" + targetPhone.slice(1);
            if (!targetPhone || targetPhone.length < 8) {
                return {
                    handled: true,
                    responseMessage: "❌ Format salah. Gunakan: `/blokir <nomor_hp>`\nContoh: `/blokir 0811422404`",
                };
            }
            await this.userRepo.setUserStatus(targetPhone, "blocked");
            return {
                handled: true,
                responseMessage: "🚫 Nomor `+" + targetPhone + "` berhasil diblokir.",
            };
        }
        if (command === "/peran" || command === "/role" || command === "/ubahperan" || command === "/setrole") {
            const remaining = trimmed.substring(command.length).trim();
            const match = remaining.match(/^([+0-9\s\-()]{7,25})(.*)$/);
            let targetPhone = "";
            let rawRole = "";
            if (match) {
                targetPhone = match[1].replace(/[^0-9]/g, "");
                if (targetPhone.startsWith("0"))
                    targetPhone = "62" + targetPhone.slice(1);
                rawRole = match[2].trim().toLowerCase();
            }
            else {
                targetPhone = (parts[1] || "").replace(/[^0-9]/g, "");
                if (targetPhone.startsWith("0"))
                    targetPhone = "62" + targetPhone.slice(1);
                rawRole = (parts[2] || "").toLowerCase();
            }
            let mappedRole = null;
            if (rawRole.includes("super") || rawRole.includes("admin")) {
                mappedRole = "super_admin";
            }
            else if (rawRole.includes("member") || rawRole.includes("anggota") || rawRole.includes("user")) {
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
            }
            catch (sheetErr) {
                logger.error({ sheetErr }, "Failed to delete row from Google Sheet");
            }
            return {
                handled: true,
                responseMessage: formatDeletedTransaction(latest),
            };
        }
        if (command === "/hapus" || command === "/delete") {
            const targetId = parts[1];
            if (!targetId) {
                return {
                    handled: true,
                    responseMessage: "❌ Format salah. Gunakan: `/hapus TRX-XXXX`\nContoh: `/hapus TRX-20260820-LX8Y`\n\nAtau cukup ketik `batal` untuk membatalkan transaksi paling akhir.",
                };
            }
            const deleted = await this.trxRepo.deleteTransaction(targetId.trim());
            if (!deleted) {
                return {
                    handled: true,
                    responseMessage: "⚠️ Transaksi dengan ID `" + targetId + "` tidak ditemukan di database.",
                };
            }
            try {
                await googleSheetsService.deleteTransactionRow(deleted.id);
            }
            catch (sheetErr) {
                logger.error({ sheetErr }, "Failed to delete row from Google Sheet");
            }
            return {
                handled: true,
                responseMessage: formatDeletedTransaction(deleted),
            };
        }
        if (command === "/laporan" || command === "/bulanini" || command === "/report") {
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
        if (command === "/rekap" || command === "/riwayat" || command === "/summary") {
            let limit = 10;
            if (parts[1] && /^\d+$/.test(parts[1])) {
                limit = Math.min(Math.max(parseInt(parts[1], 10), 1), 50);
            }
            const recent = isSuperAdmin
                ? await this.trxRepo.getAllRecentTransactions(limit)
                : await this.trxRepo.getRecentTransactions(senderPhone, limit);
            if (recent.length === 0) {
                return { handled: true, responseMessage: "ℹ️ Belum ada transaksi tercatat." };
            }
            let summary = "📊 *REKAP " + recent.length + " TRANSAKSI TERAKHIR*\n\n";
            let total = 0;
            recent.forEach((t, i) => {
                total += Number(t.total_amount);
                summary += (i + 1) + ". 🧾 `" + t.id + "`\n";
                summary += "   📅 " + t.date + " | 🏪 *" + t.merchant + "* (" + t.category + ")\n";
                summary += "   💰 *" + formatRupiah(t.total_amount) + "* | 👤 " + t.user_name + "\n\n";
            });
            summary += "💰 *Total (" + recent.length + " transaksi):* *" + formatRupiah(total) + "*\n\n";
            summary += "💡 *Tips:* Ketik `/detail [ID]` untuk melihat rincian barang, atau `/edit [ID] [koreksi]` untuk mengubah.";
            return { handled: true, responseMessage: summary };
        }
        return {
            handled: true,
            responseMessage: "❓ Perintah tidak dikenal. Ketik `/menu` untuk melihat daftar panduan & perintah.",
        };
    }
}
//# sourceMappingURL=command.handler.js.map