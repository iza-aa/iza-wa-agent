export function formatRupiah(amount) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(amount);
}
export function formatTransactionSuccess(trx, items = []) {
    let reply = "✅ *TRANSAKSI BERHASIL DICATAT*\n\n";
    reply += "🧾 *ID:* `" + trx.id + "`\n";
    reply += "📅 *Tanggal:* " + trx.date + "\n";
    reply += "🏪 *Merchant / Toko:* " + trx.merchant + "\n";
    reply += "🏷️ *Kategori:* " + trx.category + "\n";
    reply += "💳 *Metode Bayar:* " + (trx.payment_method || "Cash") + "\n";
    reply += "💰 *Total Akhir:* *" + formatRupiah(trx.total_amount) + "*\n";
    if (items && items.length > 0) {
        reply += "\n📋 *Rincian Barang (" + items.length + " item):*\n";
        items.forEach((it, idx) => {
            reply += " " + (idx + 1) + ". " + it.item_name + " (" + (it.qty || 1) + "x) -> " + formatRupiah(it.price) + "\n";
        });
    }
    if (trx.gdrive_web_view_link) {
        reply += "\n📁 *Link Bukti Foto (Drive):*\n" + trx.gdrive_web_view_link + "\n";
    }
    reply += "\n📊 *Tercatat di Supabase & Google Sheet!*";
    return reply;
}
export function formatPendingApprovalNotification(phone, pushName = "User") {
    let msg = "⚠️ *PERMINTAAN AKSES BOT BARU*\n\n";
    msg += "Ada nomor baru yang mencoba mengakses bot:\n";
    msg += "📱 *Nomor:* `" + phone + "`\n";
    msg += "👤 *Nama WhatsApp:* " + pushName + "\n\n";
    msg += "Untuk mengizinkan, balas dengan perintah:\n";
    msg += "*`/approve " + phone + " [NamaUser]`*\n";
    msg += "Atau ketik *`/block " + phone + "`* untuk menolak.";
    return msg;
}
export function formatUserList(users) {
    // Filter out internal WhatsApp LID identifiers so only human phone numbers are shown
    const visibleUsers = users.filter((u) => !u.phone_number.startsWith("232") && u.phone_number.length <= 14);
    const displayList = visibleUsers.length > 0 ? visibleUsers : users;
    if (displayList.length === 0) {
        return "ℹ️ Belum ada user aktif yang terdaftar.";
    }
    let msg = "👥 *DAFTAR USER TERDAFTAR (" + displayList.length + ")*\n\n";
    displayList.forEach((u, i) => {
        msg += (i + 1) + ". *" + u.name + "* (`+" + u.phone_number + "`) - [" + u.role.toUpperCase() + "] - " + u.status + "\n";
    });
    return msg;
}
export function formatHelpMessage(isSuperAdmin) {
    let msg = "🤖 *PANDUAN PENGGUNAAN BOT KEUANGAN*\n\n";
    msg += "Anda dapat mencatat pengeluaran dengan 3 cara mudah:\n";
    msg += "1. 📸 *Kirim Foto Struk Belanja / Bukti Transfer*\n";
    msg += "2. 🎙️ *Kirim Voice Note WhatsApp* (contoh: \"Beli bensin 50rb di Pertamina barusan\")\n";
    msg += "3. 💬 *Kirim Pesan Teks Bebas* (contoh: \"Makan siang warteg 25k\")\n";
    msg += "4. ✏️ *Ganti Nama Penginput*: Ketik `/nama [Nama Anda]` (contoh: `/nama Ayah`)\n\n";
    if (isSuperAdmin) {
        msg += "👑 *Menu Khusus Super Admin:*\n";
        msg += "• `/approve <nomor> [nama]` - Mengaktifkan akses nomor baru\n";
        msg += "• `/block <nomor>` - Memblokir akses nomor\n";
        msg += "• `/users` - Melihat seluruh daftar pengguna aktif\n";
        msg += "• `/rekap` - Melihat rekap pengeluaran\n";
    }
    return msg;
}
//# sourceMappingURL=reply.formatter.js.map