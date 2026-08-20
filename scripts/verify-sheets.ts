import { google } from "googleapis";
import { config } from "../src/config/env.js";

async function verify() {
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = config.GOOGLE_SHEET_ID;

  const trxRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Transaksi!A1:L10",
  });
  console.log("=== TRANSAKSI ROWS ===");
  console.table(trxRes.data.values);

  const dashRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Dashboard!A1:H18",
  });
  console.log("=== DASHBOARD CALCULATED VALUES ===");
  console.table(dashRes.data.values);
}

verify();
