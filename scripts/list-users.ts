import { getSupabaseClient } from "../src/db/supabase.js";

async function listUsers() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("users").select("*");
  console.log("=== USERS IN DATABASE ===");
  console.table(data);
}

listUsers();
