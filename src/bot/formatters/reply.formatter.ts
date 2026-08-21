import { TransactionRecord, TransactionItem, isIncome } from "../../db/repositories/transaction.repository.js";
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
  items: TransactionItem[] = [],
  isSuperAdmin: boolean = false,
  currentBalance?: number
): string {
  const isInc = isIncome(trx);
  let reply = isInc
    ? "🟢 *Pemasukan Berhasil Dicatat!*\n\n"
    : "🔴 *Pengeluaran Berhasil Dicatat!*\n\n";

  const shortCode = trx.id.includes("-") ? trx.id.split("-").slice(1).join("") : trx.id;
  reply += "🧾 *ID:* `" + trx.id + "`\n";
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

  reply += "\n💡 _Untuk membatalkan, ketik: `/hapus " + shortCode + "`_";
  return reply;
}

export function formatWalletBalance(wallet: {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  monthIncome: number;
  monthExpense: number;
  monthBalance: number;
  currentMonth: string;
}): string {
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
  msg += "💡 _Ketik `/saldo detail` untuk melihat rincian saldo per bank/kas fisik._\n_Ketik `/pemasukan <nominal> <keterangan> [metode]` untuk tambah saldo._";
  return msg;
}

export function formatMultiPocketBalance(
  multiWallet: {
    totalBalance: number;
    totalIncome: number;
    totalExpense: number;
    pockets: { [method: string]: { income: number; expense: number; balance: number } };
  },
  specificPocket?: string
): string {
  if (specificPocket) {
    const key = Object.keys(multiWallet.pockets).find(
      (k) => k.toLowerCase() === specificPocket.toLowerCase()
    );
    const pocketData = key ? multiWallet.pockets[key] : null;

    if (!pocketData) {
      return `ℹ️ Kantong / Metode bayar *${specificPocket}* belum memiliki riwayat transaksi.\n\nKetik \`/saldo\` untuk melihat seluruh kantong kas.`;
    }

    let msg = `🏦 *STATUS SALDO: ${key?.toUpperCase()}*\n\n`;
    msg += `🟢 Pemasukan: ${formatRupiah(pocketData.income)}\n`;
    msg += `🔴 Pengeluaran: ${formatRupiah(pocketData.expense)}\n`;
    msg += `────────────────────────\n`;
    msg += `💵 *Sisa Saldo ${key}:* *${formatRupiah(pocketData.balance)}*\n`;
    return msg;
  }

  let msg = "💳 *RINCIAN SALDO PER KAS & BANK*\n\n";
  const pocketKeys = Object.keys(multiWallet.pockets);

  if (pocketKeys.length === 0) {
    msg += "ℹ️ Belum ada data saldo per kantong.\n";
  } else {
    // Sort Cash first, then banks
    const sortedKeys = [...pocketKeys].sort((a, b) => {
      if (a.toLowerCase() === "cash" || a.toLowerCase() === "tunai") return -1;
      if (b.toLowerCase() === "cash" || b.toLowerCase() === "tunai") return 1;
      return a.localeCompare(b);
    });

    for (const p of sortedKeys) {
      const pData = multiWallet.pockets[p];
      const icon = (p.toLowerCase().includes("cash") || p.toLowerCase().includes("tunai"))
        ? "💵"
        : (p.toLowerCase().includes("qris") || p.toLowerCase().includes("gopay") || p.toLowerCase().includes("ovo") || p.toLowerCase().includes("dana"))
        ? "📱"
        : "🏦";
      msg += `${icon} *${p}:* *${formatRupiah(pData.balance)}*\n`;
    }
  }

  msg += "────────────────────────\n";
  msg += `💰 *TOTAL SELURUH KAS:* *${formatRupiah(multiWallet.totalBalance)}*\n\n`;
  msg += "💡 *Tips:* Ketik `/saldo mandiri` atau `/saldo bca` untuk cek spesifik.\nKetik `/transfer bca cash 500000 Tarik Tunai` untuk mutasi kas.";
  return msg;
}

export function formatDailyRecap(
  dailySummary: {
    date: string;
    count: number;
    totalIncome: number;
    totalExpense: number;
    netCashflow: number;
    transactions: TransactionRecord[];
  },
  wallet: { balance: number }
): string {
  const [y, m, d] = dailySummary.date.split("-");
  const formattedDate = `${d}/${m}/${y}`;

  let msg = `🌙 *REKAP KAS MALAM INI (${formattedDate})*\n\n`;

  if (dailySummary.count === 0) {
    msg += "ℹ️ _Tidak ada transaksi yang tercatat hari ini._\n\n";
    msg += `💵 *Sisa Saldo Kas Dompet Saat Ini:* *${formatRupiah(wallet.balance)}*\n\n`;
    msg += "💡 _Laporan harian otomatis dikirim setiap pukul 20.00 WITA._";
    return msg;
  }

  msg += `🟢 *Pemasukan Hari Ini:* *${formatRupiah(dailySummary.totalIncome)}*\n`;
  msg += `🔴 *Pengeluaran Hari Ini:* *${formatRupiah(dailySummary.totalExpense)}*\n`;
  const netSign = dailySummary.netCashflow >= 0 ? "+" : "";
  msg += `🏦 *Arus Kas Bersih Hari Ini:* *${netSign}${formatRupiah(dailySummary.netCashflow)}*\n`;
  msg += `────────────────────────\n`;
  msg += `💵 *SISA SALDO KAS DOMPET:* *${formatRupiah(wallet.balance)}*\n\n`;

  msg += `📋 *Rincian Transaksi Hari Ini (${dailySummary.count} transaksi):*\n`;
  dailySummary.transactions.slice(0, 15).forEach((t, i) => {
    const isInc = isIncome(t);
    const sign = isInc ? "🟢" : "🔴";
    const method = t.payment_method ? ` (${t.payment_method})` : "";
    msg += ` ${i + 1}. ${sign} *${t.merchant}*${method}: ${formatRupiah(t.total_amount)}\n`;
  });

  if (dailySummary.transactions.length > 15) {
    msg += ` _...dan ${dailySummary.transactions.length - 15} transaksi lainnya._\n`;
  }

  msg += "\n💡 _Laporan harian otomatis dikirim setiap pukul 20.00 WITA._";
  return msg;
}

export function formatDuplicateWarning(
  existingTrx: TransactionRecord,
  amount: number,
  merchant: string
): string {
  const isInc = isIncome(existingTrx);
  let msg = "⚠️ *PERINGATAN TRANSAKSI KEMBAR / SERUPA*\n\n";
  msg += `Sistem mendeteksi transaksi ini sama persis dengan transaksi yang baru saja dicatat:\n`;
  msg += `🧾 *ID Transaksi:* \`${existingTrx.id}\`\n`;
  msg += `🏪 *Tempat / Sumber:* ${existingTrx.merchant}\n`;
  msg += `💰 *Nominal:* *${formatRupiah(existingTrx.total_amount)}*\n`;
  msg += `📅 *Tanggal:* ${existingTrx.date}\n`;
  msg += `👤 *Penginput:* ${existingTrx.user_name}\n\n`;
  msg += `✅ *Transaksi ini tetap berhasil disimpan.*\n`;
  msg += `💡 _Jika ini transaksi ganda yang tidak sengaja terinput, Anda bisa membatalkannya dengan ketik:_ \`/hapus ${existingTrx.id.includes("-") ? existingTrx.id.split("-").slice(1).join("") : existingTrx.id}\``;
  return msg;
}

export function formatTransferSuccess(
  fromPocket: string,
  toPocket: string,
  amount: number,
  notes: string,
  totalBalance: number
): string {
  let msg = "🔄 *MUTASI KAS BERHASIL DICATAT!*\n\n";
  msg += `📤 *Dari:* ${fromPocket}\n`;
  msg += `📥 *Ke:* ${toPocket}\n`;
  msg += `💰 *Nominal:* *${formatRupiah(amount)}*\n`;
  if (notes) {
    msg += `📝 *Keterangan:* ${notes}\n`;
  }
  msg += `────────────────────────\n`;
  msg += `💵 *Total Sisa Saldo Kas:* *${formatRupiah(totalBalance)}*\n\n`;
  msg += `💡 _Saldo ${fromPocket} telah berkurang dan saldo ${toPocket} telah bertambah._`;
  return msg;
}

export function formatPendingApprovalNotification(phone: string, pushName: string = "User"): string {
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

export function formatUserList(users: UserRecord[]): string {
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

export function formatHelpMessage(isSuperAdmin: boolean): string {
  let msg = "🤖 *PANDUAN PENGGUNAAN BOT KEUANGAN & DOMPET*\n\n";
  msg += "Anda dapat mencatat pengeluaran & pemasukan dengan mudah:\n";
  msg += "1. 📸 *Kirim Foto Struk / Bukti Transfer*\n";
  msg += "2. 🎙️ *Kirim Voice Note WA* (contoh: \"Beli bensin 50rb di Pertamina\")\n";
  msg += "3. 💬 *Kirim Pesan Teks Bebas* (contoh: \"Makan siang 25k\" atau \"Pemasukan 5jt gaji\")\n";
  msg += "4. 💵 *Catat Pemasukan Cepat*: Ketik `/pemasukan <nominal> <keterangan> [metode]` (contoh: `/pemasukan 100000 sumbangan BCA`)\n";
  msg += "5. 💳 *Cek Saldo Kas Dompet*: Ketik `/saldo` (atau `/dompet`)\n";
  msg += "6. ✏️ *Ganti Nama Penginput*: Ketik `/nama [Nama Anda]` (contoh: `/nama Budi`)\n";
  msg += "7. 🔄 *Sinkronkan Spreadsheet*: Ketik `/sync`\n\n";

  if (isSuperAdmin) {
    msg += "🔗 *Buka Spreadsheet & Drive*: Ketik `/link` (atau `/sheet`)\n\n";
    msg += "👑 *Menu Khusus Super Admin:*\n";
    msg += "• `/saldo` - Melihat status kas, pemasukan, pengeluaran & sisa saldo\n";
    msg += "• `/saldo detail` - Melihat rincian saldo per bank/kas fisik\n";
    msg += "• `/transfer <dari> <ke> <nominal>` - Mutasi kas antar kantong/bank\n";
    msg += "• `/pemasukan <nominal> <keterangan>` - Mencatat pemasukan dana baru\n";
    msg += "• `/export pdf [YYYY-MM]` - Download dokumen laporan resmi PDF\n";
    msg += "• `/budget [kategori] [nominal]` - Pantau batas anggaran & limit boros\n";
    msg += "• `/tagihan <tambah|daftar|bayar>` - Pengingat tagihan rutin bulanan\n";
    msg += "• `/rekapmalam` - Kirim rekap harian malam secara manual\n";
    msg += "• `/detail <ID_TRX>` - Melihat rincian lengkap transaksi & barang\n";
    msg += "• `/edit <ID_TRX> [koreksi]` - Mengedit data transaksi (toko, nominal, tanggal, dll)\n";
    msg += "• `/laporan [YYYY-MM]` - Laporan arus kas bulanan & persentase kategori\n";
    msg += "• `/rekap [jumlah]` - Riwayat transaksi terakhir beserta ID transaksi\n";
    msg += "• `/batal` - Membatalkan transaksi terakhir yang baru dicatat\n";
    msg += "• `/hapus <ID_TRX>` - Menghapus transaksi spesifik\n";
    msg += "• `/tambah <nomor> [nama]` - Mendaftarkan anggota baru\n";
    msg += "• `/blokir <nomor>` - Memblokir akses nomor tertentu\n";
    msg += "• `/pengguna` - Melihat daftar anggota aktif\n";
    msg += "• `/peran <nomor> <super_admin|member>` - Mengubah hak akses anggota\n";
  } else {
    msg += "💡 _Seluruh transaksi yang Anda kirimkan akan otomatis dicatat rapi ke sistem dompet keuangan._";
  }

  return msg;
}

export function formatTransactionDetail(trx: TransactionRecord, items: TransactionItem[] = []): string {
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

export function formatTransactionUpdated(trx: TransactionRecord, updatedFields: string[]): string {
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
  msg += "✅ Data telah diperbarui di sistem & Google Sheets!";
  return msg;
}

export function formatDeletedTransaction(trx: TransactionRecord): string {
  let msg = "🗑️ *TRANSAKSI BERHASIL DIHAPUS / DIBATALKAN*\n\n";
  msg += "🧾 *ID:* `" + trx.id + "`\n";
  msg += "📅 *Tanggal:* " + trx.date + "\n";
  msg += "🏪 *Tempat / Sumber:* " + trx.merchant + "\n";
  msg += "💰 *Nominal:* *" + formatRupiah(trx.total_amount) + "*\n";
  msg += "👤 *Penginput:* " + trx.user_name + "\n\n";
  msg += "✅ Data telah dihapus dari sistem & Google Sheets.";
  return msg;
}

export function formatMonthlyReport(
  summary: {
    total: number;
    totalExpense?: number;
    totalIncome?: number;
    netCashflow?: number;
    count: number;
    byCategory: { [cat: string]: number };
    byUser: { [user: string]: number };
    topTransactions: TransactionRecord[];
  },
  monthLabel: string
): string {
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

export function formatBudgetList(
  budgets: { category: string; limit_amount: number }[],
  expensesByCategory: { [cat: string]: number },
  monthStr: string
): string {
  if (budgets.length === 0) {
    return `📊 *STATUS BATAS ANGGARAN (${monthStr})*\n\nℹ️ Belum ada anggaran bulanan yang disetel.\n\n💡 _Untuk menyetel anggaran kategori, ketik:_\n\`/budget <kategori> <nominal>\`\n_Contoh: \`/budget Operasional 4000000\`_`;
  }

  let msg = `📊 *STATUS BATAS ANGGARAN (${monthStr})*\n\n`;

  for (const b of budgets) {
    const matchedKey = Object.keys(expensesByCategory).find(
      (k) => k.toLowerCase().includes(b.category.toLowerCase()) || b.category.toLowerCase().includes(k.toLowerCase())
    );
    const spent = matchedKey ? expensesByCategory[matchedKey] : 0;
    const percent = b.limit_amount > 0 ? (spent / b.limit_amount) * 100 : 0;
    const remaining = b.limit_amount - spent;

    let statusEmoji = "✅ Aman";
    if (percent >= 100) statusEmoji = "🚨 OVER BUDGET!";
    else if (percent >= 80) statusEmoji = "⚠️ Mendekati Limit!";

    msg += `🏷️ *${b.category}:*\n`;
    msg += ` • Terpakai: *${formatRupiah(spent)}* (${percent.toFixed(1)}%)\n`;
    msg += ` • Batas Limit: ${formatRupiah(b.limit_amount)}\n`;
    msg += ` • Sisa Anggaran: *${remaining >= 0 ? formatRupiah(remaining) : "-" + formatRupiah(Math.abs(remaining))}* (${statusEmoji})\n\n`;
  }

  msg += `💡 _Ubah limit kapan saja dengan: \`/budget <kategori> <nominal>\`_\n_Hapus limit dengan: \`/budget hapus <kategori>\`_`;
  return msg.trim();
}

export function formatBudgetSetSuccess(category: string, amount: number, spent: number): string {
  const percent = amount > 0 ? ((spent / amount) * 100).toFixed(1) : "0";
  return `✅ *Batas Anggaran Berhasil Disetel!*\n\n🏷️ *Kategori:* ${category}\n💰 *Limit Bulanan:* *${formatRupiah(amount)}*\n📊 *Pengeluaran Saat Ini:* ${formatRupiah(spent)} (${percent}%)\n\n💡 _Bot akan otomatis mengingatkan saat belanja kategori ini mencapai 80% dan 100%._`;
}

export function formatBudgetWarning(category: string, currentExpense: number, limitAmount: number, percent: number): string {
  if (percent >= 100) {
    return `🚨 *PERINGATAN OVER BUDGET!*\nPengeluaran kategori *${category}* bulan ini telah mencapai *${formatRupiah(currentExpense)}* (Melebihi batas limit *${formatRupiah(limitAmount)}* / ${percent.toFixed(1)}%).`;
  }
  return `⚠️ *PERINGATAN ANGGARAN (80%)*\nPengeluaran kategori *${category}* bulan ini sudah mencapai *${formatRupiah(currentExpense)}* (${percent.toFixed(1)}% dari limit *${formatRupiah(limitAmount)}*).`;
}

export function formatBillList(
  bills: { bill_name: string; amount: number; due_day: number; category?: string; last_paid_period?: string }[],
  currentMonth: string
): string {
  if (bills.length === 0) {
    return `⏰ *DAFTAR TAGIHAN RUTIN BULANAN*\n\nℹ️ Belum ada tagihan rutin yang terdaftar.\n\n💡 _Untuk mendaftarkan tagihan baru, ketik:_\n\`/tagihan tambah <Nama_Tagihan> <Nominal> <Tgl_Jatuh_Tempo>\`\n_Contoh: \`/tagihan tambah Listrik Toko 750000 tgl 20\`_`;
  }

  let msg = `⏰ *DAFTAR TAGIHAN RUTIN BULANAN*\n\n`;

  for (const b of bills) {
    const isPaidThisMonth = b.last_paid_period === currentMonth;
    const statusText = isPaidThisMonth ? "✅ LUNAS" : "⏳ BELUM BAYAR";

    msg += `📌 *${b.bill_name}*\n`;
    msg += ` • Nominal: *${formatRupiah(b.amount)}*\n`;
    msg += ` • Jatuh Tempo: Setiap tanggal *${b.due_day}*\n`;
    msg += ` • Status (${currentMonth}): *${statusText}*\n\n`;
  }

  msg += `💡 _Tandai sudah lunas: \`/tagihan bayar <nama>\`_\n_Hapus tagihan: \`/tagihan hapus <nama>\`_`;
  return msg.trim();
}

export function formatBillReminder(bill: { bill_name: string; amount: number; due_day: number }, daysLeft: number): string {
  const urgency = daysLeft === 0 ? "🚨 *HARI INI JATUH TEMPO!*" : `⏳ *Jatuh tempo dalam ${daysLeft} hari lagi!*`;
  return `⏰ *PENGINGAT TAGIHAN BULANAN*\n\n${urgency}\n📌 *Tagihan:* ${bill.bill_name}\n💰 *Nominal:* *${formatRupiah(bill.amount)}*\n📅 *Tanggal Jatuh Tempo:* Tgl ${bill.due_day}\n\n💡 _Jika sudah dibayar, ketik:_ \`/tagihan bayar ${bill.bill_name}\``;
}

export function formatBillCreatedSuccess(bill: { bill_name: string; amount: number; due_day: number }): string {
  return `✅ *Tagihan Rutin Berhasil Didaftarkan!*\n\n📌 *Nama Tagihan:* ${bill.bill_name}\n💰 *Nominal:* *${formatRupiah(bill.amount)}*\n📅 *Jatuh Tempo:* Setiap tanggal *${bill.due_day}*\n\n💡 _Bot akan otomatis mengirimkan japri pengingat pada H-3 jam 08:00 WITA jika belum dibayar._`;
}

export function formatBillPaidSuccess(billName: string, amount: number, period: string): string {
  return `✅ *Tagihan ${billName} Telah Ditandai LUNAS (${period})!*\n\n💰 *Nominal:* ${formatRupiah(amount)}\n🧾 Transaksi pengeluaran telah otomatis dicatat ke dalam kas.`;
}

