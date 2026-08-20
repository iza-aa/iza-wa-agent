import { formatUserList, formatHelpMessage, formatRupiah } from "../formatters/reply.formatter.js";
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
        if (command === "/help" || command === "/bantuan" || command === "/menu") {
            return { handled: true, responseMessage: formatHelpMessage(isSuperAdmin) };
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
        if (command === "/rekap" || command === "/summary") {
            const recent = await this.trxRepo.getRecentTransactions(senderPhone, 10);
            if (recent.length === 0) {
                return { handled: true, responseMessage: "ℹ️ Belum ada transaksi tercatat." };
            }
            let summary = "📊 *REKAP 10 TRANSAKSI TERAKHIR*\n\n";
            let total = 0;
            recent.forEach((t, i) => {
                total += Number(t.total_amount);
                summary += (i + 1) + ". " + t.date + " - *" + t.merchant + "* (" + t.category + "): " + formatRupiah(t.total_amount) + "\n";
            });
            summary += "\n💰 *Total:* " + formatRupiah(total);
            return { handled: true, responseMessage: summary };
        }
        return {
            handled: true,
            responseMessage: "❓ Perintah tidak dikenal. Ketik `/help` untuk melihat daftar perintah.",
        };
    }
}
//# sourceMappingURL=command.handler.js.map