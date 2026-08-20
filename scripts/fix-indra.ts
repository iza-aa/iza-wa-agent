import { getSupabaseClient } from "../src/db/supabase.js";

async function removeIndra() {
  const supabase = getSupabaseClient();
  await supabase.from("users").delete().eq("phone_number", "6282147440520");
  await supabase.from("users").delete().eq("phone_number", "113404400390171");
  const { data } = await supabase.from("users").select("phone_number, name, role, status");
  console.log("✅ Indra dihapus. Users sekarang:");
  console.table(data);
}

removeIndra();
