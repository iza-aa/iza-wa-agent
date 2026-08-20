import { getSupabaseClient } from "../src/db/supabase.js";
import { google } from "googleapis";
import { config } from "../src/config/env.js";
import { setupExactDashboard } from "./setup-exact-dashboard.js";

async function resetAllFinancialData() {
  console.log("🚀 Memulai proses RESET TOTAL data transaksi...");

  const supabase = getSupabaseClient();

  // 1. Reset Supabase transaction_items & transactions & chat_logs
  console.log("🗑️ Menghapus data transaksi di Supabase...");
  const { error: errItems } = await supabase.from("transaction_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (errItems) console.warn("Items delete warning:", errItems);

  const { error: errTrx } = await supabase.from("transactions").delete().neq("id", "placeholder");
  if (errTrx) console.warn("Transactions delete warning:", errTrx);

  const { error: errChat } = await supabase.from("chat_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (errChat) console.warn("Chat logs delete warning:", errChat);

  console.log("✅ Database Supabase (transaksi, rincian barang, riwayat chat) berhasil dikosongkan!");

  // 2. Reset Google Sheets - Tab Transaksi
  console.log("📊 Membersihkan tab Transaksi di Google Sheets...");
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = config.GOOGLE_SHEET_ID;

  // Clear data in Transaksi from row 2 downwards (A2:Z)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "Transaksi!A2:Z1000",
  });

  // Ensure row 1 header is clean and correct
  const headers = [
    "ID",
    "Timestamp",
    "Tanggal",
    "Jenis",
    "Kategori",
    "Keterangan",
    "Nominal",
    "Metode",
    "Nomor WhatsApp",
    "Nama",
    "Link Bukti",
    "Pesan Asli",
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Transaksi!A1:L1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [headers],
    },
  });

  console.log("✅ Tab Transaksi berhasil dikosongkan (Header A1:L1 tetap rapi)!");

  // 3. Re-initialize Dashboard
  console.log("📈 Menyetel ulang tab Dashboard...");
  await setupExactDashboard();
  console.log("✅ Tab Dashboard berhasil di-reset ke status bersih (Rp0)!");

  // 4. Verify Active Users remain intact
  const { data: users } = await supabase.from("users").select("phone_number, name, role, status");
  console.log("\n👥 Daftar Pengguna Aktif yang Tetap Tersimpan:");
  console.table(users);

  console.log("\n🎉 RESET BERHASIL! Seluruh sistem siap digunakan dari awal oleh Ayah!");
}

resetAllFinancialData();
