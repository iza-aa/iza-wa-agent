import { getSupabaseClient } from "../src/db/supabase.js";

async function fixIndra() {
  const supabase = getSupabaseClient();

  // 1. Unblock / reactivate the registered phone number
  const { data: updated, error: err1 } = await supabase
    .from("users")
    .update({ status: "active", role: "super_admin", updated_at: new Date().toISOString() })
    .eq("phone_number", "6282147440520")
    .select()
    .single();

  console.log("Updated 6282147440520:", updated, err1);

  // 2. Also add the LID as an active user entry
  const { data: lid, error: err2 } = await supabase
    .from("users")
    .upsert({
      phone_number: "113404400390171",
      name: "Indra",
      role: "super_admin",
      status: "active",
      updated_at: new Date().toISOString(),
    }, { onConflict: "phone_number" })
    .select()
    .single();

  console.log("Upserted LID 113404400390171:", lid, err2);

  // 3. Show all users
  const { data: all } = await supabase.from("users").select("phone_number, name, role, status");
  console.log("\n=== ALL USERS ===");
  console.table(all);
}

fixIndra();
