import { isIncome } from "../../db/repositories/transaction.repository.js";
export function formatRupiah(amount) {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
    }).format(amount);
}
export function formatTransactionSuccess(trx, items = [], isSuperAdmin = false, currentBalance) {
    const isInc = isIncome(trx);
    let reply = isInc
        ? "🟢 *Pemasukan Berhasil Dicatat!*\n\n"
        : "🔴 *Pengeluaran Berhasil Dicatat!*\n\n";
    reply += (isInc ? "💵 *Sumber / Penerimaan:* " : "🏪 *Tempat / Toko:* ") + trx.merchant + "\n";
    reply += "💰 *Nominal:* *" + (isInc ? "+" : "-") + formatRupiah(trx.total_amount) + "*\n";
    reply += "🏷️ *Kategori:* " + trx.category + "\n";
    reply += "📅 *Tanggal:* " + trx.date + "\n";
    if (trx.payment_method) {
        reply += "💳 *Metode Bayar:* " + trx.payment_method + "\n";
    }
    reply += "👤 *Penginput:* " + trx.user_name + "\n";
    if (items && items.length > 0) {
        reply += "\n📋 *Rincian:* \n";
        items.forEach((it) => {
            const qtyStr = (it.qty && it.qty > 1) ? " (" + it.qty + "x)" : "";
            reply += " • " + it.item_name + qtyStr + " - " + formatRupiah(it.price) + "\n";
        });
    }
    if (currentBalance !== undefined) {
        reply += "\n💵 *Sisa Saldo Kas Dompet:* *" + formatRupiah(currentBalance) + "*\n";
    }
    // Google Drive proof link is strictly for Super Admin
    if (isSuperAdmin && trx.gdrive_web_view_link) {
        reply += "\n🔗 *Bukti Dokumen (Google Drive):*\n" + trx.gdrive_web_view_link + "\n";
    }
    if (isSuperAdmin) {
        reply += "\n📊 *Data telah otomatis tersimpan di Google Sheet & Dasbor.*";
    }
    else {
        reply += "\n✅ *Data telah berhasil tersimpan ke sistem.*";
    }
    return reply;
}
export function formatWalletBalance(wallet) {
    let msg = "💳 *STATUS DOMPET & SALDO KAS*\n\n";
    msg += "💰 *Total Pemasukan:* " + formatRupiah(wallet.totalIncome) + "\n";
    msg += "💸 *Total Pengeluaran:* " + formatRupiah(wallet.totalExpense) + "\n";
    msg += "────────────────────────\n";
    msg += "💵 *SISA SALDO KAS SAAT INI:* *" + formatRupiah(wallet.balance) + "*\n\n";
    msg += "📅 *Arus Kas Bulan Ini (" + wallet.currentMonth + "):*\n";
    msg += " 🟢 Pemasukan: " + formatRupiah(wallet.monthIncome) + "\n";
    msg += " 🔴 Pengeluaran: " + formatRupiah(wallet.monthExpense) + "\n";
    const netSign = wallet.monthBalance >= 0 ? "+" : "";
    msg += " 🏦 Saldo Bersih Bulan Ini: *" + netSign + formatRupiah(wallet.monthBalance) + "*\n\n";
    msg += "💡 _Ketik `/pemasukan <nominal> <keterangan>` untuk menambah pemasukan baru._";
    return msg;
}
export function formatPendingApprovalNotification(phone, pushName = "User") {
    let msg = "🔔 *PERMINTAAN AKSES PENGGUNA BARU*\n\n";
    msg += "Ada pengguna baru yang mengirim pesan ke bot:\n";
    msg += "👤 *Nama WhatsApp:* " + pushName + "\n";
    msg += "📱 *ID / Nomor:* `" + phone + "`\n\n";
    msg += "👉 *Untuk mengizinkan sebagai Anggota:*\n";
    msg += "`/tambah " + phone + " " + pushName + "`\n\n";
    msg += "👉 *Untuk mengizinkan sebagai Super Admin:*\n";
    msg += "`/tambah " + phone + " " + pushName + " super_admin`\n\n";
    msg += "🚫 *Untuk menolak / memblokir:*\n";
    msg += "`/blokir " + phone + "`";
    return msg;
}
export function formatUserList(users) {
    // Filter out internal WhatsApp LID identifiers so only human phone numbers are shown
    const visibleUsers = users.filter((u) => u.phone_number.length <= 14);
    const displayList = visibleUsers.length > 0 ? visibleUsers : users;
    if (displayList.length === 0) {
        return "ℹ️ Belum ada user aktif yang terdaftar.";
    }
    let msg = "👥 *DAFTAR PENGGUNA TERDAFTAR (" + displayList.length + ")*\n\n";
    displayList.forEach((u, i) => {
        const roleLabel = u.role === "super_admin" ? "SUPER_ADMIN" : "ANGGOTA";
        msg += (i + 1) + ". *" + u.name + "* (`+" + u.phone_number + "`) - [" + roleLabel + "] - " + u.status + "\n";
    });
    return msg;
}
export function formatHelpMessage(isSuperAdmin) {
    let msg = "🤖 *PANDUAN PENGGUNAAN BOT KEUANGAN & DOMPET*\n\n";
    msg += "Anda dapat mencatat pengeluaran & pemasukan dengan mudah:\n";
    msg += "1. 📸 *Kirim Foto Struk / Bukti Transfer*\n";
    msg += "2. 🎙️ *Kirim Voice Note WA* (contoh: \"Beli bensin 50rb di Pertamina\")\n";
    msg += "3. 💬 *Kirim Pesan Teks Bebas* (contoh: \"Makan siang 25k\" atau \"Pemasukan 5jt gaji\")\n";
    msg += "4. 💵 *Catat Pemasukan Cepat*: Ketik `/pemasukan <nominal> <keterangan>`\n";
    msg += "5. 💳 *Cek Saldo Kas Dompet*: Ketik `/saldo` (atau `/dompet`)\n";
    msg += "6. ✏️ *Ganti Nama Penginput*: Ketik `/nama [Nama Anda]` (contoh: `/nama Ayah`)\n\n";
    if (isSuperAdmin) {
        msg += "🔗 *Buka Spreadsheet & Drive*: Ketik `/link` (atau `/sheet`)\n\n";
        msg += "👑 *Menu Khusus Super Admin:*\n";
        msg += "• `/saldo` - Melihat status kas, pemasukan, pengeluaran & sisa saldo\n";
        msg += "• `/pemasukan <nominal> <keterangan>` - Mencatat pemasukan dana baru\n";
        msg += "• `/detail <ID_TRX>` - Melihat rincian lengkap transaksi & barang\n";
        msg += "• `/edit <ID_TRX> [koreksi]` - Mengedit data transaksi (toko, nominal, tanggal, dll)\n";
        msg += "• `/laporan [YYYY-MM]` - Laporan arus kas bulanan & persentase kategori\n";
        msg += "• `/rekap [jumlah]` - Riwayat transaksi terakhir beserta ID transaksi\n";
        msg += "• `/batal` - Membatalkan transaksi terakhir yang baru dicatat\n";
        msg += "• `/hapus <ID_TRX>` - Menghapus transaksi spesifik (contoh: `/hapus TRX-20260820-LX8Y`)\n";
        msg += "• `/tambah <nomor> [nama]` - Mendaftarkan anggota baru\n";
        msg += "• `/blokir <nomor>` - Memblokir akses nomor tertentu\n";
        msg += "• `/pengguna` - Melihat daftar anggota aktif\n";
        msg += "• `/peran <nomor> <super_admin|member>` - Mengubah hak akses anggota\n";
    }
    else {
        msg += "💡 _Seluruh transaksi yang Anda kirimkan akan otomatis dicatat rapi ke sistem dompet keuangan._";
    }
    return msg;
}
export function formatTransactionDetail(trx, items = []) {
    const isInc = isIncome(trx);
    let msg = isInc ? "🔍 *DETAIL PEMASUKAN KAS*\n\n" : "🔍 *DETAIL PENGELUARAN*\n\n";
    msg += "🧾 *ID Transaksi:* `" + trx.id + "`\n";
    msg += "📌 *Tipe:* " + (isInc ? "🟢 Pemasukan" : "🔴 Pengeluaran") + "\n";
    msg += "📅 *Tanggal Transaksi:* " + trx.date + "\n";
    msg += "⏰ *Waktu Input:* " + (trx.created_at ? new Date(trx.created_at).toLocaleString("id-ID", { timeZone: "Asia/Makassar" }) : "-") + " WITA\n";
    msg += "👤 *Nama Penginput:* " + trx.user_name + " (`+" + trx.user_phone + "`)\n";
    msg += (isInc ? "💵 *Sumber / Pengirim:* *" : "🏪 *Merchant / Tempat:* *") + trx.merchant + "*\n";
    msg += "🏷️ *Kategori:* " + trx.category + "\n";
    msg += "💳 *Metode Pembayaran:* " + (trx.payment_method || "-") + "\n";
    msg += "💰 *Nominal:* *" + (isInc ? "+" : "-") + formatRupiah(trx.total_amount) + "*\n";
    if (trx.raw_text && trx.raw_text !== "-") {
        msg += "📝 *Catatan / Teks:* _" + trx.raw_text + "_\n";
    }
    if (items && items.length > 0) {
        msg += "\n📋 *Rincian Barang / Keterangan (" + items.length + " item):*\n";
        items.forEach((it, i) => {
            const qty = it.qty || 1;
            const price = Number(it.price) || 0;
            const subtotal = price * qty;
            msg += " " + (i + 1) + ". " + it.item_name + " (" + qty + "x @" + formatRupiah(price) + ") -> *" + formatRupiah(subtotal) + "*\n";
        });
    }
    if (trx.gdrive_web_view_link) {
        msg += "\n📁 *Foto Bukti / Struk:* \n" + trx.gdrive_web_view_link + "\n";
    }
    return msg;
}
export function formatTransactionUpdated(trx, updatedFields) {
    const isInc = isIncome(trx);
    let msg = "✏️ *TRANSAKSI BERHASIL DIPERBARUI!*\n\n";
    msg += "🧾 *ID:* `" + trx.id + "`\n";
    msg += "📌 *Tipe:* " + (isInc ? "🟢 Pemasukan" : "🔴 Pengeluaran") + "\n";
    msg += "📅 *Tanggal:* " + trx.date + "\n";
    msg += (isInc ? "💵 *Sumber:* *" : "🏪 *Merchant:* *") + trx.merchant + "*\n";
    msg += "🏷️ *Kategori:* " + trx.category + "\n";
    msg += "💰 *Total Akhir:* *" + formatRupiah(trx.total_amount) + "*\n";
    msg += "👤 *Penginput:* " + trx.user_name + "\n\n";
    if (updatedFields.length > 0) {
        msg += "🔄 *Kolom yang diubah:* " + updatedFields.join(", ") + "\n";
    }
    msg += "✅ Data telah diperbarui di Database Supabase & Google Sheets!";
    return msg;
}
export function formatDeletedTransaction(trx) {
    let msg = "🗑️ *TRANSAKSI BERHASIL DIHAPUS / DIBATALKAN*\n\n";
    msg += "🧾 *ID:* `" + trx.id + "`\n";
    msg += "📅 *Tanggal:* " + trx.date + "\n";
    msg += "🏪 *Tempat / Sumber:* " + trx.merchant + "\n";
    msg += "💰 *Nominal:* *" + formatRupiah(trx.total_amount) + "*\n";
    msg += "👤 *Penginput:* " + trx.user_name + "\n\n";
    msg += "✅ Data telah dihapus dari Supabase & Google Sheets.";
    return msg;
}
export function formatMonthlyReport(summary, monthLabel) {
    if (summary.count === 0) {
        return "📊 *LAPORAN ARUS KAS (" + monthLabel + ")*\n\nℹ️ Belum ada transaksi yang tercatat pada periode ini.";
    }
    const inc = summary.totalIncome || 0;
    const exp = summary.totalExpense !== undefined ? summary.totalExpense : summary.total;
    const net = summary.netCashflow !== undefined ? summary.netCashflow : inc - exp;
    let msg = "📊 *LAPORAN ARUS KAS DOMPET (" + monthLabel + ")*\n\n";
    msg += "🟢 *Total Pemasukan:* *" + formatRupiah(inc) + "*\n";
    msg += "🔴 *Total Pengeluaran:* *" + formatRupiah(exp) + "*\n";
    msg += "────────────────────────\n";
    const netSign = net >= 0 ? "+" : "";
    msg += "🏦 *Arus Kas Bersih:* *" + netSign + formatRupiah(net) + "*\n";
    msg += "🧾 *Total Transaksi:* *" + summary.count + " transaksi*\n\n";
    if (Object.keys(summary.byCategory).length > 0) {
        msg += "🏷️ *Pengeluaran per Kategori:*\n";
        const sortedCategories = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
        sortedCategories.forEach(([cat, amount]) => {
            const percentage = exp > 0 ? Math.round((amount / exp) * 100) : 0;
            msg += " • *" + cat + "*: " + formatRupiah(amount) + " (" + percentage + "%)\n";
        });
    }
    if (Object.keys(summary.byUser).length > 0) {
        msg += "\n👥 *Rincian per Penginput:*\n";
        const sortedUsers = Object.entries(summary.byUser).sort((a, b) => b[1] - a[1]);
        sortedUsers.forEach(([user, amount]) => {
            msg += " • *" + user + "*: " + formatRupiah(amount) + "\n";
        });
    }
    if (summary.topTransactions && summary.topTransactions.length > 0) {
        msg += "\n🔥 *Top Pengeluaran Terbesar:*\n";
        summary.topTransactions.forEach((t, i) => {
            msg += " " + (i + 1) + ". " + t.merchant + " (" + t.date + ") -> *" + formatRupiah(t.total_amount) + "*\n";
        });
    }
    return msg;
}
//# sourceMappingURL=reply.formatter.js.map