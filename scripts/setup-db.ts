import { getSupabaseClient } from "../src/db/supabase.js";
import { config } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  console.log("🔍 Checking Supabase connection to:", config.SUPABASE_URL);
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.from("users").select("count", { count: "exact", head: true });

  if (error) {
    console.log("\n⚠️ Tabel users belum ditemukan atau belum dibuat di Supabase.");
    console.log("Silakan buka SQL Editor di Supabase Dashboard:");
    console.log("👉 https://supabase.com/dashboard/project/" + config.SUPABASE_URL.replace(/https:\/\/|\.supabase\.co/g, "") + "/sql");
    console.log("\nLalu copy-paste dan jalankan isi file migration berikut:");
    console.log("📁 supabase/migrations/20260820_initial_schema.sql\n");
  } else {
    console.log("✅ Supabase berhasil terhubung dan tabel users sudah aktif!");
  }
}

main().catch(console.error);
