import { google } from "googleapis";
import { config } from "../src/config/env.js";

async function cleanLeftoverColumns() {
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = config.GOOGLE_SHEET_ID;

  // Clear range M1:Z100 on Transaksi
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: "Transaksi!M1:Z100",
  });

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const trxSheet = spreadsheet.data.sheets?.find((s: any) => s.properties?.title === "Transaksi");
  const trxSheetId = trxSheet?.properties?.sheetId || 0;

  // Unformat and clear any borders or backgrounds on M1:Z100
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: trxSheetId,
              startRowIndex: 0,
              endRowIndex: 100,
              startColumnIndex: 12,
              endColumnIndex: 26,
            },
            cell: {
              userEnteredFormat: {},
            },
            fields: "userEnteredFormat",
          },
        },
      ],
    },
  });

  console.log("✅ Kolom M s/d Z di tab Transaksi berhasil dihapus dan dibersihkan!");
}

cleanLeftoverColumns();
