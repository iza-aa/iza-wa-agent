import { google } from "googleapis";
import { config } from "../src/config/env.js";
import { getSupabaseClient } from "../src/db/supabase.js";

async function main() {
  console.log("=== Checking Supabase ===");
  const supabase = getSupabaseClient();
  const { data: trxs, error: err1 } = await supabase.from("transactions").select("*").order("created_at", { ascending: true });
  if (err1) console.error("Supabase err:", err1);
  console.log(`Total transactions in DB: ${trxs?.length}`);

  const hMap = new Map();
  trxs?.forEach((t) => {
    const m = t.id.match(/H(\d+)/i);
    if (m) {
      const num = parseInt(m[1], 10);
      hMap.set(num, t);
    }
  });

  const hKeys = Array.from(hMap.keys()).sort((a,b) => a - b);
  console.log(`Total H-IDs: ${hKeys.length}, Min: ${hKeys[0]}, Max: ${hKeys[hKeys.length-1]}`);

  const missingH = [];
  for (let i = hKeys[0]; i <= hKeys[hKeys.length-1]; i++) {
    if (!hMap.has(i)) {
      missingH.push(i);
    }
  }
  console.log("Missing H numbers in DB sequence:", missingH);

  // Let's print H around 115 to 125
  for (let i = 110; i <= 126; i++) {
    if (hMap.has(i)) {
      const t = hMap.get(i);
      console.log(`H${i.toString().padStart(3, '0')}: ID=${t.id} | Date=${t.date} | Total=${t.total_amount} | Status=${t.status} | Row=${t.gsheet_row_index} | Merchant=${t.merchant} | Raw=${t.raw_text?.substring(0, 40)}`);
    } else {
      console.log(`H${i.toString().padStart(3, '0')}: [MISSING IN DB]`);
    }
  }

  console.log("\n=== Checking 'Transaksi' sheet row by row ===");
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = config.GOOGLE_SHEET_ID;

  const trxRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Transaksi!A110:L126",
  });
  const rows = trxRes.data.values || [];
  console.log(`Transaksi rows 110-126:`);
  rows.forEach((r, idx) => {
    console.log(`Row ${110 + idx}: ${r[0]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} | ${r[6]} | ${r[11]}`);
  });

  console.log("\n=== Checking Rincian Belanja around H115-H125 ===");
  const rinciRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Rincian Belanja!A1:L500",
  });
  const rinciRows = rinciRes.data.values || [];
  console.log(`Total rows in Rincian Belanja: ${rinciRows.length}`);
  rinciRows.forEach((r, idx) => {
    const s = JSON.stringify(r);
    if (s.includes("H115") || s.includes("H116") || s.includes("H117") || s.includes("H118") || s.includes("H119") || s.includes("H120") || s.includes("H121") || s.includes("H122") || s.includes("H123") || s.includes("H124")) {
      console.log(`Rincian Belanja Row ${idx + 1}:`, r);
    }
  });

  console.log("\n=== Checking Data_Rincian around H115-H125 ===");
  const dataRinciRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Data_Rincian!A1:L500",
  });
  const dataRinciRows = dataRinciRes.data.values || [];
  console.log(`Total rows in Data_Rincian: ${dataRinciRows.length}`);
  dataRinciRows.forEach((r, idx) => {
    const s = JSON.stringify(r);
    if (s.includes("H115") || s.includes("H116") || s.includes("H117") || s.includes("H118") || s.includes("H119") || s.includes("H120") || s.includes("H121") || s.includes("H122") || s.includes("H123") || s.includes("H124")) {
      console.log(`Data_Rincian Row ${idx + 1}:`, r);
    }
  });
}

main().catch(console.error);
