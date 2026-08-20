import { getSupabaseClient } from "../src/db/supabase.js";
import { googleSheetsService } from "../src/google/sheets.service.js";

async function fixDates() {
  const supabase = getSupabaseClient();
  const { data: trxs } = await supabase
    .from("transactions")
    .select("id, date, created_at, merchant, total_amount");

  console.log("=== TRANSACTIONS BEFORE FIX ===");
  console.table(trxs);

  // Update any transaction whose date year is not 2026 to today's date (2026-08-20)
  for (const trx of trxs || []) {
    if (trx.date && !trx.date.startsWith("2026")) {
      const actualDate = "2026-08-20";
      console.log(`Fixing ${trx.id}: ${trx.date} -> ${actualDate}`);
      await supabase
        .from("transactions")
        .update({ date: actualDate, updated_at: new Date().toISOString() })
        .eq("id", trx.id);
    }
  }

  const { data: fixedTrxs } = await supabase
    .from("transactions")
    .select("id, date, created_at, merchant, total_amount");

  console.log("\n=== TRANSACTIONS AFTER FIX ===");
  console.table(fixedTrxs);
}

fixDates();
