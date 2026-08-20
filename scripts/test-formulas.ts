import { google } from "googleapis";
import { config } from "../src/config/env.js";

async function testFormulas() {
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = config.GOOGLE_SHEET_ID;

  // Formula 1: SORT with FILTER and CHOOSECOLS
  const formulaA14 = '=IFERROR(SORT(FILTER(CHOOSECOLS(Transaksi!A2:L; 3; 6; 4; 7); Transaksi!A2:A<>""); 1; FALSE); "Belum ada transaksi")';
  
  // Clean Category breakdown formula for Pie Chart
  const formulaJ14 = '=IFERROR(QUERY(Transaksi!A2:L; "SELECT E, SUM(G) WHERE D = \'Pengeluaran\' GROUP BY E LABEL E \'\', SUM(G) \'\'"; 0); {"Lain-lain"\\ 0})';

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Dashboard!A14",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[formulaA14]] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Dashboard!J14",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[formulaJ14]] },
  });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Dashboard!J13:K20",
  });
  console.log("Pie Chart Data Output (J13:K20):");
  console.table(res.data.values);
}

testFormulas();
