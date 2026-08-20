import { TransactionRecord, TransactionItem } from "../../db/repositories/transaction.repository.js";
import { UserRecord } from "../../db/repositories/user.repository.js";

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTransactionSuccess(
  trx: TransactionRecord,
  items: TransactionItem[] = []
): string {
  let reply = "✅ *Transaksi Berhasil Dicatat!*\n\n";
  reply += "🏪 *Tempat / Toko:* " + trx.merchant + "\n";
  reply += "💰 *Total Pengeluaran:* *" + formatRupiah(trx.total_amount) + "*\n";
  reply += "🏷️ *Kategori:* " + trx.category + "\n";
  reply += "📅 *Tanggal:* " + trx.date + "\n";
  if (trx.payment_method) {
    reply += "💳 *Metode Bayar:* " + trx.payment_method + "\n";
  }

  if (items && items.length > 0) {
    reply += "\n📋 *Rincian Barang:*\n";
    items.forEach((it) => {
      const qtyStr = (it.qty && it.qty > 1) ? " (" + it.qty + "x)" : "";
      reply += " • " + it.item_name + qtyStr + " - " + formatRupiah(it.price) + "\n";
    });
  }

  if (trx.gdrive_web_view_link) {
    reply += "\n🔗 *Bukti Struk (Google Drive):*\n" + trx.gdrive_web_view_link + "\n";
  }

  reply += "\n📊 *Data telah otomatis tersimpan di Google Sheet Anda.*";
  return reply;
}

export function formatPendingApprovalNotification(phone: string, pushName: string = "User"): string {
  let msg = "⚠️ *PERMINTAAN AKSES BOT BARU*\n\n";
  msg += "Ada nomor baru yang mencoba mengakses bot:\n";
  msg += "📱 *Nomor:* `" + phone + "`\n";
  msg += "👤 *Nama WhatsApp:* " + pushName + "\n\n";
  msg += "Untuk mengizinkan, balas dengan perintah:\n";
  msg += "*`/tambah " + phone + " [NamaUser]`*\n";
  msg += "Atau ketik *`/blokir " + phone + "`* untuk menolak.";
  return msg;
}

export function formatUserList(users: UserRecord[]): string {
  // Filter out internal WhatsApp LID identifiers so only human phone numbers are shown
  const visibleUsers = users.filter((u) => !u.phone_number.startsWith("232") && u.phone_number.length <= 14);
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

export function formatHelpMessage(isSuperAdmin: boolean): string {
  let msg = "🤖 *PANDUAN PENGGUNAAN BOT KEUANGAN*\n\n";
  msg += "Anda dapat mencatat pengeluaran dengan 3 cara mudah:\n";
  msg += "1. 📸 *Kirim Foto Struk Belanja / File Dokumen PDF Invoice*\n";
  msg += "2. 🎙️ *Kirim Voice Note WhatsApp* (contoh: \"Beli bensin 50rb di Pertamina barusan\")\n";
  msg += "3. 💬 *Kirim Pesan Teks Bebas* (contoh: \"Makan siang warteg 25k\")\n";
  msg += "4. ✏️ *Ganti Nama Penginput*: Ketik `/nama [Nama Anda]` (contoh: `/nama Ayah`)\n";
  msg += "5. 🔗 *Buka Spreadsheet & Drive*: Ketik `/link` (atau `/sheet`)\n\n";

  if (isSuperAdmin) {
    msg += "👑 *Menu Khusus Super Admin:*\n";
    msg += "• `/detail <ID_TRX>` - Melihat rincian lengkap transaksi & barang\n";
    msg += "• `/edit <ID_TRX> [koreksi]` - Mengedit data transaksi (toko, nominal, tanggal, kategori, dll)\n";
    msg += "• `/laporan [YYYY-MM]` - Ringkasan pengeluaran bulanan & persentase kategori\n";
    msg += "• `/batal` - Membatalkan / menghapus transaksi terakhir yang baru dicatat\n";
    msg += "• `/hapus <ID_TRX>` - Menghapus transaksi spesifik (contoh: `/hapus TRX-20260820-LX8Y`)\n";
    msg += "• `/tambah <nomor> [nama]` - Mendaftarkan/mengaktifkan akses anggota baru\n";
    msg += "• `/blokir <nomor>` - Memblokir akses nomor tertentu\n";
    msg += "• `/pengguna` - Melihat seluruh daftar anggota aktif\n";
    msg += "• `/peran <nomor> <super_admin|member>` - Mengubah hak akses anggota\n";
    msg += "• `/rekap [jumlah]` - Melihat riwayat transaksi + ID transaksi (contoh: `/rekap 5`)\n";
  }

  return msg;
}

export function formatTransactionDetail(trx: TransactionRecord, items: TransactionItem[] = []): string {
  let msg = "🔍 *DETAIL LENGKAP TRANSAKSI*\n\n";
  msg += "🧾 *ID Transaksi:* `" + trx.id + "`\n";
  msg += "📅 *Tanggal Transaksi:* " + trx.date + "\n";
  msg += "⏰ *Waktu Input:* " + (trx.created_at ? new Date(trx.created_at).toLocaleString("id-ID", { timeZone: "Asia/Makassar" }) : "-") + " WITA\n";
  msg += "👤 *Nama Penginput:* " + trx.user_name + " (`+" + trx.user_phone + "`)\n";
  msg += "🏪 *Merchant / Tempat:* *" + trx.merchant + "*\n";
  msg += "🏷️ *Kategori:* " + trx.category + "\n";
  msg += "💳 *Metode Pembayaran:* " + (trx.payment_method || "Cash") + "\n";
  msg += "📌 *Status Verifikasi:* " + (trx.status || "recorded") + "\n";
  if (trx.raw_text && trx.raw_text !== "-") {
    msg += "📝 *Catatan / Teks:* _" + trx.raw_text + "_\n";
  }

  if (items && items.length > 0) {
    msg += "\n📋 *Rincian Barang (" + items.length + " item):*\n";
    items.forEach((it, i) => {
      const qty = it.qty || 1;
      const price = Number(it.price) || 0;
      const subtotal = price * qty;
      msg += " " + (i + 1) + ". " + it.item_name + " (" + qty + "x @" + formatRupiah(price) + ") -> *" + formatRupiah(subtotal) + "*\n";
    });
  }

  msg += "\n💰 *Rincian Pembayaran:*\n";
  if (trx.subtotal && trx.subtotal !== trx.total_amount) {
    msg += " • Subtotal: " + formatRupiah(trx.subtotal) + "\n";
  }
  if (trx.tax && trx.tax > 0) {
    msg += " • Pajak / PB1: " + formatRupiah(trx.tax) + "\n";
  }
  if (trx.discount && trx.discount > 0) {
    msg += " • Diskon: -" + formatRupiah(trx.discount) + "\n";
  }
  msg += " • *Total Akhir:* *" + formatRupiah(trx.total_amount) + "*\n";

  if (trx.gdrive_web_view_link) {
    msg += "\n📁 *Foto Bukti / Struk:* \n" + trx.gdrive_web_view_link + "\n";
  }

  return msg;
}

export function formatTransactionUpdated(trx: TransactionRecord, updatedFields: string[]): string {
  let msg = "✏️ *TRANSAKSI BERHASIL DIPERBARUI!*\n\n";
  msg += "🧾 *ID:* `" + trx.id + "`\n";
  msg += "📅 *Tanggal:* " + trx.date + "\n";
  msg += "🏪 *Merchant:* *" + trx.merchant + "*\n";
  msg += "🏷️ *Kategori:* " + trx.category + "\n";
  msg += "💰 *Total Akhir:* *" + formatRupiah(trx.total_amount) + "*\n";
  msg += "💳 *Metode Bayar:* " + (trx.payment_method || "Cash") + "\n";
  msg += "👤 *Penginput:* " + trx.user_name + "\n\n";

  if (updatedFields.length > 0) {
    msg += "🔄 *Kolom yang diubah:* " + updatedFields.join(", ") + "\n";
  }
  msg += "✅ Data telah diperbarui di Database Supabase & Google Sheets!";
  return msg;
}

export function formatDeletedTransaction(trx: TransactionRecord): string {
  let msg = "🗑️ *TRANSAKSI BERHASIL DIHAPUS / DIBATALKAN*\n\n";
  msg += "🧾 *ID:* `" + trx.id + "`\n";
  msg += "📅 *Tanggal:* " + trx.date + "\n";
  msg += "🏪 *Merchant:* " + trx.merchant + "\n";
  msg += "💰 *Nominal:* *" + formatRupiah(trx.total_amount) + "*\n";
  msg += "👤 *Penginput:* " + trx.user_name + "\n\n";
  msg += "✅ Data telah dihapus dari Supabase & Google Sheets.";
  return msg;
}

export function formatMonthlyReport(
  summary: {
    total: number;
    count: number;
    byCategory: { [cat: string]: number };
    byUser: { [user: string]: number };
    topTransactions: TransactionRecord[];
  },
  monthLabel: string
): string {
  if (summary.count === 0) {
    return "📊 *LAPORAN KEUANGAN (" + monthLabel + ")*\n\nℹ️ Belum ada transaksi yang tercatat pada periode ini.";
  }

  let msg = "📊 *LAPORAN KEUANGAN (" + monthLabel + ")*\n\n";
  msg += "💰 *Total Pengeluaran:* *" + formatRupiah(summary.total) + "*\n";
  msg += "🧾 *Total Transaksi:* *" + summary.count + " transaksi*\n\n";

  msg += "🏷️ *Rincian per Kategori:*\n";
  const sortedCategories = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
  sortedCategories.forEach(([cat, amount]) => {
    const percentage = summary.total > 0 ? Math.round((amount / summary.total) * 100) : 0;
    msg += " • *" + cat + "*: " + formatRupiah(amount) + " (" + percentage + "%)\n";
  });

  msg += "\n👥 *Rincian per Penginput:*\n";
  const sortedUsers = Object.entries(summary.byUser).sort((a, b) => b[1] - a[1]);
  sortedUsers.forEach(([user, amount]) => {
    msg += " • *" + user + "*: " + formatRupiah(amount) + "\n";
  });

  if (summary.topTransactions && summary.topTransactions.length > 0) {
    msg += "\n🔥 *Top Pengeluaran Terbesar:*\n";
    summary.topTransactions.forEach((t, i) => {
      msg += " " + (i + 1) + ". " + t.merchant + " (" + t.date + ") -> *" + formatRupiah(t.total_amount) + "*\n";
    });
  }

  return msg;
}
