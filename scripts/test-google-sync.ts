import { googleSheetsService } from "../src/google/sheets.service.js";
import { config } from "../src/config/env.js";

async function main() {
  console.log("🚀 Testing Google Sheets Integration directly...");
  console.log("Sheet ID:", config.GOOGLE_SHEET_ID);
  console.log("Service Account:", config.GOOGLE_SERVICE_ACCOUNT_EMAIL);

  console.log("\n1. Appending transaction to Google Sheet...");
  const sheetResult = await googleSheetsService.appendTransaction(
    {
      id: "TRX-TEST-" + Date.now().toString().slice(-4),
      user_phone: config.SUPER_ADMIN_PHONE,
      user_name: "Test User",
      date: new Date().toISOString().slice(0, 10),
      merchant: "Toko Uji Coba",
      category: "Makanan & Minuman",
      subtotal: 50000,
      tax: 0,
      discount: 0,
      total_amount: 50000,
      payment_method: "QRIS",
      gdrive_web_view_link: "https://ikqlyniyyfdtlyfdkmmv.supabase.co/storage/v1/object/public/receipts/test.webp",
      status: "test_verified",
    },
    [
      { item_name: "Nasi Goreng Spesial", qty: 2, price: 25000, total_price: 50000 },
    ]
  );
  console.log("✅ Google Sheets Append Success! Row Index:", sheetResult.rowIndex);
  console.log("🎉 Google Sheets Integration is working 100%!");
}

main().catch((err) => {
  console.error("❌ Google Sheets Test Failed:", err);
  process.exit(1);
});
