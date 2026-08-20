import { formatUserList, formatHelpMessage, formatMonthlyReport, formatDeletedTransaction } from "../formatters/reply.formatter.js";
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
        let trimmed = text.trim();
        const isKeyword = ["help", "menu", "bantuan", "panduan", "rekap", "laporan", "users"].includes(trimmed.toLowerCase());
        if (!trimmed.startsWith("/") && !isKeyword) {
            return { handled: false, responseMessage: "" };
        }
        if (isKeyword && !trimmed.startsWith("/")) {
            trimmed = "/" + trimmed;
        }
        const parts = trimmed.split(" ");
        const command = parts[0].toLowerCase();
        const isSuperAdmin = this.userRepo.isSuperAdmin(senderPhone);
        if (command === "/help" || command === "/bantuan" || command === "/menu" || command === "/panduan") {
            return { handled: true, responseMessage: formatHelpMessage(isSuperAdmin) };
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
        if (command === "/users" || command === "/daftar_user") {
            const users = await this.userRepo.listActiveUsers();
            return { handled: true, responseMessage: formatUserList(users) };
        }
        if (command === "/approve" || command === "/izinkan") {
            const targetPhone = parts[1];
            const userName = parts.slice(2).join(" ") || "Anggota";
            if (!targetPhone) {
                return {
                    handled: true,
                    responseMessage: "❌ Format salah. Gunakan: `/approve 6281234567890 NamaUser`",
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
                responseMessage: "✅ Nomor `" + targetPhone + "` (" + userName + ") berhasil disetujui & diaktifkan!",
            };
        }
        if (command === "/block" || command === "/blokir") {
            const targetPhone = parts[1];
            if (!targetPhone) {
                return {
                    handled: true,
                    responseMessage: "❌ Format salah. Gunakan: `/block 6281234567890`",
                };
            }
            await this.userRepo.setUserStatus(targetPhone, "blocked");
            return {
                handled: true,
                responseMessage: "🚫 Nomor `" + targetPhone + "` berhasil diblokir.",
            };
        }
        if (command === "/role" || command === "/setrole" || command === "/ubahrole") {
            const targetPhone = parts[1]?.replace(/[^0-9]/g, "");
            const newRole = parts[2]?.toLowerCase();
            if (!targetPhone || !newRole || !["super_admin", "admin", "member"].includes(newRole)) {
                return {
                    handled: true,
                    responseMessage: "❌ Format salah. Gunakan: `/role <nomor> <super_admin|member>`\n\nContoh:\n• `/role 6281234567890 super_admin`\n• `/role 6281234567890 member`",
                };
            }
            const updated = await this.userRepo.setUserRole(targetPhone, newRole);
            if (!updated) {
                return {
                    handled: true,
                    responseMessage: "⚠️ Pengguna dengan nomor `" + targetPhone + "` tidak ditemukan di database. Pastikan nomor sudah pernah mendaftar/di-approve terlebih dahulu.",
                };
            }
            return {
                handled: true,
                responseMessage: "✅ Role untuk *" + (updated.name || targetPhone) + "* (`+" + targetPhone + "`) berhasil diubah menjadi: *" + newRole.toUpperCase() + "*!",
            };
        }
        if (command === "/batal" || command === "/cancel") {
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
                    responseMessage: "❌ Format salah. Gunakan: `/hapus TRX-XXXX`\nContoh: `/hapus TRX-20260820-LX8Y`\n\nAtau ketik `/batal` untuk membatalkan transaksi paling akhir.",
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
        return {
            handled: true,
            responseMessage: "❓ Perintah tidak dikenal. Ketik `/help` untuk melihat daftar perintah.",
        };
    }
}
//# sourceMappingURL=command.handler.js.map