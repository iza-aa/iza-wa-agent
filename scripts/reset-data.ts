import { getSupabaseClient } from "../src/db/supabase.js";
import { googleSheetsService } from "../src/google/sheets.service.js";
import { googleDriveService } from "../src/google/drive.service.js";
import { config } from "../src/config/env.js";
import { google } from "googleapis";

async function main() {
  console.log("==========================================");
  console.log("🧹 MEMULAI PROSES RESET DATA (BERSIH TOTAL)");
  console.log("==========================================");

  const supabase = getSupabaseClient();

  // 1. Reset Supabase Tables (receipt_items, transactions, chat_logs)
  console.log("\n1. Mengosongkan data transaksi di Supabase Database...");
  const { error: errItems } = await supabase.from("receipt_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (errItems) console.error("Error clearing receipt_items:", errItems.message);
  else console.log("   ✅ Tabel receipt_items berhasil dikosongkan.");

  const { error: errTrx } = await supabase.from("transactions").delete().neq("id", "DUMMY");
  if (errTrx) console.error("Error clearing transactions:", errTrx.message);
  else console.log("   ✅ Tabel transactions berhasil dikosongkan.");

  const { error: errChat } = await supabase.from("chat_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (errChat) console.error("Error clearing chat_logs:", errChat.message);
  else console.log("   ✅ Tabel chat_logs berhasil dikosongkan.");

  console.log("   ℹ️ Tabel users TETAP DIPERTAHANKAN (Super Admin & Anggota aman).");

  // 2. Reset Supabase Storage files
  console.log("\n2. Mengosongkan file di Supabase Storage bucket 'receipt'...");
  try {
    const { data: files, error: listErr } = await supabase.storage.from("receipt").list("expenses", { limit: 100 });
    if (files && files.length > 0) {
      for (const item of files) {
        if (item.name.includes(".")) {
          await supabase.storage.from("receipt").remove([`expenses/${item.name}`]);
        } else {
          // It's a folder (like year/month)
          const { data: subFiles } = await supabase.storage.from("receipt").list(`expenses/${item.name}`, { limit: 100 });
          if (subFiles && subFiles.length > 0) {
            for (const subItem of subFiles) {
              if (subItem.name.includes(".")) {
                await supabase.storage.from("receipt").remove([`expenses/${item.name}/${subItem.name}`]);
              } else {
                const { data: subSubFiles } = await supabase.storage.from("receipt").list(`expenses/${item.name}/${subItem.name}`, { limit: 100 });
                if (subSubFiles && subSubFiles.length > 0) {
                  const paths = subSubFiles.map(f => `expenses/${item.name}/${subItem.name}/${f.name}`);
                  await supabase.storage.from("receipt").remove(paths);
                }
              }
            }
          }
        }
      }
      console.log("   ✅ Supabase Storage bucket 'receipt' berhasil dibersihkan.");
    } else {
      console.log("   ✅ Supabase Storage sudah kosong.");
    }
  } catch (err: any) {
    console.warn("   ⚠️ Peringatan Supabase Storage:", err.message);
  }

  // 3. Reset Google Drive Folder contents
  console.log("\n3. Membersihkan folder Google Drive...");
  try {
    const auth = new google.auth.JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth });

    const rootFolderId = config.GOOGLE_DRIVE_FOLDER_ID;
    const res = await drive.files.list({
      q: `"${rootFolderId}" in parents and trashed = false`,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const items = res.data.files || [];
    if (items.length > 0) {
      for (const file of items) {
        if (file.id) {
          try {
            await drive.files.update({ fileId: file.id, requestBody: { trashed: true }, supportsAllDrives: true });
            console.log(`   🗑️ Memindahkan item Drive ke Sampah: ${file.name}`);
          } catch (e: any) {
            console.warn(`   ⚠️ Tidak bisa menghapus Drive file ${file.name}:`, e.message);
          }
        }
      }
      console.log("   ✅ Folder transaksi di Google Drive berhasil dibersihkan.");
    } else {
      console.log("   ✅ Google Drive sudah bersih.");
    }
  } catch (err: any) {
    console.error("   ❌ Error membersihkan Google Drive:", err.message);
  }

  // 4. Reset Google Sheets (Clear Rows A2:P in Transaksi tab)
  console.log("\n4. Mengosongkan data baris di Google Sheets...");
  try {
    const auth = new google.auth.JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.GOOGLE_SHEET_ID });
    const tabNames = (meta.data.sheets || []).map((s: any) => s.properties?.title);
    console.log("   Daftar tab Google Sheets:", tabNames.join(", "));

    const targetTab = tabNames.find((t: string) => t.toLowerCase().includes("transaksi")) || tabNames[0];

    await sheets.spreadsheets.values.clear({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: `${targetTab}!A2:P5000`,
    });

    console.log(`   ✅ Baris transaksi di Google Sheets tab '${targetTab}' berhasil dikosongkan (Header kolom tetap utuh).`);

    // Ensure header row is intact in Data Transaksi tab
    await googleSheetsService.ensureSheetInitialized();
    console.log("   ✅ Header kolom Google Sheet diverifikasi dan siap.");
  } catch (err: any) {
    console.error("   ❌ Error membersihkan Google Sheets:", err.message);
  }

  console.log("\n==========================================");
  console.log("🎉 SEMUA DATA TELAH BERHASIL DIRESET MENJADI BARU!");
  console.log("==========================================");
}

main().catch(console.error);
