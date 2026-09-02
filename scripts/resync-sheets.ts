import { google } from "googleapis";
import { config } from "../src/config/env.js";
import { getSupabaseClient } from "../src/db/supabase.js";
import { setupExactDashboard } from "./setup-exact-dashboard.js";

function isIncome(trx: any): boolean {
  if (trx.status === "income") return true;
  const cat = (trx.category || "").toLowerCase();
  const merch = (trx.merchant || "").toLowerCase();
  const raw = (trx.raw_text || "").toLowerCase();

  return (
    cat.includes("pemasukan") ||
    cat.includes("gaji") ||
    cat.includes("income") ||
    cat.includes("transfer masuk") ||
    cat.includes("setoran tunai") ||
    merch.includes("pemasukan") ||
    merch.includes("gaji bulanan") ||
    raw.includes("pemasukan") ||
    raw.includes("/pemasukan") ||
    raw.includes("transfer masuk")
  );
}

async function resyncAllTransactions() {
  console.log("Fetching all transactions from Supabase...");
  const supabase = getSupabaseClient();
  const { data: transactions, error } = await supabase
    .from("transactions")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    console.error("Error fetching transactions:", error);
    return;
  }

  console.log(`Found ${transactions.length} transactions in Supabase.`);

  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = config.GOOGLE_SHEET_ID;

  // Clear Transaksi sheet from row 2 onwards
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "Transaksi!A2:Z1000",
  });

  // Re-write Headers (A1:L1)
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
    requestBody: { values: [headers] },
  });

  // Format each row properly
  const rows = transactions.map((trx) => {
    const isInc = isIncome(trx);
    const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
    const dateFormatted = trx.date || new Date(trx.created_at).toISOString().split("T")[0];
    const timestampFormatted = new Date(trx.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    const cleanPhone = (trx.user_phone || "").startsWith("62") ? "+" + trx.user_phone : trx.user_phone;
    const paymentMethod = trx.payment_method || (isInc ? "Transfer Bank" : "Cash");

    return [
      trx.id, // A
      timestampFormatted, // B
      dateFormatted, // C
      typeLabel, // D
      trx.category || (isInc ? "Pemasukan: Lain-lain" : "Lain-lain"), // E
      trx.merchant || (isInc ? "Pemasukan" : "Belanja"), // F
      Number(trx.total_amount || 0), // G: Nominal (number)
      paymentMethod, // H
      cleanPhone, // I
      trx.user_name || "User", // J
      trx.gdrive_web_view_link ? `=HYPERLINK("${trx.gdrive_web_view_link}"; "Lihat Bukti")` : "-", // K
      trx.raw_text || "-", // L
    ];
  });

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Transaksi!A2:L${rows.length + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  }

  // Format Column G in Transaksi as Currency
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const trxSheet = spreadsheet.data.sheets?.find((s: any) => s.properties?.title === "Transaksi");
  const trxSheetId = trxSheet?.properties?.sheetId || 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: trxSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 6, endColumnIndex: 7 },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
              },
            },
            fields: "userEnteredFormat(numberFormat)",
          },
        },
      ],
    },
  });

  console.log("✅ Transaksi sheet resynced with clean 12-column layout!");

  // Re-run Dashboard layout & formulas setup
  console.log("Re-setting up Dashboard tab...");
  await setupExactDashboard(sheetId);
  console.log("🎉 Complete resync finished successfully!");
}

resyncAllTransactions();
